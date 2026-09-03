import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/parsers/userside/building-core.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(source, /#ref_start, #navigation/, 'parser must use the building-card/tab boundary');
assert.match(source, /#slider_content \/ customer rows/, 'scope comment must explicitly exclude customer slider');
assert.ok(source.includes('#dataSearchResultId a[href^="/building/"]'), 'crawler must discover building cards only');
assert.doesNotMatch(source, /fetchText\([^\n]*\/customer\//, 'crawler must never fetch customer pages');
assert.match(source, /const CONCURRENCY = 2;/, 'crawler concurrency must stay bounded to 2');
assert.match(source, /MAX_RETRIES = 2/, 'crawler must have bounded retries');
assert.match(source, /stopRequested/, 'crawler must have STOP support');
assert.match(source, /simnet_crm_building_snapshot_v1/, 'parser must persist one building snapshot');
assert.match(source, /Экспорт JSON/, 'operator must be able to export one snapshot file');
assert.match(source, /Заметки|заметки/, 'building notes must be a first-class field');
assert.match(source, /Рабочая заметка|рабочая заметка/, 'working note must be a first-class field');

const scripts = manifest.content_scripts?.[0]?.js || [];
assert.ok(scripts.includes('src/parsers/userside/building-core.js'), 'building parser must be loaded on UserSide');
assert.ok(manifest.permissions.includes('unlimitedStorage'), 'large local building snapshot needs unlimitedStorage permission');

console.log('PASS CRM building parser contract');
