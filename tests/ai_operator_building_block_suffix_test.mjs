import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_SNAPSHOT_TOOL,
  readBuildingSnapshot
} from '../src/features/ai-operator/building-snapshot-tool.js';

const LAB_KEY = 'simnet_ai_operator_lab_v1';

function installStorage() {
  const snapshot = {
    schema: 'simnet-crm-building-snapshot-v1',
    version: 1,
    generatedAt: '2026-08-25T23:53:03.997Z',
    stats: { parsed: 2, complete: true },
    buildings: [
      {
        id: 'victory-v',
        address: 'просп. Берестейський (Перемоги), буд. 5/В',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' }]
      },
      {
        id: 'plain-five',
        address: 'просп. Берестейський, буд. 5',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Нет', source: 'main_card' }]
      }
    ]
  };
  const lab = {
    messages: [{ role: 'customer', text: 'abon177556 договор\nхочу перейти на оптику' }]
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(requested) {
          const keys = Array.isArray(requested) ? requested : [requested];
          const result = {};
          for (const key of keys) {
            if (key === BUILDING_SNAPSHOT_TOOL.snapshotKey) result[key] = snapshot;
            if (key === LAB_KEY) result[key] = lab;
          }
          return result;
        }
      }
    }
  };
}

test('Billing house + block resolves to the specific slash-suffixed building before bare house', async () => {
  installStorage();

  const result = await readBuildingSnapshot({
    toolArgs: {},
    labState: {
      confirmedCaseId: 'billing-live:17755',
      confirmedSubscriber: {
        login: 'abon177556',
        address: "просп. Берестейський (Перемоги), буд. 5, блок В, під'їзд 1, поверх 9, кв. 110"
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, 'victory-v');
  assert.equal(result.data.address, 'просп. Берестейський (Перемоги), буд. 5/В');
  assert.equal(result.data.fields.gpon, 'Да');
  assert.equal(result.data.query.house, '5/в');
  assert.deepEqual(result.data.query.houseAliases, ['5/в', '5']);
});
