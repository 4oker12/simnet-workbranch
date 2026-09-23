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
    version: 9,
    hash: expectedHash
  });
});

test('canonical instruction keeps general reasoning and evidence boundaries', () => {
  assert.match(md, /СМЫСЛ → ЛОГИКА → EVIDENCE → ОТВЕТ → ПОДАЧА/i);
  assert.match(md, /RULES CONSTRAIN REASONING; RULES DO NOT REPLACE REASONING/i);
  assert.match(md, /TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS/i);
  assert.match(md, /ABSENCE FROM SIMNET KB ≠ ABSENCE OF KNOWLEDGE/i);
  assert.match(md, /UNKNOWN ≠ NO\. NOT OBSERVED ≠ ABSENT/i);
  assert.match(md, /Display text ≠ semantic authority/i);
  assert.match(md, /текущий.*исторический.*производный.*заявленный/is);
  assert.match(md, /не останавливайся на нём как на готовом ответе/i);
});

test('canonical instruction defines concise contextual subscriber communication', () => {
  assert.match(md, /follow-up продолжает текущую мысль/i);
  assert.match(md, /Не превращай ответ в сводку карточки\/состояния/i);
  assert.match(md, /Простой факт\/да-нет — одно предложение/i);
  assert.match(md, /Без markdown, списков и заголовков/i);
  assert.match(md, /Без «сверхвежливости» и дежурных фраз службы поддержки/i);
  assert.match(md, /Шаблонность выдаёт AI-оператора быстрее всего/i);
  assert.match(md, /Разнообразие никогда не важнее ясности/i);
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
