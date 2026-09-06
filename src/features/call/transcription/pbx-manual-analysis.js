import { MessageType } from '../../../shared/messages.js';
import { transcribeRecord } from './background.js';
import { postprocessTranscript } from './ai-postprocessor.js';

const JOBS_KEY = 'simnet_workbench_pbx_manual_analysis_jobs_v1';
const JOB_SCHEMA = 1;
const MAX_JOBS = 120;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'transcribing', 'analyzing']);
const running = new Map();

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 500) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function abortError(message = 'Отменено оператором') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbort(error, signal = null) {
  return Boolean(signal?.aborted || error?.name === 'AbortError');
}

function recordIdOf(value) {
  return String(value || '').match(/(?:getrec\.php\?id=)?(\d{9,12}\.\d{1,12})/i)?.[1] || '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}

function normalizeCall(raw = {}) {
  const recordId = recordIdOf(raw.recordId || raw.recordUrl || raw.callId);
  if (!recordId) throw new Error('PBX manual analysis: recordId не найден');
  return {
    recordId,
    callKey: `pbx:${recordId}`,
    recordUrl: `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}`,
    rowNumber: clean(raw.rowNumber, 24),
    date: clean(raw.date, 24),
    time: clean(raw.time, 24),
    callerId: normalizePhone(raw.callerId),
    providerCode: clean(raw.providerCode, 20),
    contract: clean(raw.contract, 80),
    fio: clean(raw.fio, 180),
    address: clean(raw.address, 300),
    duration: clean(raw.duration, 32),
    queue: clean(raw.queue, 40),
    agent: clean(raw.agent, 180)
  };
}

function senderIsPbx(sender = {}) {
  try {
    const url = new URL(String(sender?.url || sender?.tab?.url || ''));
    return url.protocol === 'https:' && url.hostname === 'pbx.simnet.kiev.ua';
  } catch {
    return false;
  }
}

function shape(raw = {}) {
  const jobs = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return jobs;
}

async function readJobs() {
  const raw = (await chrome.storage.local.get(JOBS_KEY))?.[JOBS_KEY] || {};
  return shape(raw);
}

function prune(jobs = {}) {
  const cutoff = Date.now() - RETENTION_MS;
  const entries = Object.entries(jobs)
    .filter(([, job]) => Number(job?.createdAtMs || 0) >= cutoff)
    .sort(([, a], [, b]) => Number(b?.createdAtMs || 0) - Number(a?.createdAtMs || 0))
    .slice(0, MAX_JOBS);
  return Object.fromEntries(entries);
}

async function writeJob(recordId, patch = {}) {
  const jobs = await readJobs();
  const previous = jobs[recordId] || {};
  const createdAtMs = Number(previous.createdAtMs || 0) || Date.now();
  const next = {
    schemaVersion: JOB_SCHEMA,
    ...previous,
    ...patch,
    recordId,
    createdAtMs,
    createdAt: previous.createdAt || new Date(createdAtMs).toISOString(),
    updatedAt: nowIso()
  };
  jobs[recordId] = next;
  await chrome.storage.local.set({ [JOBS_KEY]: prune(jobs) });
  return next;
}

async function reconcileInterruptedJobs() {
  const jobs = await readJobs();
  let changed = false;
  const now = nowIso();
  for (const [recordId, job] of Object.entries(jobs)) {
    if (!ACTIVE_STATUSES.has(job?.status) || running.has(recordId)) continue;
    jobs[recordId] = {
      ...job,
      status: 'interrupted',
      error: 'Обработка была прервана или Service Worker перезапустился. Нажмите ↻, чтобы продолжить.',
      completedAt: now,
      updatedAt: now
    };
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ [JOBS_KEY]: prune(jobs) });
  return jobs;
}

async function markCancelled(recordId) {
  return writeJob(recordId, {
    status: 'cancelled',
    error: '',
    aiError: '',
    cancelledAt: nowIso(),
    completedAt: nowIso()
  });
}

async function process(call, { forceTranscribe = false, forceAnalysis = false } = {}) {
  const recordId = call.recordId;
  if (running.has(recordId)) return running.get(recordId).promise;

  const controller = new AbortController();
  const signal = controller.signal;
  const promise = (async () => {
    await writeJob(recordId, {
      call,
      callKey: call.callKey,
      status: 'downloading',
      error: '',
      aiError: ''
    });

    try {
      if (signal.aborted) throw abortError();
      const transcript = await transcribeRecord({
        callKey: call.callKey,
        recordUrl: call.recordUrl,
        profile: 'simnet',
        language: 'auto',
        force: Boolean(forceTranscribe)
      }, async (stage, details = {}) => {
        if (signal.aborted) return;
        if (stage === 'AUDIO_FETCHING') {
          await writeJob(recordId, { status: 'downloading' });
        } else if (stage === 'TRANSCRIBING') {
          await writeJob(recordId, { status: 'transcribing' });
        } else if (stage === 'TRANSCRIPT_READY') {
          await writeJob(recordId, {
            status: 'transcribed',
            transcriptMeta: {
              cached: Boolean(details.cached),
              language: clean(details.language, 24),
              durationSeconds: Number(details.durationSeconds || 0),
              processingSeconds: Number(details.processingSeconds || 0),
              fileBytes: Number(details.fileBytes || 0),
              requestId: clean(details.requestId, 120)
            }
          });
        }
      }, signal);

      if (signal.aborted) throw abortError();
      await writeJob(recordId, {
        status: 'analyzing',
        transcript: {
          text: String(transcript.text || ''),
          language: clean(transcript.language, 24),
          languageProbability: Number(transcript.languageProbability || 0),
          durationSeconds: Number(transcript.durationSeconds || 0),
          processingSeconds: Number(transcript.processingSeconds || 0),
          requestId: clean(transcript.requestId, 120),
          cached: Boolean(transcript.cached)
        }
      });

      try {
        const analysis = await postprocessTranscript({
          callKey: call.callKey,
          pbxRecordId: recordId,
          manualPbx: true,
          forceAnalysis: Boolean(forceAnalysis)
        }, transcript, signal);
        if (signal.aborted) throw abortError();
        return await writeJob(recordId, {
          status: 'ready',
          analysis,
          aiError: '',
          completedAt: nowIso()
        });
      } catch (error) {
        if (isAbort(error, signal)) return markCancelled(recordId);
        return await writeJob(recordId, {
          status: 'transcribed',
          analysis: null,
          aiError: clean(error?.message || error || 'AI analysis failed', 700),
          completedAt: nowIso()
        });
      }
    } catch (error) {
      if (isAbort(error, signal)) return markCancelled(recordId);
      return writeJob(recordId, {
        status: 'error',
        error: clean(error?.message || error || 'PBX manual analysis failed', 700),
        completedAt: nowIso()
      });
    }
  })();

  running.set(recordId, { promise, controller });
  try {
    return await promise;
  } finally {
    const current = running.get(recordId);
    if (current?.promise === promise) running.delete(recordId);
  }
}

async function start(payload = {}) {
  const call = normalizeCall(payload.call || {});
  const existing = (await readJobs())[call.recordId] || null;
  const force = Boolean(payload.force);

  if (existing && !force && ['ready', 'transcribed'].includes(existing.status)) return existing;
  const active = running.get(call.recordId);
  if (active) return active.promise;

  await writeJob(call.recordId, {
    call,
    callKey: call.callKey,
    status: 'queued',
    error: '',
    aiError: ''
  });

  return process(call, {
    forceTranscribe: Boolean(payload.forceTranscribe),
    forceAnalysis: Boolean(payload.forceAnalysis)
  });
}

async function cancel(payload = {}) {
  const recordId = recordIdOf(payload.recordId);
  if (!recordId) throw new Error('PBX manual analysis cancel: recordId не найден');
  const active = running.get(recordId);
  if (active && !active.controller.signal.aborted) active.controller.abort('operator-cancel');
  return markCancelled(recordId);
}

async function status(payload = {}) {
  const jobs = await reconcileInterruptedJobs();
  const recordId = recordIdOf(payload.recordId);
  return recordId ? (jobs[recordId] || null) : jobs;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (![
    MessageType.PBX_MANUAL_ANALYSIS_START,
    MessageType.PBX_MANUAL_ANALYSIS_CANCEL,
    MessageType.PBX_MANUAL_ANALYSIS_STATUS
  ].includes(type)) return false;

  if (!senderIsPbx(sender)) {
    sendResponse({ success: false, error: 'PBX manual analysis request rejected: invalid sender' });
    return false;
  }

  const action = type === MessageType.PBX_MANUAL_ANALYSIS_START
    ? start(message?.payload || {})
    : type === MessageType.PBX_MANUAL_ANALYSIS_CANCEL
      ? cancel(message?.payload || {})
      : status(message?.payload || {});

  void action
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: clean(error?.message || error || 'unknown error', 700) }));
  return true;
});

export const PBX_MANUAL_ANALYSIS_JOBS_KEY = JOBS_KEY;
