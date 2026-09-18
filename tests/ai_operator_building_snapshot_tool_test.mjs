import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_SNAPSHOT_TOOL,
  findBuildingInSnapshot,
  readBuildingSnapshot
} from '../src/features/ai-operator/building-snapshot-tool.js';
import { mapInformationNeedsToTools } from '../src/features/ai-operator/semantic-tool-broker.js';

const SNAPSHOT = {
  schema: 'simnet-crm-building-snapshot-v1',
  version: 1,
  generatedAt: '2026-09-18T08:00:00.000Z',
  stats: { discovered: 2, parsed: 2, failed: 0, complete: true },
  buildings: [
    {
      id: '2693',
      address: 'вул. Данченка, буд. 32/А',
      url: '/building/2693',
      fields: [
        { key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' },
        { key: 'owner', label: 'Собственник', text: 'ОСББ Тест', source: 'main_card' },
        { key: 'working_note', label: 'Рабочая заметка', text: 'Ключ у консьержа', source: 'main_card' },
        { key: 'floors', label: 'Этажей', text: '25', source: 'main_card' }
      ]
    },
    {
      id: '7777',
      address: 'вул. Симиренка, буд. 21',
      url: '/building/7777',
      fields: [
        { key: 'gpon', label: 'GPON', text: 'Нет', source: 'main_card' },
        { key: 'management', label: 'Название УК/ОСББ', text: 'ЖЕК Тест', source: 'main_card' }
      ]
    }
  ]
};

function installChromeSnapshot(snapshot = SNAPSHOT) {
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: snapshot };
        }
      }
    }
  };
}

test('building.snapshot resolves street + house and returns the whole building card', async () => {
  installChromeSnapshot();
  const result = await readBuildingSnapshot({ toolArgs: { street: 'Данченка', house: '32/А' } });

  assert.equal(result.ok, true);
  assert.equal(result.tool, 'building.snapshot');
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '2693');
  assert.equal(result.data.address, 'вул. Данченка, буд. 32/А');
  assert.equal(result.data.fields.gpon, 'Да');
  assert.equal(result.data.fields.owner, 'ОСББ Тест');
  assert.equal(result.data.fields.working_note, 'Ключ у консьержа');
  assert.equal(result.data.fields.floors, '25');
  assert.equal(result.data.source, 'userside-building-snapshot-local');
  assert.equal(result.data.snapshotComplete, true);
  assert.equal(BUILDING_SNAPSHOT_TOOL.snapshotKey, 'simnet_crm_building_snapshot_v1');
});

test('building.snapshot can derive street + house from already known subscriber address', async () => {
  installChromeSnapshot();
  const result = await readBuildingSnapshot({
    labState: {
      confirmedSubscriber: {
        address: 'м. Київ, вул. Симиренка (Святошинський), буд. 21, під\'їзд 2, поверх 2, кв. 72'
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.buildingId, '7777');
  assert.equal(result.data.fields.gpon, 'Нет');
  assert.equal(result.data.fields.management, 'ЖЕК Тест');
});

test('building lookup never guesses when street + house are ambiguous', () => {
  const duplicate = structuredClone(SNAPSHOT);
  duplicate.buildings.push({
    id: '8888',
    address: 'улица Симиренка, дом 21',
    url: '/building/8888',
    fields: [{ key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' }]
  });

  const found = findBuildingInSnapshot(duplicate, { street: 'Симиренка', house: '21' });
  assert.equal(found.code, 'AMBIGUOUS_BUILDING');
  assert.equal(found.matches.length, 2);
});

test('building.snapshot NOT_FOUND is explicitly not proof that GPON is absent', async () => {
  installChromeSnapshot();
  const result = await readBuildingSnapshot({ toolArgs: { street: 'Несуществующая', house: '999' } });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_FOUND');
  assert.match(result.warnings.join(' '), /не доказательство отсутствия GPON|не доказательство отсутствия.*покрытия/i);
});

test('building questions route to building.snapshot while ONU signal remains pon.signal', () => {
  const buildingCalls = mapInformationNeedsToTools([
    { system: 'UserSide', field: 'покрытие GPON/оптикой по дому', why: 'Проверить, доступна ли оптика в этом здании.' }
  ]);
  assert.deepEqual(buildingCalls.map(item => item.tool), ['building.snapshot']);

  const signalCalls = mapInformationNeedsToTools([
    { system: 'UserSide', field: 'оптический RX ONU', why: 'Проверить текущий сигнал линии абонента.' }
  ]);
  assert.deepEqual(signalCalls.map(item => item.tool), ['pon.signal']);
});

test('an old explicit userside.snapshot request for building GPON coverage is upgraded to building.snapshot', () => {
  const calls = mapInformationNeedsToTools([
    { system: 'UserSide', field: 'userside.snapshot: GPON coverage по дому', why: 'Проверить наличие оптики в здании.' }
  ]);
  assert.deepEqual(calls.map(item => item.tool), ['building.snapshot']);
});
