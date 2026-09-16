import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Manual Lab uses semantic runtime, supports live profile changes, A/B repeat and snapshots', async () => {
  const savedChrome = globalThis.chrome;
  const savedFetch = globalThis.fetch;
  const listeners = [];
  const storage = {
    simnet_workbench_ai_runtime_v1: { groqApiKey: 'test-only-placeholder', chatModel: 'qwen/qwen3.8-27b' }
  };
  globalThis.chrome = {
    runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: structuredClone(storage[keys]) };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, structuredClone(storage[key])]));
          return structuredClone(storage);
        },
        set: async patch => Object.assign(storage, structuredClone(patch))
      }
    }
  };

  const bodies = [];
  const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    const system = body.messages?.[0]?.role === 'system' ? String(body.messages[0].content || '') : '';
    let content = 'SAFE';
    if (/анализируешь живой диалог/i.test(system)) {
      content = JSON.stringify({
        language: 'ru',
        what_user_wants: 'Узнать, можно ли перейти на гигабитный тариф',
        latest_message_means: 'Клиент спрашивает о переходе на гигабит',
        refers_to: '',
        underlying_goal: 'Увеличить скорость доступа',
        facts_said_by_user: [],
        facts_said_by_operator: [],
        unresolved_requests: ['Получить ответ о возможности перехода'],
        ambiguities: [],
        knowledge_need: 'needed',
        knowledge_reason: 'Нужны внутренние условия SIMNET',
        confidence: 0.94
      });
    } else if (/продолжаешь разбор обращения/i.test(system)) {
      content = JSON.stringify({
        used_articles: [],
        relevant_internal_knowledge: ['Переход зависит от условий SIMNET и технологии подключения'],
        how_it_applies: 'Внутреннее знание уточняет условия перехода',
        already_enough: ['Клиент хочет гигабит'],
        must_not_assume: ['Нельзя считать технологию конкретного абонента подтверждённой'],
        hypotheses: [],
        knowledge_gaps: []
      });
    } else if (/формируешь ответ абоненту/i.test(system)) {
      const userPayload = JSON.parse(body.messages.at(-1).content);
      const withKnowledge = Boolean(userPayload.grounded_context?.internal_knowledge?.enabled);
      content = JSON.stringify({
        reply: withKnowledge
          ? 'Перейти на гигабит можно при подходящей технологии подключения. Данные вашего договора в лаборатории пока не подключены.'
          : 'Я понимаю, что вы хотите перейти на гигабит. Без внутренней базы SIMNET не буду придумывать условия перехода.',
        subscriber_data_needed: [{ system: 'Billing', field: 'технология/тариф договора', why: 'проверить применимость к конкретному абоненту' }],
        unresolved_requests: [],
        clarification_questions: [],
        verification_needed: ['Технология подключения конкретного договора'],
        next_step_offered: '',
        basis: withKnowledge ? ['dialogue', 'knowledge'] : ['dialogue'],
        behavior_effects: {
          directness: 'Ответ сформулирован осторожно.',
          clarification: 'Уточнение не обязательно на этом шаге.',
          verification: 'Live-данные не выдуманы.',
          initiative: 'Дополнительный шаг не навязан.',
          brevity: 'Ответ краткий.'
        }
      });
    }
    return new Response(JSON.stringify({
      model: body.model,
      choices: [{ message: { content } }],
      usage
    }), { status: 200 });
  };

  const sendMessage = message => new Promise(resolve => {
    const accepted = listeners[0](message, {}, resolve);
    assert.equal(accepted, true);
  });

  try {
    await import(`../src/features/ai-operator/lab-background.js?behavior-lab=${Date.now()}`);
    assert.equal(listeners.length, 1);

    const configured = await sendMessage({
      type: 'AI_OPERATOR_LAB_CONFIG',
      payload: {
        knowledgeMode: 'off',
        displayMode: 'answer_analysis',
        behavior: { confidenceStyle: 25, curiosity: 80, initiative: 35, skepticism: 90, brevity: 70, maxFollowUpQuestions: 1 }
      }
    });
    assert.equal(configured.success, true);
    assert.equal(configured.data.knowledgeMode, 'off');
    assert.equal(configured.data.behavior.curiosity, 80);
    assert.equal(configured.data.behavior.skepticism, 90);

    const first = await sendMessage({ type: 'AI_OPERATOR_LAB_SEND', payload: { text: 'Можно перейти на гигабит?' } });
    assert.equal(first.success, true);
    assert.equal(first.data.lastExperiment.knowledgeMode, 'off');
    assert.equal(first.data.lastExperiment.variants.length, 1);
    assert.equal(first.data.lastExperiment.variants[0].useKnowledge, false);
    assert.match(first.data.messages.at(-1).text, /Без внутренней базы SIMNET/i);
    assert.deepEqual(first.data.capabilities, { billing: false, userside: false, network: false });
    assert.ok(first.data.lastExperiment.variants[0].subscriberDataNeeded.some(item => item.system === 'Billing'));
    assert.equal(bodies.filter(body => /продолжаешь разбор обращения/i.test(body.messages?.[0]?.content || '')).length, 0, 'KB reflection must be skipped in OFF mode');

    const changed = await sendMessage({
      type: 'AI_OPERATOR_LAB_CONFIG',
      payload: { knowledgeMode: 'ab', behavior: { confidenceStyle: 70, curiosity: 35, initiative: 75 } }
    });
    assert.equal(changed.success, true);
    assert.equal(changed.data.knowledgeMode, 'ab');
    assert.equal(changed.data.behavior.confidenceStyle, 70);

    const bodyCountBeforeRepeat = bodies.length;
    const repeated = await sendMessage({ type: 'AI_OPERATOR_LAB_REPEAT' });
    assert.equal(repeated.success, true);
    assert.equal(repeated.data.lastExperiment.knowledgeMode, 'ab');
    assert.equal(repeated.data.lastExperiment.variants.length, 2);
    assert.deepEqual(repeated.data.lastExperiment.variants.map(item => item.label), ['without_knowledge', 'with_knowledge']);
    assert.equal(repeated.data.lastExperiment.activeVariant, 'with_knowledge');
    assert.match(repeated.data.messages.at(-1).text, /подходящей технологии/i);

    const repeatBodies = bodies.slice(bodyCountBeforeRepeat);
    const semanticBody = repeatBodies.find(body => /анализируешь живой диалог/i.test(body.messages?.[0]?.content || ''));
    assert.ok(semanticBody, 'repeat must rerun semantic understanding');
    const semanticPayload = JSON.parse(semanticBody.messages.at(-1).content);
    assert.equal(semanticPayload.dialogue.length, 1, 'repeat must use pre-turn state, not prior generated answer');
    assert.equal(semanticPayload.dialogue[0].role, 'customer');
    assert.equal(semanticPayload.dialogue[0].text, 'Можно перейти на гигабит?');
    assert.equal(repeatBodies.filter(body => /формируешь ответ абоненту/i.test(body.messages?.[0]?.content || '')).length, 2, 'A/B must generate both answer variants');

    const snap = await sendMessage({ type: 'AI_OPERATOR_LAB_SNAPSHOT' });
    assert.equal(snap.success, true);
    assert.equal(snap.data.snapshots.length, 1);
    assert.equal(snap.data.snapshots[0].knowledgeMode, 'ab');
    assert.equal(snap.data.snapshots[0].behavior.confidenceStyle, 70);
    assert.equal(snap.data.snapshots[0].experiment.variants.length, 2);

    assert.ok(repeated.data.apiCost.session.calls >= 1, 'manual lab API usage must be metered');
    assert.ok(repeated.data.apiCost.session.usd > 0);
  } finally {
    globalThis.chrome = savedChrome;
    globalThis.fetch = savedFetch;
  }
});

test('Manual Lab no longer wires the old deterministic runtime into the new experiment path', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
  assert.match(source, /analyzeSubscriberIntent/);
  assert.match(source, /generateSubscriberReply/);
  assert.doesNotMatch(source, /fact-runtime\.js/);
  assert.doesNotMatch(source, /groq-planner\.js/);
  assert.doesNotMatch(source, /live-tool-runtime\.js/);
  assert.match(source, /AI_OPERATOR_LAB_REPEAT/);
  assert.match(source, /AI_OPERATOR_LAB_SNAPSHOT/);
  assert.match(source, /messagesBefore/);
});