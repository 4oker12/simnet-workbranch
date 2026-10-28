import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { protectExport } from '../standalone-ai/trace-report.js';
const source = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Billing lookup records HTTP and DOM but never the session pp/uu or subscriber query in route',()=>{
  const src=source('src/features/ai-operator/billing-live-search.js');
  assert.match(src,/const operations = \[\]/);
  assert.match(src,/kind: 'HTTP', method: 'GET'/);
  assert.match(src,/kind: 'DOM', selector: 'a\[href\]/);
  assert.match(src,/safe\.searchParams\.delete\(key\)/);
  assert.match(src,/key === 'name' \|\| key === 'id' \|\| key\.startsWith\('dopfield_'\)/);
  assert.match(src,/httpTrace: operations/);
});

test('Billing main summary distinguishes cached previous observation from fresh browser HTTP read',()=>{
  const src=source('src/features/ai-operator/billing-summary-live.js');
  assert.match(src,/cache: 'hit'/);
  assert.match(src,/httpTrace: \[\], cacheSource: 'previous-observation'/);
  assert.match(src,/transport: 'dom'/);
  assert.match(src,/transport: 'fetch'/);
  assert.match(src,/selector: summarySelector/);
});

test('UserSide tool separates a historical snapshot from HTTP executed on this turn',()=>{
  const src=source('src/features/ai-operator/live-tool-runtime-core.js');
  assert.match(src,/let readMode = 'cache'/);
  assert.match(src,/readMode = 'live'/);
  assert.match(src,/readMode = 'stale'/);
  assert.match(src,/readTrace: \[\]/);
  assert.match(src,/snapshotObservedAt:/);
  const search=source('src/features/ai-operator/userside-live-search.js');
  assert.match(search,/safeEndpoint/);
  assert.match(search,/httpTrace: operations/);
  assert.match(search,/snapshot\.readTrace = operations/);
});

test('READ tab renders source operations as nested, expandable node children',()=>{
  const html=source('standalone-ai/chat.html');
  const js=source('standalone-ai/chat.js');
  assert.match(html,/id="readTimeline"/);
  assert.match(js,/http-observations/);
  assert.match(js,/read\.data\?\.httpTrace/);
  assert.match(js,/read\.data\?\.evidence\?\.httpTrace/);
  assert.match(js,/HTTP GET/); // fallback string in UI note
});

test('default decision export redacts embedded customer URL IDs and search terms',()=>{
  const sample = {pageUrl:'https://userside.simnet.kiev.ua/customer/12345?search=abon999999',endpoint:'/cgi-bin/adm/adm.pl?a=user&id=12345&name=abon999999'};
  const clean = protectExport(sample);
  assert.doesNotMatch(JSON.stringify(clean),/12345|999999/);
  assert.match(clean.pageUrl,/\[ID скрыт\]/);
});
