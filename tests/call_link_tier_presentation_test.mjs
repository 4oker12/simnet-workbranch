import assert from 'node:assert/strict';
import fs from 'node:fs';
import { callLinkTier } from '../src/features/call/index.js';

const direct = callLinkTier({
  customerId: '59369',
  customerCandidates: [{ customerId: '59369' }]
}, {
  identity: { customerId: '59369' },
  authoritative: true,
  confidence: 100
});
assert.equal(direct.kind, 'direct');
assert.equal(direct.label, '100%', 'only a unique direct call_list CUSTOMER may be presented as 100%');

const strong = callLinkTier({}, {
  identity: { customerId: '59369' },
  authoritative: false,
  confidence: 97
});
assert.equal(strong.kind, 'strong');
assert.equal(strong.label, 'Сильные признаки');
assert.doesNotMatch(strong.label, /%/, 'indirect Workbench scoring is a tier, not a probability');

const ambiguous = callLinkTier({
  customerCandidates: [{ customerId: '58427' }, { customerId: '56287' }]
}, {
  identity: { customerId: '58427' },
  authoritative: false,
  confidence: 92
});
assert.equal(ambiguous.kind, 'ambiguous', 'multiple call_list customers outrank a high heuristic score');

const conflict = callLinkTier({ customerId: '59369' }, {
  identity: { customerId: '99999' },
  authoritative: false,
  hardConflict: true,
  confidence: 0
});
assert.equal(conflict.kind, 'conflict');

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const identityUx = fs.readFileSync(new URL('../src/ui/call-registration-identity-ux.js', import.meta.url), 'utf8');
const activeGuard = fs.readFileSync(new URL('../src/ui/call-active-focus-guard.js', import.meta.url), 'utf8');
assert.match(ui, /Остальное — уровень косвенных признаков, не вероятность/);
assert.doesNotMatch(ui, /Number\(row\.topConfidence[^\n]*%/, 'history rows must not print heuristic percentages');
assert.doesNotMatch(identityUx, /WB\$\{confidence[^\n]*%/, 'identity enhancer must not restore heuristic percentages');
assert.match(identityUx, /100% · call_list/);
assert.match(activeGuard, /confidence:\s*ambiguous\s*\?\s*79\s*:\s*100/);
assert.match(activeGuard, /authoritative:\s*!ambiguous/);
assert.match(activeGuard, /kind:\s*'ambiguous'/);

console.log('call_link_tier_presentation_test: ok');
