import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  searchCrmIndex,
  crmSearchStats,
  snapshotToCrmEntries,
  searchCrmEntriesForTest,
  queryCrmEntriesForTest,
  crmSearchIsPrimary
} from '../src/ai/crm-search-index.js';

const stats = await crmSearchStats();
assert.equal(stats.source, 'missing', 'production CRM must not silently fall back to Danchenko when snapshot is absent');
assert.equal(stats.entries, 0, 'missing snapshot must expose zero production CRM entries');

const vadim = await searchCrmIndex('что известно по Вадиму с Данченка?', { limit: 8, minScore: 0.48 });
assert.ok(vadim.some(x => x.section === 'notes' && /Вадим мастер/i.test(x.text)), 'must find Vadim master in building notes');
assert.ok(vadim.some(x => x.section === 'working_note' && /подготовил ключи/i.test(x.text)), 'must find key-preparation working note');
assert.equal(vadim.some(x => x.entityType === 'customer'), false, 'subscriber/customer rows must not exist in CRM building index');
assert.equal(vadim.some(x => /Тривалюк Вадим/i.test(x.text)), false, 'subscriber Vadim must be excluded by design');

const keys = await searchCrmIndex('данченка ключи что известно?', { limit: 8, minScore: 0.48 });
assert.ok(keys.some(x => x.section === 'working_note' && /Вадим/i.test(x.text) && /подготовил ключи/i.test(x.text)), 'real operator phrase must retrieve the building key/Vadim note');


const activeDanchenko = {
  scope: 'building', entityType: 'building', entityId: '2693',
  address: 'Киев, вул. Сергія Данченка (Подільський), 32/А',
  url: '/building/2693', street: 'Сергія Данченка'
};
const speedTurn = queryCrmEntriesForTest('что по скорости делать?', undefined, { activeContext: activeDanchenko });
assert.notEqual(speedTurn.plan.scope, 'active_building', 'diagnostic speed question must escape stale CRM building context');
assert.equal(crmSearchIsPrimary(speedTurn, 'что по скорости делать?'), false, 'speed question must use normal diagnostic assistant');
const cableFollowup = queryCrmEntriesForTest('а если по кабелю так же?', undefined, { activeContext: activeDanchenko });
assert.notEqual(cableFollowup.plan.scope, 'active_building', 'cable diagnostic follow-up must not be forced into CRM');
assert.equal(crmSearchIsPrimary(cableFollowup, 'а если по кабелю так же?'), false);
const vadimFollowup = queryCrmEntriesForTest('что по Вадиму?', undefined, { activeContext: activeDanchenko });
assert.equal(vadimFollowup.plan.scope, 'active_building', 'matching person follow-up must keep the active building');
assert.equal(crmSearchIsPrimary(vadimFollowup, 'что по Вадиму?'), true);
const keysFollowup = queryCrmEntriesForTest('а ключи?', undefined, { activeContext: activeDanchenko });
assert.equal(keysFollowup.plan.scope, 'active_building', 'matching CRM-topic follow-up must keep the active building');
const explicitContinuation = queryCrmEntriesForTest('а что еще?', undefined, { activeContext: activeDanchenko });
assert.equal(explicitContinuation.plan.scope, 'active_building', 'explicit same-building continuation may reuse the active CRM context');

const syntheticSnapshot = {
  schema: 'simnet-crm-building-snapshot-v1',
  buildings: [{
    id: '2162',
    address: 'с. Софиевская Борщаговка, вул. Яблунева, 13/Б',
    url: '/building/2162',
    fields: [
      { key: 'working_note', label: 'Рабочая заметка', text: 'Ключи у мастера Сергея, звонить утром' },
      { key: 'manager', label: 'Менеджер', text: 'Иванов И.' }
    ]
  }]
};
const entries = snapshotToCrmEntries(syntheticSnapshot);
assert.equal(entries.length, 2);
assert.ok(entries.every(x => x.entityType === 'building'));
assert.ok(searchCrmEntriesForTest('яблунева ключи мастер', entries, { minScore: 0.3 }).some(x => /Ключи у мастера/.test(x.text)));

const backgroundSource = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
assert.match(backgroundSource, /CRM_RESULTS is authoritative read-only evidence/, 'background must build dedicated CRM context');
assert.match(backgroundSource, /await queryCrmIndex\(message,/, 'universal CRM query planner must be awaited');
assert.match(backgroundSource, /subscriber\/customer rows and tabs excluded/i, 'model routing must know subscriber rows are outside this index');

console.log('PASS AI CRM building-core search');
