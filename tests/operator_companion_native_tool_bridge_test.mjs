import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bridgeSource = fs.readFileSync(new URL('../src/features/operator-companion/groq-native-tool-bridge.js', import.meta.url), 'utf8');
const layoutSource = fs.readFileSync(new URL('../src/ui/operator-companion-layout.js', import.meta.url), 'utf8');
const backgroundEntry = fs.readFileSync(new URL('../src/background-entry.js', import.meta.url), 'utf8');
const featureLoader = fs.readFileSync(new URL('../src/infrastructure/feature-loader.js', import.meta.url), 'utf8');

assert.doesNotThrow(() => new Function(bridgeSource), 'Groq native bridge must remain valid service-worker JavaScript');
assert.doesNotThrow(() => new Function(layoutSource), 'Companion layout override must remain valid browser JavaScript');
assert.match(backgroundEntry, /groq-native-tool-bridge\.js'[\s\S]*operator-companion\/background\.js'/,
  'native bridge must load before Companion background');
assert.match(featureLoader, /operator-companion-conversation\.js'[\s\S]*operator-companion-layout\.js'/,
  'layout override must load after Companion conversation mounts');
assert.match(layoutSource, /width:min\(420px/);
assert.match(layoutSource, /height:min\(560px/);

const calls = [];
const nativeFetch = async (_input, init = {}) => {
  const body = JSON.parse(String(init.body || '{}'));
  calls.push(body);

  const finalPass = body.messages?.some(item => String(item?.content || '').includes('TOOL EVIDENCE'));
  if (finalPass) {
    if (Object.prototype.hasOwnProperty.call(body, 'tool_choice')) {
      return new Response(JSON.stringify({ error: { message: 'Tool choice is none, but model called a tool' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Баланс 125 грн.' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'billing_balance', arguments: '{}' }
        }]
      }
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const sandbox = { fetch: nativeFetch, Response, JSON, Object, Array, String, RegExp, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(bridgeSource, sandbox);

async function send(payload) {
  const response = await sandbox.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: response.status, json: JSON.parse(await response.text()) };
}

const first = await send({
  model: 'qwen/qwen3.6-27b',
  messages: [
    { role: 'system', content: 'Ты — AI-напарник оператора интернет-провайдера SIMNET внутри Workbench.' },
    { role: 'user', content: 'глянь баланс 241402' }
  ],
  reasoning_effort: 'low'
});

assert.equal(first.status, 200);
assert.equal(calls[0].tool_choice, 'auto', 'first Companion pass must allow native tool selection');
assert.equal(calls[0].reasoning_effort, 'none', 'qwen3.6 must receive its supported disabled-reasoning value');
assert.ok(Array.isArray(calls[0].tools) && calls[0].tools.length >= 10, 'Companion must send its READ tool definitions to Groq');
assert.equal(calls[0].tools.find(row => row.function?.name === 'billing_balance')?.type, 'function');
assert.match(first.json.choices[0].message.content, /<wb_tool_request>/);
assert.match(first.json.choices[0].message.content, /billing\.balance/);
assert.equal(first.json.choices[0].message.tool_calls, undefined);

await send({
  model: 'openai/gpt-oss-120b',
  messages: [
    { role: 'system', content: 'Ты — AI-напарник оператора интернет-провайдера SIMNET внутри Workbench.' },
    { role: 'user', content: 'глянь баланс 241402' }
  ],
  reasoning_effort: 'none'
});
assert.equal(calls[1].reasoning_effort, 'low', 'gpt-oss must receive one of low/medium/high');

const final = await send({
  model: 'qwen/qwen3.6-27b',
  messages: [
    { role: 'system', content: 'Ты — AI-напарник оператора интернет-провайдера SIMNET внутри Workbench.' },
    { role: 'system', content: 'TOOL EVIDENCE: billing.balance = 125 грн' },
    { role: 'system', content: 'Инструменты уже выполнены. Дай финальный видимый ответ по evidence. Не возвращай wb_tool_request повторно.' },
    { role: 'user', content: 'какой баланс?' }
  ],
  tools: [{ type: 'function', function: { name: 'legacy_tool', parameters: { type: 'object' } } }],
  tool_choice: 'none',
  parallel_tool_calls: false,
  disable_tool_validation: false,
  reasoning_effort: 'low'
});

assert.equal(final.status, 200, 'final synthesis must not hit Groq tool-choice 400');
assert.equal(final.json.choices[0].message.content, 'Баланс 125 грн.');
assert.equal(Object.prototype.hasOwnProperty.call(calls[2], 'tool_choice'), false,
  'final synthesis must omit tool_choice completely');
assert.equal(Object.prototype.hasOwnProperty.call(calls[2], 'tools'), false,
  'final synthesis must omit tools completely');
assert.equal(Object.prototype.hasOwnProperty.call(calls[2], 'parallel_tool_calls'), false);
assert.equal(Object.prototype.hasOwnProperty.call(calls[2], 'disable_tool_validation'), false);

assert.doesNotMatch(bridgeSource, /finalPassPayload[\s\S]{0,2200}tool_choice:\s*'none'/,
  'final pass must never force tool_choice none');

console.log('operator_companion_native_tool_bridge_test: PASS');
