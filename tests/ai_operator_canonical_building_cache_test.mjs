import test from 'node:test';
import assert from 'node:assert/strict';

import { createCanonicalDomainContext, resolveFacts } from '../src/features/ai-operator/canonical-fact-resolver.js';

const NOW = Date.parse('2026-09-20T06:00:00.000Z');

function buildingResult(id, address, fields) {
  return {
    ok: true,
    tool: 'building.snapshot',
    code: 'OK',
    observedAt: new Date(NOW).toISOString(),
    data: {
      buildingId: String(id),
      address,
      fields,
      source: 'userside-building-snapshot-local'
    }
  };
}

function fact(result, path) {
  return result.facts.find(item => item.path === path);
}

test('explicit Building B outranks active Building A cache and becomes the follow-up context', async () => {
  const calls = [];
  const execute = async ({ tool, toolArgs }) => {
    assert.equal(tool, 'building.snapshot');
    calls.push(toolArgs.address);
    if (/Дом А/u.test(toolArgs.address)) return buildingResult('100', 'Киев, Дом А', { gpon: 'Да', ktv: 'Нет' });
    if (/Дом Б/u.test(toolArgs.address)) return buildingResult('200', 'Киев, Дом Б', { gpon: 'Нет', ktv: 'Есть' });
    throw new Error(`unexpected address: ${toolArgs.address}`);
  };

  const a = await resolveFacts({
    context: createCanonicalDomainContext(),
    facts: ['building.gpon'],
    request: { address: 'Киев, Дом А' },
    execute,
    now: NOW
  });
  assert.equal(fact(a, 'building.gpon').value, 'Да');
  assert.equal(a.context.domainContext.activeBuildingId, 'userside-building:100');

  const b = await resolveFacts({
    context: a.context,
    facts: ['building.gpon'],
    request: { address: 'Киев, Дом Б' },
    execute,
    now: NOW + 1000
  });
  assert.equal(fact(b, 'building.gpon').value, 'Нет');
  assert.equal(b.context.domainContext.activeBuildingId, 'userside-building:200');
  assert.deepEqual(calls, ['Киев, Дом А', 'Киев, Дом Б']);

  const followUp = await resolveFacts({
    context: b.context,
    facts: ['building.ktv'],
    execute,
    now: NOW + 2000
  });
  assert.equal(fact(followUp, 'building.ktv').value, 'Есть');
  assert.deepEqual(calls, ['Киев, Дом А', 'Киев, Дом Б']);
  assert.deepEqual(followUp.diagnostics.cacheHits, ['userside.building']);
});
