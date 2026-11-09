import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSubscriberList, gradeBulkAnswer, makeBulkReport, bulkTotals, BULK_SCENARIOS } from '../standalone-ai/bulk-qa.js';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('input accepts abon and numeric contracts, handles CSV headers, skips duplicates, never auto-finds subscribers',()=>{
  const result=parseSubscriberList('login,contract\nabon123456,700000\nABON123456\n334455\nwrong\n334455');
  assert.deepEqual(result.valid,['abon123456','334455']);
  assert.deepEqual(result.invalid,['wrong']);
  assert.equal(result.overLimit,0);
  const huge=parseSubscriberList(Array.from({length:105},(_,i)=>'abon'+String(i+10000)).join('\n'));
  assert.equal(huge.accepted.length,100);
  assert.equal(huge.overLimit,5);
});

test('balances including zero and negative remain distinct from UNKNOWN',()=>{
  assert.equal(gradeBulkAnswer('balance','На счету 0 грн.',{balance:0}).verdict,'PASS');
  assert.equal(gradeBulkAnswer('balance','На счету -150 грн.',{balance:-150}).verdict,'PASS');
  assert.equal(gradeBulkAnswer('balance','На счету 700 грн.',{balance:0}).verdict,'FAIL');
  assert.equal(gradeBulkAnswer('balance','На счету 0 грн.',{balance:null}).verdict,'REVIEW');
  assert.equal(gradeBulkAnswer('balance','Проверить не удалось.',{balance:250}).verdict,'REVIEW');
});

test('tariff matching, service contradictions, missing services and payments are handled conservatively',()=>{
  assert.equal(gradeBulkAnswer('tariff','Ваш тариф BIZ 800, цена 800 грн.',{tariffName:'BIZ 800',tariffPrice:800}).verdict,'PASS');
  assert.equal(gradeBulkAnswer('tariff','Тариф BIZ 800, цена 500 грн.',{tariffName:'BIZ 800',tariffPrice:800}).verdict,'FAIL');
  assert.equal(gradeBulkAnswer('services','Услуг нет.',{services:[{name:'Static IP',price:50}]}).verdict,'FAIL');
  assert.equal(gradeBulkAnswer('services','Услуг нет.',{services:[]}).verdict,'REVIEW');
  assert.equal(gradeBulkAnswer('topup','Внесите 150 грн.',{balance:250,tariffPrice:400}).verdict,'REVIEW');
  assert.equal(gradeBulkAnswer('charge_date','Списание 31 октября в 23:59.',{}).verdict,'FAIL');
  assert.equal(gradeBulkAnswer('followup','Да, будет нормально.',{}).verdict,'REVIEW');
  assert.equal(gradeBulkAnswer('balance','Договор abon654321, на счёте 250 грн.',{balance:250},{identifier:'abon123456'}).category,'context_leak');
});

test('default audit JSON masks supplied contract and login even inside replies, preserves typed verdicts',()=>{
  const batch={schema:'simnet.bulk-finance-qa.v1',createdAt:'2026-11-09',phase:'completed',mode:'starter',
    subscribers:[
      {identifier:'334455',status:'ready',snapshot:{facts:{balance:25},identity:{contract:'334455'},source:'billing-live'},checks:[
        {scenario:'balance',name:'Баланс',question:'По договору 334455 что по балансу?',reply:'На 334455 25 грн.',verdict:'PASS',category:'checked_fact',reason:'Matched 334455',usage:{total_tokens:300},tools:[]}
      ]},
      {identifier:'abon123456',status:'blocked',error:{stage:'lookup',code:'BILLING_TAB_REQUIRED'},checks:[]}
    ]};
  const result=makeBulkReport(batch);
  const encoded=JSON.stringify(result);
  assert.doesNotMatch(encoded,/334455|abon123456/);
  assert.match(encoded,/BILLING_TAB_REQUIRED/);
  assert.equal(result.totals.pass,1);
  assert.equal(result.totals.blocked,1);
  assert.equal(result.totals.usedTokens,300);
  const identifiable=makeBulkReport(batch,true);
  assert.equal(identifiable.cases[0].subscriber,'334455');
});

test('a batch runs one preflight / isolated Lab turn at a time; STOP and explicit resume use local checkpoint',()=>{
  const bg=file('src/features/ai-operator/bulk-qa-background.js');
  const ui=file('standalone-ai/bulk-qa.js');
  const html=file('standalone-ai/chat.html');
  const manifest=JSON.parse(file('standalone-ai/manifest.json'));
  assert.equal(manifest.version,'0.3.0');
  assert.match(bg,/runIsolatedLabCase/);
  assert.match(bg,/readBillingSummaryLive\(\{ billingId, refresh:true \}\)/);
  assert.match(bg,/if \(!exactIdentity\(expected,candidate\)\)/);
  assert.match(bg,/case_context|CASE_CONTEXT_MISMATCH/i);
  assert.match(ui,/await persist\(\);render\(\)/);
  assert.match(ui,/if\(isStopped\(\)\)/);
  assert.match(ui,/stopRequested=true/);
  assert.match(ui,/stopped-scan|stopped-run/);
  assert.match(ui,/Math\.min\(600/);
  assert.match(ui,/tokenBudget/);
  assert.match(ui,/chrome\.storage\.local\.get\(STORAGE_KEY\)/);
  for(const id of ['bulkQaToggle','bulkQaPanel','bulkFile','bulkScan','bulkRun','bulkStop','bulkResume','bulkExportJson','bulkExportCsv'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.ok(BULK_SCENARIOS.length>=6);
});
