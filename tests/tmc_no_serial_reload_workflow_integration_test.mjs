import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const storageData = {};
const listeners = [];
globalThis.chrome = {
  storage: { local: {
    async get(keys){ if(keys==null) return structuredClone(storageData); const list=Array.isArray(keys)?keys:[keys]; return Object.fromEntries(list.filter(k=>k in storageData).map(k=>[k,structuredClone(storageData[k])])); },
    async set(patch){ for(const [k,v] of Object.entries(patch)) storageData[k]=structuredClone(v); },
    async remove(keys){ for(const k of (Array.isArray(keys)?keys:[keys])) delete storageData[k]; }
  }, onChanged:{addListener(){},removeListener(){}} },
  runtime:{id:'wb-tmc-field-contract',onMessage:{addListener(fn){listeners.push(fn)}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  tabs:{onRemoved:{addListener(){}},async query(){return[]},async update(id,p){return{id,...p}},async create(p){return{id:99,...p}},async get(id){return{id,windowId:1,url:'https://admin.simnet.kiev.ua/'}}},
  windows:{async update(id,p){return{id,...p}}}, action:{async setBadgeText(){},async setBadgeBackgroundColor(){}}, scripting:{async executeScript(){}}
};
globalThis.addEventListener=()=>{};
await import(pathToFileURL(new URL('../src/background.js',import.meta.url).pathname).href+`?field=${Date.now()}`);
const listener=listeners[0]; assert.ok(listener);
const fact=(value,source='test')=>({value,source,confidence:.99});
const url='https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=dopdata&parent_type=0&id=24938&tmpl=1';
const senderFor=doc=>({tab:{id:10,windowId:1,url},frameId:0,documentId:doc,url});
function send(type,payload,sender){return new Promise((resolve,reject)=>{const handled=listener({type,payload},sender,r=>r?.success?resolve(r.data):reject(new Error(r?.error||type)));assert.equal(handled,true);});}

const context=doc=>({
  key:'billing|billing_technical|24938|technical|abon249387',system:'billing',pageKind:'billing_technical',entityId:'24938',subview:'technical',title:'Technical',url,
  identity:{login:fact('abon249387'),contract:fact('249387'),billingId:fact('24938')},
  network:{connectionFamily:fact('PON','billing:connection-type'),ip:fact('10.8.73.212'),mac:fact('D8:07:B6:4E:AB:B8')},
  pon:{
    oltName:fact('BDCOM OLT P3616-2TE','billing:olt-selected-option'),
    oltIp:fact('172.16.1.17','billing:olt-selected-option-ip'),
    onuMac:fact('C8:3A:35:B2:C3:39','billing:onu-mac'),
    tmcOltName:fact('BDCOM OLT P3616-2TE','userside:tmc-olt-name'),
    tmcOltIp:fact('172.16.1.17','userside:tmc-olt-ip'),
    tmcOltDeviceId:fact('60','userside:tmc-olt-device-id'),
    tmcOnuMac:fact('C8:3A:35:B2:C3:39','userside:tmc-onu-mac'),
    tmcPort:fact('epon0/2:44','userside:tmc-port')
  },
  profile:{},quality:{trustedPage:true,parser:'field-fixture'},
  meta:{documentId:doc,pageInstanceId:`page-${doc}`,pageInstanceStartedAt:1,scanGeneration:1,
    locatorObservations:[{type:'TMC_RESULT',result:'found',method:'exact-inventory-row',source:'userside',routeRelation:'supporting',details:{
      tmcFound:true,ponFound:true,equipmentName:'ONUabon',serial:null,mac:'C8:3A:35:B2:C3:39',foundOnOlt:true,
      oltName:'BDCOM OLT P3616-2TE',oltDeviceId:'60',oltIp:'172.16.1.17',interface:'epon0/2:44',onuRx:'-26.3',onuTx:'1.3',oltRx:'-23.3',
      identityCheck:{isMatch:true}
    }}]}
});

const first=await send('STORE_APPLY_CONTEXT',{context:context('tech-doc-1'),envelope:{eventId:'ctx1',occurredAt:new Date().toISOString(),origin:{tabId:10,frameId:0,documentId:'tech-doc-1',pageInstanceId:'page-tech-doc-1',pageInstanceStartedAt:1}}},senderFor('tech-doc-1'));
const caseId=first.caseId;
let c=structuredClone(storageData.simnet_workbench_state_v5.cases[caseId]);
assert.equal(c.diagnostic.readyForOnuPoll,true);
assert.equal(c.diagnostic.pollAction,'310');
assert.equal(c.diagnostic.subtype,'EPON');
assert.equal(c.diagnostic.ponWorkflowDetails.serialStatus,'optional-missing');

// Reloading without ever saving Serial must not manufacture a Save gate.
await send('STORE_APPLY_CONTEXT',{caseId,context:context('tech-doc-2'),envelope:{eventId:'ctx2',occurredAt:new Date().toISOString(),caseId,origin:{tabId:10,frameId:0,documentId:'tech-doc-2',pageInstanceId:'page-tech-doc-2',pageInstanceStartedAt:2}}},senderFor('tech-doc-2'));
c=structuredClone(storageData.simnet_workbench_state_v5.cases[caseId]);
assert.equal(c.diagnostic.readyForOnuPoll,true);
assert.equal(c.diagnostic.locatorAction,'poll_candidate');
assert.equal('ponAcquisition' in c.workflow, false, 'obsolete mutable PON policy state must be migrated out');

console.log('tmc_no_serial_reload_workflow_integration_test: PASS',{caseId,pollAction:'310'});
