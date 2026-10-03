import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { searchBillingLive } from '../src/features/ai-operator/billing-live-search.js';
import { executeOperatorTool } from '../src/features/ai-operator/live-tool-runtime.js';
import { requestBillingCapture } from '../src/features/ai-operator/billing-login-live.js';

// Synthetic addresses only. Execute the actual serialized Chrome callback so the
// test covers street selection, native GET fields and source-backed candidates.
const STREET = 'просп. Героїв Мирної Долини (Тестове)';
const ADDRESS = 'проспект героів мирноі долини 42/7 кв 6\nЧому за цією адресою немає інтернету наразі?';
const captureSource = readFileSync(new URL('../src/features/ai-operator/billing-snapshot-capture.js', import.meta.url), 'utf8');

function billingHarness({ streets = [STREET], matches = () => ['70001'], renderedSelect = null, auth = false, formMissing = false, formTimeout = false, enhancedStreetWidget = false, rawDictionaryFails = false } = {}) {
  const requests = [];
  const store = {};
  const injections = [];
  const nodes = new Set();
  const timers = new Set();
  const savedChrome = globalThis.chrome;
  const emptyDoc = (fields = {}, links = []) => ({
    body: { textContent: 'Synthetic Billing page' },
    querySelector(selector) { return fields[selector] || null; },
    querySelectorAll(selector) { return selector === 'a[href]' ? links : []; }
  });
  const selected = (value, label) => ({ value, selectedIndex: 0, options: [{ value, textContent: label }] });
  const docs = new Map();
  const streetOptions = streets.map((street, index) => typeof street === 'string'
    ? { value: String(index + 1), textContent: street, label: street }
    : { ...street });
  let docId = 0;
  const fetchPage = async (value, options) => {
    const url = new URL(value);
    requests.push({ url, options });
    const action = url.searchParams.get('a');
    let doc;
    if (action === 'listuser' && !url.searchParams.has('f')) {
      assert.equal(url.searchParams.get('tmpl'), '2', 'dictionary must use the native address template');
      const rawRead = !options.transport;
      if (rawRead && rawDictionaryFails) throw new Error('synthetic dictionary transport failed');
      if (!rawRead) assert.equal(options.transport, 'native-form-submit-hidden-iframe', 'address dictionary must load in the native bridge');
      doc = emptyDoc(auth ? { 'input[type="password"]': {} } : formMissing ? {} : { 'select[name="dopfield_5"]': { options: enhancedStreetWidget && !rawRead ? [{value:'',label:'',textContent:''}] : streetOptions } });
    } else if (action === 'listuser') {
      assert.equal(options.transport, 'native-form-submit-hidden-iframe', 'address search must use native GET form-submit');
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
      const sourceStreet = streetOptions.find(option => option.value === search.get('dopfield_5'));
      doc = emptyDoc({
        'select[name="dopfield_5"]': selected(search.get('dopfield_5'), sourceStreet?.label || sourceStreet?.textContent || 'вул. Синтетична'),
        '[name="dopfield_6"]': { value: search.get('dopfield_6') },
        '[name="dopfield_11"]': { value: search.get('dopfield_11') || '' },
        '[name="dopfield_8"]': { value: search.get('dopfield_8') || '' }
      });
    } else {
      doc = emptyDoc();
    }
    const html = `synthetic-document-${++docId}`;
    doc.documentElement = { outerHTML: html };
    doc.characterSet = 'windows-1251';
    docs.set(html, doc);
    return {
      ok: true, status: 200, url: url.href,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      doc
    };
  };
  function createElement(tag) {
    const listeners = new Map();
    const element = {
      tagName: tag.toUpperCase(), style: {}, children: [],
      setAttribute() {}, append(...children) { this.children.push(...children); },
      addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type) { listeners.delete(type); },
      remove() { nodes.delete(this); }
    };
    if (tag === 'iframe') element.contentWindow = { location: { href: 'about:blank' } };
    if (tag === 'form') element.requestSubmit = () => {
      if (formTimeout) return;
      const url = new URL(element.action);
      for (const field of element.children) if (field.name) url.searchParams.set(field.name, field.value);
      const iframe = [...nodes].find(node => node.name === element.target);
      void fetchPage(url.href, { method: element.method.toUpperCase(), credentials: 'include', transport: 'native-form-submit-hidden-iframe' }).then(response => {
        iframe.contentWindow.location.href = response.url;
        iframe.contentDocument = response.doc;
        iframe.notifyLoad();
      });
    };
    element.notifyLoad = () => listeners.get('load')?.();
    return element;
  }
  const document = {
    ...emptyDoc(renderedSelect ? { 'select[name="dopfield_5"]': renderedSelect } : {}),
    createElement,
    documentElement: { append(...elements) { elements.forEach(element => nodes.add(element)); } }
  };
  let bridgeListener = null;
  const context = {
    URL, TextDecoder, Uint8Array, AbortController, fetch: fetchPage,
    URLSearchParams,
    CSS: { escape: value => value },
    location: { hostname: 'admin.simnet.kiev.ua', origin: 'https://admin.simnet.kiev.ua', href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?pp=synthetic-session', search: '?pp=synthetic-session' },
    document,
    window: {
      setTimeout(callback, delay) { const id = setTimeout(callback, formTimeout ? 0 : delay); timers.add(id); return id; },
      clearTimeout(id) { clearTimeout(id); timers.delete(id); }
    },
    DOMParser: class { parseFromString(html) { return docs.get(html); } }
  };
  const bridgeContext = vm.createContext(context);
  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 1, active: true }],
      sendMessage: async (_tabId, message) => {
        if (!bridgeListener) return undefined;
        return new Promise(resolve => {
          if (!bridgeListener(message, {}, resolve)) resolve(undefined);
        });
      }
    },
    runtime: { onMessage: {
      addListener(listener) { bridgeListener = listener; },
      removeListener(listener) { if (bridgeListener === listener) bridgeListener = null; }
    } },
    scripting: { executeScript: async ({ func, args, files, world }) => {
      injections.push({ files, world });
      if (files) {
        assert.deepEqual(files, ['src/features/ai-operator/billing-snapshot-capture.js']);
        vm.runInContext(captureSource, bridgeContext);
        return [{ result: undefined }];
      }
      const result = await vm.runInNewContext(`(${func.toString()})(...requestArgs)`, { ...context, requestArgs: args || [] });
      return [{ result: JSON.parse(JSON.stringify(result)) }];
    } },
    storage: { local: {
      get: async () => store,
      set: async patch => Object.assign(store, patch)
    } }
  };
  context.chrome = globalThis.chrome;
  return {
    requests, store, injections, nodes, timers,
    searches: () => requests.filter(r => r.url.searchParams.get('f') === 'd'),
    restore() {
      for (const timer of timers) clearTimeout(timer);
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

test('address lookup loads the current native bridge once and cleans every temporary form', async () => {
  const harness = billingHarness();
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.code, 'OK');
    assert.equal(harness.injections.filter(item => item.files).length, 1);
    assert.equal(result.addressSearch.nativeOptionCount, 1);
    assert.equal(result.addressSearch.characterSet, 'windows-1251');
    assert.equal(result.transport, 'native-form-submit-hidden-iframe');
    assert.equal(harness.nodes.size, 0);
    assert.equal(harness.timers.size, 0);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-session/);
  } finally { harness.restore(); }
});

test('Russian spelling and bounded typos resolve only to a source street', async t => {
  for (const [street, address] of [
    [STREET, 'проспект Героев Мирной Долини 42/7 кв.6'],
    [STREET, 'по адресу пр-т Героїв Мирної Долини 42/7, кв.6 мне нужно найти абонента'],
    ['вул. Сергія Синтетичного (Тестове)', 'Сергеая синтетичного 42А кв 6'],
    ['вул. Сергія Синтетичного (Тестове)', 'Сергея Синтетичного 42А кв.6'],
    ['вул. Тестова (Тестове)', 'Тистова 42 кв.6'],
    ['--- просп. Героїв Мирної Долини (Тестове)', 'проспект Героїв Мирної Долини 42 кв.6'],
    ['пер. Синтетичний (Тестове)', 'провулок Синтетичний 42 кв.6']
  ]) await t.test(address, async () => {
    const harness = billingHarness({ streets: [street] });
    try {
      const result = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: { address }, labState: {} });
      assert.equal(result.code, 'OK');
      assert.equal(result.data.candidate.address.startsWith(street), true);
      assert.equal(result.data.requiresConfirmation, true);
      assert.equal(result.statePatch.confirmedSubscriber, null);
      assert.equal(result.statePatch.confirmedCaseId, '');
      assert.equal(harness.searches().length, 1);
    } finally { harness.restore(); }
  });
});

test('option label and the literal source value are preserved by the native address form', async () => {
  const harness = billingHarness({ streets: [{ value: 'вул. Синтетична', label: 'вул. Тестова (Тестове)', textContent: '' }] });
  try {
    const result = await searchBillingLive({ address: 'Тестова 42 кв.6' });
    assert.equal(result.code, 'OK');
    assert.equal(harness.searches()[0].url.searchParams.get('dopfield_5'), 'вул. Синтетична');
    assert.equal(result.addressResolution.street, 'вул. Тестова (Тестове)');
  } finally { harness.restore(); }
});

test('empty or placeholder-only dictionaries report unavailable evidence, not a missing street', async t => {
  for (const streets of [[], [{ value: '', label: '---', textContent: '---' }], [{ value: '0', textContent: '--- Оберіть вулицю ---' }]]) {
    await t.test(`options: ${streets.length}`, async () => {
      const harness = billingHarness({ streets });
      try {
        const result = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: { address: ADDRESS } });
        assert.equal(result.code, 'BILLING_STREET_DICTIONARY_UNAVAILABLE');
        assert.equal(result.data.addressSearch.stage, 'street-selection');
        assert.match(result.data.message, /нельзя заключить/);
        assert.deepEqual(result.statePatch, {});
        assert.equal(harness.searches().length, 0);
        assert.deepEqual(harness.store, {});
      } finally { harness.restore(); }
    });
  }
});

test('an initialized selectize dictionary supplies real options absent from the static select', async () => {
  const harness = billingHarness({ streets: [], renderedSelect: {
    options: [], selectize: { settings: { valueField: 'id', labelField: 'name' }, options: { synthetic: { id: '73', name: STREET } } }
  } });
  try {
    const result = await searchBillingLive({ address: ADDRESS });
    assert.equal(result.code, 'OK');
    assert.equal(harness.searches()[0].url.searchParams.get('dopfield_5'), '73');
    assert.equal(result.addressSearch.renderedOptionCount, 1);
    assert.equal(harness.injections.filter(item => item.world === 'MAIN').length, 1);
    assert.equal(harness.requests.filter(r => r.url.searchParams.get('a') === 'listuser' && !r.url.searchParams.has('f')).length, 2);
  } finally { harness.restore(); }
});

test('several plausible typo matches require clarification even with different edit distances', async () => {
  const harness = billingHarness({ streets: ['вул. Сергія Синтетичного (Тестове)', 'вул. Сергея Синтетичного (Тестове)'] });
  try {
    const result = await searchBillingLive({ address: 'Сергеая Синтетичного 42А кв.6' });
    assert.equal(result.code, 'ADDRESS_STREET_AMBIGUOUS');
    assert.equal(result.streets.length, 2);
    assert.equal(harness.searches().length, 0);
  } finally { harness.restore(); }
});

test('an exact street name wins over its fuzzy neighbour', async () => {
  const harness = billingHarness({ streets: ['вул. Тестова (Тестове)', 'вул. Тестева (Тестове)'] });
  try {
    const result = await searchBillingLive({ address: 'Тестова 42 кв.6' });
    assert.equal(result.code, 'OK');
    assert.equal(harness.searches()[0].url.searchParams.get('dopfield_5'), '1');
  } finally { harness.restore(); }
});

test('explicit locality disambiguates otherwise identical source street names', async () => {
  const harness = billingHarness({ streets: ['вул. Тестова (Тестовий Схід)', 'вул. Тестова (Тестовий Захід)'] });
  try {
    const result = await searchBillingLive({ address: 'Тестова (Тестовий Захід), буд.42 кв.6' });
    assert.equal(result.code, 'OK');
    assert.equal(harness.searches()[0].url.searchParams.get('dopfield_5'), '2');
  } finally { harness.restore(); }
});

test('unrelated street tokens and numeric street differences cannot manufacture a lookup', async t => {
  for (const [street, address] of [
    [STREET, 'Героїв Сонячної Долини, буд.42, кв.6'],
    ['вул. 22-а Синтетична (Тестове)', '23-а Синтетична, буд.42, кв.6'],
    ['вул. Тестова (Тестове)', 'Тстива 42 кв.6']
  ]) await t.test(address, async () => {
    const harness = billingHarness({ streets: [street] });
    try {
      const result = await searchBillingLive({ address });
      assert.equal(result.code, 'ADDRESS_STREET_NOT_FOUND');
      assert.equal(result.snapshots, undefined);
      assert.equal(harness.searches().length, 0);
    } finally { harness.restore(); }
  });
});

test('native form absence, authentication and timeout stay separate from subscriber absence', async t => {
  for (const [config, code] of [
    [{ formMissing: true }, 'BILLING_ADDRESS_FORM_UNAVAILABLE'],
    [{ auth: true }, 'BILLING_AUTH_REQUIRED'],
    [{ formTimeout: true }, 'BILLING_SEARCH_EXECUTION_FAILED']
  ]) await t.test(code, async () => {
    const harness = billingHarness(config);
    try {
      const result = await searchBillingLive({ address: ADDRESS });
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
      assert.equal(harness.searches().length, 0);
      assert.equal(harness.nodes.size, 0);
      assert.equal(harness.timers.size, 0);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-session/);
    } finally { harness.restore(); }
  });
});

test('native address bridge ignores injected actions and forwards only the READ address fields', async () => {
  const harness = billingHarness();
  try {
    await searchBillingLive({ address: ADDRESS });
    const result = await chrome.tabs.sendMessage(1, { type: 'SIMNET_AI_BILLING_ADDRESS_READ_V2', request: {
      phase: 'search', params: { a: 'saveuser', save: '1', pp: 'untrusted', dopfield_5: '1', dopfield_6: '42' }
    } });
    assert.equal(result.ok, true);
    const request = harness.searches().at(-1).url.searchParams;
    assert.equal(request.get('a'), 'listuser');
    assert.equal(request.get('pp'), 'synthetic-session');
    assert.equal(request.has('save'), false);
    assert.equal(request.get('dopfield_full_5'), '1');
  } finally { harness.restore(); }
});

test('shared bridge retains exact identity messages and performs at most one reinjection', async () => {
  const savedChrome = globalThis.chrome;
  const messages = [];
  const injections = [];
  globalThis.chrome = {
    tabs: { sendMessage: async (tabId, message) => {
      messages.push({ tabId, message });
      if (messages.length === 1) throw new Error('Synthetic old content bridge');
      return { ok: true, code: 'OK', candidates: [] };
    } },
    scripting: { executeScript: async request => { injections.push(request); return []; } }
  };
  try {
    const request = { mode: 'contract', value: '700011' };
    const result = await requestBillingCapture(7, request);
    assert.equal(result.ok, true);
    assert.equal(result.bridgeRecovered, true);
    assert.equal(injections.length, 1);
    assert.equal(messages.length, 2);
    for (const item of messages) assert.deepEqual(item, { tabId: 7, message: { type: 'SIMNET_AI_BILLING_EXACT_LOOKUP_V3', request } });
  } finally {
    if (savedChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = savedChrome;
  }
});


test('enhanced street widget cannot erase the dictionary from address lookup', async () => {
 const harness=billingHarness({enhancedStreetWidget:true});
 try {
  const result=await searchBillingLive({address:ADDRESS});
  assert.equal(result.code,'OK');
  assert.equal(result.addressSearch.dictionarySource,'native-address-form-raw-response');
  assert.equal(result.addressSearch.rawReadCode,'OK');
  assert.equal(result.addressSearch.usableOptionCount,1);
  assert.equal(harness.requests.filter(r=>!r.options.transport && r.url.searchParams.get('a')==='listuser').length,1);
  assert.equal(harness.nodes.size,0);assert.equal(harness.timers.size,0);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-session/);
 } finally {harness.restore();}
});

test('failed raw dictionary recovery stays unknown and never searches a guessed street ID', async () => {
 const harness=billingHarness({enhancedStreetWidget:true,rawDictionaryFails:true});
 try {
  const result=await searchBillingLive({address:ADDRESS});
  assert.equal(result.code,'BILLING_STREET_DICTIONARY_UNAVAILABLE');
  assert.equal(result.addressSearch.rawReadCode,'FAILED');
  assert.equal(harness.searches().length,0);assert.equal(harness.timers.size,0);
 } finally {harness.restore();}
});
