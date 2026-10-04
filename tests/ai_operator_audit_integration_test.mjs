import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFacts } from '../src/features/ai-operator/canonical-fact-resolver.js';
import { executeInformationNeeds } from '../src/features/ai-operator/semantic-tool-broker-core-runtime-base.js';
import { runScenario } from '../src/features/ai-operator/scenario-replay.js';
import { executeOperatorTool } from '../src/features/ai-operator/live-tool-runtime-core.js';
import { analyzeSubscriberIntent } from '../src/features/ai-operator/semantic-probe.js';
import { groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker-core.js';

function storage(extra = {}) {
  const memory = { simnet_workbench_ai_runtime_v1: { groqApiKey: 'test-key', chatModel: 'qwen/qwen3.8-27b' }, ...extra };
  globalThis.chrome = { storage: { local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k,memory[k]])); }, async set(patch) { Object.assign(memory, patch); } }, onChanged: { addListener() {} } } };
  return memory;
}
const context = () => ({ confirmedCaseId: 'billing-live:900001', confirmedSubscriber: { billingId: '900001' }, domainContext: {} });
const now = Date.now();
for (const state of ['known', 'unknown', 'absent']) test(`fallback reuses already requested UserSide (${state})`, async () => {
  const calls = [];
  const out = await resolveFacts({ context: context(), now, facts: ['subscriber.access.connectionFamily', 'subscriber.access.userside.connectionFamily'], execute: async ({ tool }) => {
    calls.push(tool);
    return { ok: state !== 'unknown' || tool !== 'userside.snapshot', code: 'UNAVAILABLE', observedAt: new Date(now).toISOString(), data: tool === 'userside.snapshot' && state === 'known' ? { network: { connectionFamily: 'GPON' } } : tool === 'userside.snapshot' ? { network: { connectionFamily: '' } } : { technical: { technologyHint: '' } } };
  } });
  assert.equal(calls.filter(x => x === 'userside.snapshot').length, 1);
  const primary = out.facts.find(x => x.path === 'subscriber.access.connectionFamily');
  assert.equal(primary.status, state);
  assert.equal(primary.value, state === 'known' ? 'GPON' : null);
});

test('state survives real broker and scenario checkpoint across two turns', async () => {
  const deep = { a: { b: { c: { d: { e: { f: { list: Array.from({ length: 90 }, (_, i) => ({ i, text: ' long text '.repeat(100) })) } } } } } } };
  const saved = { ...context(), factSourceCache: deep, network: { authorization: { status: 'active' } } };
  const cycle = await executeInformationNeeds({ labState: saved, needs: [], execute: async () => { throw new Error('no tools needed'); } });
  assert.deepEqual(cycle.labState, saved);
  let toolCalls = 0;
  const patched = await executeInformationNeeds({ labState: context(), needs: [{ system: 'Billing', field: 'current account balance', why: 'customer question' }], execute: async ({ tool }) => {
    toolCalls++;
    return { ok: true, tool, data: {}, statePatch: { factSourceCache: deep } };
  } });
  assert.equal(toolCalls, 1);
  assert.deepEqual(patched.labState.factSourceCache, deep);

  const out = await runScenario({ scenario: { id: 'state', title: 'state', turns: ['one', 'two'] }, seedToolState: cycle.labState, runTurn: async ({ toolState }) => ({ toolState, decision: { reply: 'ok' } }) });
  assert.deepEqual(out.turns[1].checkpointBefore.toolState.factSourceCache, deep);
  assert.deepEqual(out.finalToolState.factSourceCache, deep);
});

test('stored Billing read preserves timestamp and expired evidence remains unknown', async () => {
  const old = new Date(now - 24 * 3600000).toISOString();
  storage({ simnet_ai_operator_billing_snapshots_v1: { '900001': { billingId: '900001', observedAt: old, technical: { technologyHint: 'GPON' } } } });
  const read = await executeOperatorTool({ tool: 'customer.snapshot', labState: context() });
  assert.equal(read.observedAt, old);
  const facts = await resolveFacts({ context: context(), now, facts: ['subscriber.access.connectionFamily'], execute: async ({tool}) => tool === 'customer.snapshot' ? read : { ok: false, code: 'UNAVAILABLE' } });
  assert.equal(facts.facts[0].status, 'unknown');
});

test('general tariffs override wrong knowledge gate and reach actual synthesis payload', async () => {
  storage();
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    const content = sent.length === 1 ? { what_user_wants: 'Какие обычные тарифы для квартиры', latest_message_means: 'Общий вопрос', knowledge_need: 'none', required_facts: [] } : { reply: 'Есть тарифы для квартиры.' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { total_tokens: 1 } }), { status: 200 });
  };
  const latestCustomer = { text: 'Какие у вас вообще есть обычные тарифы для квартиры?' };
  const analysis = await analyzeSubscriberIntent({ latestCustomer, transcript: [{ role: 'customer', ...latestCustomer }], knowledgeMode: 'auto' });
  assert.ok(analysis.knowledge.usedArticles.some(x => x.id === 'tariff.residential'));
  await groundSubscriberReply({ latestCustomer, analysis, factResolution: { context: {}, requestedFacts: [], evidence: [], sourceTrace: [] } });
  const payload = JSON.parse(sent.at(-1).messages.at(-1).content);
  assert.ok(payload.grounded_context.internal_knowledge.used_articles.includes('tariff.residential'));
  assert.ok(payload.grounded_context.internal_knowledge.article_evidence.some(x => x.id === 'tariff.residential' && x.text));
});

test('NEW_OCCUPANT relationship reaches final generation on follow-up', async () => {
  storage(); let payload;
  globalThis.fetch = async (_url, options) => { payload = JSON.parse(JSON.parse(options.body).messages.at(-1).content); return new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"Для нового договора действуют условия подключения."}' }, finish_reason: 'stop' }] }), { status: 200 }); };
  const state = { ...context(), domainContext: { dialogue: { contractRelationshipClaim: 'NEW_OCCUPANT' } } };
  await groundSubscriberReply({ latestCustomer: { text: 'А сколько платить?' }, analysis: { probe: {} }, labState: state, factResolution: { context: state, requestedFacts: ['subscriber.finance.totalDue'], evidence: [{ path: 'subscriber.finance.totalDue', status: 'known', value: 250 }], sourceTrace: [] } });
  assert.equal(payload.grounded_context.understanding.dialoguePolicy.contractRelationshipClaim, 'NEW_OCCUPANT');
  assert.ok(!payload.canonical_fact_evidence.some(x => /^(?:derived|subscriber\.finance)\./.test(x.path)));
  assert.equal(payload.grounded_context.understanding.dialoguePolicy.financeDecision, null);
});

test('replay counts canonical reads once, excludes cache hits and exposes request evidence', async () => {
  const observedAt = new Date(now).toISOString();
  const read = { tool: 'userside.snapshot', source: 'userside.subscriber', ok: true, cache: 'miss', observedAt, requestedFacts: ['subscriber.access.connectionFamily'], requestEvidence: { endpoint: '/customer/:id', method: 'GET' } };
  const out = await runScenario({ scenario: { id: 'trace', title: 'trace', turns: ['read', 'cached'] }, runTurn: async ({turnIndex}) => {
    const t = { ...read, cache: turnIndex ? 'hit' : 'miss' };
    return { experiment: { variants: [{ label: 'a', reply: 'GPON', toolTrace: [{...t, requestEvidence: undefined, source:'userside-live-read-only'}], factSourceTrace: [t] }] } };
  } });
  assert.equal(out.summary.toolCalls, 1);
  assert.equal(out.turns[0].toolTrace.length, 1);
  assert.equal(out.turns[0].toolTrace[0].requestEvidence.method, 'GET');
  assert.equal(out.turns[0].checks.answer, 'not_verified');
});

test('degraded generation never quotes previous occupants payment as current obligation', async () => {
  const { canonicalEvidenceFallbackResult } = await import('../src/features/ai-operator/semantic-tool-broker-core.js');
  const result = canonicalEvidenceFallbackResult({ requestText: 'Сколько оплатить?', factResolution: { context: { domainContext: { dialogue: { contractRelationshipClaim: 'NEW_OCCUPANT' } } }, requestedFacts: ['subscriber.finance.totalDue'], evidence: [{ path: 'subscriber.finance.totalDue', status: 'known', value: 777 }] } });
  assert.equal(result.complete, false);
  assert.ok(!result.reply.includes('777'));
});

test('Billing authentication failure cannot refresh expired snapshot timestamps', async () => {
  const old = new Date(now - 86400000).toISOString();
  const memory = storage({ simnet_ai_operator_billing_snapshots_v1: { '900001': { billingId: '900001', observedAt: old, service: { currentTariff: 'Test' }, finance: { accountBalance: 100 }, fieldObservedAt: { 'finance.accountBalance': old } } } });
  globalThis.chrome.tabs = { async query() { return [{ id: 1, url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl' }]; } };
  globalThis.chrome.scripting = { async executeScript() { return [{ result: { ok: false, code: 'BILLING_AUTH_REQUIRED' } }]; } };
  const { executeOperatorTool: liveTool } = await import('../src/features/ai-operator/live-tool-runtime.js');
  const result = await liveTool({ tool: 'billing.main_summary', toolArgs: { refresh: true, requiredCanonicalFacts: ['subscriber.finance.balance.account'] }, labState: context() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BILLING_AUTH_REQUIRED');
  assert.equal(memory.simnet_ai_operator_billing_snapshots_v1['900001'].observedAt, old);
  assert.equal(memory.simnet_ai_operator_billing_snapshots_v1['900001'].fieldObservedAt['finance.accountBalance'], old);
});

test('failed UserSide read for sibling fact is reused by technology fallback', async () => {
  const calls = [];
  const result = await resolveFacts({ context: context(), now, facts: ['subscriber.access.connectionFamily', 'subscriber.access.ethernet.deviceId'], execute: async ({tool}) => {
    calls.push(tool);
    return { ok: tool !== 'userside.snapshot', observedAt: new Date(now).toISOString(), code: 'UNAVAILABLE', data: { technical: { technologyHint: '' } } };
  } });
  assert.equal(calls.filter(x => x === 'userside.snapshot').length, 1);
  assert.equal(result.facts.find(x => x.path === 'subscriber.access.connectionFamily').status, 'unknown');
});
