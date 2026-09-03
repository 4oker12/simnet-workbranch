import assert from 'node:assert/strict';
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.content_security_policy?.extension_pages, "script-src 'self'; object-src 'self'");
const serialized = JSON.stringify(manifest);
assert.doesNotMatch(serialized, /appeals-navigator|appeals-loader|operator-graph|graph-loader/);
const exposed = (manifest.web_accessible_resources || []).flatMap(block => block.resources || []).sort();
assert.deepEqual(exposed, [
  'src/audit/audit.css',
  'src/audit/audit.html',
  'src/audit/audit.js',
  'src/parsers/userside/tmc.js'
].sort(), 'web-accessible surface must be limited to the Audit iframe assets');
assert.match(serialized, /operator-companion-loader/);
console.log('manifest_security_contract_test: PASS');
