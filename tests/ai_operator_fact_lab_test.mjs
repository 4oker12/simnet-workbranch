import test from 'node:test';
import assert from 'node:assert/strict';

test('Test Lab messages execute the fact runtime, persist identity and recalculate a follow-up', async () => {
  const savedChrome = globalThis.chrome;
  const savedFetch = globalThis.fetch;
  const listeners = [];
  const storage = {
    simnet_workbench_ai_runtime_v1: { groqApiKey: 'test-only-placeholder' },
    simnet_ai_operator_lab_v1: { id: 'lab-test', confirmedCaseId: 'billing-live:42', confirmedSubscriber: { billingId: '42', contract: '123456' } },
    simnet_ai_operator_billing_snapshots_v1: { 42: {
      billingId: '42', identity: { billingId: '42', contract: '123456' }, observedAt: new Date().toISOString(),
      service: { currentTariff: 'Тариф', nextTariff: '', startDay: 1, accessState: 'Разрешен', group: 'Рабочие' },
      finance: { totalDue: 250, accountBalance: 270.1, balanceAfterTariff: 20.1 }
    } }
  };
  globalThis.chrome = {
    runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
    storage: { onChanged: { addListener() {} }, local: {
      get: async keys => typeof keys === 'string' ? { [keys]: structuredClone(storage[keys]) } : Object.fromEntries(keys.map(k => [k, structuredClone(storage[k])])),
      set: async patch => Object.assign(storage, structuredClone(patch))
    } }
  };
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /не выбирай tools/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      questions: [{ entity: 'recurring_charge', relation: 'amount', period: 'current' }], language: 'ru'
    }) } }], usage: { prompt_tokens: 300, completion_tokens: 100 } }), { status: 200 });
  };
  try {
    await import('../src/features/ai-operator/lab-background.js');
    const send = text => new Promise(resolve => {
      const accepted = listeners[0]({ type: 'AI_OPERATOR_LAB_SEND', payload: { text } }, {}, resolve);
      assert.equal(accepted, true);
    });
    const first = await send('Сколько в месяц?');
    assert.equal(first.success, true); assert.match(first.data.messages.at(-1).text, /250 грн/);
    const second = await send('А следующий?');
    assert.equal(second.success, true); assert.match(second.data.messages.at(-1).text, /229,90/);
    assert.equal(second.data.apiCost.turn.calls, 0);
    assert.equal(second.data.apiCost.session.calls, 1);
    assert.ok(second.data.apiCost.session.usd > 0);
    assert.equal(calls, 1, 'unambiguous follow-up needs neither new NLU nor CRM read');
    assert.equal(second.data.events.filter(e => e.type === 'tool_call').length, 1);
    assert.equal(storage.simnet_ai_operator_lab_v1.conversationState.confirmedCaseId, 'billing-live:42');
    assert.equal(storage.simnet_ai_operator_lab_v1.conversationState.derived[0].value, 22990);
  } finally {
    globalThis.chrome = savedChrome; globalThis.fetch = savedFetch;
  }
});
