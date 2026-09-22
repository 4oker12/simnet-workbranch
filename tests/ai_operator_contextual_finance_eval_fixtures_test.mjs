import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIMNET_KNOWLEDGE,
  SIMNET_KNOWLEDGE_VERSION,
  searchKnowledgeLibrary
} from '../src/features/ai-operator/knowledge/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const l2Path = path.join(root, 'fixtures/contextual-reasoning/finance-l2-cases.json');
const l3Path = path.join(root, 'fixtures/contextual-reasoning/finance-l3-dialogue.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const REQUIRED_L2_IDS = [
  'l2-balance-direct',
  'l2-balance-colloquial',
  'l2-why-negative-again',
  'l2-i-paid',
  'l2-i-had-money',
  'l2-paid-two-weeks-ago',
  'l2-new-connect-debt-question',
  'l2-yesterday-worked-with-temporary',
  'l2-yesterday-worked-without-temporary',
  'l2-so-i-owe-170',
  'l2-why-099-vs-320'
];

const l2 = readJson(l2Path);
const l3 = readJson(l3Path);

assert.equal(l2.level, 'L2');
assert.equal(l3.level, 'L3');
assert.ok(Array.isArray(l2.cases) && l2.cases.length >= REQUIRED_L2_IDS.length);

const l2Ids = l2.cases.map(item => item.id);
for (const id of REQUIRED_L2_IDS) {
  assert.ok(l2Ids.includes(id), `missing required L2 case: ${id}`);
}

for (const item of l2.cases) {
  assert.ok(String(item.id || '').trim(), 'case id required');
  assert.ok(Array.isArray(item.customerTexts) && item.customerTexts.length > 0, `${item.id}: customerTexts required`);
  assert.ok(String(item.taskClass || '').trim(), `${item.id}: taskClass required`);
  assert.ok(item.evidence && typeof item.evidence === 'object', `${item.id}: evidence required`);
  assert.ok(item.expect && typeof item.expect === 'object', `${item.id}: expect required`);
  assert.ok(['simple', 'contextual'].includes(item.expect.replyMode), `${item.id}: replyMode must be simple|contextual`);
}

const direct = l2.cases.find(item => item.id === 'l2-balance-direct');
assert.deepEqual(direct.expect.mustReferenceFields, ['subscriber.finance.balance.account']);
assert.ok(direct.expect.mustNotPresentAsCurrentBalance.includes('subscriber.finance.balance.afterTariff'));

const owe = l2.cases.find(item => item.id === 'l2-so-i-owe-170');
assert.equal(owe.expect.mustNotConfirmDebtFromAfterTariffAlone, true);

const withTmp = l2.cases.find(item => item.id === 'l2-yesterday-worked-with-temporary');
const withoutTmp = l2.cases.find(item => item.id === 'l2-yesterday-worked-without-temporary');
assert.equal(withTmp.expect.mayUseTemporaryPaymentInExplanation, true);
assert.equal(withoutTmp.expect.mustNotInventTemporaryPayment, true);
assert.equal(withoutTmp.expect.mayUseTemporaryPaymentInExplanation, false);
assert.equal(withTmp.evidence['subscriber.finance.temporaryPayment'].status, 'known');
assert.equal(withoutTmp.evidence['subscriber.finance.temporaryPayment'].status, 'absent');

const hadMoney = l2.cases.find(item => item.id === 'l2-i-had-money');
assert.equal(hadMoney.expect.customerClaimAsFact, false);
assert.equal(hadMoney.expect.liveBalanceAuthoritativeForCurrentState, true);

assert.ok(Array.isArray(l3.turns) && l3.turns.length >= 8, 'L3 dialogue must have at least 8 turns');
assert.equal(l3.turns[0].taskClass, 'direct_balance');
assert.equal(l3.turns.at(-1).taskClass, 'return_to_finance');
assert.ok(l3.turns.some(turn => turn.taskClass === 'topic_switch_tariff'), 'L3 must include topic switch');
assert.ok(l3.turns.some(turn => /вчера|вчора/i.test(turn.text)), 'L3 must include yesterday-worked turn');
assert.equal(l3.sessionExpect.meaningContinuity, true);

for (const turn of l3.turns) {
  assert.equal(turn.role, 'customer');
  assert.ok(String(turn.text || '').trim());
  assert.ok(turn.expect && turn.expect.replyMode);
}

assert.equal(SIMNET_KNOWLEDGE_VERSION, 'simnet-encyclopedia-v3.3');
const settlement = SIMNET_KNOWLEDGE.find(article => article.id === 'billing.settlement-cycle');
assert.ok(settlement, 'billing.settlement-cycle must exist');
assert.match(settlement.text, /CONFIRMED/);
assert.match(settlement.text, /WORKING HYPOTHESIS/);
assert.match(settlement.text, /NEEDS SIMNET VERIFICATION/);

const hits = searchKnowledgeLibrary('расчётный период минус временный платёж новое подключение', { limit: 8, minScore: 1 });
assert.ok(hits.some(item => item.id === 'billing.settlement-cycle'), 'settlement-cycle must be retrievable');

console.log('ai_operator_contextual_finance_eval_fixtures_test: PASS');
