import { MessageType } from '../../shared/messages.js';
import {
  PERFORMANCE_SESSION_STORAGE_KEY,
  PERFORMANCE_CONTROL_STORAGE_KEY,
  createPerformanceSession,
  appendPerformanceSample,
  createPerformanceSnapshot,
  ensureContinuousPerformanceSession,
  isContinuousPerformanceSession,
  performanceSessionControl,
  performanceSessionOverview
} from './session-model.js';

let performanceWriteQueue = Promise.resolve();

function serialized(task) {
  const run = performanceWriteQueue.then(task, task);
  performanceWriteQueue = run.catch(() => {});
  return run;
}

async function readSession() {
  const stored = await chrome.storage.local.get(PERFORMANCE_SESSION_STORAGE_KEY);
  const session = stored?.[PERFORMANCE_SESSION_STORAGE_KEY];
  return session && typeof session === 'object' && !Array.isArray(session) ? session : null;
}

async function saveSession(session, updateControl = false) {
  const patch = { [PERFORMANCE_SESSION_STORAGE_KEY]: session };
  if (updateControl) patch[PERFORMANCE_CONTROL_STORAGE_KEY] = performanceSessionControl(session);
  await chrome.storage.local.set(patch);
  return session;
}

function continuousSession(current = null, nowMs = Date.now()) {
  if (isContinuousPerformanceSession(current)) return { session: current, changed: false };
  return {
    session: ensureContinuousPerformanceSession(current, {
      nowMs,
      version: chrome.runtime.getManifest().version
    }),
    changed: true
  };
}

async function sessionStart(payload = {}) {
  return serialized(async () => {
    const nowMs = Date.now();
    const current = await readSession();
    if (isContinuousPerformanceSession(current) && payload.reset !== true) {
      return performanceSessionOverview(current, nowMs);
    }
    const session = createPerformanceSession({ nowMs, version: chrome.runtime.getManifest().version });
    await saveSession(session, true);
    return performanceSessionOverview(session, nowMs);
  });
}

async function sessionSample(payload = {}, sender = {}) {
  return serialized(async () => {
    const nowMs = Date.now();
    const stored = await readSession();
    const ensured = continuousSession(stored, nowMs);
    const current = ensured.session;
    if (ensured.changed) await saveSession(current, true);
    if (!current?.id) {
      return { ...performanceSessionOverview(current, nowMs), accepted: false, reason: 'not-active' };
    }
    if (String(payload.sessionId || '') !== String(current.id)) {
      return { ...performanceSessionOverview(current, nowMs), accepted: false, reason: 'session-mismatch' };
    }
    const next = appendPerformanceSample(current, {
      ...(payload.sample || {}),
      tabId: sender?.tab?.id
    }, { nowMs });
    await saveSession(next, false);
    return { ...performanceSessionOverview(next, nowMs), accepted: true };
  });
}

async function sessionStatus() {
  return serialized(async () => {
    const nowMs = Date.now();
    const ensured = continuousSession(await readSession(), nowMs);
    const session = ensured.session;
    if (ensured.changed) await saveSession(session, true);
    return performanceSessionOverview(session, nowMs);
  });
}

async function sessionFinish() {
  return sessionExport();
}

async function sessionExport() {
  return serialized(async () => {
    const nowMs = Date.now();
    const ensured = continuousSession(await readSession(), nowMs);
    const session = ensured.session;
    const snapshot = createPerformanceSnapshot(session, { nowMs, reason: 'operator-snapshot' });
    session.lastSnapshotAt = snapshot.snapshotAt;
    session.lastSnapshotReport = snapshot.report;
    session.updatedAt = new Date(nowMs).toISOString();
    await saveSession(session, ensured.changed);
    return snapshot;
  });
}

const handlers = new Map([
  [MessageType.PERF_SESSION_START, (payload, sender) => sessionStart(payload, sender)],
  [MessageType.PERF_SESSION_SAMPLE, sessionSample],
  [MessageType.PERF_SESSION_STATUS, sessionStatus],
  [MessageType.PERF_SESSION_FINISH, sessionFinish],
  [MessageType.PERF_SESSION_EXPORT, sessionExport]
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers.get(message?.type);
  if (!handler) return false;
  Promise.resolve(handler(message?.payload || {}, sender)).then(
    data => sendResponse({ success: true, data }),
    error => {
      console.error(`[SIMNET WB][PERF][${String(message?.type || 'UNKNOWN')}]`, error);
      sendResponse({ success: false, error: error?.message || String(error) });
    }
  );
  return true;
});

// Loading the MV3 worker is enough to arm the passive recorder. Opening the
// popup is never required; the control update wakes every supported CRM tab.
void serialized(async () => {
  const nowMs = Date.now();
  const ensured = continuousSession(await readSession(), nowMs);
  if (ensured.changed) await saveSession(ensured.session, true);
}).catch(error => {
  console.error('[SIMNET WB][PERF][AUTO_START]', error);
});
