import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInformationNeeds } from '../src/features/ai-operator/semantic-tool-broker.js';

const NEED = {
  system: 'UserSide',
  field: 'building.snapshot: наличие оптического покрытия по адресу Симиренка 34а',
  why: 'Нужно проверить карточку конкретного дома.'
};

test('explicit building address does not rebind an already confirmed subscriber', async () => {
  const calls = [];
  const labState = {
    confirmedCaseId: 'billing-live:17755',
    confirmedSubscriber: {
      login: 'abon177556',
      contract: '177556',
      address: 'просп. Берестейський (Перемоги), буд. 5, блок В'
    }
  };

  const result = await executeInformationNeeds({
    needs: [NEED],
    transcript: [{ role: 'customer', text: 'Проверь оптику по адресу Симиренка 34а' }],
    analysis: {
      probe: {
        whatUserWants: 'Подтвердить наличие оптического покрытия по адресу Симиренка 34а'
      }
    },
    labState,
    execute: async ({ tool, toolArgs, labState: state }) => {
      calls.push({ tool, toolArgs, state });
      if (tool === 'customer.lookup') {
        return {
          ok: false,
          tool,
          code: 'ADDRESS_STREET_NOT_FOUND',
          observedAt: '2026-09-19T03:20:00.000Z',
          data: { source: 'billing-live-read-only' },
          warnings: [],
          statePatch: {}
        };
      }
      assert.equal(tool, 'building.snapshot');
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-19T03:20:01.000Z',
        data: {
          source: 'userside-building-snapshot-local',
          address: toolArgs.address,
          fields: { gpon: 'Да' }
        },
        warnings: [],
        statePatch: {}
      };
    }
  });

  assert.deepEqual(calls.map(item => item.tool), ['building.snapshot']);
  assert.equal(calls[0].toolArgs.address, 'Симиренка 34а');
  assert.equal(result.labState.confirmedCaseId, 'billing-live:17755');
  assert.equal(result.labState.confirmedSubscriber.login, 'abon177556');
});
