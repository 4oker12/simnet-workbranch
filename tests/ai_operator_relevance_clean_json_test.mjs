import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function installChromeStorage() {
  const memory = Object.create(null);
  memory.simnet_workbench_ai_runtime_v1 = {
    groqApiKey: 'test-key',
    chatModel: 'qwen/qwen3.6-27b'
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
  return memory;
}

function jsonResponse(content, { model = 'qwen/qwen3.6-27b', finishReason = 'stop', usage = {} } = {}) {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: {
      prompt_tokens: usage.prompt_tokens ?? 10,
      completion_tokens: usage.completion_tokens ?? 10,
      total_tokens: usage.total_tokens ?? 20
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('semantic probe repairs HTTP 200 truncated JSON before degrading the turn', async () => {
  installChromeStorage();
  let semanticCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || '{}'));
    if (body.model === 'meta-llama/llama-prompt-guard-2-86m') return jsonResponse('safe', { model: body.model });
    semanticCalls += 1;
    if (semanticCalls === 1) {
      return jsonResponse('{"language":"ru","what_user_wants":"понять предыдущий ответ"', {
        model: body.model,
        finishReason: 'length',
        usage: { prompt_tokens: 120, completion_tokens: 1400, total_tokens: 1520 }
      });
    }
    return jsonResponse(JSON.stringify({
      language: 'ru',
      what_user_wants: 'Понять, что означает предыдущий ответ оператора',
      latest_message_means: 'Клиент просит объяснить предыдущий ответ',
      refers_to: 'к предыдущему ответу оператора',
      underlying_goal: 'Разобраться в уже обсуждаемом вопросе',
      facts_said_by_user: [],
      facts_said_by_operator: [],
      unresolved_requests: ['Объяснить предыдущий ответ'],
      ambiguities: [],
      knowledge_need: 'none',
      knowledge_reason: 'Достаточно контекста диалога',
      confidence: 0.94
    }), { model: body.model, finishReason: 'stop' });
  };

  const semantic = await import(`../src/features/ai-operator/semantic-probe.js?json-recovery=${Date.now()}`);
  const analysis = await semantic.analyzeSubscriberIntent({
    transcript: [
      { role: 'agent', text: 'По стандартной сетке более дешёвого тарифа не вижу.' },
      { role: 'customer', text: 'что это значит?' }
    ],
    latestCustomer: { text: 'что это значит?' },
    knowledgeMode: 'off',
    meterContext: { scope: 'test', turnId: 'json-repair' }
  });

  assert.equal(semanticCalls, 2, 'invalid HTTP 200 JSON must trigger an in-model repair attempt');
  assert.equal(analysis.probe.whatUserWants, 'Понять, что означает предыдущий ответ оператора');
  assert.equal(analysis.decision.semanticDiagnostics.repaired, true);
  assert.equal(analysis.decision.semanticDiagnostics.finishReason, 'stop');
});

test('clean model path has no SIMNET tool manifest and cannot request live tools', async () => {
  installChromeStorage();
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || '{}'));
    requests.push(body);
    return jsonResponse(JSON.stringify({
      reply: 'Если речь о более дешёвом тарифе, без тарифной сетки конкретного провайдера я не могу назвать вариант.',
      unresolved_requests: ['Нужна актуальная тарифная сетка конкретного провайдера'],
      clarification_questions: [],
      verification_needed: ['Актуальные тарифы и условия конкретного провайдера'],
      answer_relevance: {
        request: 'Можно ли перейти на более дешёвый тариф?',
        kept: [{ fact: 'Клиент хочет более дешёвый тариф', source: 'dialogue', reason: 'Это текущий вопрос' }],
        dropped: [],
        completeness: 'partial',
        conclusion: 'Без внутренних тарифов точный вариант неизвестен'
      }
    }), { model: body.model });
  };

  const semantic = await import(`../src/features/ai-operator/semantic-probe.js?clean-model=${Date.now()}`);
  const result = await semantic.generateCleanModelReply({
    transcript: [{ role: 'customer', text: 'могу понизить тариф?' }],
    latestCustomer: { text: 'могу понизить тариф?' },
    meterContext: { scope: 'test', turnId: 'clean-model' }
  });

  const prompt = requests.map(item => JSON.stringify(item.messages || [])).join('\n');
  assert.doesNotMatch(prompt, /customer\.lookup|billing\.tariff|billing\.balance|pon\.signal|network\.session|tariff\.residential/);
  assert.deepEqual(result.subscriberDataNeeded, []);
  assert.equal(result.cleanModel, true);
  assert.equal(result.answerRelevance.completeness, 'partial');
});

test('answer relevance boundary is deterministic, uses zero API calls and strips auto-injected KB prefix', async () => {
  const gateSource = fs.readFileSync(new URL('../src/features/ai-operator/answer-relevance-gate.js', import.meta.url), 'utf8');
  const broker = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');

  assert.doesNotMatch(gateSource, /fetch\s*\(/);
  assert.doesNotMatch(gateSource, /readAiRuntimeConfig|AI_OPERATOR_GENERATION_MODEL_POOL|recordApiUsage/);
  assert.match(gateSource, /deterministic_local_relevance_boundary/);
  assert.match(gateSource, /Internal KB text is evidence\/context, not client-facing copy/i);
  assert.match(broker, /applyAnswerRelevanceGate/);
  assert.match(broker, /answerRelevance: relevance\.answerRelevance/);
  assert.match(broker, /relevanceGate: relevance\.gate/);

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('relevance boundary must not call network');
  };

  const gate = await import(`../src/features/ai-operator/answer-relevance-gate.js?local-boundary=${Date.now()}`);
  const internalPrefix = 'balance field is accountBalance; other related fields are internal Billing semantics';
  const result = await gate.applyAnswerRelevanceGate({
    reply: `${internalPrefix}\n\nБаланс — 800 грн.`,
    latestCustomer: { text: 'шо по балансу' },
    analysis: {
      probe: { whatUserWants: 'Узнать текущий баланс' },
      knowledge: { relevantInternalKnowledge: [internalPrefix] }
    },
    toolTrace: [{
      tool: 'billing.balance',
      ok: true,
      code: 'OK',
      requestedBy: { field: 'текущий баланс', why: 'Ответить на вопрос о балансе' }
    }]
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.reply, 'Баланс — 800 грн.');
  assert.equal(result.gate.reason, 'deterministic_local_relevance_boundary');
  assert.deepEqual(result.gate.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  assert.equal(result.answerRelevance.completeness, 'complete');
});

test('Lab exposes CLEAN MODEL and records the relevance filter in the ordered trace', () => {
  const background = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
  const trace = fs.readFileSync(new URL('../src/ui/ai-operator-lab-trace.js', import.meta.url), 'utf8');

  assert.match(background, /'off', 'auto', 'on', 'ab', 'clean'/);
  assert.match(background, /generateCleanModelReply/);
  assert.match(background, /CLEAN_CAPABILITIES/);
  assert.match(background, /toolCalls: 0/);
  assert.match(background, /answer_relevance/);
  assert.match(ui, /clean: 'CLEAN MODEL'/);
  assert.match(ui, /MODEL: CLEAN/);
  assert.match(ui, /CLEAN MODEL · без внутреннего контекста SIMNET/);
  assert.match(ui, /Энциклопедия, Billing\/UserSide\/Network tools, tool manifest и специальные правила SIMNET не передаются модели/);

  const facts = trace.indexOf("'ФАКТЫ'");
  const filter = trace.indexOf("'ФИЛЬТР ОТВЕТА'");
  const verify = trace.indexOf("'ПРОВЕРКА'");
  const answer = trace.indexOf("'ОТВЕТ'");
  assert.ok(facts >= 0 && filter > facts && verify > filter && answer > verify, 'relevance filter must sit between collected facts and final verification/answer');
  assert.match(trace, /ИСПОЛЬЗОВАНО/);
  assert.match(trace, /ОТБРОШЕНО/);
  assert.match(trace, /key-relevance/);
});
