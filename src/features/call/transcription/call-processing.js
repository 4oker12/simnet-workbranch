'use strict';

import { MessageType } from '../../../shared/messages.js';
import { CallRecord } from '../domain/call-record.js';
import { CallStateStore, WORKBENCH_STATE_KEY } from '../storage/call-state-store.js';
import { readTranscript, transcribeRecord } from './background.js';
import { writeTranscriptToUserSide } from './userside-writer.js';
import { callExecutionRegistry } from '../runtime/call-execution-registry.js';

const LEGACY_JOB_STORE_KEY = 'simnet_workbench_transcription_jobs_v1';
const AUTO_LOCK_WINDOW_MS = 5 * 60 * 1000;
const WAIT_PBX_ATTENTION_MS = 90 * 1000;
const PBX_RECORD_BASE = 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=';
const OWNER = 'registration';

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 240) {
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

function recordIdOf(call = {}) {
  return String(call.pbxRecordId || '').match(/^\d{9,12}\.\d{1,12}$/)?.[0] || '';
}

function recordUrl(call = {}) {
  const id = recordIdOf(call);
  return id ? `${PBX_RECORD_BASE}${encodeURIComponent(id)}` : '';
}

function waitAgeMs(call = {}, atMs = Date.now()) {
  const p = call.processing || {};
  const anchor = Date.parse(String(
    p.startedAt
    || call.registration?.registeredAt
    || p.updatedAt
    || call.updatedAt
    || call.observedAt
    || ''
  )) || Number(call.startedAtMs || 0);
  return anchor ? Math.max(0, atMs - anchor) : 0;
}

function processingStatus(call = {}) {
  const p = call.processing || {};
  const state = String(p.state || 'idle');
  const stage = String(p.stage || '');
  const error = String(p.error || '');

  if (state === 'done') return 'DONE';
  if (state === 'cancelled') return 'CANCELLED';
  if (state === 'stale') return 'STALE';
  if (state === 'failed') {
    if (stage === 'pbx' || stage === 'audio') return 'PBX_ERROR';
    if (stage === 'userside') return 'USERSIDE_ERROR';
    return 'ERROR';
  }
  if (state === 'running') {
    if (stage === 'audio') return 'FETCH_AUDIO';
    if (stage === 'whisper') return 'TRANSCRIBING';
    if (stage === 'ai') return 'ANALYZING';
    if (stage === 'userside') return 'WRITING_USERSIDE';
    return 'QUEUED';
  }
  if (state === 'waiting') {
    if (stage === 'pbx' || !call.pbxRecordId) return 'WAIT_PBX';
    if (stage === 'whisper' && error) return 'WAIT_TRANSCRIBER';
    if (stage === 'userside') {
      if (/review|проверк/i.test(error)) return 'USERSIDE_REVIEW';
      return 'WAIT_TASK_ID';
    }
    if (call.transcript?.storageKey || p.lastSuccessfulStage === 'whisper') return 'TRANSCRIPT_READY';
    return 'QUEUED';
  }
  if (call.registration?.state === 'registered') return call.pbxRecordId ? 'QUEUED' : 'WAIT_PBX';
  return 'IDLE';
}

function legacySteps(call = {}) {
  const p = call.processing || {};
  const steps = p.steps || {};
  const registrationDone = call.registration?.state === 'registered';
  const transcriptDone = Boolean(
    call.transcript?.storageKey
    || p.lastSuccessfulStage === 'whisper'
    || ['ai', 'userside'].includes(String(p.lastSuccessfulStage || ''))
  );
  return {
    lock: {
      status: registrationDone ? 'done' : 'pending',
      at: call.registration?.registeredAt || '',
      detail: registrationDone ? 'UserSide подтвердил сохранение; CALL закреплён' : ''
    },
    pbx: { ...(steps.pbx || { status: call.pbxRecordId ? 'done' : 'waiting', at: '', detail: '' }) },
    audio: { ...(steps.audio || { status: 'pending', at: '', detail: '' }) },
    gpu: { ...(steps.whisper || { status: 'pending', at: '', detail: '' }) },
    transcript: {
      status: transcriptDone ? 'done' : 'pending',
      at: call.transcript?.updatedAt || call.transcript?.createdAt || '',
      detail: transcriptDone ? (call.transcript?.language ? `язык ${call.transcript.language}` : 'текст получен') : ''
    },
    userside: { ...(steps.userside || { status: 'pending', at: '', detail: '' }) }
  };
}

function processingView(call = {}, atMs = Date.now()) {
  const record = CallRecord.from(call);
  const rawStatus = processingStatus(call);
  const p = call.processing || {};
  const ageMs = waitAgeMs(call, atMs);
  const waitSeconds = Math.round(ageMs / 1000);
  const linkedPbxInterrupted = rawStatus === 'WAIT_PBX' && Boolean(recordIdOf(call)) && ageMs >= AUTO_LOCK_WINDOW_MS;
  const status = linkedPbxInterrupted ? 'STALE' : rawStatus;
  const waitPbxAttention = rawStatus === 'WAIT_PBX' && !recordIdOf(call) && ageMs >= WAIT_PBX_ATTENTION_MS;
  const execution = callExecutionRegistry.get(call.callKey);
  const error = linkedPbxInterrupted
    ? 'PBX recordId получен, но цепочка обработки не продолжилась.'
    : String(p.error || call.writeback?.error || '');

  return {
    id: call.callKey,
    callKey: call.callKey,
    usersideCallId: digits(call.usersideCallId, 24),
    customerId: digits(call.subscriber?.customerId || call.customerId, 14),
    caseId: clean(call.subscriber?.caseId, 120),
    customerLabel: clean(call.fio || call.login || call.subscriber?.contract || '', 160),
    phone: clean(call.callerMasked || call.callerId, 32),
    date: clean(call.date, 20),
    time: clean(call.time, 20),
    duration: clean(call.duration, 20),
    registeredAt: String(call.registration?.registeredAt || ''),
    pbxRecordId: recordIdOf(call),
    recordUrl: recordUrl(call),
    taskId: digits(call.writeback?.taskId, 14),
    status,
    error,
    attempts: Number(p.attempts || 0),
    createdAt: call.firstObservedAt || call.observedAt || '',
    createdAtMs: Number(call.startedAtMs || 0),
    updatedAt: call.updatedAt || p.updatedAt || '',
    steps: legacySteps(call),
    needsAttention: linkedPbxInterrupted || waitPbxAttention || record.needsAttention(),
    active: execution?.state === 'running' || p.state === 'running',
    queued: execution?.state === 'queued' || status === 'QUEUED',
    canRetry: linkedPbxInterrupted || waitPbxAttention || rawStatus === 'WAIT_PBX' || record.canRetry(),
    canCancel: Boolean(execution) || record.canCancel(),
    waitSeconds,
    processing: { ...p }
  };
}

async function broadcast(callKey = '') {
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
            type: MessageType.CALL_PROCESSING_CHANGED,
            payload: { callKey: String(callKey || '') }
          })
    )));
  } catch {}
}

async function updateCall(callKey, mutator) {
  const next = await CallStateStore.mutate(callKey, mutator);
  if (next) await broadcast(next.callKey || callKey);
  return next;
}

function queueOrder(call = {}, fallback = '') {
  const registered = Date.parse(String(call.registration?.registeredAt || fallback || '')) || 0;
  const started = Number(call.startedAtMs || 0);
  return registered || started || Number.MAX_SAFE_INTEGER;
}

function recoverableWaitingCall(raw = {}) {
  const p = raw.processing || {};
  if (raw.registration?.state !== 'registered' || !recordIdOf(raw)) return false;
  if (p.attention) return false;
  if (!['idle', 'waiting'].includes(String(p.state || ''))) return false;
  const stage = String(p.stage || '');
  if (['', 'pbx', 'audio'].includes(stage)) return true;
  return stage === 'whisper' && Boolean(raw.transcript?.storageKey);
}

async function syncRegisteredCalls(stateHint = null) {
  const starts = await CallStateStore.mutateAll((store, state) => {
    const source = stateHint && stateHint.callModule ? stateHint : state;
    const bindings = source?.callModule?.bindings?.bindings || {};
    const candidates = new Map();
    const atMs = Date.now();
    const at = nowIso();

    const enqueue = (callKey, raw, fallback = '') => {
      const key = String(callKey || '');
      if (!key) return;
      const order = queueOrder(raw, fallback);
      const previous = candidates.get(key);
      if (!previous || order < previous.order) candidates.set(key, { callKey: key, order });
    };

    for (const [callKey, binding] of Object.entries(bindings)) {
      if (!isFreshRegisteredBinding(binding, atMs)) continue;
      const raw = store.calls?.[callKey];
      if (!raw) continue;

      const before = JSON.stringify(raw);
      const record = CallRecord.from(raw);
      record.bindSubscriber({
        ...(binding.identity || {}),
        caseId: binding.caseId || binding.identity?.caseId,
        customerId: binding.customerId || binding.identity?.customerId
      }, binding.updatedAt || at);
      record.setRegistration('registered', 'userside', binding.registeredAt || binding.updatedAt || at);

      const pbxId = recordIdOf(raw);
      if (pbxId) {
        const snapshot = record.toJSON();
        if (snapshot.processing?.steps?.pbx?.status !== 'done') record.attachPbx(pbxId, at);
        const p = record.processing;
        if (['idle', 'waiting'].includes(String(p.state || '')) && ['', 'pbx'].includes(String(p.stage || '')) && !p.attention) {
          if (String(p.lastSuccessfulStage || '') !== 'pbx') {
            record.completeStage('pbx', { detail: `PBX ${pbxId}` }, at);
          }
          enqueue(callKey, record.toJSON(), binding.registeredAt || binding.updatedAt);
        }
      } else {
        const p = record.processing;
        if (p.state === 'idle' || (p.state === 'waiting' && !p.stage)) {
          record.wait('pbx', 'ожидается PBX recordId', at, false);
          record.processing.startedAt ||= String(binding.registeredAt || binding.updatedAt || at);
        }
      }

      const next = record.toJSON();
      if (JSON.stringify(next) !== before) store.calls[callKey] = next;
    }

    for (const [callKey, raw] of Object.entries(store.calls || {})) {
      if (!recoverableWaitingCall(raw)) continue;
      const record = CallRecord.from(raw);
      const pbxId = recordIdOf(raw);
      if (record.processing?.steps?.pbx?.status !== 'done') record.attachPbx(pbxId, at);
      if (String(record.processing.lastSuccessfulStage || '') !== 'pbx'
          && ['', 'pbx'].includes(String(record.processing.stage || ''))) {
        record.completeStage('pbx', { detail: `PBX ${pbxId}` }, at);
      }
      const next = record.toJSON();
      if (JSON.stringify(next) !== JSON.stringify(raw)) store.calls[callKey] = next;
      enqueue(callKey, next);
    }

    return [...candidates.values()]
      .sort((a, b) => a.order - b.order || a.callKey.localeCompare(b.callKey))
      .map(row => row.callKey);
  });

  for (const callKey of Array.isArray(starts) ? starts : []) {
    queueMicrotask(() => void processCall(callKey));
  }
  return starts || [];
}

function writerPayload(call = {}) {
  return {
    jobId: call.callKey,
    callKey: call.callKey,
    usersideCallId: digits(call.usersideCallId, 24),
    customerId: digits(call.subscriber?.customerId || call.customerId, 14),
    caseId: clean(call.subscriber?.caseId, 120),
    customerLabel: clean(call.fio || call.login || '', 160),
    phone: clean(call.callerMasked || call.callerId, 32),
    date: clean(call.date, 20),
    time: clean(call.time, 20),
    duration: clean(call.duration, 20),
    registeredAt: String(call.registration?.registeredAt || ''),
    pbxRecordId: recordIdOf(call),
    recordUrl: recordUrl(call),
    taskId: digits(call.writeback?.taskId, 14)
  };
}

async function processUsersideWrite(callKey, transcriptEntry = null, signal = null) {
  if (signal?.aborted) return null;
  const raw = await CallStateStore.read(callKey);
  if (!raw || raw.processing?.state === 'cancelled') return raw;

  if (raw.writeback?.state === 'done') {
    if (raw.processing?.state === 'done') return raw;
    return updateCall(callKey, record => record.finish(nowIso(), 'UserSide writeback уже завершён'));
  }

  const entry = transcriptEntry?.text
    ? transcriptEntry
    : await readTranscript({ callKey });
  if (!entry?.text) {
    return updateCall(callKey, record => {
      record.wait('userside', 'текст транскрипта не найден в локальном хранилище', nowIso(), true);
      record.setWriteback('waiting', { error: 'текст транскрипта не найден' });
    });
  }

  await updateCall(callKey, record => {
    record.startStage('userside', nowIso(), { owner: OWNER });
    record.setWriteback('running');
  });

  try {
    if (signal?.aborted) return null;
    const current = await CallStateStore.read(callKey);
    const result = await writeTranscriptToUserSide(writerPayload(current || raw), entry);
    if (signal?.aborted) return null;
    return updateCall(callKey, record => {
      record.setWriteback('done', { taskId: result.taskId });
      record.completeStage('userside', {
        detail: result.alreadyWritten
          ? `task #${digits(result.taskId, 14)} уже содержит транскрипт`
          : `добавлено в task #${digits(result.taskId, 14)}`
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    if (signal?.aborted || error?.name === 'AbortError') return null;
    return updateCall(callKey, record => {
      if (/^WAIT_TASK_ID:/i.test(message)) {
        const detail = message.replace(/^WAIT_TASK_ID:\s*/i, '');
        record.wait('userside', detail, nowIso(), true);
        record.setWriteback('waiting', { error: detail });
      } else if (/^USERSIDE_REVIEW:/i.test(message)) {
        const detail = message.replace(/^USERSIDE_REVIEW:\s*/i, '');
        record.wait('userside', detail, nowIso(), true);
        record.setWriteback('review', { error: detail });
      } else {
        record.fail('userside', message);
        record.setWriteback('error', { error: message });
      }
    });
  }
}

function isTranscriberUnavailable(message) {
  return /Failed to fetch|Transcriber|127\.0\.0\.1|localhost|ERR_CONNECTION|таймаут|network/i.test(String(message || ''));
}

function processCall(callKey, { force = false } = {}) {
  const key = clean(callKey, 160);
  if (!key) return Promise.resolve(null);
  if (callExecutionRegistry.has(key)) return callExecutionRegistry.wait(key);

  return callExecutionRegistry.run(key, OWNER, async signal => {
    const initial = await CallStateStore.read(key);
    if (!initial) return null;
    if (initial.processing?.state === 'done' && !force) return initial;
    if (initial.processing?.state === 'cancelled' && !force) return initial;
    if (signal.aborted) return null;

    if (!recordIdOf(initial)) {
      return updateCall(key, record => {
        const p = record.processing;
        record.wait('pbx', 'PBX recordId пока не найден', nowIso(), false);
        p.startedAt ||= record.toJSON().registration?.registeredAt || nowIso();
      });
    }

    if (initial.transcript?.storageKey && !force) {
      const cached = await readTranscript({ callKey: key });
      if (cached?.text) return processUsersideWrite(key, cached, signal);
    }

    const url = recordUrl(initial);
    if (!url) return null;

    try {
      const entry = await transcribeRecord({
        callKey: key,
        usersideCallId: digits(initial.usersideCallId, 24),
        customerId: digits(initial.subscriber?.customerId || initial.customerId, 14),
        recordUrl: url,
        profile: 'simnet',
        language: 'auto',
        force
      }, async (stage, details = {}) => {
        if (signal.aborted) return;
        const at = nowIso();
        if (stage === 'AUDIO_FETCHING') {
          await updateCall(key, record => record.startStage('audio', at, { owner: OWNER }));
        } else if (stage === 'AUDIO_READY') {
          await updateCall(key, record => record.completeStage('audio', { detail: `${Number(details.fileBytes || 0)} B` }, at));
        } else if (stage === 'TRANSCRIBING') {
          await updateCall(key, record => record.startStage('whisper', at, { owner: OWNER }));
        } else if (stage === 'TRANSCRIPT_READY') {
          await updateCall(key, record => {
            record.setTranscript({
              callKey: key,
              requestId: details.requestId,
              language: details.language,
              durationSeconds: details.durationSeconds,
              processingSeconds: details.processingSeconds,
              fileBytes: details.fileBytes,
              cached: details.cached,
              createdAt: at
            }, at);
            record.completeStage('whisper', {
              detail: details.cached ? 'из кеша' : `${Number(details.processingSeconds || 0).toFixed(2)} сек.`
            }, at);
          });
        }
      }, signal);

      if (signal.aborted) return null;
      await updateCall(key, record => {
        record.setTranscript({
          callKey: entry.callKey,
          requestId: entry.requestId,
          language: entry.language,
          durationSeconds: entry.durationSeconds,
          processingSeconds: entry.processingSeconds,
          fileBytes: entry.fileBytes,
          audioSha256: entry.audioSha256,
          cached: entry.cached,
          createdAt: entry.createdAt
        });
        if (record.processing.steps?.whisper?.status !== 'done') {
          record.completeStage('whisper', {
            detail: entry.cached ? 'из кеша' : `${Number(entry.processingSeconds || 0).toFixed(2)} сек.`
          });
        }
      });

      return processUsersideWrite(key, entry, signal);
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return null;
      const message = error instanceof Error ? error.message : String(error || 'unknown error');
      return updateCall(key, record => {
        if (isTranscriberUnavailable(message)) {
          record.wait('whisper', message, nowIso(), true);
        } else if (/^PBX|PBX\b/i.test(message)) {
          record.fail('audio', message);
        } else {
          record.fail(record.processing?.stage || 'whisper', message);
        }
      });
    }
  });
}

async function cancelCall(callKey) {
  callExecutionRegistry.cancel(callKey, OWNER);
  return updateCall(callKey, record => record.cancel());
}

async function dismissCall(callKey) {
  return updateCall(callKey, record => record.dismissAttention());
}

async function retryCall(callKey, force = false) {
  await syncRegisteredCalls();
  let call = await CallStateStore.read(callKey);
  if (!call) return null;

  if (!recordIdOf(call)) {
    await updateCall(callKey, record => {
      record.wait('pbx', 'PBX recordId пока не найден; поиск перезапущен', nowIso(), false);
      record.processing.startedAt = nowIso();
      record.processing.attention = false;
      record.processing.attentionDismissedAt = '';
    });
    return CallStateStore.read(callKey);
  }

  await updateCall(callKey, record => {
    const p = record.processing;
    if (['cancelled', 'stale', 'failed'].includes(String(p.state || ''))) p.state = 'waiting';
    p.error = '';
    p.attention = false;
    p.attentionDismissedAt = '';
    p.cancelledAt = '';
  });

  call = await CallStateStore.read(callKey);
  if (!call) return null;
  return processCall(callKey, { force: force === true });
}

async function listProcessing() {
  await syncRegisteredCalls();
  const calls = await CallStateStore.list();
  const now = Date.now();
  return calls
    .filter(call => call.registration?.state === 'registered' || call.processing?.state !== 'idle')
    .slice(0, 40)
    .map(call => processingView(call, now));
}

async function recoverInterruptedCalls() {
  const changed = await CallStateStore.mutateAll(store => {
    const keys = [];
    const at = nowIso();

    for (const [key, raw] of Object.entries(store.calls || {})) {
      const p = raw?.processing || {};
      if (p.state !== 'running') continue;

      const record = CallRecord.from(raw);
      const stage = String(record.processing.stage || '');
      record.processing.state = 'waiting';
      record.processing.stage = recordIdOf(raw) ? 'pbx' : 'pbx';
      record.processing.updatedAt = at;
      record.processing.heartbeatAt = at;
      record.processing.error = '';
      record.processing.attention = false;
      record.processing.attentionDismissedAt = '';
      record.processing.owner = '';
      record.event('requeued_after_worker_restart', { interruptedStage: stage }, at);
      if (recordIdOf(raw)) record.setStep('pbx', 'done', `PBX ${recordIdOf(raw)}`, at);
      store.calls[key] = record.toJSON();
      keys.push(key);
    }
    return keys;
  });

  for (const key of Array.isArray(changed) ? changed : []) await broadcast(key);
  return changed || [];
}

async function migrateLegacyJobs() {
  const legacy = (await chrome.storage.local.get(LEGACY_JOB_STORE_KEY))?.[LEGACY_JOB_STORE_KEY];
  const jobs = legacy?.jobs && typeof legacy.jobs === 'object' ? legacy.jobs : {};
  const rows = Object.values(jobs);
  if (!rows.length) {
    if (legacy) await chrome.storage.local.remove(LEGACY_JOB_STORE_KEY);
    return 0;
  }

  let migrated = 0;
  await CallStateStore.mutateAll(store => {
    for (const job of rows) {
      const raw = store.calls?.[job.callKey];
      if (!raw) continue;
      const record = CallRecord.from(raw);
      if (job.pbxRecordId && !recordIdOf(raw)) record.attachPbx(job.pbxRecordId, job.updatedAt || nowIso());
      if (job.customerId) record.bindSubscriber({ customerId: job.customerId, caseId: job.caseId }, job.updatedAt || nowIso());
      if (job.registeredAt) record.setRegistration('registered', 'workbench-local', job.registeredAt);
      if (job.transcript) record.setTranscript({ ...job.transcript, storageKey: job.callKey }, job.updatedAt || nowIso());
      if (job.taskId) record.setWriteback('done', { taskId: job.taskId }, job.updatedAt || nowIso());

      const status = String(job.status || '');
      if (status === 'DONE') record.finish(job.updatedAt || nowIso(), 'migrated from legacy processing store');
      else if (status === 'CANCELLED') record.cancel(job.cancelledAt || job.updatedAt || nowIso());
      else if (['ERROR', 'PBX_ERROR', 'USERSIDE_ERROR'].includes(status)) {
        record.fail(status === 'USERSIDE_ERROR' ? 'userside' : 'whisper', job.error || status, job.updatedAt || nowIso());
      } else if (status === 'WAIT_PBX') {
        record.wait('pbx', job.error || 'ожидается PBX recordId', job.updatedAt || nowIso(), false);
      } else if (status === 'WAIT_TRANSCRIBER') {
        record.wait('whisper', job.error || 'транскрибер недоступен', job.updatedAt || nowIso(), true);
      } else if (status === 'WAIT_TASK_ID' || status === 'USERSIDE_REVIEW') {
        record.wait('userside', job.error || 'ожидается UserSide', job.updatedAt || nowIso(), true);
      } else if (['FETCH_AUDIO', 'AUDIO_READY', 'TRANSCRIBING', 'WRITING_USERSIDE', 'QUEUED'].includes(status)) {
        record.processing.state = 'waiting';
        record.processing.stage = recordIdOf(record.toJSON()) ? 'pbx' : 'pbx';
        record.processing.error = '';
        record.processing.attention = false;
        record.event('legacy_job_requeued', { previousStatus: status }, job.updatedAt || nowIso());
      }
      store.calls[job.callKey] = record.toJSON();
      migrated += 1;
    }
    return migrated;
  });

  await chrome.storage.local.remove(LEGACY_JOB_STORE_KEY);
  return migrated;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[WORKBENCH_STATE_KEY]?.newValue) return;
  void syncRegisteredCalls(changes[WORKBENCH_STATE_KEY].newValue).catch(error => {
    console.error('[SIMNET WB][CALL PROCESSING] state sync failed', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handled = new Set([
    MessageType.CALL_PROCESSING_LIST,
    MessageType.CALL_PROCESSING_RETRY,
    MessageType.CALL_PROCESSING_CANCEL,
    MessageType.CALL_PROCESSING_DISMISS
  ]);
  if (!handled.has(message?.type)) return false;
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Call processing request rejected' });
    return false;
  }

  const callKey = clean(message?.payload?.callKey || message?.payload?.jobId, 160);
  const task = message.type === MessageType.CALL_PROCESSING_LIST
    ? listProcessing()
    : message.type === MessageType.CALL_PROCESSING_RETRY
      ? retryCall(callKey, message?.payload?.force === true)
      : message.type === MessageType.CALL_PROCESSING_CANCEL
        ? cancelCall(callKey)
        : dismissCall(callKey);

  void task
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

void (async () => {
  await migrateLegacyJobs();
  await recoverInterruptedCalls();
  await syncRegisteredCalls();
})().catch(error => {
  console.error('[SIMNET WB][CALL PROCESSING] startup failed', error);
});

export const CallProcessing = Object.freeze({
  list: listProcessing,
  retry: retryCall,
  cancel: cancelCall,
  dismiss: dismissCall,
  sync: syncRegisteredCalls,
  process: processCall
});
