import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../src/parsers/userside/building-core.js', import.meta.url), 'utf8');

assert.match(src, /const item = queue\[index\];\s*let parsed = null;\s*try \{/s, 'parsed must live across try/catch and progress callback');
assert.doesNotMatch(src, /try \{[\s\S]{0,300}const parsed = parseBuildingCoreHtml/, 'parsed must not be block-scoped inside try');
assert.match(src, /sso\\\.php|sso\.php/, 'fetchText must detect UserSide SSO redirect');
console.log('crm_building_crawl_runtime_regression_test: PASS');
