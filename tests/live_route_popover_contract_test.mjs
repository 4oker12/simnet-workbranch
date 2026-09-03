import fs from 'node:fs';
import assert from 'node:assert/strict';

const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/ui/rail-styles.js', import.meta.url), 'utf8');

assert.match(rail, /class="live-help-popover" hidden role="tooltip"/);
assert.match(rail, /showLiveNavHelp\(node\)/);
assert.match(rail, /hideLiveNavHelp\(\)/);
assert.match(rail, /live-help-key/);
assert.match(styles, /\.live-help-popover\{/);
assert.match(styles, /\.live-help-key\{color:#B42318/);
assert.doesNotMatch(styles, /\.live-nav-help:after\{/);

console.log('PASS live_route_popover_contract_test');
