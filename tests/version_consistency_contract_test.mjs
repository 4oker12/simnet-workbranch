import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const namespace = fs.readFileSync(new URL('../src/content/namespace.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const version = manifest.version;

assert.ok(version);
assert.match(namespace, /chrome\.runtime\.getManifest\(\)\.version/);
assert.match(namespace, /existing\?\.version === RUNTIME_VERSION/);
assert.match(background, new RegExp(`const VERSION = ['\"]${version.replaceAll('.', '\\.')}`));
console.log('version_consistency_contract_test: PASS', version);
