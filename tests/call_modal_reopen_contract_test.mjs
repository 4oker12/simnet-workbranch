import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');

assert.match(ui, /isOpen\(\) \{\s*return Boolean\(this\.host\?\.isConnected && this\.shadow\);/s);
const closeStart = ui.indexOf('close() {');
const closeEnd = ui.indexOf('\n    isOpen()', closeStart);
assert.ok(closeStart >= 0 && closeEnd > closeStart);
const close = ui.slice(closeStart, closeEnd);
assert.match(close, /this\.host\?\.remove\(\)/);
assert.match(close, /this\.host = null/);
assert.match(close, /this\.shadow = null/);
assert.match(close, /simnet-workbench-module-close/);

const clickStart = rail.indexOf("if (action === 'call-registration')");
const clickEnd = rail.indexOf("if (action === 'toggle-attention')", clickStart);
assert.ok(clickStart >= 0 && clickEnd > clickStart);
const click = rail.slice(clickStart, clickEnd);
assert.match(click, /const openCall = \(\) => Promise\.resolve\(WB\.callRegistration\.open\(currentCase\)\)/);
assert.match(click, /!document\.getElementById\('simnet-workbench-call-registration-host'\)/);
assert.match(click, /result = await openCall\(\)/);

console.log('call_modal_reopen_contract_test: PASS');
