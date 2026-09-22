import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateFinanceBehavior,
  loadFinanceL2Cases
} from '../src/features/ai-operator/contextual-finance-eval.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const l2 = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/contextual-reasoning/finance-l2-cases.json'), 'utf8'));
const cases = loadFinanceL2Cases(l2);
assert.ok(cases.length >= 11);

const byId = Object.fromEntries(cases.map(item => [item.id, item]));

{
  const item = byId['l2-balance-direct'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'На счету 320,99 грн.',
    toolTrace: [{ tool: 'billing.main_summary', source: 'billing.mainSummary' }]
  });
  assert.equal(result.ok, true, result.failures.join('; '));
}

{
  const item = byId['l2-balance-direct'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Сейчас на счету 0,99 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /afterTariff/i.test(f)));
}

{
  const item = byId['l2-balance-direct'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'На счету 320,99 грн., задолженность отсутствует.',
    toolTrace: [{ tool: 'billing.main_summary', source: 'billing.mainSummary' }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /forbidden claim/i.test(f)));
}

{
  const item = byId['l2-yesterday-worked-without-temporary'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Вчера работало за счёт временного платежа 200 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /temporaryPayment/i.test(f)));
}

{
  const item = byId['l2-yesterday-worked-without-temporary'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Вчора доступ працював через тимчасовий платіж 200 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /temporaryPayment/i.test(f)));
}

{
  const item = byId['l2-yesterday-worked-with-temporary'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Вчера доступ мог держаться за счёт временного платежа 200 грн; это временная сумма, не обычное пополнение.',
    toolTrace: []
  });
  assert.equal(result.ok, true, result.failures.join('; '));
}

{
  const item = byId['l2-so-i-owe-170'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Да, у вас долг 170 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /debt/i.test(f)));
}

{
  const item = byId['l2-so-i-owe-170'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Так, у вас борг 170 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /debt/i.test(f)));
}

{
  const item = byId['l2-so-i-owe-170'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Да, вы должны 170 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /debt/i.test(f)));
}

{
  const item = byId['l2-so-i-owe-170'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'Нет. 170 грн нельзя автоматически считать долгом: это расчётное значение после тарифа; на счёте сейчас 80 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, true, result.failures.join('; '));
}

{
  const item = byId['l2-why-099-vs-320'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'На счёте 320,99 грн. После учёта тарифа расчётный остаток — 0,99 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, true, result.failures.join('; '));
}

{
  const item = byId['l2-why-099-vs-320'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'На счёте 320,99 грн.',
    toolTrace: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /balance\.afterTariff/i.test(f)));
}

{
  const item = byId['l2-balance-colloquial'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'На счету 150 грн.',
    toolTrace: [
      { tool: 'billing.main_summary', source: 'billing.mainSummary' },
      { tool: 'network.session', source: 'network.session' }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /too many tool/i.test(f)));
}

{
  const item = byId['l2-balance-direct'];
  const result = evaluateFinanceBehavior({
    caseExpect: item.expect,
    evidence: item.evidence,
    reply: 'На счету 320,99 грн.',
    toolTrace: [{ tool: 'network.session', source: 'network.session' }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => /disallowed tool source/i.test(f)));
}

console.log('ai_operator_contextual_finance_behavior_eval_test: PASS');
