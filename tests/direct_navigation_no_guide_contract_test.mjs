import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const scripts = manifest.content_scripts?.[0]?.js || [];
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/store-client.js', import.meta.url), 'utf8');
const handoff = fs.readFileSync(new URL('../src/core/handoff.js', import.meta.url), 'utf8');

assert.equal(scripts.includes('src/ui/guide-loader.js'), false);
assert.equal(scripts.includes('src/core/action-lifecycle.js'), false);
assert.doesNotMatch(rail, /WB\.guide|WB\.actionLifecycle/);
assert.match(rail, /openTechnicalDirect/);
assert.match(rail, /goToTmcDirect/);
assert.match(rail, /intent: 'DIRECT_NAVIGATION'/);
assert.match(handoff, /timeoutMs: 1200/);
assert.match(handoff, /CLAIM_RETRIES = 5/);
assert.doesNotMatch(store, /observability|ACTION_SESSION|GUIDE_/i);
console.log('direct_navigation_no_guide_contract_test: PASS');
