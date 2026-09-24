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


test('DeepSeek structured JSON disables thinking and recovers from reasoning-only empty content', async () => {
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
              chatModel: 'deepseek-v4-pro'
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
    if (calls.length === 1) {
      return envelope('', { prompt_tokens: 50, completion_tokens: 1400, total_tokens: 1450 }, 'deepseek-v4-pro', 'reasoning consumed the output budget');
    }
    return envelope('{"language":"ru","what_user_wants":"проверить баланс"}', { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 }, body.model);
  };

  try {
    await import(`../src/ai/provider-router.js?deepseek-empty-content=${Date.now()}`);

    const response = await globalThis.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer old-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        max_tokens: 1400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: 'Верни JSON с полем language.' }]
      })
    });

    const data = await response.json();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.model, 'deepseek-v4-pro', 'valid explicit DeepSeek model must not be rewritten back to config blindly');
    assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
    assert.deepEqual(calls[1].body.thinking, { type: 'disabled' });
    assert.equal(JSON.parse(data.choices[0].message.content).language, 'ru');
    assert.equal(data.simnet?.json_repaired, true);
    assert.deepEqual(data.usage, { prompt_tokens: 110, completion_tokens: 1440, total_tokens: 1550 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
    delete globalThis.__SIMNET_AI_PROVIDER_ROUTER__;
  }
});
