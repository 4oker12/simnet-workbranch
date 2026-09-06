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
