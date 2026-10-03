import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCrmSnapshot } from '../src/ai/crm-search-index-base.js';
import { findBuildingInSnapshot, readBuildingSnapshot, normalizeHouseSuffix } from '../src/features/ai-operator/building-snapshot-tool.js';

test('bundled catalog loads without import; imported full snapshot wins', async () => {
 const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
 const bundled = {schema:'simnet-crm-building-snapshot-v1',addressOnly:true,buildings:[{id:'test',address:'Київ, вул. Тестова (Подільський) (Стара Тестова), 32/А',fields:[]}]};
 let imported = null, requests = 0;
 globalThis.chrome = {runtime:{getURL:path=>`chrome-extension://test/${path}`},storage:{local:{get:(keys,callback)=>{const data={simnet_crm_building_snapshot_v1:imported};if(callback)callback(data);return Promise.resolve(data);}}}};
 globalThis.fetch = async url => {requests++;assert.match(url,/userside-building-addresses.json$/);return {ok:true,json:async()=>bundled};};
 try {
  assert.equal(await loadCrmSnapshot(),bundled);
  for (const address of ['Тестова 32А','вул. Тестова 32/А','Тестова 32A','Тестова 32 / А','Стара Тестова 32А']) {
   assert.equal(findBuildingInSnapshot(bundled,{rawAddress:address}).code,'OK',address);
  }
  const result = await readBuildingSnapshot({toolArgs:{address:'Тестова 32А'}});
  assert.equal(result.code,'OK');assert.equal(result.data.addressOnly,true);assert.equal(result.warnings.length,1);
  imported = {...bundled,addressOnly:false,generatedAt:'newer',buildings:[{id:'other',address:'Тестова 1',fields:[]}]};
  assert.equal(await loadCrmSnapshot(),imported);assert.equal(requests,1);
 } finally {globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;}
});

test('bundled catalog contains address records only',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../src/ai/data/userside-building-addresses.json',import.meta.url)));
 assert.equal(catalog.buildings.length,1651);assert.equal(catalog.addressOnly,true);
 for(const row of catalog.buildings){assert.deepEqual(Object.keys(row).sort(),['address','fields','id','url']);assert.deepEqual(row.fields,[]);}
});

test('house lookalike letters and compound slash numbers remain precise',()=>{
 for(const [latin,cyrillic] of Object.entries({A:'а',B:'в',C:'с',E:'е',H:'н',K:'к',M:'м',O:'о',P:'р',T:'т',X:'х'})) assert.equal(normalizeHouseSuffix(latin),cyrillic);
 const snapshot={buildings:[{id:'one',address:'вул. Синтетична, 42/Б/2'}]};
 assert.equal(findBuildingInSnapshot(snapshot,{rawAddress:'Синтетична 42 / Б / 2'}).code,'OK');
 assert.equal(findBuildingInSnapshot(snapshot,{rawAddress:'Синтетична 42/Б/3'}).code,'NOT_FOUND');
});
