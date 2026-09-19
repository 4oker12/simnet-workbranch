import test from 'node:test';
import assert from 'node:assert/strict';

function envelope(content, usage = {}, model = 'deepseek-flash') {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: 'stop', message: { content } }],
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
    calls.push({ url: String(url), body: JSON.parse(String(init.body || '{}')) });
    if (calls.length === 1) {
      return envelope('{"reply":"обрезано"', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    }
    return envelope('{"reply":"исправлено"}', { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 });
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
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
    delete globalThis.__SIMNET_AI_PROVIDER_ROUTER__;
  }
});
