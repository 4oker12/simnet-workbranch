import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(root, '../scripts/measure-lab-token-usage.mjs');

const sample = {
  id: 'lab_demo',
  events: [
    {
      type: 'experiment_result',
      customerMessageId: 'msg_0',
      totalTokens: 10000
    },
    {
      type: 'experiment_result',
      customerMessageId: 'msg_1',
      totalTokens: 12350
    }
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
        usage: { prompt_tokens: 8000, completion_tokens: 150, total_tokens: 8150 }
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-token-'));
const file = path.join(dir, 'sample.json');
fs.writeFileSync(file, JSON.stringify(sample));

const result = spawnSync(process.execPath, [script, file, '--json'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const parsed = JSON.parse(result.stdout);

assert.equal(parsed.session.turns, 2, 'historic experiment_result and detailed current turn must produce exactly two turns');
assert.equal(parsed.session.total, 22350, 'session total must not double-count lastExperiment/apiCost/current experiment_result');
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

console.log('ai_operator_measure_lab_token_usage_test: PASS');
