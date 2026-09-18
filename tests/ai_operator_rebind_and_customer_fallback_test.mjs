import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { runFactTurn } from '../src/features/ai-operator/fact-runtime.js';

test('fact runtime rebinds from Sota to a later explicit free-text login before reading account facts', async () => {
  const calls = [];
  const result = await runFactTurn({
    text: 'tipalas\nдоговор\nчто по балансу?',
    state: {
      confirmedCaseId: 'billing-live:111',
      confirmedSubscriber: { billingId: '111', contract: '11111', login: 'Sota' },
      facts: { accountBalance: { value: 99999, caseId: 'billing-live:111', expiresAt: Date.now() + 60000 } },
      reads: {},
      language: 'ru'
    },
    transcript: [{ role: 'customer', text: 'tipalas\nдоговор\nчто по балансу?' }],
    interpret: async () => ({
      ids: { login: 'tipalas' },
      questions: [{ entity: 'balance', relation: 'amount', period: 'current' }],
      language: 'ru',
      speechAct: 'new'
    }),
    execute: async ({ tool, toolArgs, labState }) => {
      calls.push({ tool, toolArgs, caseId: labState.confirmedCaseId });
      if (tool === 'customer.lookup') {
        assert.deepEqual(toolArgs, { login: 'tipalas' });
        return {
          ok: true,
          tool,
          code: 'OK',
          observedAt: '2026-09-17T12:00:00.000Z',
          data: { candidate: { billingId: '222', contract: '22222', login: 'tipalas' } },
          statePatch: {
            confirmedCaseId: 'billing-live:222',
            confirmedSubscriber: { billingId: '222', contract: '22222', login: 'tipalas' },
            pendingCandidate: null
          }
        };
      }
      if (tool === 'customer.snapshot') {
        assert.equal(labState.confirmedCaseId, 'billing-live:222');
        return {
          ok: true,
          tool,
          code: 'OK',
          observedAt: '2026-09-17T12:00:01.000Z',
          data: {
            identity: { billingId: '222', contract: '22222', login: 'tipalas' },
            finance: { accountBalance: 12345 }
          }
        };
      }
      throw new Error(`Unexpected tool: ${tool}`);
    },
    now: Date.parse('2026-09-17T12:00:02.000Z')
  });

  assert.equal(calls[0].tool, 'customer.lookup');
  assert.equal(calls[1].tool, 'customer.snapshot');
  assert.equal(result.state.confirmedCaseId, 'billing-live:222');
  assert.equal(result.state.confirmedSubscriber.login, 'tipalas');
  assert.match(result.decision.reply, /123\.45|12345/);
  assert.doesNotMatch(result.decision.reply, /99999/);
});

test('Lab degraded bubble never exposes developer/debug wording to the subscriber', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Сейчас не удалось корректно завершить обработку сообщения/);
  assert.doesNotMatch(source, /контекст диалога сохранён/);
  assert.match(source, /subscriberFacingRecoveryReply/);
  assert.match(source, /await recoverTurn\(/);
  assert.match(source, /groundSubscriberReply\(/);
});
