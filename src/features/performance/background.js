import { MessageType } from '../../shared/messages.js';
import {
  PERFORMANCE_SESSION_STORAGE_KEY,
  PERFORMANCE_CONTROL_STORAGE_KEY,
  createPerformanceSession,
  appendPerformanceSample,
  finalizePerformanceSession,
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

function deadlinePassed(session, nowMs = Date.now()) {
  return session?.status === 'active' && nowMs >= new Date(session.plannedEndAt).getTime();
}

async function sessionStart(payload = {}) {
  return serialized(async () => {
    const nowMs = Date.now();
    const current = await readSession();
    if (current?.status === 'active') return performanceSessionOverview(current, nowMs);
    const session = createPerformanceSession({
      nowMs,
      durationMs: payload.durationMs,
      version: chrome.runtime.getManifest().version
    });
    await saveSession(session, true);
    return performanceSessionOverview(session, nowMs);
  });
}

async function sessionSample(payload = {}, sender = {}) {
  return serialized(async () => {
    const nowMs = Date.now();
    const current = await readSession();
    if (!current?.id || current.status !== 'active') {
      return { ...performanceSessionOverview(current, nowMs), accepted: false, reason: 'not-active' };
    }
    if (String(payload.sessionId || '') !== String(current.id)) {
      return { ...performanceSessionOverview(current, nowMs), accepted: false, reason: 'session-mismatch' };
    }
    const next = appendPerformanceSample(current, {
      ...(payload.sample || {}),
      tabId: sender?.tab?.id
    }, { nowMs });
    const completed = current.status !== next.status;
    await saveSession(next, completed);
    return { ...performanceSessionOverview(next, nowMs), accepted: true };
  });
}

async function sessionStatus() {
  return serialized(async () => {
    const nowMs = Date.now();
    let session = await readSession();
    if (deadlinePassed(session, nowMs)) {
      session = finalizePerformanceSession(session, { nowMs, reason: 'deadline' });
      await saveSession(session, true);
    }
    return performanceSessionOverview(session, nowMs);
  });
}

async function sessionFinish() {
  return serialized(async () => {
    const nowMs = Date.now();
    let session = await readSession();
    if (session?.status === 'active') {
      session = finalizePerformanceSession(session, { nowMs, reason: 'operator' });
      await saveSession(session, true);
    }
    return performanceSessionOverview(session, nowMs);
  });
}

async function sessionExport() {
  return serialized(async () => {
    const nowMs = Date.now();
    let session = await readSession();
    if (deadlinePassed(session, nowMs)) {
      session = finalizePerformanceSession(session, { nowMs, reason: 'deadline' });
      await saveSession(session, true);
    }
    return session;
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
