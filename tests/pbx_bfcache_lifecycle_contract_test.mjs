import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/pbx/pbx-observer.js'), 'utf8');

assert.match(source, /function startObserver\(\)/);
assert.match(source, /function stopObserver\(\)/);
assert.match(source, /observer\.disconnect\(\)/);
assert.match(source, /addEventListener\('pagehide', stopObserver\)/);
assert.match(source, /addEventListener\('pageshow', \(\) => \{[\s\S]*startObserver\(\);[\s\S]*schedulePublish\(\)/);

console.log('pbx_bfcache_lifecycle_contract_test: PASS');
