import assert from 'node:assert/strict';
import fs from 'node:fs';

const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../src/core/interaction-guards.js', import.meta.url), 'utf8');
const debug = fs.readFileSync(new URL('../src/core/click-debug.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.doesNotMatch(rail, /liveNavInFlight|navigation-busy|evidenceReplayInFlight|replay-busy/,
  'LIVE/history navigation must not drop the operator second click');
assert.match(rail, /Navigation actions are intentionally not serialized/,
  'navigation code documents the no-click-lock contract');
assert.doesNotMatch(guard, /preventDefault\(\)|stopImmediatePropagation\(\)/,
  'OLT conflict warning must not cancel the click');
assert.match(guard, /warning-only:/,
  'conflict reason is still exposed to diagnostics/debug');
assert.match(debug, /document\.addEventListener\('click', start, lifecycle \? \{ capture: true, signal: lifecycle\.signal \} : true\)/,
  'click debugger observes capture phase without changing native clicks');
assert.match(debug, /defaultPrevented/,
  'debugger reports whether some handler prevented a click');
assert.match(debug, /WB\.clickDebug = Object\.freeze/,
  'debug buffer has one session-local API');
assert.match(rail, /Click debug · только текущая вкладка/,
  'Journal exposes the session click debugger');
const content = manifest.content_scripts.find(item => item.js?.includes('src/core/click-debug.js'));
assert.ok(content, 'click debugger is loaded in normal Workbench pages');
assert.ok(content.js.indexOf('src/core/click-debug.js') < content.js.indexOf('src/core/interaction-guards.js'),
  'debugger is installed before guard handlers so prevented clicks remain observable');

console.log('click_navigation_unlocked_debug_contract_test: PASS');
