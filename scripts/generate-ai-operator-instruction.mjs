import fs from 'node:fs';
import crypto from 'node:crypto';

const sourceUrl = new URL('../src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md', import.meta.url);
const targetUrl = new URL('../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const versionMatch = source.match(/\*\*Version:\*\*\s*`(\d+)`/);
if (!versionMatch) throw new Error('AUTONOMOUS_OPERATOR.md must contain **Version:** `N`');
const version = Number(versionMatch[1]);
const hash = crypto.createHash('sha256').update(source).digest('hex');
const content = `// AUTO-GENERATED from AUTONOMOUS_OPERATOR.md. Do not edit by hand.
export const AUTONOMOUS_OPERATOR_INSTRUCTION_NAME = 'AUTONOMOUS_OPERATOR';
export const AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION = ${version};
export const AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256 = '${hash}';
export const AUTONOMOUS_OPERATOR_INSTRUCTION = ${JSON.stringify(source)};

export const AUTONOMOUS_OPERATOR_INSTRUCTION_META = Object.freeze({
  name: AUTONOMOUS_OPERATOR_INSTRUCTION_NAME,
  version: AUTONOMOUS_OPERATOR_INSTRUCTION_VERSION,
  hash: AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256
});

export function autonomousOperatorSystemMessages(localStageInstruction = '') {
  const messages = [{ role: 'system', content: AUTONOMOUS_OPERATOR_INSTRUCTION }];
  const local = String(localStageInstruction || '').trim();
  if (local) messages.push({ role: 'system', content: local });
  return messages;
}
`;
fs.writeFileSync(targetUrl, content);
console.log(`Generated ${targetUrl.pathname} (${hash.slice(0, 12)})`);
