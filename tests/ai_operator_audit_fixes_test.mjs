import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFacts } from '../src/features/ai-operator/canonical-fact-resolver.js';
import { searchKnowledgeLibrary } from '../src/features/ai-operator/knowledge/index.js';
import { normalizeTariffLabel } from '../src/features/ai-operator/billing-tariff-normalizer.js';
import { compactValue, compactText } from '../src/features/ai-operator/compact-value.js';
import { compactTurnOutcome, replyIssues } from '../src/features/ai-operator/scenario-replay.js';

const NOW = Date.parse('2026-10-04T10:00:00Z');
const iso = () => new Date(NOW).toISOString();
const ctx = () => ({ confirmedCaseId: 'billing-live:900001', confirmedSubscriber: { billingId: '900001' }, domainContext: {} });

function makeExecute({ billing = {}, userside = null, usersideFails = false } = {}) {
  const calls = [];
  const execute = async ({ tool }) => {
    calls.push(tool);
    if (tool === 'customer.snapshot') return { ok: true, tool, observedAt: iso(), data: billing };
    if (tool === 'userside.snapshot') {
      if (usersideFails) return { ok: false, tool, code: 'USERSIDE_SESSION_UNAVAILABLE', observedAt: iso(), data: {} };
      return { ok: true, tool, observedAt: iso(), data: userside || {} };
    }
    if (tool === 'billing.main_summary') return { ok: true, tool, observedAt: iso(), data: billing };
    return { ok: false, tool, code: 'UNEXPECTED_TOOL', observedAt: iso(), data: {} };
  };
  return { execute, calls };
}
const fact = (result, path) => result.facts.find(item => item.path === path);

test('1. general tariff question retrieves the residential tariff article without any identification', () => {
  const ids = searchKnowledgeLibrary('Какие у вас вообще есть обычные тарифы для квартиры?', { limit: 4, minScore: 4 }).map(a => a.id);
  assert.ok(ids.includes('tariff.residential'), ids.join(','));
});

test('3. empty Billing technology falls through to exactly one UserSide read', async () => {
  const { execute, calls } = makeExecute({ billing: { technical: { technologyHint: '' } }, userside: { network: { connectionFamily: 'Ethernet' } } });
  const result = await resolveFacts({ context: ctx(), facts: ['subscriber.access.connectionFamily'], execute, now: NOW });
  const item = fact(result, 'subscriber.access.connectionFamily');
  assert.equal(item.status, 'known');
  assert.equal(item.value, 'Ethernet');
  assert.equal(item.viaFallbackOf, 'subscriber.access.connectionFamily');
  assert.deepEqual(calls, ['customer.snapshot', 'userside.snapshot']);
});

test('3b. a Billing technology hint does not trigger UserSide', async () => {
  const { execute, calls } = makeExecute({ billing: { technical: { technologyHint: 'GPON' } } });
  const result = await resolveFacts({ context: ctx(), facts: ['subscriber.access.connectionFamily'], execute, now: NOW });
  assert.equal(fact(result, 'subscriber.access.connectionFamily').value, 'GPON');
  assert.deepEqual(calls, ['customer.snapshot']);
});

test('4. unavailable UserSide stays unknown and is never turned into Ethernet', async () => {
  const { execute, calls } = makeExecute({ billing: { technical: { technologyHint: '' } }, usersideFails: true });
  const result = await resolveFacts({ context: ctx(), facts: ['subscriber.access.connectionFamily'], execute, now: NOW });
  const item = fact(result, 'subscriber.access.connectionFamily');
  assert.equal(item.status, 'unknown');
  assert.equal(item.value, null);
  assert.equal(item.fallbackChecked.source, 'userside.subscriber');
  assert.ok(calls.length <= 2, `bounded calls, got ${calls.join(',')}`);
});

test('16. a failed lookup is not retried inside one resolution', async () => {
  const { execute, calls } = makeExecute({ billing: { technical: { technologyHint: '' } }, usersideFails: true });
  await resolveFacts({ context: ctx(), facts: ['subscriber.access.connectionFamily'], execute, now: NOW });
  assert.equal(calls.filter(tool => tool === 'userside.snapshot').length, 1);
});

test('14. service start day 0 is preserved without assuming business semantics', async () => {
  const { execute } = makeExecute({ billing: { service: { startDay: 0 }, identity: { contractDate: '2020-01-01' } } });
  const result = await resolveFacts({ context: ctx(), facts: ['subscriber.service.startDay'], execute, now: NOW });
  const item = fact(result, 'subscriber.service.startDay');
  assert.equal(item.status, 'known');
  assert.equal(item.value, 0);
});

test('13. explicit speed in the tariff name is normalized for common spellings', () => {
  for (const [name, speed] of [['Безліміт 250 100 Mbit', 100], ['Симнет 300 (100Mbit)', 100], ['SIMNET-100Mbit', 100], ['Тариф 100 mbps', 100], ['Безліміт 300 100 Мб/с', 100], ['Гигабит 350 1Gbit', 1000]]) {
    assert.equal(normalizeTariffLabel(name).speedMbps, speed, name);
  }
  assert.equal(normalizeTariffLabel('Безліміт 300').speedMbps, null, 'a bare price is not a speed');
});

test('15. compaction keeps structure and never emits [object Object]', () => {
  const deep = { a: { b: { c: { d: { e: { f: { g: 'leaf' } } } } } } };
  const out = compactValue(deep, { maxDepth: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), deep, 'round trip');
  const clipped = compactValue(deep, { maxDepth: 3 });
  assert.ok(!JSON.stringify(clipped).includes('[object Object]'));
  assert.equal(compactText({ x: 1 }), '{"x":1}');
  const once = JSON.parse(JSON.stringify(compactValue(deep, { maxDepth: 8 })));
  assert.deepEqual(compactValue(once, { maxDepth: 8 }), once, 'idempotent after storage round trip');
});

test('17. unbacked promises and denial of known knowledge are not "complete"', () => {
  assert.deepEqual(replyIssues('Каталога тарифов нет, могу уточнить и вернуться.', []).sort(), ['DENIES_KNOWN_KNOWLEDGE', 'UNBACKED_PROMISE']);
  assert.deepEqual(replyIssues('Для квартиры 100/500/1000 Мбит/с.', ['tariff.residential']), []);
  const outcome = { experiment: { analysis: { probe: {}, knowledge: { usedArticles: [] } }, activeVariant: 'a', variants: [{ label: 'a', reply: 'Каталога тарифов нет, уточню и вернусь.', toolTrace: [] }] } };
  const turn = compactTurnOutcome({ outcome, user: 'Какие есть тарифы?', turnIndex: 4 });
  assert.equal(turn.status, 'incomplete');
  assert.ok(turn.replyIssues.includes('DENIES_KNOWN_KNOWLEDGE'));
});
