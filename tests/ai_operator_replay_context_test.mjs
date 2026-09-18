import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runFactTurn } from '../src/features/ai-operator/fact-runtime.js';
import { explicitContractFromText, localDialogueControl, normalizeInterpretation } from '../src/features/ai-operator/dialogue-state.js';

const NOW = Date.parse('2026-09-16T06:00:00Z');

test('contract identifiers are recovered deterministically from real chat forms', () => {
  assert.equal(explicitContractFromText('Dogovir: 343359'), '343359');
  assert.equal(explicitContractFromText('abon343359'), '343359');
  assert.equal(explicitContractFromText('343359'), '343359');
  assert.deepEqual(normalizeInterpretation({ ids: { login: 'abon343359' } }).ids, { contract: '343359' });
});

test('short unknown reply is resolved by NLU against previous operator turn, not old topic', () => {
  const state = {
    pendingCandidate: null,
    language: 'ru',
    topic: [{ entity: 'network', relation: 'info', period: 'current' }]
  };
  assert.equal(localDialogueControl('Я не знаю)', state), null);
  assert.equal(localDialogueControl('не знаю)', state), null);
});

test('replay remembers explicit contract across later turns without touching live Billing', async () => {
  const first = await runFactTurn({
    text: 'Dogovir: 343359',
    state: {},
    transcript: [],
    replay: true,
    now: NOW,
    interpret: async () => ({ language: 'ru', speechAct: 'new', ids: {}, questions: [] })
  });

  assert.equal(first.decision.action, 'tool_required');
  assert.equal(first.decision.tool, 'customer.lookup');
  assert.equal(first.decision.toolArgs.contract, '343359');
  assert.equal(first.state.confirmedSubscriber.contract, '343359');
  assert.match(first.state.confirmedCaseId, /^replay-contract:343359$/);

  const second = await runFactTurn({
    text: 'а скорость у меня какая?',
    state: first.state,
    transcript: [],
    replay: true,
    now: NOW + 1000,
    interpret: async () => ({
      language: 'ru',
      speechAct: 'follow_up',
      ids: {},
      questions: [{ entity: 'tariff', relation: 'info', period: 'current' }]
    })
  });

  assert.equal(second.decision.action, 'tool_required');
  assert.equal(second.decision.tool, 'customer.snapshot');
  assert.doesNotMatch(second.decision.reply, /номер договора|полный адрес/i);
  assert.equal(second.state.confirmedSubscriber.contract, '343359');
});

test('tariff upgrade policy answers the observed 250 plus 100 follow-up without identity loop', async () => {
  const out = await runFactTurn({
    text: 'Можно сейчас оплатить 250, а потом доплатить 100 и перейти на гигабит?',
    state: {},
    transcript: [],
    replay: true,
    now: NOW,
    interpret: async () => ({
      language: 'ru',
      speechAct: 'new',
      ids: {},
      questions: [{ entity: 'tariff', relation: 'upgrade', period: 'current' }]
    })
  });

  assert.equal(out.decision.action, 'reply');
  assert.match(out.decision.reply, /любой день месяца/i);
  assert.match(out.decision.reply, /250.*350.*100|100 грн/i);
  assert.match(out.decision.reply, /соглас/i);
  assert.doesNotMatch(out.decision.reply, /номер договора|уточните.*что именно/i);
});

test('equipment compatibility follow-up gives a useful next step instead of router lecture', async () => {
  const out = await runFactTurn({
    text: 'Я не знаю)',
    state: {},
    transcript: [
      { role: 'agent', text: 'Какая модель роутера? Он поддерживает гигабит?' },
      { role: 'customer', text: 'Я не знаю)' }
    ],
    replay: true,
    now: NOW,
    interpret: async () => ({
      language: 'ru',
      speechAct: 'follow_up',
      ids: {},
      questions: [{ entity: 'equipment', relation: 'compatibility', period: 'current' }]
    })
  });

  assert.equal(out.decision.action, 'reply');
  assert.match(out.decision.reply, /наклейк/i);
  assert.match(out.decision.reply, /WAN\/LAN|8-жиль/i);
  assert.doesNotMatch(out.decision.reply, /соединяет домашние устройства с сетью провайдера/i);
});

test('NLU prompt keeps canonical identity and contextual follow-up rules', () => {
  const planner = fs.readFileSync(new URL('../src/features/ai-operator/groq-planner.js', import.meta.url), 'utf8');
  assert.match(planner, /NNN и abonNNN — один договор/i);
  assert.doesNotMatch(planner, /abonNNN — login, не contract/i);
  assert.match(planner, /tariff\.upgrade/);
  assert.match(planner, /equipment\.compatibility/);
  assert.match(planner, /НЕПОСРЕДСТВЕННО предыдущим вопросом/i);
  assert.match(planner, /transcript\.slice\(-10\)/);
  assert.doesNotMatch(planner, /qwen\/qwen3\.6-27b'\s*,\s*\n\s*'openai\/gpt-oss-120b'/);
});
