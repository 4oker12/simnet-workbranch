import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  snapshotToCrmEntries,
  queryCrmEntriesForTest,
  crmSearchPrompt,
  crmSearchIsPrimary
} from '../src/ai/crm-search-index.js';

const snapshot = {
  schema: 'simnet-crm-building-snapshot-v1',
  buildings: [
    {
      id: '2400',
      address: 'с. Софиевская Борщаговка, вул. Бишівська (Софіївська Борщагівка), 1',
      url: '/building/2400',
      fields: [
        { key: 'notes', label: 'Заметки', text: 'ЖЕК працює до 17:00, ключі у диспетчера.' },
        { key: 'gpon', label: 'GPON', text: 'да' }
      ]
    },
    {
      id: '2401',
      address: 'с. Софиевская Борщаговка, вул. Бишівська (Софіївська Борщагівка), 3',
      url: '/building/2401',
      fields: [
        { key: 'working_note', label: 'Рабочая заметка', text: 'Доступ свободный, дополнительной информации нет.' }
      ]
    },
    {
      id: '2693',
      address: 'Киев, вул. Сергія Данченка (Подільський), 32/А',
      url: '/building/2693',
      fields: [
        { key: 'notes', label: 'Заметки', text: 'Вадим мастер. ПЕРЕВОДИМО НА СІМНЕТ.' },
        { key: 'working_note', label: 'Рабочая заметка', text: '097-203-03-98 Вадим, утром подготовит ключи.' }
      ]
    },
    {
      id: '9000',
      address: 'Киев, вул. Вадима Гетьмана, 1',
      url: '/building/9000',
      fields: [{ key: 'notes', label: 'Заметки', text: 'Другая улица, другой контекст.' }]
    },
    {
      id: 'alias8a',
      address: 'Киев, вул. Вахтанга Кікабідзе (Святошинський) (Булгакова), 8/А',
      url: '/building/alias8a',
      fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'Ключи в 116 квартире.' }]
    },
    {
      id: 'false17',
      address: 'Киев, вул. Тестова, 17',
      url: '/building/false17',
      fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'ЖЕК 093 800 35 90, ключи у диспетчера. Квартира 17 помогает с доступом.' }]
    }
  ]
};

const entries = snapshotToCrmEntries(snapshot);

for (const query of ['по всей Бышевской ЖЕК?', 'по всій Бишівській жек?', 'па всей бышевскай жек?']) {
  const outcome = queryCrmEntriesForTest(query, entries, { maxResults: 40 });
  assert.equal(outcome.plan.scope, 'street', query);
  assert.equal(outcome.plan.street, 'Бишівська', query);
  assert.equal(outcome.summary.streetBuildingCount, 2, query);
  assert.equal(outcome.summary.matchedBuildingCount, 1, query);
  assert.equal(outcome.results[0].entityId, '2400', query);
  assert.equal(crmSearchIsPrimary(outcome, query), true, query);
}


const streetStart = queryCrmEntriesForTest('по всей Бышевской ЖЕК?', entries, { maxResults: 40 });
assert.equal(streetStart.nextActiveContext?.scope, 'street');
const streetFollowup = queryCrmEntriesForTest('а ключи?', entries, { activeContext: streetStart.nextActiveContext, maxResults: 40 });
assert.equal(streetFollowup.plan.scope, 'active_street');
assert.equal(streetFollowup.plan.street, 'Бишівська');
assert.ok(streetFollowup.results.some(row => row.entityId === '2400'));

const oldStreetAlias = queryCrmEntriesForTest('булгакова 8а ключи', entries, { maxResults: 40 });
assert.equal(oldStreetAlias.plan.scope, 'building');
assert.equal(oldStreetAlias.results[0].entityId, 'alias8a');

const globalHours = queryCrmEntriesForTest('составь список где ЖЕК до 17', entries, { maxResults: 40 });
assert.equal(globalHours.plan.scope, 'global_aggregate');
assert.ok(globalHours.results.some(row => row.entityId === '2400'));
assert.equal(globalHours.results.some(row => row.entityId === 'false17'), false, 'unrelated apartment 17 must not satisfy "ЖЕК до 17"');

const active = {
  entityType: 'building', entityId: '2693', address: 'Киев, вул. Сергія Данченка (Подільський), 32/А',
  url: '/building/2693', street: 'Сергія Данченка'
};
const vadimFollowup = queryCrmEntriesForTest('что слышно по вадиму?', entries, { activeContext: active, maxResults: 40 });
assert.equal(vadimFollowup.plan.scope, 'active_building');
assert.ok(vadimFollowup.results.every(row => row.entityId === '2693'), 'person follow-up must not jump to Вадима Гетьмана street');
assert.ok(vadimFollowup.results.some(row => /подготовит ключи/i.test(row.text)));

const simnetFollowup = queryCrmEntriesForTest('симнет', entries, { activeContext: active, maxResults: 40 });
assert.equal(simnetFollowup.plan.scope, 'active_building');
assert.ok(simnetFollowup.results.some(row => /ПЕРЕВОДИМО НА СІМНЕТ/i.test(row.text)));

const prompt = crmSearchPrompt(globalHours);
assert.match(prompt, /global_aggregate/);
assert.match(prompt, /UserSide building core-card index only/);



const semanticSnapshot = {
  schema: 'simnet-crm-building-snapshot-v1',
  buildings: [
    { id: 'm109', address: 'Киев, вул. Метрологічна (Голосіївський), 109', url: '/building/m109', fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'Gpon нет и не будет' }] },
    { id: 'm13', address: 'Киев, вул. Метрологічна (Голосіївський), 13', url: '/building/m13', fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'ЖЕК працює до 17-00. ПОНА НЕТ !!!! нет возможности' }] },
    { id: 'm15', address: 'Киев, вул. Метрологічна (Голосіївський), 15', url: '/building/m15', fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'Нет возможности подключать в правой шахте, PON бокс на 2 этаже, GPON да' }] },
    { id: 'deny1', address: 'Киев, вул. Білоруська, 21', url: '/building/deny1', fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'Сделана крыша и никого не пускают' }] },
    { id: 'ok1', address: 'Киев, вул. Тестова, 1', url: '/building/ok1', fields: [{ key: 'working_note', label: 'Рабочая заметка', text: 'Доступ свободный, ключи у диспетчера' }] }
  ]
};
const semanticEntries = snapshotToCrmEntries(semanticSnapshot);
const noOptics = queryCrmEntriesForTest('метрологическая улица, где нет оптики?', semanticEntries, { maxResults: 80 });
assert.equal(noOptics.plan.semantic, 'explicit_no_optics');
assert.deepEqual(new Set(noOptics.results.map(row => row.entityId)), new Set(['m109','m13']));
const denied = queryCrmEntriesForTest('в заметках перечень домов куда не пустили', semanticEntries, { maxResults: 80 });
assert.equal(denied.plan.semantic, 'access_denied');
assert.deepEqual(new Set(denied.results.map(row => row.entityId)), new Set(['deny1']));

const hugeSnapshot = {
  schema: 'simnet-crm-building-snapshot-v1',
  buildings: Array.from({ length: 80 }, (_, i) => ({
    id: `h${i}`,
    address: `Киев, вул. Велика Тестова, ${i + 1}`,
    url: `/building/h${i}`,
    fields: [{ key: 'working_note', label: 'Рабочая заметка', text: `ЖЕК працює до 17-00. ${'Длинная служебная заметка '.repeat(20)}` }]
  }))
};
const hugeEntries = snapshotToCrmEntries(hugeSnapshot);
const hugeOutcome = queryCrmEntriesForTest('составь список где ЖЕК до 17', hugeEntries, { maxResults: 80 });
const budgetedPrompt = crmSearchPrompt(hugeOutcome);
assert.ok(budgetedPrompt.length <= 6200, `CRM prompt budget exceeded: ${budgetedPrompt.length}`);
assert.match(budgetedPrompt, /promptTruncated/);

const backgroundSource = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
assert.doesNotMatch(backgroundSource, /function shouldSearchCrm\(/, 'hard-coded CRM routing gate must be removed');
assert.match(backgroundSource, /await queryCrmIndex\(message,/);
assert.match(backgroundSource, /crmPrimary/);
assert.match(backgroundSource, /!crmPrimary/);
assert.match(backgroundSource, /AI_CRM_SYSTEM_PROMPT/);
assert.match(backgroundSource, /crmPrimary \? AI_CRM_SYSTEM_PROMPT : AI_SYSTEM_PROMPT/);
assert.match(backgroundSource, /crmPrimary \? 'none' : aiReasoningEffortFor/);

console.log('PASS universal CRM natural-language query planner');
