import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  analyzeSubscriberIntent,
  buildKnowledgeReflectionMessages,
  buildSubscriberIntentProbeMessages,
  generateSubscriberReply,
  AI_OPERATOR_GENERATION_MODEL_POOL,
  AI_OPERATOR_PROMPT_GUARD_MODEL
} from '../src/features/ai-operator/semantic-probe.js';
import { searchKnowledgeLibrary } from '../src/features/ai-operator/knowledge/index.js';

// NOTE: This regression suite intentionally verifies semantic prompting contracts
// rather than the exact wording of model output.

test('understanding prompt treats dialogue as meaning, not phrase classification', () => {
  const messages = buildSubscriberIntentProbeMessages({
    transcript: [
      { role: 'customer', text: 'Интернет пропал после перезагрузки роутера' },
      { role: 'operator', text: 'Индикатор LOS горит?' },
      { role: 'customer', text: 'нет' }
    ],
    latestCustomer: { text: 'нет' }
  });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /Это общение с человеком/i);
  assert.match(prompt, /весь доступный диалог/i);
  assert.match(prompt, /не автоматически фактом Billing/i);
  assert.match(prompt, /knowledge_need/i);
  assert.doesNotMatch(prompt, /intent matrix|phrase map|словар[ья] фраз/i);
});

test('knowledge search does not hallucinate unsupported company-specific discount', () => {
  const candidates = searchKnowledgeLibrary('скидка 15% ветеранам SIMNET', { limit: 6, minScore: 1 });
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
  assert.match(source, /normalizeLabBehavior\(behavior\)/, 'reply path must normalize the shared three-axis behavior profile');
  assert.match(source, /behaviorInstruction\(profile\)/, 'reply path must apply Naturalness, Depth and Initiative through the shared behavior instruction');
  assert.doesNotMatch(source, /profile\.confidenceStyle|profile\.curiosity|profile\.skepticism|profile\.brevity|profile\.maxFollowUpQuestions/, 'removed behavior axes must not remain active in subscriber reply prompting');
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
  assert.match(source, /runPromptGuard/);
});

test('semantic probe exported runtime functions remain callable', () => {
  assert.equal(typeof analyzeSubscriberIntent, 'function');
  assert.equal(typeof generateSubscriberReply, 'function');
});
