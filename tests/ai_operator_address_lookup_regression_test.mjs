import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { searchBillingLive } from '../src/features/ai-operator/billing-live-search.js';
import { executeOperatorTool } from '../src/features/ai-operator/live-tool-runtime.js';

// Synthetic addresses only. Execute the actual serialized Chrome callback so the
// test covers street selection, native GET fields and source-backed candidates.
const STREET = 'просп. Героїв Мирної Долини (Тестове)';
const ADDRESS = 'проспект героів мирноі долини 42/7 кв 6\nЧому за цією адресою немає інтернету наразі?';

function billingHarness({ streets = [STREET], matches = () => ['70001'] } = {}) {
  const requests = [];
  const store = {};
  const savedChrome = globalThis.chrome;
  const emptyDoc = (fields = {}, links = []) => ({
    body: { textContent: 'Synthetic Billing page' },
    querySelector(selector) { return fields[selector] || null; },
    querySelectorAll(selector) { return selector === 'a[href]' ? links : []; }
  });
  const selected = (value, label) => ({ value, selectedIndex: 0, options: [{ value, textContent: label }] });
  const docs = new Map();
  let docId = 0;
  const fetchPage = async (value, options) => {
    const url = new URL(value);
    requests.push({ url, options });
    const action = url.searchParams.get('a');
    let doc;
    if (action === 'listuser' && !url.searchParams.has('f')) {
      doc = emptyDoc({ 'select[name="dopfield_5"]': {
        options: streets.map((label, index) => ({ value: String(index + 1), textContent: label }))
      } });
    } else if (action === 'listuser') {
      const links = matches(url.searchParams).map(id => ({
        getAttribute: () => `/cgi-bin/adm/adm.pl?a=user&id=${id}`,
        closest: () => ({ textContent: `Synthetic subscriber ${id}` })
      }));
      doc = emptyDoc({}, links);
    } else if (action === 'user') {
      doc = emptyDoc({
        '[name="name"]': { value: 'syntheticuser' },
        '[name="contract"]': { value: '700011' },
        '[name="fio"]': { value: 'Синтетичний Абонент' }
      });
    } else if (action === 'dopdata' && url.searchParams.get('tmpl') === '2') {
      const search = [...requests].reverse().find(r => r.url.searchParams.get('f') === 'd').url.searchParams;
      doc = emptyDoc({
        'select[name="dopfield_5"]': selected(search.get('dopfield_5'), streets[Number(search.get('dopfield_5')) - 1]),
        '[name="dopfield_6"]': { value: search.get('dopfield_6') },
        '[name="dopfield_11"]': { value: search.get('dopfield_11') || '' },
        '[name="dopfield_8"]': { value: search.get('dopfield_8') || '' }
      });
    } else {
      doc = emptyDoc();
    }
    const html = `synthetic-document-${++docId}`;
    docs.set(html, doc);
    return {
      ok: true, status: 200, url: url.href,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => new TextEncoder().encode(html).buffer
    };
  };
  const context = {
    URL, TextDecoder, Uint8Array, fetch: fetchPage,
    CSS: { escape: value => value },
    location: { hostname: 'admin.simnet.kiev.ua', origin: 'https://admin.simnet.kiev.ua', href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?pp=synthetic-session' },
    document: emptyDoc(),
    DOMParser: class { parseFromString(html) { return docs.get(html); } }
  };
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 1, active: true }] },
    scripting: { executeScript: async ({ func, args }) => {
      const result = await vm.runInNewContext(`(${func.toString()})(request)`, { ...context, request: args[0] });
      return [{ result: JSON.parse(JSON.stringify(result)) }];
    } },
    storage: { local: {
      get: async () => store,
      set: async patch => Object.assign(store, patch)
    } }
  };
  return {
    requests, store,
    searches: () => requests.filter(r => r.url.searchParams.get('f') === 'd'),
    restore() {
      if (savedChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = savedChrome;
    }
  };
}

test('Ukrainian і/ї and street abbreviations match the real Billing street option', async () => {
  const harness = billingHarness();
  try {
    const result = await searchBillingLive({ address: 'проспект героів мирноі долини, буд. 42, кв. 6' });
    assert.equal(result.ok, true);
    assert.equal(result.code, 'OK');
    assert.equal(result.addressResolution.street, STREET);
    assert.equal(harness.searches()[0].url.searchParams.get('dopfield_5'), '1');
  } finally { harness.restore(); }
});

test('unlabelled slash house is tried literally, then as house/block only after no match', async () => {
  const harness = billingHarness({ matches: params => params.get('dopfield_6') === '42' && params.get('dopfield_11') === '7' ? ['70001'] : [] });
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.ok, true);
    assert.equal(result.code, 'OK');
    assert.deepEqual(result.addressResolution, { street: STREET, building: '42', block: '7', apartment: '6' });
    const searches = harness.searches();
    assert.equal(searches.length, 2);
    assert.equal(searches[0].url.searchParams.get('dopfield_6'), '42/7');
    assert.equal(searches[1].url.searchParams.get('dopfield_6'), '42');
    assert.equal(searches[1].url.searchParams.get('dopfield_11'), '7');
    assert.equal(searches[1].url.searchParams.get('dopfield_8'), '6');
    for (const request of harness.requests) {
      assert.equal(request.options.method, 'GET');
      assert.equal(request.options.credentials, 'include');
    }
  } finally { harness.restore(); }
});

test('a literal slash house result prevents an unnecessary broader second search', async () => {
  const harness = billingHarness();
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.code, 'OK');
    assert.equal(result.addressResolution.building, '42/7');
    assert.equal(harness.searches().length, 1);
  } finally { harness.restore(); }
});

test('an address candidate stays pending until subscriber confirmation', async () => {
  const harness = billingHarness();
  try {
    const result = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: { address: ADDRESS }, labState: {} });
    assert.equal(result.ok, true);
    assert.equal(result.data.requiresConfirmation, true);
    assert.equal(result.statePatch.confirmedCaseId, '');
    assert.equal(result.statePatch.confirmedSubscriber, null);
    assert.equal(result.statePatch.pendingCandidate.billingId, '70001');
  } finally { harness.restore(); }
});

test('no subscriber match exhausts at most two address forms and invents no candidate', async () => {
  const harness = billingHarness({ matches: () => [] });
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.code, 'NOT_FOUND');
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.snapshots, {});
    assert.equal(harness.searches().length, 2);
  } finally { harness.restore(); }
});

test('same street in two localities remains ambiguous when locality is not supplied', async () => {
  const harness = billingHarness({ streets: [STREET, 'просп. Героїв Мирної Долини (Інше Тестове)'] });
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ADDRESS_STREET_AMBIGUOUS');
    assert.equal(harness.searches().length, 0);
  } finally { harness.restore(); }
});

test('unknown street fails without a subscriber search or fabricated snapshots', async () => {
  const harness = billingHarness({ streets: ['вул. Зовсім Інша (Тестове)'] });
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.code, 'ADDRESS_STREET_NOT_FOUND');
    assert.equal(harness.searches().length, 0);
    assert.equal(result.snapshots, undefined);
  } finally { harness.restore(); }
});

test('native address fields accept common house, block and apartment spellings', async t => {
  for (const [address, building, block, apartment] of [
    ['вул. Тестова 42 кв.6', '42', '', '6'],
    ['вул. Тестова, буд.42, кв. 6', '42', '', '6'],
    ['вул. Тестова 42, корпус 7, квартира 6', '42', '7', '6'],
    ['вул. Тестова, дом 42, блок Б, кв.6', '42', 'Б', '6'],
    ['вул. Тестова 42/Б кв 6', '42/Б', '', '6'],
    ['вул. Тестова, буд. 42Б, кв. 6', '42Б', '', '6'],
    ['вул. Тестова 42 Чому немає інтернету?', '42', '', ''],
    ['вул. Квартальна 42, кв. 6', '42', '', '6'],
    ['вул. Корпусна 42, кв. 6', '42', '', '6'],
    ['вул. 40 Років Тестування 42, кв. 6', '42', '', '6'],
    ['вул. Тестова 42 Чому нарахували 100', '42', '', '']
  ]) {
    await t.test(address, async () => {
      const street = address.match(/^вул\. ([\p{L}\s]+|40 Років Тестування)(?=[,\s]+(?:\d|буд|дом))/u)?.[1]?.trim();
      const harness = billingHarness({ streets: [`вул. ${street} (Тестове)`] });
      try {
        const result = await searchBillingLive({ address });
        assert.equal(result.code, 'OK');
        const params = harness.searches()[0].url.searchParams;
        assert.equal(params.get('dopfield_6'), building);
        assert.equal(params.get('dopfield_11') || '', block);
        assert.equal(params.get('dopfield_8') || '', apartment);
      } finally { harness.restore(); }
    });
  }
});

test('apartment number never substitutes for a missing house', async () => {
  const harness = billingHarness({ streets: ['вул. Тестова (Тестове)'] });
  try {
    const result = await searchBillingLive({ address: 'вул. Тестова, кв.6' });
    assert.equal(result.code, 'ADDRESS_BUILDING_REQUIRED');
    assert.equal(harness.searches().length, 0);
  } finally { harness.restore(); }
});

test('a question amount never substitutes for a missing house', async () => {
  const harness = billingHarness({ streets: ['вул. Тестова (Тестове)'] });
  try {
    const result = await searchBillingLive({ address: 'вул. Тестова Чому нарахували 100' });
    assert.equal(result.code, 'ADDRESS_BUILDING_REQUIRED');
    assert.equal(harness.searches().length, 0);
  } finally { harness.restore(); }
});

test('multiple subscriber matches remain ambiguous and cannot establish canonical identity', async () => {
  const harness = billingHarness({ matches: () => ['70001', '70002'] });
  try {
    const result = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: { address: ADDRESS }, labState: {} });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'AMBIGUOUS_IDENTITY');
    assert.deepEqual(result.statePatch, {});
    assert.equal(harness.searches().length, 1);
  } finally { harness.restore(); }
});

test('source street aliases, abbreviations and compound houses share the building normalizer', async t => {
  const boulevard = 'м. Київ, б-р. Синтетичного Майстра (Солом\\`янський) (Давня Тестова)';
  const descent = 'м. Київ, Синтетичний узвіз (Подільський)';
  for (const [label, address, house] of [
    [boulevard, 'БУЛЬВАР синтетичного майстра 42 / 3А кв.6', '42/3А'],
    [boulevard, 'м. Київ, б-р. Синтетичного Майстра, 42/Б, квартира 6', '42/Б'],
    [boulevard, 'Давня Тестова 42/3А кв 6', '42/3А'],
    [boulevard, 'Давня Тестова, буд. 42/Б/2, кв. 6', '42/Б/2'],
    [boulevard, 'Давня Тестова 42/Б/2 кв.6', '42/Б/2'],
    [descent, 'Синтетичний узвіз 42/8 кв. 6', '42/8'],
    [boulevard, 'Давня Тестова, будинок №42/Б/2, кв. №6', '42/Б/2'],
    [boulevard, '«Давня Тестова 42/Б/2» кв.6', '42/Б/2']
  ]) {
    await t.test(address, async () => {
      const harness = billingHarness({ streets: [label] });
      try {
        const result = await searchBillingLive({ address });
        assert.equal(result.code, 'OK');
        assert.equal(result.addressResolution.street, label);
        assert.equal(result.addressResolution.building, house);
        assert.equal(harness.searches().length, 1);
        assert.equal(harness.requests.filter(r => !r.url.searchParams.has('f') && r.url.searchParams.get('a') === 'listuser').length, 1);
      } finally { harness.restore(); }
    });
  }
});

test('district annotation is not a street alias', async () => {
  const harness = billingHarness({ streets: ['м. Київ, б-р. Синтетичного Майстра (Солом\\`янський) (Давня Тестова)'] });
  try {
    const result = await searchBillingLive({ address: 'Соломянський 42, кв.6' });
    assert.equal(result.code, 'ADDRESS_STREET_NOT_FOUND');
    assert.equal(harness.searches().length, 0);
  } finally { harness.restore(); }
});

test('Latin A house suffix reuses the existing Cyrillic house-equivalence rule', async () => {
  const harness = billingHarness({ streets: ['вул. Тестова (Тестове)'], matches: params => params.get('dopfield_6') === '42' && params.get('dopfield_11') === 'А' ? ['70001'] : [] });
  try {
    const result = await searchBillingLive({ address: 'вул. Тестова 42A кв.6' });
    assert.equal(result.code, 'OK');
    assert.equal(result.addressResolution.block, 'А');
    assert.equal(harness.searches().length, 2);
  } finally { harness.restore(); }
});
