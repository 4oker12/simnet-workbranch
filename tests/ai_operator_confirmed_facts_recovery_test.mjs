import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAnswerRelevanceGate } from '../src/features/ai-operator/answer-relevance-gate.js';

test('confirmed balance and tariff survive synthesis failure without adjacent Billing noise', async () => {
  const analysis = {
    probe: {
      language: 'ru',
      whatUserWants: 'Узнать текущий баланс и тариф',
      unresolvedRequests: ['Показать баланс', 'Показать текущий тариф']
    },
    knowledge: {
      relevantInternalKnowledge: ['balance field is accountBalance; other related fields have different semantics']
    }
  };
  const toolTrace = [
    {
      tool: 'customer.lookup',
      ok: true,
      code: 'OK',
      requestedBy: { system: 'identity', field: 'login', why: 'identify subscriber' },
      data: {
        candidate: {
          contract: '345834',
          connectionFamily: 'PON (EPON/GPON identifiers both present)'
        }
      }
    },
    {
      tool: 'billing.balance',
      ok: true,
      code: 'OK',
      requestedBy: { system: 'Billing', field: 'current balance', why: 'answer requested balance' },
      data: {
        accountBalance: 800,
        balanceAfterTariff: 400,
        accessState: 'Разрешен',
        serviceState: 'Все ОК',
        currentTariff: 'PON Гігабіт 400 (прив.сектор) - (15.10.2024)'
      }
    },
    {
      tool: 'billing.tariff',
      ok: true,
      code: 'OK',
      requestedBy: { system: 'Billing', field: 'current tariff', why: 'answer requested tariff' },
      data: {
        currentTariff: 'PON Гігабіт 400 (прив.сектор) - (15.10.2024)',
        accessState: 'Разрешен',
        serviceState: 'Все ОК'
      }
    }
  ];

  const degradedReply = [
    'balance field is accountBalance; other related fields have different semantics',
    '',
    'Договор 345834 найден. По данным Billing: доступ — Разрешен, состояние услуги — Все ОК. Текущий баланс: 800 грн. Текущий тариф: PON Гігабіт 400 (прив.сектор) - (15.10.2024). Тип подключения: PON (EPON/GPON identifiers both present).'
  ].join('\n');

  const result = await applyAnswerRelevanceGate({
    reply: degradedReply,
    analysis,
    toolTrace,
    latestCustomer: { text: 'abon345834 шо по балансу и какой тариф у меня' }
  });

  assert.match(result.reply, /800 грн/);
  assert.match(result.reply, /PON Гігабіт 400 \(прив\.сектор\)/);
  assert.doesNotMatch(result.reply, /15\.10\.2024/);
  assert.doesNotMatch(result.reply, /Договор|Разрешен|Все ОК|Тип подключения/i);
  assert.doesNotMatch(result.reply, /balance field is accountBalance/i);
  assert.equal(result.gate.reason, 'deterministic_confirmed_facts_recovery');
  assert.deepEqual(result.gate.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});
