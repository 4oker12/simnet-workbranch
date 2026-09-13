// Keep only one compact refresh result, never the HTML response or native form.
export function createRefreshGate(now = Date.now) {
  let pending = null;
  let cached = null;
  return function run(key, task, reuse = false) {
    if (pending?.key === key) return pending.promise;
    if (reuse && cached?.key === key && now() - cached.at < 15000) {
      return Promise.resolve({ ...cached.result, reused: true });
    }
    const entry = { key, promise: null };
    entry.promise = Promise.resolve().then(task).then(result => {
      if (pending === entry && result?.refreshed) cached = { key, result, at: now() };
      return result;
    }).finally(() => { if (pending === entry) pending = null; });
    pending = entry;
    return entry.promise;
  };
}
