import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/core/crm-constraint-index.js', import.meta.url), 'utf8');
const storage = {};
const sandbox = {
  console,
  setTimeout() { return 0; },
  clearTimeout() {},
  SIMNET_WB: { log: { info() {}, warn() {} } },
  chrome: {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          cb(Object.fromEntries(list.map(key => [key, storage[key]])));
        },
        set(value, cb) { Object.assign(storage, value); cb?.(); }
      },
      onChanged: { addListener() {} }
    }
  }
};
sandbox.window = sandbox;
sandbox.top = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'crm-constraint-index.js' });

const api = sandbox.SIMNET_WB.crmConstraints;
assert.ok(api, 'CRM constraint API must register on SIMNET_WB');

const building = (id, address, fields) => ({ id: String(id), address, url: `/building/${id}`, fields });
const field = (key, text, label = key) => ({ key, label, source: 'main_card', text });
const types = row => new Set(api.extractBuildingConstraints(row).map(item => item.type));

{
  const out = types(building(635, 'Киев, вул. Герцена, 18/20', [
    field('notes', 'Трубки все забиты! Нет возможности для подключения!!! Оборудование на тех. этаже.')
  ]));
  assert.ok(out.has('infrastructure_capacity'), 'blocked tubes must be indexed as infrastructure capacity');
  assert.ok(out.has('connection_block'), 'explicit no-connection possibility must be a blocker');
}

{
  const out = types(building(7433, 'Глушкова 42 / Підмогильного 5', [
    field('keys', 'В выходные ключи не выдают. Обед 12:00-13:00. Ключи сдать до 16:00.')
  ]));
  assert.ok(out.has('access_window'), 'weekend/time key restrictions must be indexed');
}

{
  const out = types(building(9001, 'Тестовая 1', [
    field('notes', '1-й подъезд не подключаем, коммуникация замурована.'),
    field('working_note', 'Подключать не больше 100 Мбит/с.'),
    field('keys', 'Перед подключением предупреждать ОСББ, звонить заранее.'),
    field('custom_77', 'По витой паре не подключаем, только GPON.')
  ]));
  assert.ok(out.has('entrance_scope'), 'entrance-only restriction must not become a whole-building blocker');
  assert.ok(out.has('speed_limit'), 'tariff/speed cap must be indexed');
  assert.ok(out.has('access_coordination'), 'advance coordination must be indexed');
  assert.ok(out.has('technology_restriction'), 'technology-only restriction must be indexed');
}

{
  const out = api.extractBuildingConstraints(building(2693, 'Данченка 32/А', [
    field('notes', 'можно включать по пону. бокси 13,8,3 эт., 2 стояка.'),
    field('gpon', 'да')
  ]));
  assert.equal(out.length, 0, 'routine positive PON notes must not be promoted to a warning');
}

{
  const snapshot = {
    schema: 'simnet-crm-building-snapshot-v1',
    generatedAt: '2026-08-25T23:53:03.997Z',
    stats: { complete: true },
    buildings: [
      building(635, 'Герцена 18/20', [field('notes', 'Трубки все забиты! Нет возможности для подключения!!!')]),
      building(7433, 'Глушкова 42 / Підмогильного 5', [field('keys', 'В выходные ключи не выдают. Ключи сдать до 16:00.')]),
      building(2693, 'Данченка 32/А', [field('notes', 'можно включать по пону.')])
    ]
  };
  const index = api.buildFromSnapshot(snapshot);
  assert.equal(index.schema, 'simnet-crm-building-constraints-v1');
  assert.equal(index.stats.scannedBuildings, 3);
  assert.equal(index.stats.buildingsWithConstraints, 2);
  assert.ok(index.stats.constraints >= 3);
  assert.ok(index.buildings['635']);
  assert.ok(index.buildings['7433']);
  assert.equal(index.buildings['2693'], undefined);
}

console.log('CRM operational constraint index tests passed');
