export function createStateRepository({ chromeApi, stateKey, clone, nowIso, onSlowWrite = null }) {
  let cache = null;
  let loadPromise = null;

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
    state.meta ||= {};
    state.meta.updatedAt = nowIso();
    const startedAt = Date.now();
    // The only physical canonical Workbench State write.
    await chromeApi.storage.local.set({ [stateKey]: state });
    if (chromeApi?.runtime?.id) cache = clone(state);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= 1200 && typeof onSlowWrite === 'function') {
      await onSlowWrite({ elapsedMs, caseCount: Object.keys(state.cases || {}).length });
    }
    return state;
  }

  function replaceCache(state) {
    cache = state ? clone(state) : null;
  }

  return Object.freeze({ readRaw, ensureCache, read, writeCanonical, replaceCache });
}
