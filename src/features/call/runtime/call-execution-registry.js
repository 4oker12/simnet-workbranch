'use strict';

class CallExecutionRegistry {
  constructor() {
    this.running = new Map();
  }

  get(callKey = '') {
    return this.running.get(String(callKey || '')) || null;
  }

  has(callKey = '') {
    return this.running.has(String(callKey || ''));
  }

  async wait(callKey = '') {
    const entry = this.get(callKey);
    return entry?.promise || null;
  }

  run(callKey = '', owner = 'unknown', executor = async () => undefined) {
    const key = String(callKey || '');
    if (!key) return Promise.reject(new Error('Call execution requires callKey'));
    const existing = this.running.get(key);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const entry = {
      callKey: key,
      owner: String(owner || 'unknown'),
      controller,
      startedAt: new Date().toISOString(),
      promise: null
    };

    entry.promise = Promise.resolve()
      .then(() => executor(controller.signal, entry))
      .finally(() => {
        if (this.running.get(key) === entry) this.running.delete(key);
      });
    this.running.set(key, entry);
    return entry.promise;
  }

  cancel(callKey = '', owner = '') {
    const entry = this.get(callKey);
    if (!entry) return false;
    if (owner && entry.owner !== String(owner)) return false;
    if (!entry.controller.signal.aborted) entry.controller.abort('operator-cancel');
    return true;
  }

  snapshot() {
    return [...this.running.values()].map(entry => ({
      callKey: entry.callKey,
      owner: entry.owner,
      startedAt: entry.startedAt,
      aborted: entry.controller.signal.aborted
    }));
  }
}

export const callExecutionRegistry = new CallExecutionRegistry();
export { CallExecutionRegistry };
