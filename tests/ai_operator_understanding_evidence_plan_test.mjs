import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriberIntentProbeMessages } from '../src/features/ai-operator/semantic-probe.js';
import { planLiveDataNeeds } from '../src/features/ai-operator/live-need-recovery.js';
import { mapInformationNeedsToTools } from '../src/features/ai-operator/semantic-tool-broker.js';

test('UNDERSTANDING asks for semantic live facts rather than tool names', () => {
  const messages = buildSubscriberIntentProbeMessages({
    transcript: [{ role: 'customer', text: 'abon345834 шо по балансу и какой тариф у меня' }],
    latestCustomer: { text: 'abon345834 шо по балансу и какой тариф у меня' }
  });
  const prompt = messages.map(item => String(item.content || '')).join('\n');

  assert.match(prompt, /"live_data_need":"none\|needed"/);
  assert.match(prompt, /"evidence_needs"/);
  assert.match(prompt, /факты, а НЕ tools и НЕ команды/);
  assert.match(prompt, /field="текущий баланс"/);
  assert.match(prompt, /field="текущий тариф"/);
  assert.match(prompt, /Не пиши названия функций вроде billing\.balance/);
});

test('semantic evidence plan maps balance and tariff to bounded READ tools', () => {
  const analysis = {
    probe: {
      liveDataNeed: 'needed',
      evidenceNeeds: [
        { system: 'Billing', field: 'текущий баланс', why: 'Нужно ответить на вопрос о балансе' },
        { system: 'Billing', field: 'текущий тариф', why: 'Нужно ответить на вопрос о тарифе' }
      ],
      whatUserWants: 'Узнать баланс и текущий тариф',
      unresolvedRequests: ['Узнать баланс', 'Узнать текущий тариф']
    }
  };

  const needs = planLiveDataNeeds(analysis);
  assert.deepEqual(needs, analysis.probe.evidenceNeeds);

  const calls = mapInformationNeedsToTools(needs);
  assert.deepEqual(calls.map(item => item.tool), ['billing.balance', 'billing.tariff']);
  assert.equal(calls.every(item => item.toolArgs.refresh === true), true);
});

test('semantic evidence plan stays fact-level after handoff', () => {
  const analysis = {
    probe: {
      liveDataNeed: 'needed',
      evidenceNeeds: [{ system: 'Network', field: 'текущая сессия абонента', why: 'Нужно проверить наличие сессии' }]
    }
  };

  const needs = planLiveDataNeeds(analysis);
  assert.equal(needs[0].field, 'текущая сессия абонента');
  assert.equal(needs[0].field.includes('network.session'), false);
  assert.equal(mapInformationNeedsToTools(needs)[0].tool, 'network.session');
});
