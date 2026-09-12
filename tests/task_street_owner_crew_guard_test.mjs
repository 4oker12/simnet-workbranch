import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rules = require('../src/core/task-street-owner-rules.js');
const uiSource = fs.readFileSync(new URL('../src/ui/task-street-owner-crew-guard.js', import.meta.url), 'utf8');
const contextSource = fs.readFileSync(new URL('../src/ui/task-street-owner-context.js', import.meta.url), 'utf8');
const coreSource = fs.readFileSync(new URL('../src/core/task-street-owner-rules.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const B1 = '33333333-3333-4333-8333-333333333333';
const required = rules.requiredCrew;

function owner(id, name, uuid = '') {
  return { id, name, uuid };
}

function fakeOwnerDocument(rows) {
  return {
    querySelectorAll(selector) {
      if (selector !== '.erp-object-props__row') return [];
      return rows.map(row => ({
        querySelector(sel) {
          if (sel === '.erp-object-props__label-main') return { textContent: row.label };
          if (sel === 'select[name^="owner_uuid"]' && row.select) {
            return {
              value: row.select.uuid,
              selectedOptions: [{ textContent: row.select.name }]
            };
          }
          return null;
        },
        querySelectorAll(sel) {
          if (sel !== 'a[href^="/owner/"]') return [];
          return (row.anchors || []).map(anchor => ({
            textContent: anchor.name,
            getAttribute(name) { return name === 'href' ? anchor.href : ''; }
          }));
        }
      }));
    }
  };
}

test('1. street without owner does not trigger territory rule', () => {
  assert.deepEqual(rules.classifyTerritory([]).territory, '');
});

test('2. owner /owner/148 triggers SOVKI', () => {
  assert.equal(rules.classifyTerritory([owner('148', 'anything')]).territory, 'SOVKI');
});

test('3. owner /owner/171 triggers SOVKI', () => {
  assert.equal(rules.classifyTerritory([owner('171', 'anything')]).territory, 'SOVKI');
});

test('4. owner name "Масив Совки" triggers SOVKI', () => {
  assert.equal(rules.classifyTerritory([owner('', 'Масив Совки')]).territory, 'SOVKI');
});

test('5. owner name "Массив Совки" triggers SOVKI', () => {
  assert.equal(rules.classifyTerritory([owner('', 'Массив Совки')]).territory, 'SOVKI');
});

test('6. several owners trigger SOVKI when one owner matches', () => {
  const result = rules.classifyTerritory([
    owner('35', 'STARGROUP'),
    owner('148', 'Масив Совки'),
    owner('999', 'Other')
  ]);
  assert.equal(result.territory, 'SOVKI');
});

test('7. unrelated owner does not trigger SOVKI', () => {
  assert.equal(rules.classifyTerritory([owner('35', 'STARGROUP')]).territory, '');
});

test('8. changing house on same street reuses street cache without extra fetch', async () => {
  let loads = 0;
  const cache = rules.createStreetContextCache(async (streetUuid, source) => {
    loads += 1;
    const classified = rules.classifyTerritory([owner('148', 'Масив Совки')]);
    return { streetUuid, streetName: source.streetName, owners: [owner('148', 'Масив Совки')], ...classified };
  });

  const first = await cache.get(S1, { streetName: 'Street A', buildingUuid: B1 });
  const second = await cache.get(S1, { streetName: 'Street A', buildingUuid: '44444444-4444-4444-8444-444444444444' });
  assert.equal(loads, 1);
  assert.equal(first, second);
});

test('9. changing street invalidates current context and loads the new street', async () => {
  let loads = 0;
  const cache = rules.createStreetContextCache(async streetUuid => {
    loads += 1;
    return { owners: [], territory: '', requiredCrew: null, streetName: streetUuid === S1 ? 'A' : 'B' };
  });
  const first = await cache.get(S1, {});
  const second = await cache.get(S2, {});
  assert.equal(loads, 2);
  assert.equal(first.streetUuid, S1);
  assert.equal(second.streetUuid, S2);
  assert.notEqual(first.streetUuid, second.streetUuid);
});

test('10. SOVKI with required crew allows save', () => {
  const decision = rules.evaluateCrewRule({
    status: 'ready', territory: 'SOVKI', owners: [owner('148', 'Масив Совки')], requiredCrew: required
  }, [{ uuid: required.uuid, name: required.name }]);
  assert.equal(decision.matched, true);
  assert.equal(decision.issues.length, 0);
});

test('11. SOVKI with wrong crew blocks save', () => {
  const decision = rules.evaluateCrewRule({
    status: 'ready', territory: 'SOVKI', owners: [owner('171', 'Массив Совки')], requiredCrew: required
  }, [{ uuid: '55555555-5555-4555-8555-555555555555', name: 'Бр. 9.9' }]);
  assert.equal(decision.matched, false);
  assert.equal(decision.issues[0]?.code, 'street-owner-crew-mismatch');
  assert.match(decision.issues[0]?.message || '', /Бр\. 2\.1 ВЛ/);
});

test('12. ordinary street leaves existing save path untouched', () => {
  const decision = rules.evaluateCrewRule({ status: 'ready', territory: '', owners: [owner('35', 'STARGROUP')] }, []);
  assert.equal(decision.applies, false);
  assert.equal(decision.issues.length, 0);
});

test('13. loader/parser failure is fail-open and never becomes false SOVKI', async () => {
  const cache = rules.createStreetContextCache(async () => { throw new Error('HTTP 500'); });
  const context = await cache.get(S1, { streetName: 'Street A' });
  const decision = rules.evaluateCrewRule(context, []);
  assert.equal(context.status, 'error');
  assert.equal(context.territory, '');
  assert.equal(decision.failOpen, true);
  assert.equal(decision.issues.length, 0);
});

test('owner parser uses exact property row and every /owner/ link, taking id from href', () => {
  const doc = fakeOwnerDocument([
    { label: 'Other', anchors: [{ href: '/owner/999', name: 'Nope' }] },
    {
      label: '  Собственник  ',
      anchors: [
        { href: '/owner/35', name: 'STARGROUP' },
        { href: '/owner/148', name: 'Масив Совки' },
        { href: '/owner/171', name: 'Массив Совки' }
      ]
    }
  ]);
  assert.deepEqual(rules.parseOwnersDocument(doc).map(item => [item.id, item.name]), [
    ['35', 'STARGROUP'], ['148', 'Масив Совки'], ['171', 'Массив Совки']
  ]);
  assert.match(coreSource, /\.erp-object-props__row/);
  assert.match(coreSource, /\.erp-object-props__label-main/);
  assert.match(coreSource, /a\[href\^="\/owner\/"\]/);
});

test('street resolver uses the real UserSide [Street] item, not the selected house uuid', () => {
  const result = rules.resolveStreetSelection([
    { uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Киев [City]' },
    { uuid: S1, label: 'вул. Володимира Брожка [Street]' },
    { uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: '12/А [House]' }
  ]);
  assert.equal(result.streetUuid, S1);
  assert.equal(result.streetName, 'вул. Володимира Брожка');
});

test('runtime uses proven UserSide routes, no keyup polling, and blocks through submit capture', () => {
  assert.match(contextSource, /\/task\/load_building_work_description/);
  assert.match(contextSource, /\/building\/\$\{encodeURIComponent\(uuid\)\}\/building_level/);
  assert.match(contextSource, /\/building\/\$\{encodeURIComponent\(building\.id\)\}/);
  assert.match(contextSource, /\/building\/\$\{encodeURIComponent\(building\.id\)\}\/edit/);
  assert.match(uiSource, /document\.addEventListener\('submit',onSubmit,true\)/);
  assert.match(contextSource, /document\.addEventListener\('change',onChange,true\)/);
  assert.doesNotMatch(contextSource + uiSource, /keyup/);
  assert.doesNotMatch(contextSource + uiSource, /setInterval/);
});


test('manifest loads street rules and save guard before the existing task form assistant', () => {
  const scripts = manifest.content_scripts?.[0]?.js || [];
  const core = scripts.indexOf('src/core/task-street-owner-rules.js');
  const context = scripts.indexOf('src/ui/task-street-owner-context.js');
  const guard = scripts.indexOf('src/ui/task-street-owner-crew-guard.js');
  const assistant = scripts.indexOf('src/ui/task-form-assistant.js');
  assert.ok(core >= 0);
  assert.ok(context > core);
  assert.ok(guard > context);
  assert.ok(assistant > guard);
});

test('runtime source compiles and pins the proven Sovki crew identity', () => {
  assert.doesNotThrow(() => new Function(contextSource));
  assert.doesNotThrow(() => new Function(uiSource));
  assert.equal(required.id, '13');
  assert.equal(required.uuid, 'c2e9fc30-f22d-4317-a039-30ea3deac875');
  assert.equal(required.name, 'Бр. 2.1 ВЛ');
});
