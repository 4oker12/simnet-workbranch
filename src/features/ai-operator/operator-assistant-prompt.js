// Compatibility bridge. Canonical reasoning lives only in instructions/AUTONOMOUS_OPERATOR.md.
// Do not add reasoning rules here; update the MD and regenerate the runtime artifact.
export {
  AUTONOMOUS_OPERATOR_INSTRUCTION as OPERATOR_ASSISTANT_REASONING_CORE,
  AUTONOMOUS_OPERATOR_INSTRUCTION_META as OPERATOR_ASSISTANT_REASONING_META
} from './instructions/autonomous-operator-instruction.generated.js';
