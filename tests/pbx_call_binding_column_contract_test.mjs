import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/pbx/pbx-call-binding-column.js', import.meta.url), 'utf8');

test('PBX binding column is loaded on the PBX page after the existing row parser', () => {
  const scripts = manifest.content_scripts.find(item => item.matches?.includes('https://pbx.simnet.kiev.ua/*'))?.js || [];
  const analysisIndex = scripts.indexOf('src/pbx/pbx-manual-analysis-ui.js');
  const bindingIndex = scripts.indexOf('src/pbx/pbx-call-binding-column.js');
  assert.ok(analysisIndex >= 0);
  assert.ok(bindingIndex > analysisIndex);
});

test('PBX row resolves the existing canonical Call through pbxRecordId aliases', () => {
  assert.match(source, /const STATE_KEY = 'simnet_workbench_state_v5'/);
  assert.match(source, /state\?\.callModule\?\.calls\?\.calls/);
  assert.match(source, /call\.pbxRecordId/);
  assert.match(source, /legacyAliases/);
  assert.match(source, /`pbx:\$\{recordId\}`/);
});

test('contract is read from the one existing Binding keyed by the resolved Call', () => {
  assert.match(source, /state\?\.callModule\?\.bindings\?\.bindings/);
  assert.match(source, /entry\?\.call\?\.callKey/);
  assert.match(source, /binding\?\.identity\?\.contract/);
  assert.match(source, /candidateConfidence/);
  assert.match(source, /registrationStatus\?\.state/);
  assert.match(source, /operator-override/);
});

test('PBX UI does not create a second call-contract store or mutate Workbench state', () => {
  assert.doesNotMatch(source, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(source, /chrome\.storage\.local\.remove/);
  assert.doesNotMatch(source, /pbx-contract-map|pbx_contract_map|contractMap/);
});

test('WB contract column exposes native, inferred, confirmed and conflict states', () => {
  assert.match(source, /WB договор/);
  assert.match(source, /~\$\{Math\.round\(confidence \* 100\)\}%/);
  assert.match(source, /🔒/);
  assert.match(source, /Конфликт: PBX/);
  assert.match(source, /Workbench ещё не связал этот PBX-звонок с Call/);
});

test('binding display follows live state changes without polling timers', () => {
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.match(source, /MutationObserver/);
  assert.doesNotMatch(source, /setInterval/);
});

test('binding cell rendering is idempotent so the MutationObserver settles', () => {
  assert.match(source, /const renderKey =/);
  assert.match(source, /dataset\.wbRenderKey === renderKey/);
  assert.match(source, /dataset\.wbRenderKey = renderKey/);
});
