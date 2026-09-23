import test from 'node:test';
import assert from 'node:assert/strict';

import { executeOperatorTool } from '../src/features/ai-operator/tool-runtime.js';

function installStorage() {
  const state = {
    cases: {
      'login:abon123456': {
        identity: {
          billingId: '12345',
          contract: '123456',
          login: 'abon123456'
        },
        profile: {
          address: 'вул. Тестова, буд. 10, кв. 2'
        },
        network: {
          ip: '192.0.2.44'
        }
      },
      'login:nameduser': {
        identity: {
          billingId: '54321',
          contract: '654321',
          login: 'namedUser'
        },
        profile: {
          address: 'вул. Інша, буд. 1'
        },
        network: {
          ip: '192.0.2.45'
        }
      }
    }
  };
  const stored = {
    simnet_workbench_state_v5: state,
    simnet_ai_operator_billing_snapshots_v1: {}
  };
  const previous = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => stored
      }
    }
  };
  return () => {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  };
}

test('local fallback auto-confirms an exact unique abon login', async () => {
  const restore = installStorage();
  try {
    const result = await executeOperatorTool({
      tool: 'customer.lookup',
      toolArgs: { login: 'abon123456' },
      labState: {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.requiresConfirmation, false);
    assert.equal(result.data.candidate.login, 'abon123456');
    assert.equal(result.statePatch.confirmedCaseId, 'login:abon123456');
    assert.equal(result.statePatch.confirmedSubscriber.login, 'abon123456');
    assert.equal(result.statePatch.pendingCandidate, null);
  } finally {
    restore();
  }
});

test('local fallback auto-confirms any exact unique named login', async () => {
  const restore = installStorage();
  try {
    const result = await executeOperatorTool({
      tool: 'customer.lookup',
      toolArgs: { login: 'namedUser' },
      labState: {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.requiresConfirmation, false);
    assert.equal(result.statePatch.confirmedCaseId, 'login:nameduser');
  } finally {
    restore();
  }
});

test('local fallback auto-confirms an exact unique IP', async () => {
  const restore = installStorage();
  try {
    const result = await executeOperatorTool({
      tool: 'customer.lookup',
      toolArgs: { ip: '192.0.2.44' },
      labState: {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.requiresConfirmation, false);
    assert.equal(result.statePatch.confirmedCaseId, 'login:abon123456');
  } finally {
    restore();
  }
});

test('address lookup remains confirmation-gated', async () => {
  const restore = installStorage();
  try {
    const result = await executeOperatorTool({
      tool: 'customer.lookup',
      toolArgs: { address: 'вул. Тестова, буд. 10, кв. 2' },
      labState: {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.requiresConfirmation, true);
    assert.equal(result.statePatch.confirmedCaseId, '');
    assert.equal(result.statePatch.pendingCandidate.login, 'abon123456');
  } finally {
    restore();
  }
});
