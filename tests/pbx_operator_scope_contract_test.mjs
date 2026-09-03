import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const moduleSource = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../src/features/call/config.js', import.meta.url), 'utf8');

assert.equal(manifest.host_permissions.some(pattern => pattern.includes('pbx.simnet.kiev.ua')), false);
assert.equal(manifest.content_scripts.some(script => script.matches.some(pattern => pattern.includes('pbx.simnet.kiev.ua'))), false);
assert.match(config, /pbxRealtimeEnabled:\s*false/);
assert.match(background, /callModule\.recordPbxRealtimeHints\(state, payload\.calls, fallbackObservedAt\)/);
assert.match(moduleSource, /PBX_CALL_STARTED_HINT/);
assert.match(moduleSource, /PBX_CALL_ENDED_HINT/);
assert.match(moduleSource, /omit record\/call\/customer\/phone fields/);
console.log('pbx_operator_scope_contract_test: PASS');
