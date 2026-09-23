import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
  AUTONOMOUS_OPERATOR_INSTRUCTION,
  AUTONOMOUS_OPERATOR_INSTRUCTION_NAME,
  AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256,
  AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION
} from '../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js';

const canonicalPath = new URL('../src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md', import.meta.url);
const canonical = fs.readFileSync(canonicalPath, 'utf8');
const canonicalHash = crypto.createHash('sha256').update(canonical).digest('hex');

assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_NAME, 'AUTONOMOUS_OPERATOR');
assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION, 9, 'runtime must use canonical reasoning instruction v9');
assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION, canonical, 'generated runtime instruction must exactly match canonical markdown');
assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256, canonicalHash, 'generated instruction hash must match canonical markdown');

assert.match(canonical, /СМЫСЛ → ЛОГИКА → EVIDENCE → ОТВЕТ → ПОДАЧА/, 'workflow must stay meaning-first and evidence-before-answer');
assert.match(canonical, /Не начинай с выбора tool или статьи/, 'tool selection must not become the first reasoning step');
assert.match(canonical, /ABSENCE FROM SIMNET KB ≠ ABSENCE OF KNOWLEDGE/, 'missing KB coverage must not suppress common knowledge');
assert.match(canonical, /KNOWN FACTS → REASON FIRST\. READ MORE ONLY WHEN NECESSARY/, 'extra reads must remain need-driven');
assert.match(canonical, /TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS/, 'tools must remain evidence providers rather than conclusion authorities');
assert.match(canonical, /UNKNOWN ≠ NO\. NOT OBSERVED ≠ ABSENT/, 'unobserved evidence must not become a negative fact');
assert.match(canonical, /Display text ≠ semantic authority/, 'display labels must not become business meaning by inference');
assert.match(canonical, /текущий.*исторический.*производный.*заявленный/is, 'fact provenance must distinguish temporal and evidential roles');
assert.match(canonical, /follow-up продолжает текущую мысль/i, 'follow-up must preserve dialogue context');
assert.match(canonical, /Не превращай ответ в сводку карточки\/состояния/i, 'answers must stay scoped to the subscriber question');
assert.match(canonical, /Без markdown, списков и заголовков/i, 'subscriber replies must remain live-chat prose');
assert.match(canonical, /Шаблонность выдаёт AI-оператора быстрее всего/i, 'instruction must actively suppress repetitive phrasing');
assert.match(canonical, /Разнообразие никогда не важнее ясности/i, 'anti-repeat behavior must not sacrifice clarity');

const meaningIndex = canonical.indexOf('Восстанови смысл последней реплики');
const readIndex = canonical.indexOf('Запроси минимальный READ');
const answerIndex = canonical.indexOf('Сформулируй прямой, человеческий ответ');
const deliveryIndex = canonical.indexOf('Перед отправкой сверь подачу');
assert.ok(
  meaningIndex >= 0 && readIndex > meaningIndex && answerIndex > readIndex && deliveryIndex > answerIndex,
  'canonical workflow must preserve meaning → evidence → answer → delivery ordering'
);

console.log('ai_autonomous_operator_instruction_v9_test: PASS');
