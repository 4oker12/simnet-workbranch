import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const moduleSource = fs.readFileSync(new URL('../src/features/call/index.js', import.meta.url), 'utf8');

assert.equal(manifest.host_permissions.some(pattern => pattern.includes('pbx.simnet.kiev.ua')), false);
assert.equal(manifest.content_scripts.some(script => script.matches.some(pattern => pattern.includes('pbx.simnet.kiev.ua'))), false);
assert.match(background, /createCallMessageRouter/);
assert.match(background, /callModule\.recordSearch/);
assert.match(background, /callModule\.recordVisit/);
assert.match(background, /callModule\.ingestUsersideCalls/);
assert.match(moduleSource, /enable\(\)/);
assert.match(moduleSource, /disable\(\)/);
assert.match(moduleSource, /open\(\)/);
assert.match(moduleSource, /destroy\(\)/);
assert.match(moduleSource, /recordPbxRealtimeHints/);
assert.match(moduleSource, /Deliberately omit record\/call\/customer\/phone fields/);
assert.match(bootstrap, /callEvidenceAbort\?\.abort/);
assert.match(bootstrap, /syncCallEvidenceLifecycle/);
assert.match(bootstrap, /WB\.callRegistration\?\.disable/);
assert.match(ui, /export-call-audit/);
assert.match(ui, /CALL_GLOBAL_AUDIT_GET/);
assert.match(ui, /focusSnapshot/);
assert.doesNotMatch(ui, /relative-to-best/);

console.log('call_module_architecture_contract_test: PASS');
