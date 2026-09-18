import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function loadImportRuntime() {
  const source = await fs.readFile(new URL('../src/parsers/userside/building-import.js', import.meta.url), 'utf8');
  const writes = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    location: { pathname: '/noop' },
    document: {
      readyState: 'loading',
      addEventListener() {}
    },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          set(value, callback) {
            writes.push(value);
            callback?.();
          }
        }
      }
    }
  };
  context.window = context;
  context.self = context;
  context.top = context;
  context.globalThis = context;
  context.SIMNET_WB = {};
  vm.runInNewContext(source, context, { filename: 'building-import.js' });
  return { api: context.SIMNET_WB.crmBuildingImport, writes, source };
}

function sampleSnapshot() {
  return {
    schema: 'simnet-crm-building-snapshot-v1',
    version: 1,
    generatedAt: '2026-08-25T23:55:05.578Z',
    source: { origin: 'https://userside.simnet.kiev.ua' },
    stats: { discovered: 2, parsed: 2, failed: 0, complete: true },
    buildings: [
      {
        id: '101',
        address: 'вул. Симиренка, буд. 21',
        url: '/building/101',
        fields: [
          { key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' },
          { key: 'owner', label: 'Собственник', text: 'ОСББ Тест', source: 'main_card' }
        ]
      },
      {
        id: '102',
        address: 'вул. Симиренка, буд. 18',
        url: '/building/102',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Нет', source: 'main_card' }]
      }
    ],
    errors: []
  };
}

test('building snapshot import validates the exported CRM schema and preserves original snapshot time', async () => {
  const { api } = await loadImportRuntime();
  assert.ok(api);

  const normalized = api.validateSnapshot(sampleSnapshot());
  assert.equal(normalized.schema, 'simnet-crm-building-snapshot-v1');
  assert.equal(normalized.generatedAt, '2026-08-25T23:55:05.578Z');
  assert.equal(normalized.stats.parsed, 2);
  assert.equal(normalized.stats.complete, true);
  assert.equal(normalized.buildings[0].fields[0].key, 'gpon');
  assert.equal(normalized.buildings[0].fields[0].text, 'Да');
});

test('building snapshot import writes the exact storage key used by building.snapshot', async () => {
  const { api, writes } = await loadImportRuntime();
  const stats = await api.importSnapshotObject(sampleSnapshot(), 'simnet-crm-buildings-test.json');

  assert.equal(stats.buildings, 2);
  assert.equal(writes.length, 1);
  const saved = writes[0];
  const snapshot = saved.simnet_crm_building_snapshot_v1;
  const state = saved.simnet_crm_building_crawl_state_v1;
  assert.ok(snapshot);
  assert.equal(snapshot.buildings.length, 2);
  assert.equal(snapshot.generatedAt, '2026-08-25T23:55:05.578Z');
  assert.equal(snapshot.importMeta.importedFrom, 'simnet-crm-buildings-test.json');
  assert.equal(state.status, 'imported');
  assert.equal(state.processed, 2);
});

test('building snapshot import rejects unrelated or damaged JSON', async () => {
  const { api } = await loadImportRuntime();
  assert.throws(() => api.validateSnapshot({ schema: 'wrong', buildings: [{}] }), /Неверная схема snapshot/);
  assert.throws(() => api.validateSnapshot({ schema: 'simnet-crm-building-snapshot-v1', buildings: [] }), /нет карточек зданий/i);
});

test('manifest loads the import UI immediately after the existing building parser', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  const coreIndex = scripts.indexOf('src/parsers/userside/building-core.js');
  const importIndex = scripts.indexOf('src/parsers/userside/building-import.js');
  assert.ok(coreIndex >= 0);
  assert.equal(importIndex, coreIndex + 1);
});

test('building list UI exposes an Import JSON button without removing the crawler/export path', async () => {
  const { source } = await loadImportRuntime();
  assert.match(source, /Импорт JSON/);
  assert.match(source, /importSnapshotFile/);
  const core = await fs.readFile(new URL('../src/parsers/userside/building-core.js', import.meta.url), 'utf8');
  assert.match(core, /Собрать \/ обновить/);
  assert.match(core, /Экспорт JSON/);
});
