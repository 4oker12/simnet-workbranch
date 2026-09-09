import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const engineer = readFileSync(new URL('../src/ui/engineer-tools-mode.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/ui/settings-enhancer.js', import.meta.url), 'utf8');
const responsive = readFileSync(new URL('../src/ui/responsive-layout.js', import.meta.url), 'utf8');

test('engineer tools mode is loaded after the rail controller', () => {
  const scripts = manifest.content_scripts.find(item => item.matches?.includes('https://userside.simnet.kiev.ua/*'))?.js || [];
  const railIndex = scripts.indexOf('src/ui/rail.js');
  const engineerIndex = scripts.indexOf('src/ui/engineer-tools-mode.js');
  assert.ok(railIndex >= 0);
  assert.ok(engineerIndex > railIndex);
});

test('settings exposes tech mode as a persistent engineer-tools UI flag', () => {
  assert.match(settings, /Тех\. режим/);
  assert.match(settings, /data-action="engineer-tools"/);
  assert.match(settings, /wb-tech-card/);
  assert.match(settings, /wb-tech-switch/);
  assert.match(engineer, /simnet_workbench_ui_engineer_tools_v1/);
  assert.match(engineer, /chrome\.storage\.local\.set/);
  assert.match(engineer, /\[STORAGE_KEY\]\s*:\s*enabled/);
});

test('engineer mode activates only pending LIVE rows without completing evidence', () => {
  assert.match(engineer, /item\?\.level === 'pending'/);
  assert.match(engineer, /wb-engineer-open/);
  assert.doesNotMatch(engineer, /EVIDENCE_RECORD|STORE_APPLY_CONTEXT|pollCompleted\s*=|technicalChecked\s*=|tmcChecked\s*=/);
});

test('engineer ONU navigation reuses the native poll route and falls back to Technical when unresolved', () => {
  assert.match(engineer, /'310': 'billing\.poll\.epon'/);
  assert.match(engineer, /'311': 'billing\.poll\.gpon'/);
  assert.match(engineer, /'312': 'billing\.poll\.gcom'/);
  assert.match(engineer, /'313': 'billing\.poll\.huawei'/);
  assert.match(engineer, /diagnostic\?\.pollAction/);
  assert.match(engineer, /Технология опроса ещё не определена — открываю техданные/);
  assert.match(engineer, /openTechnicalDirect/);
});

test('panel stays compact but has enough room for settings content', () => {
  assert.match(responsive, /width:min\(380px,calc\(100vw - 66px\)\)/);
  assert.match(responsive, /width:min\(330px,calc\(100vw - 66px\)\)/);
});

test('three full-panel tabs use the whole width instead of a five-column grid', () => {
  assert.match(responsive, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(responsive, /\.full-nav button\{/);
  assert.match(responsive, /height:54px/);
});

test('settings toggles remain visible and tech switch is deliberately smaller', () => {
  assert.match(responsive, /#wb-human-settings \.switch\{/);
  assert.match(responsive, /background:#e2e8f0/);
  assert.match(responsive, /#wb-human-settings \.switch\.on\{/);
  assert.match(responsive, /background:#a50046/);
  assert.match(responsive, /flex-wrap:nowrap/);
  assert.match(settings, /wb-tech-switch\{width:32px!important;height:18px!important/);
  assert.match(settings, /wb-tech-card\{padding:7px 9px/);
});
