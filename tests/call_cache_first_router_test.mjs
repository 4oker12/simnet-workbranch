import assert from 'node:assert/strict';
import { createCallMessageRouter } from '../src/features/call/background/message-router.js';

function moduleStub() {
  return {
    status: () => ({ enabled: true, destroyed: false }),
    enable() {},
    disable() {},
    open() {},
    destroy() {}
  };
}

{
  const queryCalls = [];
  const router = createCallMessageRouter({
    module: moduleStub(),
    handlers: {
      PBX_RECENT_CALLS_QUERY(payload) {
        queryCalls.push({ ...payload });
        return Promise.resolve({
          source: payload.forceRefresh ? 'network' : 'cache',
          focusCall: { callKey: payload.forceRefresh ? 'fresh-call' : 'cached-call' }
        });
      }
    }
  });

  const result = await router.handle('PBX_RECENT_CALLS_QUERY', {
    caseId: 'case-1',
    fresh: true,
    forceRefresh: true
  });

  assert.equal(result.source, 'network', 'opening CALL must await authoritative call_list refresh');
  assert.equal(result.focusCall.callKey, 'fresh-call');
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].fresh, true);
  assert.equal(queryCalls[0].forceRefresh, true);
  assert.equal(queryCalls[0].refreshMode, undefined);
}

{
  const queryCalls = [];
  const router = createCallMessageRouter({
    module: moduleStub(),
    handlers: {
      PBX_RECENT_CALLS_QUERY(payload) {
        queryCalls.push({ ...payload });
        return Promise.resolve({ source: payload.forceRefresh ? 'network' : 'cache', focusCall: null });
      }
    }
  });

  await router.handle('PBX_RECENT_CALLS_QUERY', {
    caseId: 'case-repeat',
    fresh: true,
    forceRefresh: true
  });
  await router.handle('PBX_RECENT_CALLS_QUERY', {
    caseId: 'case-repeat',
    fresh: true,
    forceRefresh: true
  });

  assert.equal(
    queryCalls.filter(call => call.forceRefresh).length,
    2,
    'each explicit registration open must issue its own authoritative call_list refresh'
  );
}

{
  const queryCalls = [];
  const router = createCallMessageRouter({
    module: moduleStub(),
    handlers: {
      PBX_RECENT_CALLS_QUERY(payload) {
        queryCalls.push({ ...payload });
        return Promise.resolve({ source: payload.forceRefresh ? 'network' : 'cache' });
      }
    }
  });

  const result = await router.handle('PBX_RECENT_CALLS_QUERY', {
    caseId: 'case-cache',
    fresh: false,
    forceRefresh: false
  });

  assert.equal(result.source, 'cache', 'non-fresh internal reads may still use local CALL state');
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].forceRefresh, false);
}

{
  const refreshCalls = [];
  const router = createCallMessageRouter({
    module: moduleStub(),
    handlers: {
      PBX_RECENT_CALLS_QUERY(payload) {
        refreshCalls.push({ ...payload });
        return Promise.resolve({ source: 'network' });
      },
      PBX_RECENT_CALLS_OBSERVED() {
        return Promise.resolve({ stored: 1 });
      }
    }
  });

  await router.handle('PBX_RECENT_CALLS_OBSERVED', {
    calls: [{ id: 'pbx-1', durationSeconds: 27 }]
  });
  await new Promise(setImmediate);

  assert.equal(refreshCalls.length, 1, 'a newly observed completed PBX call should prefetch canonical call_list in background');
  assert.equal(refreshCalls[0].backgroundRefresh, true);
  assert.equal(refreshCalls[0].backgroundRefreshReason, 'pbx-ended');
}

{
  const refreshCalls = [];
  const router = createCallMessageRouter({
    module: moduleStub(),
    handlers: {
      PBX_RECENT_CALLS_QUERY(payload) {
        refreshCalls.push({ ...payload });
        return Promise.resolve({ source: 'network' });
      },
      PBX_RECENT_CALLS_OBSERVED() {
        return Promise.resolve({ stored: 1 });
      }
    }
  });

  await router.handle('PBX_RECENT_CALLS_OBSERVED', {
    calls: [{ id: 'pbx-ringing', durationSeconds: 0, status: 'ringing' }]
  });
  await new Promise(setImmediate);

  assert.equal(refreshCalls.length, 0, 'ringing hints alone must not start the expensive call_list refresh');
}

console.log('call_authoritative_refresh_router_test: PASS');
