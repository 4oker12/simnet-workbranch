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
      { sequence: 2, stage: 'reply', model: 'openai/gpt-oss-120b', input: 8000, output: 150, total: 8150 }
    ]
  }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-token-'));
const file = path.join(dir, 'sample.json');
fs.writeFileSync(file, JSON.stringify(sample));

const result = spawnSync(process.execPath, [script, file, '--json'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const parsed = JSON.parse(result.stdout);
assert.ok(parsed.session.total > 0);
assert.ok(parsed.calls.length >= 2);
assert.ok(parsed.notes.some(note => /Payload-block breakdown/i.test(note)));

const human = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
assert.equal(human.status, 0, human.stderr || human.stdout);
assert.match(human.stdout, /TURN/);
assert.match(human.stdout, /understanding|reply/i);
assert.match(human.stdout, /total session tokens/i);

console.log('ai_operator_measure_lab_token_usage_test: PASS');
