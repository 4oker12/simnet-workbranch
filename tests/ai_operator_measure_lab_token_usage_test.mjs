import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(root, '../scripts/measure-lab-token-usage.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-token-'));

function writeSample(name, data) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function runJson(file) {
  const result = spawnSync(process.execPath, [script, file, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

// Mirrors the real Lab event contract: experiment_result has totalTokens and
// experimentId but normally no customerMessageId. The active customer turn must
// be inferred from the ordered event stream.
const realShape = {
  id: 'lab_demo',
  events: [
    { type: 'customer_message', id: 'evt_c0', messageId: 'msg_0', text: 'что по балансу?' },
    { type: 'semantic_analysis', id: 'evt_s0', customerMessageId: 'msg_0' },
    { type: 'experiment_result', id: 'evt_r0', experimentId: 'exp0', totalTokens: 10000 },
    { type: 'customer_message', id: 'evt_c1', messageId: 'msg_1', text: 'почему 0.99?' },
    { type: 'semantic_analysis', id: 'evt_s1', customerMessageId: 'msg_1' },
    { type: 'experiment_result', id: 'evt_r1', experimentId: 'exp1', totalTokens: 12350 }
  ],
  lastExperiment: {
    id: 'exp1',
    customerMessageId: 'msg_1',
    model: 'openai/gpt-oss-120b',
    analysis: {
      model: 'openai/gpt-oss-120b',
      usage: { prompt_tokens: 4000, completion_tokens: 200, total_tokens: 4200 }
    },
    variants: [
      {
        label: 'with_knowledge',
        model: 'openai/gpt-oss-120b',
        tokens: 8150
      }
    ]
  },
  apiCost: {
    turnCalls: [
      { sequence: 1, stage: 'understanding', model: 'openai/gpt-oss-120b', input: 4000, output: 200, total: 4200 },
      { sequence: 2, stage: 'reply_with_knowledge', model: 'openai/gpt-oss-120b', input: 8000, output: 150, total: 8150 }
    ]
  }
};

const file = writeSample('real-shape.json', realShape);
const parsed = runJson(file);

assert.equal(parsed.session.turns, 2, 'two customer turns must remain two token turns');
assert.equal(parsed.session.total, 22350, 'current experiment_result must not be added on top of detailed apiCost calls');
assert.equal(parsed.session.calls, 3, 'one historic aggregate + two current detailed calls expected');
assert.equal(parsed.turns.msg_0.length, 1);
assert.equal(parsed.turns.msg_0[0].stage, 'turn_total');
assert.equal(parsed.turns.msg_0[0].total, 10000);
assert.equal(parsed.turns.msg_1.length, 2);
assert.deepEqual(parsed.turns.msg_1.map(call => call.stage), ['understanding', 'reply']);
assert.equal(parsed.turns.msg_1.reduce((sum, call) => sum + call.total, 0), 12350);
assert.ok(parsed.notes.some(note => /Payload-block breakdown/i.test(note)));

const human = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
assert.equal(human.status, 0, human.stderr || human.stdout);
assert.match(human.stdout, /TURN msg_0/);
assert.match(human.stdout, /TURN msg_1/);
assert.match(human.stdout, /understanding/i);
assert.match(human.stdout, /reply/i);
assert.match(human.stdout, /total session tokens: 22350/i);

// If apiCost is absent, lastExperiment must still provide current-turn details.
// Its variant may contain only `tokens`, which is another shape present in Lab exports.
const withoutApiCost = structuredClone(realShape);
delete withoutApiCost.apiCost;
const fallbackFile = writeSample('without-api-cost.json', withoutApiCost);
const fallback = runJson(fallbackFile);
assert.equal(fallback.session.turns, 2);
assert.equal(fallback.session.total, 22350);
assert.equal(fallback.turns.msg_1.length, 2);
assert.deepEqual(fallback.turns.msg_1.map(call => call.stage), ['understanding', 'reply']);
assert.equal(fallback.turns.msg_1[1].total, 8150, 'variant.tokens must be recognized as total token usage');

// Distinct repeated calls with identical usage must not be collapsed when sequence differs.
const repeated = {
  turnCalls: [
    { turnId: 'msg_x', sequence: 1, stage: 'reply', model: 'm', input: 100, output: 10, total: 110 },
    { turnId: 'msg_x', sequence: 2, stage: 'reply', model: 'm', input: 100, output: 10, total: 110 }
  ]
};
const repeatedFile = writeSample('repeated.json', repeated);
const repeatedParsed = runJson(repeatedFile);
assert.equal(repeatedParsed.session.calls, 2);
assert.equal(repeatedParsed.session.total, 220);

console.log('ai_operator_measure_lab_token_usage_test: PASS');
