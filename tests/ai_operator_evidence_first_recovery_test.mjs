import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { groundSubscriberReply } from '../src/features/ai-operator/semantic-tool-broker.js';

function okTrace(tool, data, field) {
  return {
    tool,
    requestedBy: { system: 'Billing', field, why: `Нужен ${field} для текущего ответа` },
    args: { refresh: true },
    ok: true,
    code: 'OK',
    observedAt: '2026-09-19T00:10:00.000Z',
    source: 'billing-main-live-read-only',
    data,
    warnings: []
  };
}

test('UNDERSTANDING may reason about evidence sufficiency but does not answer or choose tools', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  const stage = source.match(/const stageInstruction = `ЭТАП: UNDERSTANDING\.[\s\S]*?`;\n  return \[/)?.[0] || '';

  assert.match(stage, /Не формируй финальный ответ на этой стадии/);
  assert.match(stage, /обычное внутреннее reasoning/);
  assert.match(stage, /достаточно ли уже известных фактов и общеизвестного знания/);
  assert.match(stage, /Если ответ уже следует из известного контекста, ставь live_data_need=none и не создавай evidence_needs/);
  assert.match(stage, /evidence_needs как факты, а НЕ tools и НЕ команды/);
  assert.doesNotMatch(stage, /Не выполняй арифметику и не решай сам запрос/);
});

test('live balance + tariff skips pre-tool answer synthesis in the Lab pipeline', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
  const liveBranch = source.match(/async function replyVariant[\s\S]*?async function cleanVariant/)?.[0] || '';

  assert.match(liveBranch, /const liveNeeds = planLiveDataNeeds\(analysis\)/);
  assert.match(liveBranch, /if \(liveNeeds\.length\)\s*\{\s*draft = evidenceFirstDraft\(/);
  assert.match(liveBranch, /else\s*\{[\s\S]*?generateSubscriberReply\(/);
  assert.match(source, /UNDERSTANDING → KB при необходимости → evidence plan → READ → один финальный synthesis → локальная проверка/);
});

test('generation recovery state depends on evidence coverage, not reply wording', () => {
  const broker = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');
  const impl = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker-impl.js', import.meta.url), 'utf8');

  assert.match(broker, /delegated\?\.evidenceFallback\?\.used/);
  assert.match(broker, /delegated\?\.evidenceFallback\?\.complete/);
  assert.doesNotMatch(broker, /relevance\?\.gate\?\.reason === 'deterministic_confirmed_facts_recovery'/);
  assert.match(impl, /evidenceFallback:\s*\{/);
  assert.match(impl, /requestedTools:/);
  assert.match(impl, /coveredTools:/);
  assert.match(impl, /complete: Boolean\(evidenceFallback\.complete\)/);
});

test('confirmed balance + tariff survive final synthesis 429 without leaking adjacent Billing facts', async () => {
  const analysis = {
    probe: {
      language: 'ru',
      whatUserWants: 'Узнать текущий баланс и текущий тариф',
      latestMessageMeans: 'Абонент спрашивает баланс и какой у него тариф',
      unresolvedRequests: ['Сообщить баланс и текущий тариф'],
      liveDataNeed: 'needed',
      evidenceNeeds: [
        { system: 'Billing', field: 'текущий баланс', why: 'Нужен текущий баланс' },
        { system: 'Billing', field: 'текущий тариф', why: 'Нужен текущий тариф' }
      ]
    },
    knowledge: {
      skipped: false,
      relevantInternalKnowledge: ['balance field is accountBalance; other related fields are internal Billing semantics'],
      articleEvidence: []
    }
  };

  const draft = {
    reply: '',
    subscriberDataNeeded: analysis.probe.evidenceNeeds,
    unresolvedRequests: analysis.probe.unresolvedRequests,
    clarificationQuestions: [],
    verificationNeeded: [],
    nextStepOffered: '',
    basis: ['dialogue', 'semantic-understanding', 'evidence-plan'],
    behaviorEffects: {},
    behavior: {},
    model: '',
    usage: {},
    rateLimit: {},
    degraded: false,
    evidenceFirst: true
  };

  const toolTrace = [
    {
      tool: 'customer.lookup',
      requestedBy: { system: 'identity', field: 'login', why: 'Привязать live-контекст' },
      args: { login: 'abon345834' },
      ok: true,
      code: 'OK',
      observedAt: '2026-09-19T00:09:59.000Z',
      source: 'billing-live-read-only',
      data: {
        candidate: { contract: '345834', billingId: '42', connectionFamily: 'PON' },
        source: 'billing-live-read-only'
      },
      warnings: []
    },
    okTrace('billing.balance', {
      accountBalance: 800,
      accessState: 'Разрешен',
      serviceState: 'Все ОК',
      currentTariff: 'PON Гігабіт 400 (прив.сектор) - (18.09.2026)',
      source: 'billing-main-live-read-only'
    }, 'текущий баланс'),
    okTrace('billing.tariff', {
      currentTariff: 'PON Гігабіт 400 (прив.сектор) - (18.09.2026)',
      accessState: 'Разрешен',
      serviceState: 'Все ОК',
      source: 'billing-main-live-read-only'
    }, 'текущий тариф')
  ];

  let executeCalls = 0;
  const result = await groundSubscriberReply({
    draft,
    transcript: [{ role: 'customer', text: 'шо по балансу и какой тариф у меня' }],
    latestCustomer: { text: 'шо по балансу и какой тариф у меня' },
    analysis,
    useKnowledge: true,
    labState: {
      confirmedCaseId: 'billing-live:42',
      confirmedSubscriber: { caseId: 'billing-live:42', billingId: '42', contract: '345834', login: 'abon345834' }
    },
    execute: async () => {
      executeCalls += 1;
      throw new Error('injected coreGround must own this test cycle');
    },
    coreGround: async ({ draft: routedDraft, labState }) => ({
      ...routedDraft,
      reply: 'Проверку данных выполнил, но сейчас не удалось корректно сформировать итоговый ответ. Данные проверки сохранены; повторите, пожалуйста, этот ход.',
      toolTrace,
      toolEvidence: toolTrace.filter(item => item.ok),
      degraded: true,
      degradationReason: 'Groq HTTP 429 — rate limit reached',
      toolState: labState
    })
  });

  assert.equal(executeCalls, 0);
  assert.equal(result.reply, 'Текущий баланс: 800 грн. Текущий тариф: PON Гігабіт 400 (прив.сектор).');
  assert.equal(result.degraded, false, 'complete confirmed evidence must recover the subscriber-facing turn');
  assert.equal(result.recoveredFromGenerationFailure, true);
  assert.equal(result.generationDegraded, true);
  assert.deepEqual(result.evidenceFallback, {
    used: true,
    requestedTools: ['billing.balance', 'billing.tariff'],
    coveredTools: ['billing.balance', 'billing.tariff'],
    complete: true
  });
  assert.equal(result.relevanceGate?.reason, 'deterministic_local_relevance_boundary');
  assert.doesNotMatch(result.reply, /Договор|Разрешен|Все ОК|Тип подключения|connectionFamily/i);
  assert.doesNotMatch(result.reply, /balance field is accountBalance|повторите|rate limit|429/i);
  assert.doesNotMatch(result.reply, /18\.09\.2026/);
});
