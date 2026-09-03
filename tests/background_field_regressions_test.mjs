import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const storageData={}; const listeners=[];
globalThis.chrome={
  storage:{local:{async get(keys){if(keys==null)return structuredClone(storageData);const list=Array.isArray(keys)?keys:[keys];return Object.fromEntries(list.filter(k=>k in storageData).map(k=>[k,structuredClone(storageData[k])]));},async set(p){Object.assign(storageData,structuredClone(p));},async remove(keys){for(const k of(Array.isArray(keys)?keys:[keys]))delete storageData[k];}},onChanged:{addListener(){},removeListener(){}}},
  runtime:{id:'wb-reg',onMessage:{addListener(fn){listeners.push(fn)}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  tabs:{onRemoved:{addListener(){}},async query(){return[]},async update(id,p){return{id,...p}},async create(p){return{id:99,...p}},async get(id){return{id,windowId:1,url:'https://admin.simnet.kiev.ua/'}}},windows:{async update(id,p){return{id,...p}}},action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},scripting:{async executeScript(){}}
};
globalThis.addEventListener=()=>{};
await import(pathToFileURL(new URL('../src/background.js',import.meta.url).pathname).href+`?reg=${Date.now()}`);
const listener=listeners[0]; assert.ok(listener); const api=globalThis.__SIMNET_WB_TEST_API__; assert.ok(api);
const fact=(value,source='test')=>({value,source,confidence:.99,observedAt:new Date().toISOString()});
const c=api.emptyCase('login:manual'); c.network.connectionFamily=fact('PON','billing:connection-type'); c.currentContext={pageKind:'billing_technical'}; c.pon.onuMac=fact('C4:CD:50:12:08:35','billing:onu-mac'); c.pon.tmcOltName=fact('Huawei MA5800-X15','userside:tmc-olt-name'); c.pon.tmcOltIp=fact('172.16.1.50','userside:tmc-olt-ip'); c.locator.sourceStatus.tmc={result:'found',details:{oltName:'Huawei MA5800-X15',oltIp:'172.16.1.50'}};
let d=api.diagnosticSnapshot(c); assert.equal(d.readyForOnuPoll,false); assert.deepEqual(d.billingMissingTechnical,['olt']);
c.pon.oltName=fact('Huawei MA5800-X15','billing:olt-selected-option'); c.pon.oltIp=fact('172.16.1.50','billing:olt-selected-option-ip'); d=api.diagnosticSnapshot(c); assert.equal(d.readyForOnuPoll,true); assert.equal(d.pollAction,'313');
const url='https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=100'; const sender={tab:{id:10,windowId:1,url},frameId:0,documentId:'doc1',url};
function send(type,payload){return new Promise((resolve,reject)=>{const handled=listener({type,payload},sender,r=>r?.success?resolve(r.data):reject(new Error(r?.error||type)));assert.equal(handled,true);});}
const context={key:'billing|billing_user|100||abon1000',system:'billing',pageKind:'billing_user',entityId:'100',url,identity:{login:fact('abon1000','billing:exact-login'),billingId:fact('100','billing:url-id')},network:{connectionFamily:fact('PON','billing:connection-type')},pon:{},profile:{},quality:{trustedPage:true},meta:{documentId:'doc1',pageInstanceId:'p1',pageInstanceStartedAt:1,locatorObservations:[]}};
const created=await send('STORE_APPLY_CONTEXT',{context,envelope:{eventId:'ctx1',occurredAt:new Date().toISOString(),origin:{documentId:'doc1',pageInstanceId:'p1',pageInstanceStartedAt:1}}});
const stored=storageData.simnet_workbench_state_v5.cases[created.caseId]; assert.equal('route' in stored,false,'legacy route workflow state is not persisted'); assert.equal('routeGeneration' in stored,false);
console.log('background_field_regressions_test: PASS');
