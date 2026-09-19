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
assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION, 5, 'runtime must use canonical reasoning instruction v5');
assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION, canonical, 'generated runtime instruction must exactly match canonical markdown');
assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256, canonicalHash, 'generated instruction hash must match canonical markdown');

assert.match(canonical, /СМЫСЛ → ЛОГИКА → EVIDENCE → ОТВЕТ/, 'reasoning order must stay meaning-first and evidence-before-answer');
assert.match(canonical, /Не начинай с выбора tool или статьи/, 'tool or article selection must not become the first reasoning step');
assert.match(canonical, /не превращай понимание в synonym\/intent matrix/, 'free-form language understanding must not regress into a synonym or intent matrix');
assert.match(canonical, /ABSENCE FROM SIMNET KB ≠ ABSENCE OF KNOWLEDGE/, 'missing KB coverage must not suppress common knowledge');
assert.match(canonical, /KNOWN FACTS → REASON FIRST/, 'known facts must be reasoned over before extra reads');
assert.match(canonical, /READ MORE ONLY WHEN NECESSARY/, 'extra READs must remain need-driven');
assert.match(canonical, /TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS/, 'tools must remain evidence providers rather than reasoning authorities');
assert.match(canonical, /UNKNOWN ≠ NO/, 'unknown evidence state must not be treated as a negative fact');
assert.match(canonical, /CONVERSATIONAL FALLBACK IS A TERMINAL MOVE, NOT A NEW REASONING LOOP/, 'fallback must terminate dead-end reasoning loops');
assert.match(canonical, /не запускай новый цикл KB\/READ/, 'fallback must not restart redundant KB or READ work');
assert.match(canonical, /не утверждай «я уже передал»/, 'fallback must not pretend an escalation action already happened');
assert.match(canonical, /DATA_NOT_AVAILABLE/, 'failed or unavailable READs must remain an explicit unknown-evidence condition');
assert.match(canonical, /не создают закрытый список вопросов, intents, формулировок или сценариев/, 'examples must not become a closed intent catalogue');
assert.match(canonical, /Старый subscriber context допустим как fallback только если новый target явно не указан/, 'stale subscriber context must not override an explicit new target');

const meaningIndex = canonical.indexOf('Восстанови человеческий смысл');
const readIndex = canonical.indexOf('запроси минимальный READ');
const answerIndex = canonical.indexOf('Сформулируй прямой, естественный ответ');
assert.ok(meaningIndex >= 0 && readIndex > meaningIndex && answerIndex > readIndex, 'canonical workflow must preserve meaning → evidence → answer ordering');

console.log('ai_autonomous_operator_instruction_v5_test: PASS');
