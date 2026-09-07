import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [manifestText, toggleSource, processingSource] = await Promise.all([
  readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui/call-record-toggle.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/call/transcription/call-processing.js', import.meta.url), 'utf8')
]);

const manifest = JSON.parse(manifestText);
const mainScripts = manifest.content_scripts?.find(item =>
  Array.isArray(item.matches) && item.matches.includes('https://userside.simnet.kiev.ua/*')
)?.js || [];

assert.ok(mainScripts.includes('src/ui/call-record-toggle.js'), 'Record toggle must be loaded on UserSide');
assert.match(toggleSource, /simnet_workbench_call_record_preferences_v1/);
assert.match(toggleSource, /Record/);
assert.match(toggleSource, /enabled:\s*enabled !== false/);
assert.match(toggleSource, /usersideCallId:/);
assert.match(toggleSource, /customerId:/);
assert.match(toggleSource, /pbxRecordId:/);

assert.match(processingSource, /RECORD_PREF_KEY\s*=\s*'simnet_workbench_call_record_preferences_v1'/);
assert.match(processingSource, /record\.processing\.recordEnabled\s*=\s*recordEnabled/);
assert.match(processingSource, /binding\.customerId\s*\|\|\s*binding\.identity\?\.customerId\s*\|\|\s*caseCustomerId/);
assert.match(processingSource, /processing\.linkage\s*=\s*\{/);
assert.match(processingSource, /if \(!recordEnabled/);
assert.match(processingSource, /raw\.processing\?\.recordEnabled === false/);

console.log('call_record_policy_contract_test: PASS');
