import test from 'node:test';
import assert from 'node:assert/strict';

function envelope(content, usage = {}, model = 'deepseek-flash', reasoningContent = null) {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: 'stop', message: { content, reasoning_content: reasoningContent } }],
    usage: {
      prompt_tokens: Number(usage.prompt_tokens || 0),
      completion_tokens: Number(usage.completion_tokens || 0),
      total_tokens: Number(usage.total_tokens || 0)
    }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('DeepSeek provider adapter repairs one invalid json_object response and preserves total usage', async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  delete globalThis.__SIMNET_AI_PROVIDER_ROUTER__;

  const calls = [];
  let responseMode = 'truncated';
  let modeCalls = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            simnet_workbench_ai_runtime_v1: {
              provider: 'deepseek',
              deepseekApiKey: 'ds-test-key-12345678901234567890',
              chatModel: 'deepseek-flash'
            }
          };
        }
      },
      onChanged: { addListener() {} }
    }
  };

  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    calls.push({ url: String(url), body });
    modeCalls += 1;
    if (responseMode === 'truncated') {
      if (modeCalls === 1) return envelope('{"reply":"обрезано"', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
      return envelope('{"reply":"исправлено"}', { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }, body.model);
    }
    if (modeCalls === 1) {
      return envelope('', { prompt_tokens: 50, completion_tokens: 1400, total_tokens: 1450 }, body.model, 'reasoning consumed the output budget');
    }
    return envelope('{"language":"ru","what_user_wants":"проверить баланс"}', { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 }, body.model);
  };

  try {
    await import(`../src/ai/provider-router.js?deepseek-json-repair=${Date.now()}`);

    const response = await globalThis.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer old-groq-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        temperature: 0.12,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: 'Верни JSON' }]
      })
    });

    const data = await response.json();
    assert.equal(calls.length, 2, 'one invalid JSON response must cause exactly one format-repair call');
    assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[0].body.model, 'deepseek-flash');
    assert.equal(calls[1].body.model, 'deepseek-flash');
    assert.equal(calls[1].body.temperature, 0);
    assert.equal(calls[1].body.response_format?.type, 'json_object');
    assert.match(calls[1].body.messages.at(-1)?.content || '', /валидным JSON/);
    assert.deepEqual(data.usage, { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 });
    assert.equal(JSON.parse(data.choices[0].message.content).reply, 'исправлено');
    assert.equal(data.simnet?.json_repaired, true);
    assert.equal(response.headers.get('x-simnet-json-repaired'), '1');

    const beforeGuard = calls.length;
    const guardResponse = await globalThis.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-prompt-guard-2-86m',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    const guard = await guardResponse.json();
    assert.equal(calls.length, beforeGuard, 'Prompt Guard must not be sent to DeepSeek');
    assert.equal(guardResponse.status, 200);
    assert.equal(guard.simnet?.prompt_guard_skipped, true);
    assert.equal(guardResponse.headers.get('x-simnet-prompt-guard-skipped'), '1');

    responseMode = 'empty';
    modeCalls = 0;
    const beforeEmpty = calls.length;
    const emptyResponse = await globalThis.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer old-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        max_tokens: 1400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: 'Верни JSON с полем language.' }]
      })
    });
    const emptyData = await emptyResponse.json();
    const emptyCalls = calls.slice(beforeEmpty);
    assert.equal(emptyCalls.length, 2, 'reasoning-only empty content must cause one JSON repair request');
    assert.equal(emptyCalls[0].body.model, 'deepseek-v4-pro');
    assert.deepEqual(emptyCalls[0].body.thinking, { type: 'disabled' });
    assert.deepEqual(emptyCalls[1].body.thinking, { type: 'disabled' });
    assert.equal(JSON.parse(emptyData.choices[0].message.content).language, 'ru');
    assert.equal(emptyData.simnet?.json_repaired, true);
    assert.deepEqual(emptyData.usage, { prompt_tokens: 110, completion_tokens: 1440, total_tokens: 1550 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
    delete globalThis.__SIMNET_AI_PROVIDER_ROUTER__;
  }
});
