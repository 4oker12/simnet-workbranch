import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverLiveDataNeeds } from '../src/features/ai-operator/live-need-recovery.js';
import {
  evidenceFallbackResult,
  mapInformationNeedsToTools
} from '../src/features/ai-operator/semantic-tool-broker-impl.js';

const ANALYSIS = {
  probe: {
    whatUserWants: 'abon177556 договор\nхочу перейти на оптику',
    latestMessageMeans: 'abon177556 договор\nхочу перейти на оптику',
    unresolvedRequests: ['abon177556 договор\nхочу перейти на оптику'],
    factsSaidByUser: ['abon177556 договор\nхочу перейти на оптику'],
    language: 'ru',
    confidence: 0
  }
};

test('degraded recovery recognizes optical migration as building coverage request', () => {
  const needs = recoverLiveDataNeeds({
    analysis: ANALYSIS,
    draft: { degraded: true, subscriberDataNeeded: [] }
  });

  assert.equal(needs.length, 1);
  assert.match(needs[0].field, /^building\.snapshot:/);

  const calls = mapInformationNeedsToTools(needs);
  assert.deepEqual(calls.map(item => item.tool), ['building.snapshot']);
  assert.equal(calls.some(item => item.tool === 'customer.snapshot'), false);
});

test('degraded evidence fallback answers optical migration from successful building snapshot without LLM', () => {
  const result = evidenceFallbackResult(ANALYSIS, [
    {
      tool: 'customer.lookup',
      ok: true,
      requestedBy: { system: 'identity', field: 'login', why: 'identity' },
      data: {
        candidate: {
          login: 'abon177556',
          address: 'просп. Берестейський (Перемоги), буд. 5'
        }
      }
    },
    {
      tool: 'building.snapshot',
      ok: true,
      code: 'OK',
      requestedBy: {
        system: 'UserSide',
        field: 'building.snapshot: abon177556 договор хочу перейти на оптику',
        why: 'Проверить доступность GPON по дому.'
      },
      data: {
        address: 'просп. Перемоги, буд. 5',
        fields: { gpon: 'Да' },
        source: 'userside-building-snapshot-local'
      }
    }
  ]);

  assert.equal(result.complete, true);
  assert.deepEqual(result.requestedTools, ['building.snapshot']);
  assert.deepEqual(result.coveredTools, ['building.snapshot']);
  assert.match(result.reply, /GPON есть/i);
  assert.match(result.reply, /переход на оптику/i);
  assert.doesNotMatch(result.reply, /повторите|не удалось корректно сформировать/i);
});
