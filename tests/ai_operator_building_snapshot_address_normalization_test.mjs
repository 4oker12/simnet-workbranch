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
    stats: { parsed: 4, complete: true },
    buildings: [
      {
        id: '1024',
        address: 'Киев, вул. Симиренка (Святошинський), 34',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Нет', source: 'main_card' }]
      },
      {
        id: '6876',
        address: 'Киев, вул. Симиренка (Святошинський), 34/А',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' }]
      },
      {
        id: '2',
        address: 'Киев, вул. Вахтанга Кікабідзе (Святошинський) (Булгакова), 8/А',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Да', source: 'main_card' }]
      },
      {
        id: 'other-8a',
        address: 'Киев, вул. Олександра Махова (Святошинський) (Жолудєва), 8/А',
        fields: [{ key: 'gpon', label: 'GPON', text: 'Нет', source: 'main_card' }]
      }
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
            if (key === LAB_KEY) result[key] = { messages: [] };
          }
          return result;
        }
      }
    }
  };
}

async function read(address) {
  installStorage();
  return readBuildingSnapshot({
    toolArgs: { address },
    labState: {}
  });
}

test('compact letter suffix 34а matches UserSide slash form 34/А', async () => {
  const result = await read('Симиренка 34а');
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '6876');
  assert.equal(result.data.address, 'Киев, вул. Симиренка (Святошинський), 34/А');
  assert.equal(result.data.fields.gpon, 'Да');
  assert.equal(result.data.query.house, '34а');
  assert.deepEqual(result.data.query.houseAliases, ['34а', '34/а']);
});

test('bare house 34 stays distinct from 34/А', async () => {
  const result = await read('Симиренка 34');
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '1024');
});

test('administrative district annotation does not create cross-street ambiguity', async () => {
  const result = await read('Киев, вул. Вахтанга Кікабідзе (Святошинський) (Булгакова), 8/А');
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '2');
});

test('historical street alias in parentheses still resolves the building', async () => {
  const result = await read('Булгакова 8/А');
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(result.data.buildingId, '2');
});
