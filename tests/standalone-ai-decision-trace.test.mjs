import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('abonNNNN is always classified as a login even when described as a contract', async () => {
  const { classifyBillingLookup } = await import('../src/features/ai-operator/billing-live-search.js');
  assert.deepEqual(classifyBillingLookup({ contract: 'abon366882' }), { mode: 'login', value: 'abon366882' });
  assert.deepEqual(classifyBillingLookup({ login: 'AbOn366882' }), { mode: 'login', value: 'abon366882' });
  assert.deepEqual(classifyBillingLookup({ query: 'abon366882' }), { mode: 'login', value: 'abon366882' });
  assert.deepEqual(classifyBillingLookup({ contract: '366882' }), { mode: 'contract', value: '366882' });
});

test('missing authorized Billing tab does not convert an empty local cache into NOT_FOUND', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = {
    scripting: { executeScript: async () => { throw new Error('Should not execute without Billing tab'); } },
    tabs: { query: async () => [] },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  try {
    const { executeOperatorTool } = await import('../src/features/ai-operator/live-tool-runtime-core.js');
    const outcome = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: { login: 'abon366882' }, labState: {} });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'BILLING_TAB_REQUIRED');
    assert.equal(outcome.data.liveCode, 'BILLING_TAB_REQUIRED');
    assert.equal(outcome.data.fallbackCode, 'NOT_FOUND');
    assert.equal(outcome.data.localSource, 'none');
    assert.equal(outcome.data.searchMode, 'login');
    assert.match(outcome.warnings.join(' '), /UNKNOWN ≠ NOT_FOUND/);
  } finally {
    globalThis.chrome = previous;
  }
});

test('source failure reply does not demand a phone and does not override real successful reads', async () => {
  const { billingUnavailableReplyForTrace } = await import('../src/features/ai-operator/semantic-tool-broker.js');
  const failure = [{ tool: 'customer.lookup', ok: false, code: 'BILLING_TAB_REQUIRED', source: 'billing-live-read-only' }];
  assert.match(billingUnavailableReplyForTrace(failure), /Billing/);
  assert.match(billingUnavailableReplyForTrace(failure), /телефон/);
  assert.equal(billingUnavailableReplyForTrace([{ tool: 'customer.lookup', ok: false, code: 'NOT_FOUND' }]), '');
  assert.equal(billingUnavailableReplyForTrace([...failure, { tool: 'billing.balance', ok: true, code: 'OK' }]), '');
});

test('decision exports include decision/evidence/tools and exclude credentials', async () => {
  const { buildDecisionExport, decisionExportText } = await import('../standalone-ai/trace-report.js');
  const experiment = {
    customerMessageId: 'turn-1',
    model: 'deepseek-flash',
    elapsedMs: 8000,
    variants: [{
      label: 'with_knowledge', reply: 'Billing недоступен',
      toolTrace: [{
        tool: 'customer.lookup', ok: false, code: 'BILLING_TAB_REQUIRED', source: 'billing-live-read-only',
        args: { login: 'abon366882', password: 'danger-value', pp: 'session-secret' },
        data: { message: 'Невозможно выполнить запрос', source: 'billing-live-read-only' }
      }],
      evidenceGate: { applied: true, reason: 'billing_source_unavailable' },
      factEvidence: [], basis: ['dialogue']
    }],
    activeVariant: 'with_knowledge',
    analysis: { probe: { whatUserWants: 'баланс abon366882', confidence: 0.95, requiredFacts: ['subscriber.finance.balance.account'] }, knowledge: { skipped: true } }
  };
  const record = { customerMessageId: 'turn-1', input: 'abon366882: баланс?', at: '2026-10-26T00:00:00Z',
    experiment, decision: { reply: 'Billing недоступен', action: 'semantic_tool_reply' }, events: [{ type: 'tool_execution', customerMessageId: 'turn-1', code: 'BILLING_TAB_REQUIRED' }] };
  const lab = { id: 'test', messages: [{ id: 'turn-1', role: 'customer', text: record.input }], turnRecords: [record], lastExperiment: experiment, lastDecision: record.decision };
  const redacted = buildDecisionExport(lab, { mode: 'session' });
  const payload = JSON.stringify(redacted);
  assert.equal(redacted.turns.length, 1);
  assert.equal(redacted.turns[0].reads[0].code, 'BILLING_TAB_REQUIRED');
  assert.equal(redacted.turns[0].understanding.confidence, 0.95);
  assert.ok(!payload.includes('abon366882'));
  assert.ok(!payload.includes('danger-value'));
  assert.ok(!payload.includes('session-secret'));
  assert.match(decisionExportText(redacted), /BILLING_TAB_REQUIRED/);
  const optIn = buildDecisionExport(lab, { includeSensitive: true });
  assert.ok(JSON.stringify(optIn).includes('abon366882'));
  assert.ok(!JSON.stringify(optIn).includes('danger-value'));
});

test('standalone UI exposes a six-stage evidence view and source-open actions', () => {
  const html = readFileSync(resolve(root, 'standalone-ai/chat.html'), 'utf8');
  const js = readFileSync(resolve(root, 'standalone-ai/chat.js'), 'utf8');
  const css = readFileSync(resolve(root, 'standalone-ai/chat.css'), 'utf8');
  assert.match(html, /id="exportTurnJson"/);
  assert.match(html, /id="exportSessionJson"/);
  assert.match(html, /id="openBilling"/);
  assert.match(js, /buildDecisionExport/);
  assert.match(js, /Канонические факты/);
  assert.match(css, /#168466/);
  assert.doesNotMatch(css, /#a50046/i);
  assert.doesNotMatch(js, /innerHTML/);
});
