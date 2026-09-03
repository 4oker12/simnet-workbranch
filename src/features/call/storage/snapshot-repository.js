'use strict';

import { MAX_SNAPSHOTS, SNAPSHOT_RETENTION_MS } from '../config.js';
import { canonicalCallKey } from './call-repository.js';

export function createSnapshotStore() {
  return { schema: 'simnet-call-snapshot-repository-v1', snapshots: {}, updatedAt: '' };
}

export function getSnapshot(store = createSnapshotStore(), rawCallKey = '') {
  const key = canonicalCallKey(rawCallKey);
  return key ? store.snapshots?.[key] || null : null;
}

export function putSnapshotOnce(store = createSnapshotStore(), snapshot = {}) {
  const key = canonicalCallKey(snapshot.callKey || '');
  if (!key || snapshot.status !== 'frozen') return { stored: false, snapshot: null, reason: 'invalid' };
  store.snapshots ||= {};
  const existing = store.snapshots[key];
  if (existing) return { stored: false, snapshot: existing, reason: 'already-frozen' };
  store.snapshots[key] = JSON.parse(JSON.stringify(snapshot));
  store.updatedAt = String(snapshot.frozenAt || new Date().toISOString());
  return { stored: true, snapshot: store.snapshots[key], reason: 'frozen' };
}

export function cleanupSnapshots(store = createSnapshotStore(), atMs = Date.now()) {
  const cutoff = Number(atMs) - SNAPSHOT_RETENTION_MS;
  const entries = Object.entries(store.snapshots || {})
    .filter(([, snapshot]) => {
      const reference = Number(snapshot?.windowEndMs || 0) || Date.parse(String(snapshot?.frozenAt || '')) || 0;
      return reference >= cutoff;
    })
    .sort((a, b) => Number(b[1]?.windowEndMs || 0) - Number(a[1]?.windowEndMs || 0))
    .slice(0, MAX_SNAPSHOTS);
  store.snapshots = Object.fromEntries(entries);
  return store;
}

export const SnapshotRepository = Object.freeze({
  create: createSnapshotStore,
  get: getSnapshot,
  putOnce: putSnapshotOnce,
  cleanup: cleanupSnapshots
});
