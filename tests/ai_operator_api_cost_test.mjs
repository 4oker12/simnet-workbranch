import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsage, estimateCost, recordApiUsage, apiCostSummary, saveApiPrice, API_COST_KEY } from '../src/features/ai-operator/api-cost.js';
import { interpretOperatorTurn } from '../src/features/ai-operator/groq-planner.js';
const model = 'qwen/qwen3.6-27b';
const usage = { prompt_tokens: 1000, completion_tokens: 100 };
function storageMock() {
  const data = { simnet_workbench_ai_runtime_v1: { groqApiKey: 'test-not-real', chatModel: model } };
  globalThis.chrome = { storage: { local: {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(data[k])])),
    set: async patch => Object.assign(data, structuredClone(patch))
  } } };
  return data;
}
test('token totals estimate actual input/output rates and remain precise below a cent', () => {
  const counts = aggregateUsage({}, { model, usage });
  assert.ok(Math.abs(estimateCost(counts).usd - 0.0009) < 1e-12);
  assert.equal(estimateCost(counts).missingUsage, 0);
});
test('cached tokens are not billed twice and use known discounted rate', () => {
  const counts = aggregateUsage({}, { model: 'openai/gpt-oss-120b', usage: { ...usage, prompt_tokens_details: { cached_tokens: 400 } } });
  assert.ok(Math.abs(estimateCost(counts).usd - 0.00018) < 1e-12);
});
test('unknown rates and missing usage are not silently interpreted as free', () => {
  const counts = aggregateUsage({}, { model: 'custom-model', usage: null });
  const out = estimateCost(counts);
  assert.equal(out.unpricedCalls, 1); assert.equal(out.missingUsage, 1); assert.equal(out.calls, 1);
});
test('ledger persists beyond event ring, isolates dialogue, and reprices stored tokens', async () => {
  storageMock();
  await Promise.all(Array.from({ length: 155 }, (_, i) => recordApiUsage({ model, usage, scope: 'lab-1', turnId: `turn-${i}` })));
  const first = await apiCostSummary('lab-1','turn-154');
  assert.equal(first.total.calls, 155); assert.equal(first.session.calls, 155); assert.equal(first.turn.calls, 1);
  const second = await apiCostSummary('lab-2', null);
  assert.equal(second.session.calls, 0); assert.equal(second.total.calls, 155);
  await saveApiPrice({ model, input: '1', output: '2', cached: '' });
  assert.ok(Math.abs((await apiCostSummary('lab-1', 'turn-154')).turn.usd - 0.0012) < 1e-12);
  await assert.rejects(saveApiPrice({ model, input: '', output: 2 }));
});
test('every physical fallback request is metered, including a paid invalid JSON response', async () => {
  storageMock();
  const oldFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return new Response(JSON.stringify({ usage, choices: [{ message: { content: count === 1 ? 'not-json' : '{"questions":[]}' } }] }), { status: 200 });
  };
  try {
    await interpretOperatorTurn({ text: 'проверить баланс', meterContext: { scope: 'lab', turnId: 'turn' } });
    const out = await apiCostSummary('lab', 'turn');
    assert.equal(count, 2); assert.equal(out.turn.calls, 2); assert.equal(out.turn.input, 2000);
    assert.equal(out.turn.missingUsage, 0);
  } finally { globalThis.fetch = oldFetch; }
});
test('HTTP failure with no usage is retained as unknown, not lost from totals', async () => {
  storageMock();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":{"message":"unauthorized"}}', { status: 401 });
  try {
    await assert.rejects(interpretOperatorTurn({ text: 'баланс', meterContext: { scope: 'lab', turnId: 'error' } }));
    const out = await apiCostSummary('lab','error');
    assert.equal(out.turn.calls, 1); assert.equal(out.turn.missingUsage, 1);
  } finally { globalThis.fetch = oldFetch; }
});
