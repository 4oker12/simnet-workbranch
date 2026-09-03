'use strict';

import {
  SCORING_VERSION,
  SNAPSHOT_SCHEMA,
  SNAPSHOT_SCHEMA_VERSION
} from '../config.js';
import { evidenceInWindow } from '../evidence/repository.js';
import { callWindow, snapshotStatusForCall } from './call-window.js';
import { scoreSnapshotCandidates } from './scorer.js';
import { getSnapshot, putSnapshotOnce } from '../storage/snapshot-repository.js';

export function buildFrozenSnapshot(call = {}, evidenceBuffer = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const window = callWindow(call);
  if (!window.completed) return { frozen: false, reason: 'ongoing', snapshot: null };
  if (atMs < window.windowEndMs) return { frozen: false, reason: 'pending-window', snapshot: null };
  const events = evidenceInWindow(evidenceBuffer, window.windowStartMs, window.windowEndMs);
  const candidates = scoreSnapshotCandidates(call, events, {
    windowStartMs: window.windowStartMs,
    endedAtMs: window.endedAtMs,
    windowEndMs: window.windowEndMs
  });
  const frozenAt = String(options.nowIso || new Date(atMs).toISOString());
  return {
    frozen: true,
    reason: 'frozen',
    snapshot: {
      schema: SNAPSHOT_SCHEMA,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      scoringVersion: SCORING_VERSION,
      callKey: String(call.callKey || ''),
      usersideCallId: String(call.usersideCallId || ''),
      startedAtMs: window.startedAtMs,
      endedAtMs: window.endedAtMs,
      windowEndMs: window.windowEndMs,
      frozenAt,
      status: 'frozen',
      candidates
    }
  };
}

export function freezeCallSnapshotOnce(snapshotStore = {}, call = {}, evidenceBuffer = {}, options = {}) {
  const existing = getSnapshot(snapshotStore, call.callKey);
  if (existing) return { frozen: true, stored: false, reason: 'already-frozen', snapshot: existing };
  const built = buildFrozenSnapshot(call, evidenceBuffer, options);
  if (!built.frozen) return { ...built, stored: false };
  const stored = putSnapshotOnce(snapshotStore, built.snapshot);
  return { frozen: true, stored: stored.stored, reason: stored.reason, snapshot: stored.snapshot };
}

export function freezeEligibleCalls(callStore = {}, evidenceBuffer = {}, snapshotStore = {}, options = {}) {
  const atMs = Number(options.atMs ?? Date.now());
  const results = [];
  for (const call of Object.values(callStore.calls || {})) {
    if (snapshotStatusForCall(call, getSnapshot(snapshotStore, call.callKey), atMs) !== 'ready-to-freeze') continue;
    results.push(freezeCallSnapshotOnce(snapshotStore, call, evidenceBuffer, options));
  }
  return results;
}

export const SnapshotService = Object.freeze({
  build: buildFrozenSnapshot,
  freezeOnce: freezeCallSnapshotOnce,
  freezeEligible: freezeEligibleCalls
});
