'use strict';

class CallExecutionRegistry {
  constructor() {
    this.entries = new Map();
    this.queue = [];
    this.active = null;
  }

  get(callKey = '') {
    return this.entries.get(String(callKey || '')) || null;
  }

  has(callKey = '') {
    return this.entries.has(String(callKey || ''));
  }

  async wait(callKey = '') {
    const entry = this.get(callKey);
    return entry?.promise || null;
  }

  run(callKey = '', owner = 'unknown', executor = async () => undefined) {
    const key = String(callKey || '');
    if (!key) return Promise.reject(new Error('Call execution requires callKey'));
    const existing = this.entries.get(key);
    if (existing) return existing.promise;

    const controller = new AbortController();
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry = {
      callKey: key,
      owner: String(owner || 'unknown'),
      controller,
      executor,
      state: 'queued',
      enqueuedAt: new Date().toISOString(),
      startedAt: '',
      promise,
      resolve: resolvePromise,
      reject: rejectPromise
    };

    this.entries.set(key, entry);
    this.queue.push(entry);
    queueMicrotask(() => this._drain());
    return entry.promise;
  }

  _drain() {
    if (this.active) return;

    while (this.queue.length) {
      const entry = this.queue.shift();
      if (!entry || this.entries.get(entry.callKey) !== entry) continue;
      if (entry.controller.signal.aborted) {
        this.entries.delete(entry.callKey);
        entry.state = 'cancelled';
        entry.resolve(null);
        continue;
      }

      this.active = entry;
      entry.state = 'running';
      entry.startedAt = new Date().toISOString();

      Promise.resolve()
        .then(() => entry.executor(entry.controller.signal, entry))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          if (this.entries.get(entry.callKey) === entry) this.entries.delete(entry.callKey);
          if (this.active === entry) this.active = null;
          entry.state = entry.controller.signal.aborted ? 'cancelled' : 'done';
          queueMicrotask(() => this._drain());
        });
      return;
    }
  }

  cancel(callKey = '', owner = '') {
    const entry = this.get(callKey);
    if (!entry) return false;
    if (owner && entry.owner !== String(owner)) return false;
    if (!entry.controller.signal.aborted) entry.controller.abort('operator-cancel');

    if (entry.state === 'queued') {
      if (this.entries.get(entry.callKey) === entry) this.entries.delete(entry.callKey);
      entry.state = 'cancelled';
      entry.resolve(null);
      queueMicrotask(() => this._drain());
    }
    return true;
  }

  snapshot() {
    let queuedPosition = 0;
    const positions = new Map();
    for (const entry of this.queue) {
      if (!entry || this.entries.get(entry.callKey) !== entry || entry.state !== 'queued') continue;
      queuedPosition += 1;
      positions.set(entry.callKey, queuedPosition);
    }

    return [...this.entries.values()].map(entry => ({
      callKey: entry.callKey,
      owner: entry.owner,
      state: entry.state,
      enqueuedAt: entry.enqueuedAt,
      startedAt: entry.startedAt,
      queuePosition: entry.state === 'queued' ? (positions.get(entry.callKey) || 0) : 0,
      aborted: entry.controller.signal.aborted
    }));
  }
}

export const callExecutionRegistry = new CallExecutionRegistry();
export { CallExecutionRegistry };
