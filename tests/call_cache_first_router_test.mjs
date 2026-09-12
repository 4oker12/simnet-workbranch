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
  let releaseNetwork;
  const queryCalls = [];
  const router = createCallMessageRouter({
    module: moduleStub(),
    handlers: {
      PBX_RECENT_CALLS_QUERY(payload) {
        queryCalls.push({ ...payload });
        if (payload.forceRefresh) {
          return new Promise(resolve => { releaseNetwork = resolve; });
        }
        return Promise.resolve({ source: 'cache', focusCall: { callKey: 'cached-call' } });
      }
    }
  });

  const result = await router.handle('PBX_RECENT_CALLS_QUERY', {
    caseId: 'case-1',
    fresh: true,
    forceRefresh: true
  });

  assert.equal(result.source, 'cache', 'opening CALL must resolve from local CALL state');
  assert.equal(result.focusCall.callKey, 'cached-call');
  await new Promise(setImmediate);

  assert.equal(queryCalls.filter(call => call.forceRefresh).length, 1, 'one detached authoritative refresh is scheduled');
  assert.equal(queryCalls.filter(call => call.refreshMode === 'cache-first').length, 1, 'one immediate cache read is performed');

  const second = await router.handle('PBX_RECENT_CALLS_QUERY', {
    caseId: 'case-1',
    fresh: true,
    forceRefresh: true
  });
  assert.equal(second.source, 'cache');
  await new Promise(setImmediate);
  assert.equal(queryCalls.filter(call => call.forceRefresh).length, 1, 'repeated clicks must not duplicate an in-flight call_list refresh');

  releaseNetwork({ source: 'network' });
  await new Promise(setImmediate);
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
    calls: [{ id: 'pbx-1', durationSeconds: 27, status: 'completed' }]
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

console.log('call_cache_first_router_test: PASS');
