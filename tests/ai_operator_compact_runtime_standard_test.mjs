import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUTONOMOUS_OPERATOR_CANONICAL_MARKER,
  AUTONOMOUS_OPERATOR_COMPACT,
  AUTONOMOUS_OPERATOR_COMPACT_META
} from '../src/features/ai-operator/instructions/autonomous-operator-compact.js';
import { AUTONOMOUS_OPERATOR_INSTRUCTION } from '../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js';

assert.equal(AUTONOMOUS_OPERATOR_COMPACT_META.version, 4);
assert.ok(AUTONOMOUS_OPERATOR_INSTRUCTION.startsWith(AUTONOMOUS_OPERATOR_CANONICAL_MARKER));

const anchors = [
  'СМЫСЛ → ЛОГИКА → EVIDENCE → ОТВЕТ',
  'Не начинай с выбора tool или статьи',
  'RULES CONSTRAIN REASONING',
  'TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS',
  'ABSENCE FROM SIMNET KB ≠ ABSENCE OF KNOWLEDGE',
  'KNOWN FACTS → REASON FIRST',
  'READ MORE ONLY WHEN NECESSARY',
  'UNKNOWN ≠ NO',
  'DATA_NOT_AVAILABLE',
  'причину обращения'
];
for (const a of anchors) {
  assert.match(AUTONOMOUS_OPERATOR_COMPACT, new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `compact must keep anchor: ${a}`);
}

// Governor must import the shared compact module (single runtime source).
const governor = fs.readFileSync(new URL('../src/features/ai-operator/groq-token-governor.js', import.meta.url), 'utf8');
assert.match(governor, /autonomous-operator-compact\.js/);
assert.doesNotMatch(governor, /const COMPACT_CANONICAL = `/);

assert.ok(AUTONOMOUS_OPERATOR_COMPACT.length < AUTONOMOUS_OPERATOR_INSTRUCTION.length * 0.35, 'compact must stay much smaller than full instruction');

console.log('ai_operator_compact_runtime_standard_test: PASS');
