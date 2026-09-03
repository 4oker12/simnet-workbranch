import assert from 'node:assert/strict';
import fs from 'node:fs';

const loader = fs.readFileSync(new URL('../src/ui/call-registration-loader.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');

assert.match(loader, /if \(active\) \{/);
assert.match(loader, /module\?\.mountLiveMonitor\?\.\(\)/);
assert.match(loader, /module\?\.mountLiveCallRowHud\?\.\(\)/);
assert.match(loader, /if \(visible\) await module\?\.showLiveMonitor\?\.\(\)/);
assert.match(loader, /VISIBLE_SYNC_RETRY_DELAYS = Object\.freeze\(\[120, 420, 1100\]\)/);
assert.doesNotMatch(loader, /setInterval\(/);
assert.match(ui, /if \(document\.visibilityState !== 'hidden'\) this\.scheduleLiveRefresh\(\)/);
console.log('call_live_cross_tab_persistence_contract_test: PASS');
