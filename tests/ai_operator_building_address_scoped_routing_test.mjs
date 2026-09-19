import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapInformationNeedsToTools as mapCoreNeeds,
  executeInformationNeeds as executeCoreNeeds
} from '../src/features/ai-operator/semantic-tool-broker-core.js';
import {
  executeInformationNeeds as executeImplNeeds,
  groundSubscriberReply as groundImplReply
} from '../src/features/ai-operator/semantic-tool-broker-impl.js';

const BUILDING_NEED = Object.freeze({
  system: 'UserSide',
  field: 'building.snapshot: наличие оптического покрытия по адресу Симиренка 34а',
  why: 'Это конкретный live-факт о покрытии сети SIMNET, который нельзя достоверно определить из общеизвестных знаний.'
});

function buildingResult(toolArgs = {}) {
  return {
    ok: true,
    tool: 'building.snapshot',
    code: 'OK',
    observedAt: '2026-09-19T03:00:00.000Z',
    data: {
      source: 'userside-building-snapshot-local',
      address: toolArgs.address || '',
      fields: { gpon: 'Да' }
    },
    warnings: [],
    statePatch: {}
  };
}

test('building.snapshot planner preserves explicit address as tool args', () => {
  const planned = mapCoreNeeds([BUILDING_NEED]);

  assert.equal(planned.length, 1);
  assert.equal(planned[0].tool, 'building.snapshot');
  assert.equal(planned[0].toolArgs.address, 'Симиренка 34а');
});

test('core building-only read does not bootstrap customer.lookup', async () => {
  const calls = [];
  const result = await executeCoreNeeds({
    needs: [BUILDING_NEED],
    transcript: [{ role: 'customer', text: 'Проверь оптику по адресу Симиренка 34а' }],
    analysis: { probe: { whatUserWants: 'Подтвердить наличие оптического покрытия по адресу Симиренка 34а' } },
    labState: {},
    execute: async ({ tool, toolArgs }) => {
      calls.push({ tool, toolArgs });
      assert.notEqual(tool, 'customer.lookup');
      return buildingResult(toolArgs);
    }
  });

  assert.deepEqual(calls.map(item => item.tool), ['building.snapshot']);
  assert.equal(calls[0].toolArgs.address, 'Симиренка 34а');
  assert.equal(result.trace[0].tool, 'building.snapshot');
  assert.equal(result.trace[0].args.address, 'Симиренка 34а');
});

test('impl building-only read skips explicit identity bootstrap', async () => {
  const calls = [];
  const result = await executeImplNeeds({
    needs: [BUILDING_NEED],
    transcript: [{ role: 'customer', text: 'Проверь оптику по адресу Симиренка 34а' }],
    analysis: { probe: { whatUserWants: 'Подтвердить наличие оптического покрытия по адресу Симиренка 34а' } },
    labState: {},
    execute: async ({ tool, toolArgs }) => {
      calls.push({ tool, toolArgs });
      assert.notEqual(tool, 'customer.lookup');
      return buildingResult(toolArgs);
    }
  });

  assert.deepEqual(calls.map(item => item.tool), ['building.snapshot']);
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0].args.address, 'Симиренка 34а');
});

test('impl ground wrapper does not pre-bootstrap identity for building-only semantic need', async () => {
  const bootstrapCalls = [];
  let delegatedDraft = null;

  const result = await groundImplReply({
    draft: { reply: '', subscriberDataNeeded: [BUILDING_NEED] },
    transcript: [{ role: 'customer', text: 'Проверь оптику по адресу Симиренка 34а' }],
    analysis: {
      probe: {
        liveDataNeed: 'needed',
        whatUserWants: 'Подтвердить наличие оптического покрытия по адресу Симиренка 34а',
        evidenceNeeds: [BUILDING_NEED]
      }
    },
    labState: {},
    execute: async args => {
      bootstrapCalls.push(args);
      throw new Error(`Unexpected pre-tool call: ${args.tool}`);
    },
    coreGround: async ({ draft, labState }) => {
      delegatedDraft = draft;
      return {
        reply: 'stub',
        subscriberDataNeeded: draft.subscriberDataNeeded,
        toolTrace: [],
        toolEvidence: [],
        degraded: false,
        degradationReason: '',
        toolState: labState
      };
    }
  });

  assert.deepEqual(bootstrapCalls, []);
  assert.equal(delegatedDraft.subscriberDataNeeded.length, 1);
  assert.match(delegatedDraft.subscriberDataNeeded[0].field, /^building\.snapshot:/i);
  assert.equal(result.reply, 'stub');
});
