import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const scripts = manifest.content_scripts?.find(item => item.matches?.some(match => match.includes('admin.simnet.kiev.ua')))?.js || [];
const parserIndex = scripts.indexOf('src/parsers/juniper/session.js');
const prefetchIndex = scripts.indexOf('src/core/juniper-prefetch.js');
assert.ok(parserIndex >= 0, 'Juniper session parser must be loaded on Billing pages');
assert.ok(prefetchIndex >= 0, 'Juniper prefetch must be loaded on Billing pages');
assert.ok(parserIndex < prefetchIndex, 'Juniper parser must initialize before Juniper prefetch');

console.log('juniper_parser_loaded_contract_test: PASS');
