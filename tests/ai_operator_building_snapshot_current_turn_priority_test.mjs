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
    complete: true,
    buildings: [
      {
        id: '2693',
        address: 'вул. Данченка, буд. 32/А',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' }]
      },
      {
        id: '7777',
        address: 'вул. Симиренка, буд. 21',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Нет', source: 'main_card' }]
      }
    ]
  };
  const lab = {
    messages: [
      { role: 'customer', text: 'abon177556' },
      { role: 'customer', text: 'есть GPON на Данченка 32/А?' }
    ]
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

test('current AI Lab building address wins over confirmed subscriber address', async () => {
  installStorage();

  const result = await readBuildingSnapshot({
    toolArgs: {},
    labState: {
      confirmedCaseId: 'billing-live:177556',
      confirmedSubscriber: {
        login: 'abon177556',
        address: 'м. Київ, вул. Симиренка, буд. 21, кв. 72'
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '2693');
  assert.equal(result.data.address, 'вул. Данченка, буд. 32/А');
  assert.equal(result.data.fields.gpon, 'Да');
  assert.equal(result.data.snapshotComplete, true);
  assert.equal(result.data.query.street, 'данченка');
  assert.equal(result.data.query.house, '32/а');
});
