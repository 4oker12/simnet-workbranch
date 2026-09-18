import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  AUTONOMOUS_OPERATOR_INSTRUCTION,
  AUTONOMOUS_OPERATOR_INSTRUCTION_META,
  AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256,
  autonomousOperatorSystemMessages
} from '../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js';

const mdUrl = new URL('../src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md', import.meta.url);
const md = fs.readFileSync(mdUrl, 'utf8');
const expectedHash = crypto.createHash('sha256').update(md).digest('hex');

test('canonical autonomous instruction generated artifact exactly matches MD source', () => {
  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION, md, 'generated instruction must not drift from canonical MD');
  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256, expectedHash, 'instruction hash must identify exact canonical content');
  assert.deepEqual(AUTONOMOUS_OPERATOR_INSTRUCTION_META, {
    name: 'AUTONOMOUS_OPERATOR',
    version: 1,
    hash: expectedHash
  });
});

test('canonical instruction protects model reasoning without allowing invented live facts', () => {
  assert.match(md, /не заменяют её собственные знания, семантическое понимание и логическое рассуждение/i);
  assert.match(md, /общие знания.*технические знания.*арифметику.*сравнение.*причинно-следственные.*семантическую близость/is);
  assert.match(md, /RULES CONSTRAIN REASONING; RULES DO NOT REPLACE REASONING/i);
  assert.match(md, /TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS/i);
  assert.match(md, /LLM свободна в интерпретации подтверждённых фактов\. LLM не свободна в изобретении текущих фактов SIMNET/i);
  assert.match(md, /Отсутствие ожидаемого поля.*не является отрицательным доказательством/is);
  assert.match(md, /UNKNOWN != NO/i);
  assert.match(md, /ok=false.*NOT_FOUND.*DATA_NOT_AVAILABLE.*не превращаются автоматически в `NO`/is);
  assert.match(md, /Предыдущий ответ AI не является новым источником истины/i);
});

test('central instruction stays a protected system message separate from local stage work', () => {
  const messages = autonomousOperatorSystemMessages('ЭТАП: пойми смысл и верни JSON.');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(item => item.role), ['system', 'system']);
  assert.equal(messages[0].content, md);
  assert.equal(messages[1].content, 'ЭТАП: пойми смысл и верни JSON.');
});

test('autonomous instruction explicitly excludes operator-facing companion persona', () => {
  assert.match(md, /не определяет роль AI Operator Companion/i);
  assert.match(md, /непосредственно с абонентом/i);
  const companion = fs.readFileSync(new URL('../src/features/operator-companion/background.js', import.meta.url), 'utf8');
  assert.doesNotMatch(companion, /AUTONOMOUS_OPERATOR\.md|autonomous-operator-instruction\.generated/i);
});
