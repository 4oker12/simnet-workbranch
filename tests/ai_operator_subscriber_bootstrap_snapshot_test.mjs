import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { persistBillingSnapshots } from '../src/features/ai-operator/live-tool-runtime-core.js';
import {
  AUTONOMOUS_OPERATOR_INSTRUCTION,
  AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION,
  AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256
} from '../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js';

function installStorage() {
  const state = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map(item => [item, state[item]]));
          }
          return { [key]: state[key] };
        },
        async set(patch) {
          Object.assign(state, patch || {});
        }
      }
    }
  };
  return state;
}

test('subscriber bootstrap stores wide local context and later main refresh does not erase address/technical blocks', async () => {
  const state = installStorage();
  const key = 'simnet_ai_operator_billing_snapshots_v1';

  await persistBillingSnapshots({
    '23080': {
      billingId: '23080',
      identity: { billingId: '23080', login: 'abon230804', contract: '230804', fullName: 'Fixture User' },
      address: { street: 'Тестова', building: '10', apartment: '5', full: 'Тестова, буд. 10, кв. 5' },
      technical: { subscriberMac: '00:11:22:33:44:55', technologyHint: 'GPON', gponOntSerial: 'TESTSERIAL' },
      bootstrapMeta: {
        status: 'ready',
        sources: {
          main: { ok: true },
          address: { ok: true },
          technical: { ok: true }
        }
      },
      observedAt: '2026-09-25T00:00:00.000Z'
    }
  });

  await persistBillingSnapshots({
    '23080': {
      billingId: '23080',
      service: { currentTariff: 'Test 1000' },
      finance: { accountBalance: 321 },
      observedAt: '2026-09-25T00:01:00.000Z',
      financeObservedAt: '2026-09-25T00:01:00.000Z'
    }
  });

  const snapshot = state[key]['23080'];
  assert.equal(snapshot.identity.login, 'abon230804');
  assert.equal(snapshot.address.full, 'Тестова, буд. 10, кв. 5');
  assert.equal(snapshot.technical.technologyHint, 'GPON');
  assert.equal(snapshot.bootstrapMeta.status, 'ready');
  assert.equal(snapshot.service.currentTariff, 'Test 1000');
  assert.equal(snapshot.finance.accountBalance, 321);
});

test('identity success triggers bounded main + address + technical bootstrap and persists one subscriber snapshot', () => {
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const login = fs.readFileSync(new URL('../src/features/ai-operator/billing-login-live.js', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');

  assert.match(login, /SIMNET_AI_BILLING_EXACT_LOOKUP_V2/);
  assert.match(capture, /SIMNET_AI_BILLING_EXACT_LOOKUP_V2/);
  assert.match(capture, /tmpl:\s*'2'/, 'bootstrap must read Billing address source');
  assert.match(capture, /tmpl:\s*'1'/, 'bootstrap must read Billing technical source');
  assert.match(capture, /snapshots\[id\]\s*=\s*snapshot/);
  assert.match(runtime, /async function bootstrapSubscriberSnapshot/);
  assert.match(runtime, /readBillingSummaryLive\(\{/);
  assert.match(runtime, /core\.persistBillingSnapshots\(\{ \[billingId\]: snapshot \}\)/);
  assert.match(runtime, /bootstrapSubscriberSnapshot\(rawCandidates\[0\], live\)/);
});

test('bootstrap failure is partial evidence, not identity failure', () => {
  const capture = fs.readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');
  const runtime = fs.readFileSync(new URL('../src/features/ai-operator/live-tool-runtime.js', import.meta.url), 'utf8');

  assert.match(capture, /status:\s*'partial'/);
  assert.match(capture, /ADDRESS_READ_FAILED/);
  assert.match(capture, /TECHNICAL_READ_FAILED/);
  assert.match(runtime, /status:\s*complete \? 'ready' : 'partial'/);
  assert.match(runtime, /Абонент подтверждён; часть фонового subscriber snapshot осталась неизвестной/);
});

test('canonical instruction locks IDENTIFY → BOOTSTRAP → STORE → ANSWER MANY and generated runtime matches source', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md', import.meta.url), 'utf8');
  const hash = crypto.createHash('sha256').update(source).digest('hex');

  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION, 10);
  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION, source);
  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256, hash);
  assert.match(source, /IDENTIFY ONCE → BOOTSTRAP ONCE → SNAPSHOT WIDE → NORMALIZE ONCE → STORE LOCALLY → ANSWER MANY/);
  assert.match(source, /SNAPSHOT ≠ PROMPT/);
  assert.match(source, /основную Billing-карточку, адресные данные и технические данные/);
  assert.match(source, /Новый READ нужен только если нужный source-факт отсутствует, устарел, был invalidated/);
});
