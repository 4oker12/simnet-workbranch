/** Ignore scan-only metadata when deciding whether a Case actually changed. */
const TRANSIENT_KEYS = new Set([
  'observedAt',
  'scanGeneration'
]);

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function pathEnds(path, suffix) {
  if (path.length < suffix.length) return false;
  return suffix.every((part, index) => path[path.length - suffix.length + index] === part);
}

function omitPath(path, key) {
  if (TRANSIENT_KEYS.has(key)) return true;
  if (key === 'updatedAt') {
    // updatedAt is revision metadata. A real semantic field must change in the
    // same transaction for the revision to be persisted.
    return true;
  }
  if (key === 'caseVersion' && pathEnds(path, ['correlation'])) {
    // Correlation pins document which Case revision produced an observation.
    // Re-stamping the same accepted context with a newer revision is runtime
    // provenance, not a new subscriber fact or workflow transition.
    return true;
  }
  if (key === 'processedEventIds' && pathEnds(path, ['meta'])) return true;
  if ((key === 'scans' || key === 'observations') && pathEnds(path, ['meta'])) return true;
  return false;
}

function stableSnapshot(value, path = []) {
  if (Array.isArray(value)) return value.map((item, index) => stableSnapshot(item, [...path, String(index)]));
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (omitPath(path, key)) continue;
    out[key] = stableSnapshot(value[key], [...path, key]);
  }
  return out;
}

function fingerprint(value) {
  return JSON.stringify(stableSnapshot(value));
}

export function caseChanged(left, right) {
  const a = stableSnapshot(left || {});
  const b = stableSnapshot(right || {});
  delete a.caseVersion;
  delete b.caseVersion;
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function stateChanged(left, right) {
  return fingerprint(left || {}) !== fingerprint(right || {});
}
