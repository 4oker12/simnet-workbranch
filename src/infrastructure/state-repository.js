const SHARED_WRITE_QUEUES = globalThis.__SIMNET_WB_STATE_WRITE_QUEUES__ ||= new Map();

export function withStateWriteLock(stateKey, task) {
  const key = String(stateKey || 'workbench-state');
  const previous = SHARED_WRITE_QUEUES.get(key) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => task());
  const tracked = next.finally(() => {
    if (SHARED_WRITE_QUEUES.get(key) === tracked) SHARED_WRITE_QUEUES.delete(key);
  });
  SHARED_WRITE_QUEUES.set(key, tracked);
  return tracked;
}

function timeOf(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function componentTime(component = {}, fallback = '') {
  return Math.max(
    timeOf(component?.updatedAt),
    timeOf(component?.registeredAt),
    timeOf(component?.createdAt),
    timeOf(fallback)
  );
}

function mergeTimeline(left = [], right = []) {
  const rows = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
  const seen = new Set();
  return rows
    .filter(row => row && typeof row === 'object')
    .sort((a, b) => timeOf(a.at) - timeOf(b.at))
    .filter(row => {
      const key = `${row.at || ''}|${row.type || ''}|${JSON.stringify(row.details || null)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-120);
}

function mergeCallLifecycle(nextCall = {}, liveCall = {}) {
  const out = { ...nextCall };
  let liveWon = false;
  for (const key of ['subscriber', 'registration', 'processing', 'transcript', 'ai', 'writeback']) {
    const live = liveCall?.[key];
    if (!live || typeof live !== 'object') continue;
    const next = nextCall?.[key];
    if (!next || componentTime(live, liveCall.updatedAt) > componentTime(next, nextCall.updatedAt)) {
      out[key] = live;
      liveWon = true;
    }
  }
  if (liveWon || (liveCall.timeline?.length || 0) > 0) {
    out.timeline = mergeTimeline(nextCall.timeline, liveCall.timeline);
  }
  if (!out.pbxRecordId && liveCall.pbxRecordId) out.pbxRecordId = liveCall.pbxRecordId;
  if (!out.legacyAliases?.length && liveCall.legacyAliases?.length) out.legacyAliases = liveCall.legacyAliases;
  return out;
}

function rebaseCallRecords(nextState = {}, liveState = {}) {
  const nextStore = nextState?.callModule?.calls;
  const liveStore = liveState?.callModule?.calls;
  if (!nextStore?.calls || !liveStore?.calls) return nextState;

  for (const [key, nextCall] of Object.entries(nextStore.calls)) {
    const liveCall = liveStore.calls[key];
    if (liveCall) nextStore.calls[key] = mergeCallLifecycle(nextCall, liveCall);
  }

  const liveStoreNewer = timeOf(liveStore.updatedAt) > timeOf(nextStore.updatedAt);
  if (liveStoreNewer) {
    const canonicalPbxIds = new Set(
      Object.values(nextStore.calls)
        .map(call => String(call?.pbxRecordId || ''))
        .filter(Boolean)
    );
    for (const [key, liveCall] of Object.entries(liveStore.calls)) {
      if (nextStore.calls[key]) continue;
      const pbxId = String(liveCall?.pbxRecordId || '');
      if (pbxId && canonicalPbxIds.has(pbxId)) continue;
      nextStore.calls[key] = liveCall;
    }
    nextStore.updatedAt = liveStore.updatedAt;
  }
  return nextState;
}

export function createStateRepository({ chromeApi, stateKey, clone, nowIso, onSlowWrite = null }) {
  let cache = null;
  let loadPromise = null;

  const onStorageChanged = (changes, areaName) => {
    if (areaName !== 'local' || !changes?.[stateKey]) return;
    const next = changes[stateKey].newValue;
    cache = next ? clone(next) : null;
    loadPromise = null;
  };

  chromeApi?.storage?.onChanged?.addListener?.(onStorageChanged);

  async function readRaw(keys) {
    return chromeApi.storage.local.get(keys);
  }

  async function ensureCache(loader) {
    if (!chromeApi?.runtime?.id) return loader();
    if (cache) return cache;
    if (!loadPromise) {
      loadPromise = Promise.resolve(loader()).then(state => {
        cache = clone(state);
        return cache;
      }).finally(() => { loadPromise = null; });
    }
    return loadPromise;
  }

  async function read(loader, { isolated = true } = {}) {
    if (!chromeApi?.runtime?.id) return loader();
    const state = await ensureCache(loader);
    return isolated ? clone(state) : state;
  }

  async function writeCanonical(state) {
    return withStateWriteLock(stateKey, async () => {
      const live = (await chromeApi.storage.local.get(stateKey))?.[stateKey] || null;
      if (live) rebaseCallRecords(state, live);
      state.meta ||= {};
      state.meta.updatedAt = nowIso();
      const startedAt = Date.now();
      await chromeApi.storage.local.set({ [stateKey]: state });
      if (chromeApi?.runtime?.id) cache = clone(state);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= 1200 && typeof onSlowWrite === 'function') {
        await onSlowWrite({ elapsedMs, caseCount: Object.keys(state.cases || {}).length });
      }
      return state;
    });
  }

  function replaceCache(state) {
    cache = state ? clone(state) : null;
  }

  function destroy() {
    chromeApi?.storage?.onChanged?.removeListener?.(onStorageChanged);
    cache = null;
    loadPromise = null;
  }

  return Object.freeze({ readRaw, ensureCache, read, writeCanonical, replaceCache, destroy });
}

export const StateRepositoryInternals = Object.freeze({
  mergeCallLifecycle,
  rebaseCallRecords
});
