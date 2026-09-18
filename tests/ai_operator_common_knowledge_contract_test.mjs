import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function installChromeStorage() {
  const memory = Object.create(null);
  memory.simnet_workbench_ai_runtime_v1 = {
    groqApiKey: 'test-key',
    chatModel: 'qwen/qwen3.8-27b'
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...memory };
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter(key => Object.hasOwn(memory, key)).map(key => [key, memory[key]]));
        },
        async set(patch) { Object.assign(memory, patch || {}); }
      },
      onChanged: { addListener() {} }
    }
  };
}

function jsonResponse(content, model = 'qwen/qwen3.8-27b') {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('canonical common-knowledge contract reaches understanding, knowledge and synthesis stages', async () => {
  const semantic = await import('../src/features/ai-operator/semantic-probe.js');
  const { AUTONOMOUS_OPERATOR_INSTRUCTION } = await import('../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js');

  const understanding = semantic.buildSubscriberIntentProbeMessages({
    transcript: [{ role: 'customer', text: 'какие преимущества у оптоволокна?' }],
    latestCustomer: { text: 'какие преимущества у оптоволокна?' }
  });
  assert.equal(understanding[0]?.content, AUTONOMOUS_OPERATOR_INSTRUCTION);
  assert.match(understanding[0]?.content || '', /ABSENCE FROM SIMNET KB != ABSENCE OF KNOWLEDGE/i);
  assert.match(understanding[1]?.content || '', /knowledge_need=needed: ответ реально зависит от внутренних знаний SIMNET/i);

  const knowledge = semantic.buildKnowledgeReflectionMessages({
    probe: { whatUserWants: 'узнать преимущества оптоволокна' },
    candidateArticles: []
  });
  assert.equal(knowledge[0]?.content, AUTONOMOUS_OPERATOR_INSTRUCTION);
  assert.match(knowledge[0]?.content || '', /не запрещай общеизвестный ответ только потому, что SIMNET KB его не дублирует/i);
});

test('answer relevance gate inherits canonical instruction and distinguishes common knowledge from SIMNET live facts', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/answer-relevance-gate.js', import.meta.url), 'utf8');
  assert.match(source, /autonomousOperatorSystemMessages/);
  assert.match(source, /ABSENCE FROM SIMNET KB != ABSENCE OF KNOWLEDGE|Отсутствие статьи в SIMNET KB/i);
  assert.match(source, /технической, математической, логической, бытовой, языковой, физической, географической/i);
  assert.match(source, /конкретных внутренних\/live\/SIMNET-фактов/i);
  assert.match(source, /source":"dialogue\|common_knowledge\|reasoning\|knowledge:/i);
});

test('degraded generic fallback is recoverable with common knowledge even when KB and tools are empty', async () => {
  installChromeStorage();
  let calls = 0;
  let sentMessages = [];
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    const body = JSON.parse(String(options.body || '{}'));
    sentMessages = body.messages || [];
    return jsonResponse(JSON.stringify({
      reply: 'Оптоволокно обычно даёт высокую пропускную способность, устойчиво к электромагнитным помехам и хорошо подходит для высоких скоростей на больших расстояниях. Конкретная скорость уже зависит от тарифа и оборудования.',
      request: 'Рассказать о преимуществах оптоволоконного интернета',
      kept: [
        { fact: 'Общие свойства оптоволоконной технологии', source: 'common_knowledge', reason: 'Прямо отвечает на общий вопрос о преимуществах' }
      ],
      dropped: [],
      completeness: 'complete',
      conclusion: 'Общий вопрос закрывается common knowledge без SIMNET/live-фактов'
    }), body.model);
  };

  const gateModule = await import(`../src/features/ai-operator/answer-relevance-gate.js?common-knowledge=${Date.now()}`);
  const result = await gateModule.applyAnswerRelevanceGate({
    reply: 'Я понял запрос. Сейчас не удалось получить подтверждённые данные, поэтому не буду придумывать ответ. Попробуйте повторить запрос.',
    analysis: {
      probe: {
        whatUserWants: 'Рассказать о преимуществах оптоволоконного интернета',
        unresolvedRequests: ['Рассказать о преимуществах оптоволоконного интернета']
      },
      knowledge: { skipped: true, usedArticles: [], articleEvidence: [], relevantInternalKnowledge: [], knowledgeGaps: [] }
    },
    toolTrace: [],
    latestCustomer: { text: 'что про оптику вообще расскажете? ее преимущества?' },
    transcript: [{ role: 'customer', text: 'что про оптику вообще расскажете? ее преимущества?' }],
    useKnowledge: true,
    meterContext: { scope: 'test', turnId: 'common-knowledge-recovery' }
  });

  assert.equal(calls, 1, 'degraded fallback must not be skipped merely because KB/tools are empty');
  assert.equal(result.gate.skipped, false);
  assert.match(result.reply, /высокую пропускную способность/i);
  assert.equal(result.answerRelevance.kept[0]?.source, 'common_knowledge');

  const prompt = sentMessages.map(item => item.content || '').join('\n');
  assert.match(prompt, /ABSENCE FROM SIMNET KB != ABSENCE OF KNOWLEDGE/i);
  assert.match(prompt, /исправь ложный отказ/i);
});

test('ordinary good common-knowledge reply with no internal evidence is not needlessly reprocessed', async () => {
  installChromeStorage();
  globalThis.fetch = async () => { throw new Error('gate should be skipped'); };
  const gateModule = await import(`../src/features/ai-operator/answer-relevance-gate.js?common-knowledge-skip=${Date.now()}`);
  const reply = 'Оптоволокно устойчиво к электромагнитным помехам и поддерживает высокую пропускную способность.';
  const result = await gateModule.applyAnswerRelevanceGate({
    reply,
    analysis: {
      probe: { whatUserWants: 'Рассказать о преимуществах оптики', unresolvedRequests: ['Рассказать о преимуществах оптики'] },
      knowledge: { skipped: true }
    },
    toolTrace: [],
    latestCustomer: { text: 'преимущества оптики?' },
    transcript: [{ role: 'customer', text: 'преимущества оптики?' }],
    useKnowledge: true
  });
  assert.equal(result.gate.skipped, true);
  assert.equal(result.reply, reply);
});
