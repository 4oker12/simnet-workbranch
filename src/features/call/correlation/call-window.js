'use strict';

import { CALL_WINDOW_GRACE_MS } from '../config.js';

export function callWindow(call = {}) {
  const startedAtMs = Math.max(0, Number(call.startedAtMs || 0));
  const durationSeconds = Math.max(0, Number(call.durationSeconds || 0));
  const endedAtMs = Math.max(
    startedAtMs,
    Number(call.endedAtMs || 0) || (startedAtMs ? startedAtMs + durationSeconds * 1000 : 0)
  );
  const completed = String(call.status || '').toLowerCase() === 'completed'
    || (startedAtMs > 0 && durationSeconds > 0 && call.ongoing !== true);
  return {
    startedAtMs,
    endedAtMs,
    windowStartMs: startedAtMs,
    windowEndMs: completed && endedAtMs ? endedAtMs + CALL_WINDOW_GRACE_MS : 0,
    durationSeconds,
    completed
  };
}

export function eventInsideCallWindow(event = {}, call = {}) {
  const window = callWindow(call);
  const ts = Number(event.ts || 0);
  return Boolean(window.completed && ts >= window.windowStartMs && ts <= window.windowEndMs);
}

export function snapshotStatusForCall(call = {}, snapshot = null, atMs = Date.now()) {
  if (snapshot?.status === 'frozen') return 'frozen';
  const window = callWindow(call);
  if (!window.completed) return 'none';
  return Number(atMs) >= window.windowEndMs ? 'ready-to-freeze' : 'pending-window';
}
