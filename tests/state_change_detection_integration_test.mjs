import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const storageData = {};
let canonicalWrites = 0;
const messageListeners = [];
const removedListeners = [];
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
        for (const [k,v] of Object.entries(patch)) storageData[k] = structuredClone(v);
      },
      async remove(key) { for (const k of (Array.isArray(key)?key:[key])) delete storageData[k]; }
    },
    onChanged: { addListener(){}, removeListener(){} }
  },
  runtime: {
    id: 'arch-test',
    onMessage: { addListener(fn){ messageListeners.push(fn); } },
    onInstalled: { addListener(){} },
    onStartup: { addListener(){} }
  },
  tabs: {
    onRemoved: { addListener(fn){ removedListeners.push(fn); } },
    async query(){ return []; }, async update(id,patch){ return {id,...patch}; }, async create(p){ return {id:99,...p}; },
    async get(id){ return {id,windowId:1,url:'https://admin.simnet.kiev.ua/'}; }
  },
  windows: { async update(id,patch){ return {id,...patch}; } },
  action: { async setBadgeText(){}, async setBadgeBackgroundColor(){} },
  scripting: { async executeScript(){} }
};

globalThis.addEventListener = () => {};
await import(pathToFileURL(new URL('../src/background.js', import.meta.url).pathname).href + `?t=${Date.now()}`);
assert.equal(messageListeners.length,1);
const listener=messageListeners[0];
const sender={tab:{id:10,windowId:1,url:'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=1'},frameId:0,documentId:'doc-1',url:'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=1'};
const fact=value=>({value,source:'test',confidence:.99});
const context={
  key:'billing|billing_user|1||abon1',system:'billing',pageKind:'billing_user',entityId:'1',subview:'',title:'Subscriber',url:sender.url,
  identity:{login:fact('abon1'),contract:fact('1'),billingId:fact('1')},
  network:{connectionFamily:fact('PON'),ip:fact('10.0.0.1'),mac:fact('00:11:22:33:44:55')},pon:{},profile:{},
  meta:{documentId:'doc-1',pageInstanceId:'page-1',pageInstanceStartedAt:1,scanGeneration:1,technical:{hasOlt:false,hasOnuIdentity:false,hasSubscriberIdentity:true,isPon:true,pollCandidates:[]}},
  quality:{trustedPage:true,parser:'test'}
};
function send(type,payload){
  return new Promise((resolve,reject)=>{
    const handled=listener({type,payload},sender,r=>r?.success?resolve(r.data):reject(new Error(r?.error||type)));
    assert.equal(handled,true);
  });
}
const result1=await send('STORE_APPLY_CONTEXT',{context:structuredClone(context),envelope:{eventId:'e1',occurredAt:new Date().toISOString(),origin:{documentId:'doc-1',pageInstanceId:'page-1',pageInstanceStartedAt:1}}});
assert.ok(result1.caseId);
const after1=structuredClone(storageData.simnet_workbench_state_v5);
const cv1=after1.cases[result1.caseId].caseVersion;
const writes1=canonicalWrites;

const c2=structuredClone(context); c2.meta.scanGeneration=2;
const r2=await send('STORE_APPLY_CONTEXT',{context:c2,envelope:{eventId:'e2',occurredAt:new Date().toISOString(),origin:{documentId:'doc-1',pageInstanceId:'page-1',pageInstanceStartedAt:1}}});
const after2=structuredClone(storageData.simnet_workbench_state_v5);
const cv2=after2.cases[result1.caseId].caseVersion;
const writes2=canonicalWrites;

const c3=structuredClone(context); c3.meta.scanGeneration=3;
const r3=await send('STORE_APPLY_CONTEXT',{context:c3,envelope:{eventId:'e3',occurredAt:new Date().toISOString(),origin:{documentId:'doc-1',pageInstanceId:'page-1',pageInstanceStartedAt:1}}});
const after3=structuredClone(storageData.simnet_workbench_state_v5);
const cv3=after3.cases[result1.caseId].caseVersion;
const writes3=canonicalWrites;
assert.equal(cv3,cv2,'stable repeated DOM scan must not increment caseVersion');
assert.equal(writes3,writes2,'stable repeated DOM scan must not write canonical State');
assert.equal(r3.stateWritten,false);
assert.equal(cv2,cv1,'first repeated identical DOM scan must not increment caseVersion');
assert.equal(writes2,writes1,'first repeated identical DOM scan must not write canonical State');
assert.equal(r2.stateWritten,false,'first repeated identical DOM scan is an unchanged-state no-op');

const c4=structuredClone(context); c4.meta.scanGeneration=4; c4.pon.oltName=fact('New Huawei OLT');
const r4=await send('STORE_APPLY_CONTEXT',{context:c4,envelope:{eventId:'e4',occurredAt:new Date().toISOString(),origin:{documentId:'doc-1',pageInstanceId:'page-1',pageInstanceStartedAt:1}}});
assert.equal(r4.stateWritten,true,'real fact change must write State');
assert.equal(canonicalWrites,writes3+1);

// Browser-tab lifecycle is also a serialized state transaction transaction. A foreign tab is
// an unchanged-state no-op; a registered Workbench tab is cleaned with one write.
const api = globalThis.__SIMNET_WB_TEST_API__;
assert.ok(api?.cleanupClosedTab, 'background test API exposes tab cleanup');
const beforeForeignCleanup = canonicalWrites;
const foreignCleanup = await api.cleanupClosedTab(999);
assert.equal(foreignCleanup.changed, false);
assert.equal(canonicalWrites, beforeForeignCleanup, 'foreign tab close must not write canonical State');
const beforeKnownCleanup = canonicalWrites;
const knownCleanup = await api.cleanupClosedTab(10);
assert.equal(knownCleanup.changed, true);
assert.equal(canonicalWrites, beforeKnownCleanup + 1, 'known Workbench tab cleanup must commit exactly once');
assert.equal(storageData.simnet_workbench_state_v5.tabs?.['10'], undefined);

console.log('state_change_detection_integration_test: PASS', {cv1,cv2,cv3,writes1,writes2,writes3,canonicalWrites});
