import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmcTechnicalExpectation } from '../src/workflows/pon.js';

const storageData = {};
let canonicalWrites = 0;
const listeners = [];
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(storageData);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(k => k in storageData).map(k => [k, structuredClone(storageData[k])]));
      },
      async set(patch) {
        if ('simnet_workbench_state_v5' in patch) canonicalWrites += 1;
        for (const [key, value] of Object.entries(patch)) storageData[key] = structuredClone(value);
      },
      async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete storageData[key]; }
    },
    onChanged: { addListener(){}, removeListener(){} }
  },
  runtime: {
    id: 'arch-behavior-test',
    onMessage: { addListener(fn){ listeners.push(fn); } },
    onInstalled: { addListener(){} }, onStartup: { addListener(){} }
  },
  tabs: {
    onRemoved: { addListener(){} }, async query(){ return []; },
    async update(id, patch){ return { id, ...patch }; }, async create(patch){ return { id: 90, ...patch }; },
    async get(id){ return { id, windowId: 1, url: 'https://admin.simnet.kiev.ua/' }; }
  },
  windows: { async update(id, patch){ return { id, ...patch }; } },
  action: { async setBadgeText(){}, async setBadgeBackgroundColor(){} },
  scripting: { async executeScript(){} }
};
globalThis.addEventListener = () => {};
await import(pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href + `?behavior=${Date.now()}`);
assert.equal(listeners.length, 1);
const listener = listeners[0];

const fact = value => ({ value, source: 'test', confidence: 0.99 });
const sender = (tabId, documentId, url) => ({ tab: { id: tabId, windowId: 1, url }, frameId: 0, documentId, url });
function send(type, payload, source) {
  return new Promise((resolve, reject) => {
    const handled = listener({ type, payload }, source, response => response?.success ? resolve(response.data) : reject(new Error(response?.error || type)));
    assert.equal(handled, true, `${type} must be handled`);
  });
}
const envelope = (eventId, doc, page, extra = {}) => ({
  eventId, occurredAt: new Date().toISOString(), origin: { documentId: doc, pageInstanceId: page, pageInstanceStartedAt: 1 }, ...extra
});

const billingUrl = 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=100';
const billingSender = sender(10, 'billing-user-doc', billingUrl);
const baseIdentity = { login: fact('abon1000'), contract: fact('1000'), billingId: fact('100') };
const baseNetwork = { connectionFamily: fact('PON'), ip: fact('10.0.0.100'), mac: fact('00:11:22:33:44:55') };
const initial = {
  key: 'billing|billing_user|100||abon1000', system: 'billing', pageKind: 'billing_user', entityId: '100', subview: '', title: 'Subscriber', url: billingUrl,
  identity: baseIdentity, network: baseNetwork, pon: {}, profile: {}, quality: { trustedPage: true, parser: 'test' },
  meta: { documentId: 'billing-user-doc', pageInstanceId: 'billing-user-page', pageInstanceStartedAt: 1, scanGeneration: 1, technical: { hasOlt: false, hasOnuIdentity: false, hasSubscriberIdentity: true, isPon: true, pollCandidates: [] } }
};
const created = await send('STORE_APPLY_CONTEXT', { context: initial, envelope: envelope('ctx-user', 'billing-user-doc', 'billing-user-page') }, billingSender);
const caseId = created.caseId;
assert.ok(caseId);


const technicalUrl = 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=100&tmpl=1';
const technicalSender = sender(10, 'billing-tech-doc', technicalUrl);
const technical = {
  ...structuredClone(initial), key: 'billing|billing_technical|100|technical|abon1000', pageKind: 'billing_technical', subview: 'technical', url: technicalUrl,
  meta: { documentId: 'billing-tech-doc', pageInstanceId: 'billing-tech-page', pageInstanceStartedAt: 2, scanGeneration: 1, technical: { hasOlt: false, hasOnuIdentity: false, hasSubscriberIdentity: true, isPon: true, pollCandidates: [] } }
};
await send('STORE_APPLY_CONTEXT', { context: technical, envelope: envelope('ctx-tech', 'billing-tech-doc', 'billing-tech-page') }, technicalSender);
let state = structuredClone(storageData.simnet_workbench_state_v5);
let current = state.cases[caseId];
assert.equal(current.progress.technicalChecked?.done, true, 'manual Technical visit completes evidence-derived progress');
assert.equal('milestones' in current, false, 'legacy business milestone state is removed');
assert.equal(current.diagnostic.technicalVisited, true);

const usersideUrl = 'https://userside.simnet.kiev.ua/customer/500';
const usersideSender = sender(11, 'userside-doc', usersideUrl);
const tmc = {
  key: 'userside|userside_customer|500||abon1000', system: 'userside', pageKind: 'userside_customer', entityId: '500', subview: '', title: 'Subscriber', url: usersideUrl,
  identity: { ...baseIdentity, customerId: fact('500') }, network: baseNetwork,
  pon: { tmcOltName: fact('Kyiv-Test-OLT-Huawei'), tmcOltIp: fact('172.16.1.10'), tmcOnuMac: fact('AA:BB:CC:DD:EE:FF') }, profile: {}, quality: { trustedPage: true, parser: 'test' },
  meta: {
    documentId: 'userside-doc', pageInstanceId: 'userside-page', pageInstanceStartedAt: 3, scanGeneration: 1,
    locatorObservations: [{
      type: 'TMC_RESULT', result: 'found', method: 'userside_tmc', source: 'userside',
      details: { bestObserved: { oltName: 'Kyiv-Test-OLT-Huawei', oltIp: '172.16.1.10', onuMac: 'AA:BB:CC:DD:EE:FF', confidence: 0.99 }, identityCheck: { isMatch: true } },
      summary: 'TMC matched current subscriber'
    }]
  }
};
await send('STORE_APPLY_CONTEXT', { context: tmc, envelope: envelope('ctx-tmc', 'userside-doc', 'userside-page') }, usersideSender);
state = structuredClone(storageData.simnet_workbench_state_v5);
current = state.cases[caseId];
assert.equal(current.progress.tmcChecked?.done, true, 'accepted TMC result completes evidence-derived progress');
assert.equal(current.workflow?.ponAcquisition, undefined, 'legacy mutable PON policy state is removed');
const expectation = tmcTechnicalExpectation(current);
assert.deepEqual(expectation.fields.sort(), ['olt','onuMac'].sort(), 'source-limited TMC only requires fields the real source supplied');
assert.equal(expectation.fields.includes('onuSerial'), false, 'missing TMC Serial is not manufactured as an obligation');

assert.equal(current.route?.guide, undefined, 'legacy Guide state is removed from canonical Case');
assert.equal(current.workflow?.actionSession, undefined, 'legacy ActionSession state is removed from canonical Case');
console.log('progress_behavior_integration_test: PASS', { caseId, canonicalWrites, technical: true, tmc: true });
