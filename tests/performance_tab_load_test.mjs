import assert from 'node:assert/strict';
import { tabLoadReport } from '../src/features/performance/tab-load.js';
const samples = [
  { tabId: 1, at: '2026-09-14T01:00:00Z', page: {route:'/first'}, memory:{usedJsHeapBytes:100}, resources:{count:3}, activity:{visibleMs:1000,hiddenMs:2000,hiddenRequests:2,activations:1},tabCounts:{total:5,working:2},navigation:{loadMs:200} },
  { tabId: 1, at: '2026-09-14T01:01:00Z', page: {route:'/second'}, memory:{usedJsHeapBytes:70}, resources:{count:2}, activity:{hiddenMs:3000}, metrics:[{metric:'tab.activation_frame',maxDurationMs:42}],tabCounts:{total:8,working:3},navigation:{loadMs:400} },
  { tabId: 2, at: '2026-09-14T01:01:00Z', resources:{count:9} }
];
const result=tabLoadReport(samples,{tabs:[{tabId:1,selected:true},{tabId:3,discarded:true}]});
const row=result.tabs.find(row=>row.tabId===1);
assert.equal(row.requests,5);assert.equal(row.hiddenRequests,2);assert.equal(row.hiddenMs,5000);
assert.equal(row.heapBytes,70);assert.equal(row.peakHeapBytes,100);assert.equal(row.activationFrameMaxMs,42);
assert.equal(result.tabs.find(row=>row.tabId===2).open,false);
assert.equal(result.tabs.find(row=>row.tabId===3).sampleCount,0);
assert.equal(result.byTabCount[0].averageLoadMs,200);assert.equal(result.byTabCount[1].averageLoadMs,400);
assert.equal(tabLoadReport(samples).tabs[0].open,null);
console.log('performance_tab_load_test: PASS');
