import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/ui/call-registration-loader.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

assert.match(messages, /CALL_LATEST_SNAPSHOT_GET:\s*'CALL_LATEST_SNAPSHOT_GET'/);
assert.match(background, /\[MessageType\.CALL_LATEST_SNAPSHOT_GET\]:\s*getLatestCallSnapshot/);
assert.match(ui, /data-action="export-call-snapshot"/);
assert.match(ui, /simnet-call-snapshot-v2/);
assert.match(ui, />Выгрузить<\/button>/);
assert.match(ui, /snapshotDetailsMarkup\(\)/);

const exportStart = ui.indexOf('callSnapshotExportPayload() {');
const exportEnd = ui.indexOf('\n    downloadCallSnapshot()', exportStart);
assert.ok(exportStart >= 0 && exportEnd > exportStart);
const exportBlock = ui.slice(exportStart, exportEnd);
assert.match(exportBlock, /target:/);
assert.match(exportBlock, /source: authoritativeCustomerId \? 'userside:call_list' : 'call:evidence'/);
assert.match(exportBlock, /evidence: events\.map\(event => this\.compactSnapshotEvent\(event\)\)/);
assert.doesNotMatch(exportBlock, /candidates\s*[,}]/, 'compact export must not dump full candidate internals');
assert.doesNotMatch(exportBlock, /caseSnapshot|contexts|journal/, 'compact call export must stay call-scoped');

// Production loader must not mount or synchronize the old global TEST call HUD.
assert.doesNotMatch(loader, /simnet_wb_test_simulated_call_v1/);
assert.doesNotMatch(loader, /syncGlobalTestMonitor|TEST-call|Frozen evidence/i);

// Opening CALL goes directly to REAL/snapshot mode; no mode picker is invoked in open().
const openStart = ui.indexOf('async open(caseData');
const openEnd = ui.indexOf('\n    draft()', openStart);
assert.ok(openStart >= 0 && openEnd > openStart, 'open() block should be present');
const openBlock = ui.slice(openStart, openEnd);
assert.match(openBlock, /CALL_LATEST_SNAPSHOT_MESSAGE/);
assert.doesNotMatch(openBlock, /renderModePicker\(|choose-test-mode|startSimulatedCall/);

// Old TEST controls may remain as inert development helpers, but they render nothing in production UI.
assert.match(ui, /testControlsMarkup\(\)\s*\{\s*return '';\s*\}/);

console.log('call_snapshot_export_contract_test: PASS');
