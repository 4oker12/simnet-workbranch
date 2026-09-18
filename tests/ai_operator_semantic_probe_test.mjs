import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AI_OPERATOR_GENERATION_MODEL_POOL,
  AI_OPERATOR_KNOWLEDGE_MODES,
  AI_OPERATOR_PROMPT_GUARD_MODEL,
  buildKnowledgeReflectionMessages,
  buildSubscriberIntentProbeMessages,
  shouldReadKnowledge
} from '../src/features/ai-operator/semantic-probe.js';
import {
  SIMNET_KNOWLEDGE,
  searchKnowledgeLibrary
} from '../src/features/ai-operator/knowledge/index.js';

test('semantic probe asks what the subscriber wants without deterministic intent taxonomy', () => {
  const messages = buildSubscriberIntentProbeMessages({
    transcript: [
      { role: 'agent', text: 'Какая модель роутера? Он поддерживает гигабит?' },
      { role: 'customer', text: 'Я не знаю)' }
    ],
    latestCustomer: { text: 'Я не знаю)' }
  });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /общение с человеком/i);
  assert.match(prompt, /чего человек хочет добиться/i);
  assert.match(prompt, /непосредственно предыдущую реплику оператора/i);
  assert.match(prompt, /Я не знаю\)/);
  assert.match(prompt, /что действительно следует из разговора/i);
  assert.match(prompt, /unresolved_requests/i);
  assert.match(prompt, /служебные кнопки\/пункты меню сами по себе не означают смену реальной темы/i);
  assert.doesNotMatch(prompt, /balance\.amount|tariff\.upgrade|customer\.lookup|recurring_charge\.amount/);
  assert.doesNotMatch(prompt, /would_need_to_know|assumptions/);
});

test('semantic layer decides whether encyclopedia is useful and exposes explicit lab modes', () => {
  const messages = buildSubscriberIntentProbeMessages({
    transcript: [
      { role: 'agent', text: 'Будь ласка, вкажіть Ваш номер договору' },
      { role: 'customer', text: '146888' }
    ],
    latestCustomer: { text: '146888' }
  });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /knowledge_need/i);
  assert.match(prompt, /none\|maybe\|needed/i);
  assert.match(prompt, /не открывай энциклопедию только потому/i);
  assert.match(prompt, /служебный выбор меню/i);
  assert.equal(shouldReadKnowledge({ knowledgeNeed: 'none' }), false);
  assert.equal(shouldReadKnowledge({ knowledgeNeed: 'maybe' }), true);
  assert.equal(shouldReadKnowledge({ knowledgeNeed: 'needed' }), true);
  assert.equal(shouldReadKnowledge({}), true, 'missing gate must fail open and preserve encyclopedia access');
  assert.deepEqual(AI_OPERATOR_KNOWLEDGE_MODES, ['off', 'auto', 'on']);

  const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  assert.match(source, /mode === 'on' \|\| \(mode === 'auto' && shouldReadKnowledge\(probe\)\)/);
  assert.match(source, /knowledge_mode_off/);
  assert.match(source, /semantic_gate_none/);
  assert.match(source, /knowledgeMessages = \[\]/);
});

test('SIMNET knowledge library is descriptive encyclopedia, not phrase routing matrix', () => {
  assert.ok(SIMNET_KNOWLEDGE.length >= 20, 'knowledge library should contain a useful first encyclopedia set');
  const ids = new Set(SIMNET_KNOWLEDGE.map(article => article.id));
  for (const required of [
    'billing.balance',
    'billing.identification',
    'tariff.residential',
    'tariff.private-sector',
    'tariff.upgrade',
    'tariff.downgrade',
    'technical.no-internet',
    'technical.wifi-vs-internet',
    'technical.pon',
    'technical.ethernet',
    'service.static-ip',
    'service.pause',
    'service.credit-days',
    'service.omega-tv',
    'service.cable-tv',
    'connection.new-customer'
  ]) assert.ok(ids.has(required), `missing encyclopedia article ${required}`);

  const allText = SIMNET_KNOWLEDGE.map(article => article.text).join('\n');
  assert.doesNotMatch(allText, /если клиент написал\s+["«]/i, 'encyclopedia must not become a phrasebook');
});

test('soft retrieval offers relevant articles but does not return a forced action', () => {
  const balance = searchKnowledgeLibrary('Скільки грошей на рахунку, хочу знати баланс', { limit: 4 });
  assert.ok(balance.some(article => article.id === 'billing.balance'));
  assert.equal(balance.some(article => Object.hasOwn(article, 'action')), false);

  const neighbors = searchKnowledgeLibrary('У 4-5 сусідів одночасно пропадає інтернет', { limit: 4 });
  assert.ok(neighbors.some(article => article.id === 'technical.no-internet'));
});

test('knowledge reflection treats encyclopedia as optional reference and rejects generic industry-policy invention', () => {
  const candidates = searchKnowledgeLibrary('Я оплатил, дайте интернет', { limit: 4 });
  const messages = buildKnowledgeReflectionMessages({
    probe: {
      whatUserWants: 'Получить работающий интернет после оплаты',
      factsSaidByUser: ['Клиент утверждает, что оплатил услугу'],
      ambiguities: []
    },
    candidateArticles: candidates
  });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /справочник, а не сценарий/i);
  assert.match(prompt, /customer_claim/i);
  assert.match(prompt, /гипотеза допустима только если у неё есть конкретное основание/i);
  assert.match(prompt, /не добавляй «типичную практику отрасли»/i);
  assert.match(prompt, /не перечисляй всё/i);
  assert.match(prompt, /knowledge_gaps — только пробел внутренней энциклопедии/i);
  assert.doesNotMatch(prompt, /обязательно вызови|обязан вызвать/i);
});

test('unknown company policy stays an explicit encyclopedia gap instead of becoming a customer-claim fact', () => {
  const candidates = searchKnowledgeLibrary('Чув що компанія дає ветеранам знижку 15 відсотків', { limit: 6 });
  assert.equal(candidates.length, 0, 'unconfirmed veteran discount must not be silently represented by an unrelated article');

  const messages = buildKnowledgeReflectionMessages({
    probe: {
      whatUserWants: 'Узнать, есть ли в SIMNET скидка 15% для ветеранов',
      factsSaidByUser: ['Клиент говорит, что слышал о скидке 15% для ветеранов'],
      factsSaidByOperator: [],
      ambiguities: []
    },
    candidateArticles: []
  });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /no_candidate_articles_found/);
  assert.match(prompt, /knowledge_gaps/);
  assert.match(prompt, /не превращай слова клиента.*в правило компании/i);
  assert.match(prompt, /не записывай туда номер договора, адрес, модель роутера, баланс/i);
});

test('subscriber reply path keeps behavior tunable while truth rules stay invariant', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  assert.match(source, /export async function generateSubscriberReply/);
  assert.match(source, /НЕИЗМЕНЯЕМЫЕ правила достоверности/i);
  assert.match(source, /customer_claim.*не являются подтверждёнными фактами системы/i);
  assert.match(source, /internal_knowledge\.enabled=false/i);
  assert.match(source, /не добавляй «обычную практику отрасли»/i);
  assert.match(source, /subscriber_data_needed/);
  assert.match(source, /behavior_effects/);
  assert.match(source, /Решительность \$\{profile\.confidenceStyle\}/);
  assert.match(source, /Любопытство \$\{profile\.curiosity\}/);
  assert.match(source, /Инициативность \$\{profile\.initiative\}/);
  assert.match(source, /Скепсис \$\{profile\.skepticism\}/);
  assert.match(source, /Краткость \$\{profile\.brevity\}/);
});

test('Replay knowledge experiment bypasses deterministic regulator files', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/replay-background.js', import.meta.url), 'utf8');
  assert.match(source, /semantic-probe\.js/);
  assert.doesNotMatch(source, /fact-runtime\.js/);
  assert.doesNotMatch(source, /fact-catalog\.js/);
  assert.doesNotMatch(source, /dialogue-state\.js/);
  assert.match(source, /mode: 'knowledge_probe'/);
  assert.match(source, /knowledgeProbe/);
});

test('semantic experiment rotates supported generation models and invokes Llama Prompt Guard separately', () => {
  assert.equal(AI_OPERATOR_PROMPT_GUARD_MODEL, 'meta-llama/llama-prompt-guard-2-86m');
  assert.deepEqual(AI_OPERATOR_GENERATION_MODEL_POOL, [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ]);
  assert.equal(AI_OPERATOR_GENERATION_MODEL_POOL.includes('qwen/qwen3.6-27b'), false, 'retired Groq model must never be retried after a live 404');

  const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  assert.match(source, /RETIRED_MODELS = new Set\(\['qwen\/qwen3\.6-27b'\]\)/);
  assert.match(source, /!RETIRED_MODELS\.has\(model\)/);
  assert.match(source, /runPromptGuard\(latestCustomer, runtime, meterContext\)/);
  assert.match(source, /if \(Number\(response\.status\) === 429\) markRateLimited/);
  assert.match(source, /for \(const model of modelsForRuntime\(runtime\)\)/);
  assert.doesNotMatch(source, /modelsForRuntime\(runtime\)\.slice\(0, 2\)/);
});