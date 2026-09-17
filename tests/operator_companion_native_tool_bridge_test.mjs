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

const sandbox = {
  fetch: nativeFetch,
  Response,
  JSON,
  Object,
  Array,
  String,
  RegExp,
  console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(bridgeSource, sandbox);

const companionPayload = {
  model: 'qwen/qwen3.6-27b',
  messages: [
    { role: 'system', content: 'Ты — AI-напарник оператора интернет-провайдера SIMNET внутри Workbench.' },
    { role: 'user', content: 'глянь баланс 241402' }
  ],
  reasoning_effort: 'low'
};

const response = await sandbox.fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(companionPayload)
});
const rewritten = JSON.parse(await response.text());

assert.equal(calls.length, 1);
assert.equal(calls[0].tool_choice, 'auto', 'first Companion pass must allow native tool selection');
assert.ok(Array.isArray(calls[0].tools) && calls[0].tools.length >= 10, 'Companion must send its READ tool definitions to Groq');
assert.equal(calls[0].tools.find(row => row.function?.name === 'billing_balance')?.type, 'function');
assert.match(rewritten.choices[0].message.content, /<wb_tool_request>/);
assert.match(rewritten.choices[0].message.content, /billing\.balance/,
  'native Groq function name must map back to the canonical Workbench READ tool');
assert.equal(rewritten.choices[0].message.tool_calls, undefined,
  'legacy Companion orchestrator must receive the normalized bounded request instead of raw tool_calls');

assert.doesNotMatch(bridgeSource, /firstPassPayload[\s\S]{0,1500}tool_choice:\s*'none'/,
  'the tool-selection pass must never disable tool calls');

console.log('operator_companion_native_tool_bridge_test: PASS');
