import { MessageType } from '../../../shared/messages.js';
import { readTranscript, transcribeRecord } from './background.js';
import { writeTranscriptToUserSide } from './userside-writer.js';

const WORKBENCH_STATE_KEY = 'simnet_workbench_state_v5';
const JOB_STORE_KEY = 'simnet_workbench_transcription_jobs_v1';
const JOB_SCHEMA = 1;
const MAX_JOBS = 40;
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_LOCK_WINDOW_MS = 5 * 60 * 1000;
const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const USERSIDE_RESUME_STATES = new Set([
  'TRANSCRIPT_READY',
  'WAIT_TASK_ID',
  'USERSIDE_ERROR',
  'USERSIDE_REVIEW'
]);

let writeQueue = Promise.resolve();
const processing = new Set();

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function digits(value, max = 24) {
  return String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
}

function bindingState(binding = {}) {
  const raw = binding?.registrationStatus;
  return raw && typeof raw === 'object' ? String(raw.state || '') : String(raw || '');
}

function registeredAtMs(binding = {}) {
  return Date.parse(String(binding.registeredAt || binding.updatedAt || '')) || 0;
}

function isFreshRegisteredBinding(binding = {}, atMs = Date.now()) {
  if (bindingState(binding) !== 'registered') return false;
  const registered = registeredAtMs(binding);
  return Boolean(registered && atMs - registered >= 0 && atMs - registered <= AUTO_LOCK_WINDOW_MS);
}

function jobStoreShape(raw = {}) {
  return {
    schemaVersion: JOB_SCHEMA,
    updatedAt: String(raw.updatedAt || ''),
    jobs: raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {}
  };
}

async function readStore() {
  const raw = (await chrome.storage.local.get(JOB_STORE_KEY))?.[JOB_STORE_KEY] || {};
  return jobStoreShape(raw);
}

async function writeStore(mutator) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    const cutoff = Date.now() - JOB_RETENTION_MS;
    const jobs = Object.values(store.jobs || {})
      .filter(job => Number(job?.createdAtMs || 0) >= cutoff)
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
      .slice(0, MAX_JOBS);
    store.jobs = Object.fromEntries(jobs.map(job => [job.jobId, job]));
    store.updatedAt = nowIso();
    await chrome.storage.local.set({ [JOB_STORE_KEY]: store });
    return result;
  });
  return writeQueue;
}

function step(status = 'pending', at = '', detail = '') {
  return { status, at, detail: clean(detail, 300) };
}

function normalizeRecordId(call = {}) {
  return String(call.pbxRecordId || call.recordId || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
}

function normalizeCallKey(raw = '') {
  const match = String(raw || '').match(/^call:(\d{1,24})$/);
  return match ? `call:${match[1]}` : '';
}

function jobIdFor(callKey, customerId) {
  return `${callKey}:${customerId}`;
}

function lockedJobFromState(callKey, binding = {}, call = {}) {
  const normalizedKey = normalizeCallKey(callKey);
  const usersideCallId = digits(call.usersideCallId || normalizedKey.split(':')[1], 24);
  const customerId = digits(binding.customerId || binding.identity?.customerId || call.customerId, 14);
  const recordId = normalizeRecordId(call);
  if (!normalizedKey || !usersideCallId || !customerId) return null;

  const at = nowIso();
  const createdAtMs = Date.now();
  const hasPbx = Boolean(recordId);
  return {
    schemaVersion: JOB_SCHEMA,
    jobId: jobIdFor(normalizedKey, customerId),
    idempotencyKey: `call-registration:${usersideCallId}:${customerId}`,
    status: hasPbx ? 'QUEUED' : 'WAIT_PBX',
    callKey: normalizedKey,
    usersideCallId,
    customerId,
    caseId: clean(binding.caseId || binding.identity?.caseId, 120),
    customerLabel: clean(binding.caseLabel || binding.identity?.fullName || binding.identity?.login || call.fio, 160),
    phone: clean(call.callerMasked || call.callerId, 32),
    date: clean(call.date, 20),
    time: clean(call.time, 20),
    duration: clean(call.duration, 20),
    registeredAt: String(binding.registeredAt || at),
    pbxRecordId: recordId,
    recordUrl: recordId ? `${PBX_RECORD_BASE}${encodeURIComponent(recordId)}` : '',
    taskId: '',
    transcript: null,
    error: '',
    attempts: 0,
    createdAt: at,
    createdAtMs,
    updatedAt: at,
    steps: {
      lock: step('done', at, 'UserSide подтвердил сохранение; CALL закреплён'),
      pbx: step(hasPbx ? 'done' : 'waiting', hasPbx ? at : '', hasPbx ? `PBX ${recordId}` : 'ожидается PBX recordId'),
      audio: step('pending'),
      gpu: step('pending'),
      transcript: step('pending'),
      userside: step('pending', '', 'ожидается готовый транскрипт')
    }
  };
}

async function broadcast(job) {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://userside.simnet.kiev.ua/*',
      'https://admin.simnet.kiev.ua/*',
      'https://admin.looknet.kiev.ua/*'
    ] });
    await Promise.allSettled((tabs || []).map(tab => (
      tab?.id == null
        ? Promise.resolve()
        : chrome.tabs.sendMessage(tab.id, {
            type: MessageType.CALL_TRANSCRIPTION_JOB_CHANGED,
            payload: { jobId: job?.jobId || '' }
          })
    )));
  } catch {}
}

async function updateJob(jobId, mutate) {
  let snapshot = null;
  await writeStore(store => {
    const job = store.jobs?.[jobId];
    if (!job) return null;
    mutate(job);
    job.updatedAt = nowIso();
    snapshot = JSON.parse(JSON.stringify(job));
    return snapshot;
  });
  if (snapshot) await broadcast(snapshot);
  return snapshot;
}

async function onProgress(jobId, stage, details = {}) {
  const at = nowIso();
  await updateJob(jobId, job => {
    if (stage === 'AUDIO_FETCHING') {
      job.status = 'FETCH_AUDIO';
      job.steps.audio = step('running', at, 'скачиваю MP3 с PBX');
    } else if (stage === 'AUDIO_READY') {
      job.status = 'AUDIO_READY';
      job.steps.audio = step('done', at, `${Number(details.fileBytes || 0)} B`);
      job.steps.gpu = step('pending');
    } else if (stage === 'TRANSCRIBING') {
      job.status = 'TRANSCRIBING';
      job.steps.gpu = step('running', at, 'Whisper large-v3');
    } else if (stage === 'TRANSCRIPT_READY') {
      job.status = 'TRANSCRIPT_READY';
      job.steps.gpu = step('done', at, details.cached ? 'из кеша' : `${Number(details.processingSeconds || 0).toFixed(2)} сек.`);
      job.steps.transcript = step('done', at, details.language ? `язык ${details.language}` : 'текст получен');
      job.steps.userside = step('waiting', '', 'ищу созданное обращение UserSide');
    }
  });
}

function isTranscriberUnavailable(message) {
  return /Failed to fetch|Transcriber|127\.0\.0\.1|localhost|ERR_CONNECTION|таймаут|network/i.test(String(message || ''));
}

async function processUsersideWrite(jobId, transcriptEntry = null) {
  const token = `userside:${jobId}`;
  if (!jobId || processing.has(token)) return;
  processing.add(token);
  try {
    const store = await readStore();
    const job = store.jobs?.[jobId];
    if (!job || job.steps?.userside?.status === 'done') return;

    const entry = transcriptEntry?.text
      ? transcriptEntry
      : await readTranscript({ callKey: job.callKey });
    if (!entry?.text) {
      await updateJob(jobId, current => {
        current.status = 'TRANSCRIPT_READY';
        current.steps.userside = step('waiting', '', 'текст транскрипта не найден в локальном хранилище');
      });
      return;
    }

    await updateJob(jobId, current => {
      current.status = 'WRITING_USERSIDE';
      current.error = '';
      current.steps.userside = step('running', nowIso(), 'ищу task регистрации и добавляю комментарий');
    });

    const result = await writeTranscriptToUserSide(job, entry);
    await updateJob(jobId, current => {
      current.status = 'DONE';
      current.taskId = digits(result.taskId, 14);
      current.error = '';
      current.steps.userside = step(
        'done',
        nowIso(),
        result.alreadyWritten
          ? `task #${current.taskId} уже содержит транскрипт`
          : `добавлено в task #${current.taskId}`
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    await updateJob(jobId, current => {
      current.error = clean(message, 500);
      if (/^WAIT_TASK_ID:/i.test(message)) {
        current.status = 'WAIT_TASK_ID';
        current.steps.userside = step('waiting', '', message.replace(/^WAIT_TASK_ID:\s*/i, ''));
      } else if (/^USERSIDE_REVIEW:/i.test(message)) {
        current.status = 'USERSIDE_REVIEW';
        current.steps.userside = step('waiting', '', message.replace(/^USERSIDE_REVIEW:\s*/i, ''));
      } else {
        current.status = 'USERSIDE_ERROR';
        current.steps.userside = step('error', nowIso(), message);
      }
    });
  } finally {
    processing.delete(token);
  }
}

async function processJob(jobId, { force = false } = {}) {
  if (!jobId) return;

  const initialStore = await readStore();
  const initialJob = initialStore.jobs?.[jobId];
  if (!initialJob) return;
  if (initialJob.status === 'DONE' && !force) return;
  if (USERSIDE_RESUME_STATES.has(String(initialJob.status || '')) && !force) {
    await processUsersideWrite(jobId);
    return;
  }
  if (processing.has(jobId)) return;

  processing.add(jobId);
  try {
    const store = await readStore();
    const job = store.jobs?.[jobId];
    if (!job || !job.recordUrl) return;

    await updateJob(jobId, current => {
      current.attempts = Number(current.attempts || 0) + 1;
      current.error = '';
      if (current.steps.audio?.status === 'error' || current.steps.audio?.status === 'waiting') current.steps.audio = step('pending');
      if (current.steps.gpu?.status === 'error' || current.steps.gpu?.status === 'waiting') current.steps.gpu = step('pending');
      if (current.steps.transcript?.status === 'error') current.steps.transcript = step('pending');
    });

    const entry = await transcribeRecord({
      callKey: job.callKey,
      usersideCallId: job.usersideCallId,
      customerId: job.customerId,
      recordUrl: job.recordUrl,
      profile: 'simnet',
      language: 'auto',
      force
    }, (stage, details) => onProgress(jobId, stage, details));

    await updateJob(jobId, current => {
      current.status = 'TRANSCRIPT_READY';
      current.transcript = {
        callKey: entry.callKey,
        requestId: entry.requestId,
        language: entry.language,
        durationSeconds: Number(entry.durationSeconds || 0),
        processingSeconds: Number(entry.processingSeconds || 0),
        fileBytes: Number(entry.fileBytes || 0),
        audioSha256: entry.audioSha256,
        createdAt: entry.createdAt
      };
      current.steps.userside = step('waiting', '', 'ищу созданное обращение UserSide');
    });

    await processUsersideWrite(jobId, entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    await updateJob(jobId, current => {
      current.error = clean(message, 500);
      if (isTranscriberUnavailable(message)) {
        current.status = 'WAIT_TRANSCRIBER';
        if (current.steps.audio?.status === 'running') current.steps.audio = step('error', nowIso(), message);
        else current.steps.gpu = step('waiting', '', message);
      } else if (/^PBX|PBX\b/i.test(message)) {
        current.status = 'PBX_ERROR';
        current.steps.audio = step('error', nowIso(), message);
      } else {
        current.status = 'ERROR';
        current.steps.transcript = step('error', nowIso(), message);
      }
    });
  } finally {
    processing.delete(jobId);
  }
}

async function ensureJobsFromWorkbenchState(state = null) {
  const source = state || (await chrome.storage.local.get(WORKBENCH_STATE_KEY))?.[WORKBENCH_STATE_KEY] || {};
  const callState = source?.callModule || {};
  const bindings = callState?.bindings?.bindings || {};
  const calls = callState?.calls?.calls || {};
  const created = [];
  const atMs = Date.now();

  for (const [callKey, binding] of Object.entries(bindings)) {
    if (!isFreshRegisteredBinding(binding, atMs)) continue;
    const call = calls[callKey];
    if (!call) continue;
    const job = lockedJobFromState(callKey, binding, call);
    if (!job) continue;

    let inserted = false;
    let hydratedPbx = false;
    let snapshot = null;
    await writeStore(store => {
      const existing = store.jobs[job.jobId];
      if (existing) {
        if (!existing.registeredAt) existing.registeredAt = job.registeredAt;
        if (!existing.recordUrl && job.recordUrl) {
          existing.pbxRecordId = job.pbxRecordId;
          existing.recordUrl = job.recordUrl;
          existing.status = 'QUEUED';
          existing.steps.pbx = step('done', nowIso(), `PBX ${job.pbxRecordId}`);
          hydratedPbx = true;
        }
        snapshot = JSON.parse(JSON.stringify(existing));
        return existing;
      }
      store.jobs[job.jobId] = job;
      inserted = true;
      snapshot = JSON.parse(JSON.stringify(job));
      return job;
    });

    if (inserted) created.push(job);
    if (inserted || hydratedPbx) {
      if (snapshot) await broadcast(snapshot);
      if (snapshot?.recordUrl) queueMicrotask(() => void processJob(snapshot.jobId));
    }
  }
  return created;
}

async function listJobs() {
  const store = await readStore();
  return Object.values(store.jobs || {})
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
    .slice(0, 12);
}

async function resumePendingJobs() {
  const jobs = await listJobs();
  for (const job of jobs) {
    const status = String(job.status || '');
    if (status === 'TRANSCRIPT_READY' || status === 'WAIT_TASK_ID') {
      queueMicrotask(() => void processUsersideWrite(job.jobId));
    } else if (job.recordUrl && ['QUEUED', 'FETCH_AUDIO', 'AUDIO_READY', 'TRANSCRIBING'].includes(status)) {
      queueMicrotask(() => void processJob(job.jobId));
    }
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[WORKBENCH_STATE_KEY]?.newValue) return;
  void ensureJobsFromWorkbenchState(changes[WORKBENCH_STATE_KEY].newValue).catch(error => {
    console.error('[SIMNET WB][CALL JOBS] state lock failed', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (![MessageType.CALL_TRANSCRIPTION_JOB_LIST, MessageType.CALL_TRANSCRIPTION_JOB_RETRY].includes(message?.type)) return false;
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Call job request rejected' });
    return false;
  }

  const task = message.type === MessageType.CALL_TRANSCRIPTION_JOB_LIST
    ? listJobs()
    : (async () => {
        const jobId = clean(message?.payload?.jobId, 160);
        await processJob(jobId, { force: message?.payload?.force === true });
        const jobs = await listJobs();
        return jobs.find(job => job.jobId === jobId) || null;
      })();

  void task
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

void (async () => {
  await ensureJobsFromWorkbenchState();
  await resumePendingJobs();
})().catch(error => {
  console.error('[SIMNET WB][CALL JOBS] startup resume failed', error);
});
