import assert from 'node:assert/strict';
import test from 'node:test';

const storage = {};
const listeners = [];

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter(key => key in storage).map(key => [key, structuredClone(storage[key])]));
      },
      async set(patch) {
        for (const [key, value] of Object.entries(patch)) storage[key] = structuredClone(value);
      }
    }
  },
  runtime: {
    getManifest() { return { version: '1.7.36.156' }; },
    onMessage: { addListener(listener) { listeners.push(listener); } }
  }
};

await import(`../src/features/performance/background.js?test=${Date.now()}`);

function request(type, payload = {}, sender = {}) {
  return new Promise((resolve, reject) => {
    const handled = listeners[0]({ type, payload }, sender, response => {
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || `${type} failed`));
    });
    assert.equal(handled, true);
  });
}

test('background owns the cross-page session and accepts matching samples only', async () => {
  assert.equal(listeners.length, 1);
  const started = await request('PERF_SESSION_START', { durationMs: 30 * 60_000 });
  assert.equal(started.status, 'active');
  assert.equal(storage.simnet_workbench_performance_control_v1.sessionId, started.sessionId);

  const rejected = await request('PERF_SESSION_SAMPLE', {
    sessionId: 'another-session',
    sample: { id: 'wrong' }
  }, { tab: { id: 9 } });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'session-mismatch');

  const accepted = await request('PERF_SESSION_SAMPLE', {
    sessionId: started.sessionId,
    sample: {
      id: 'right',
      page: { route: 'userside.simnet.kiev.ua/customer/123456?secret=1', visibility: 'visible' },
      resources: { windowMs: 60_000, count: 1, totalDurationMs: 120 }
    }
  }, { tab: { id: 9 } });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.sampleCount, 1);
  assert.equal(storage.simnet_workbench_performance_session_v1.samples[0].tabId, 9);
  assert.doesNotMatch(storage.simnet_workbench_performance_session_v1.samples[0].page.route, /123456|secret/);

  const completed = await request('PERF_SESSION_FINISH');
  assert.equal(completed.status, 'completed');
  assert.ok(completed.report);
  assert.equal(storage.simnet_workbench_performance_control_v1.status, 'completed');
});

test('starting again while a session is active returns the same session', async () => {
  storage.simnet_workbench_performance_session_v1 = undefined;
  delete storage.simnet_workbench_performance_session_v1;
  delete storage.simnet_workbench_performance_control_v1;
  const first = await request('PERF_SESSION_START');
  const second = await request('PERF_SESSION_START');
  assert.equal(second.sessionId, first.sessionId);
});
