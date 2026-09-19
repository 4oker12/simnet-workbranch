import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_SNAPSHOT_TOOL,
  findBuildingInSnapshot,
  readBuildingSnapshot
} from '../src/features/ai-operator/building-snapshot-tool.js';

const LAB_KEY = 'simnet_ai_operator_lab_v1';

const SNAPSHOT = {
  schema: 'simnet-crm-building-snapshot-v1',
  version: 1,
  generatedAt: '2026-08-25T23:53:03.997Z',
  complete: true,
  buildings: [
    {
      id: '5-old-name',
      address: 'просп. Перемоги, буд. 5',
      url: '/building/5-old-name',
      fields: [{ key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' }]
    }
  ]
};

function installStorage() {
  globalThis.chrome = {
    storage: {
      local: {
        async get(requested) {
          const keys = Array.isArray(requested) ? requested : [requested];
          const result = {};
          for (const key of keys) {
            if (key === BUILDING_SNAPSHOT_TOOL.snapshotKey) result[key] = SNAPSHOT;
            if (key === LAB_KEY) result[key] = { messages: [{ role: 'customer', text: 'чи можна перейти на оптику?' }] };
          }
          return result;
        }
      }
    }
  };
}

test('renamed street alias in subscriber address matches old street name in building snapshot', async () => {
  installStorage();

  const result = await readBuildingSnapshot({
    toolArgs: {},
    labState: {
      confirmedCaseId: 'billing-live:177556',
      confirmedSubscriber: {
        login: 'abon177556',
        address: "просп. Берестейський (Перемоги), буд. 5, блок В, під'їзд 1, поверх 9, кв. 110"
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '5-old-name');
  assert.equal(result.data.fields.gpon, 'Да');
  assert.equal(result.data.query.house, '5');
  assert.deepEqual(result.data.query.streetAliases, ['берестейський', 'перемоги']);
});

test('findBuildingInSnapshot accepts alternate street aliases for the same house', () => {
  const found = findBuildingInSnapshot(SNAPSHOT, {
    street: 'берестейський',
    streetAliases: ['берестейський', 'перемоги'],
    house: '5',
    rawAddress: 'просп. Берестейський (Перемоги), буд. 5'
  });

  assert.equal(found.code, 'OK');
  assert.equal(found.matches.length, 1);
  assert.equal(found.matches[0].id, '5-old-name');
});
