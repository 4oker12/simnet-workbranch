import assert from 'node:assert/strict';
import fs from 'node:fs';

const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');

assert.match(rail, /renderImmediate\(\)\s*\{/,
  'rail provides an immediate render path for explicit operator interactions');
assert.match(rail, /cancelAnimationFrame\?\.\(this\._renderRaf\)/,
  'immediate render cancels a stale pending RAF');
assert.match(rail, /this\._renderRaf = 0;[\s\S]*this\._renderDirty = false;[\s\S]*this\.renderNow\(\)/,
  'immediate render clears deferred render state before reconciliation');
assert.match(rail, /visibilitychange[\s\S]*boundVisibilityRefresh/,
  'rail self-heals when returning to a visible tab');
assert.match(rail, /pageshow[\s\S]*boundVisibilityRefresh/,
  'rail self-heals across BFCache/pageshow restores');
assert.match(rail, /window\.addEventListener\?\.\('focus', this\.boundVisibilityRefresh\)/,
  'rail self-heals when browser focus returns');
assert.match(rail, /action === 'view-live'[\s\S]{0,700}renderImmediate\(\)/,
  'LIVE rail click is not queued behind a stale RAF');
assert.match(rail, /action === 'call-registration'[\s\S]{0,700}renderImmediate\(\)/,
  'CALL rail click is not queued behind a stale RAF');
assert.match(rail, /action === 'view-companion'[\s\S]{0,300}renderImmediate\(\)/,
  'AI rail click is not queued behind a stale RAF');

console.log('rail_interaction_self_heal_contract_test: PASS');
