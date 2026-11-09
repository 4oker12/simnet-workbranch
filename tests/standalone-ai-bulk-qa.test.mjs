import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSubscriberList, gradeBulkAnswer, gradeIdentityAi, makeBulkReport, bulkTotals, BULK_SCENARIOS } from '../standalone-ai/bulk-qa.js';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const verified=tool=>({toolTrace:[{tool,ok:true,source:'billing-main-summary-live-read-only'}]});

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
  assert.equal(gradeBulkAnswer('balance','На счету 0 грн.',{balance:0},verified('billing.balance')).verdict,'PASS');
  assert.equal(gradeBulkAnswer('balance','На счету -150 грн.',{balance:-150},verified('billing.balance')).verdict,'PASS');
  assert.equal(gradeBulkAnswer('balance','На счету 700 грн.',{balance:0}).verdict,'FAIL');
  assert.equal(gradeBulkAnswer('balance','На счету 0 грн.',{balance:0}).category,'evidence_gap');
  assert.equal(gradeBulkAnswer('balance','На счету 0 грн.',{balance:null}).verdict,'REVIEW');
  assert.equal(gradeBulkAnswer('balance','Проверить не удалось.',{balance:250}).verdict,'REVIEW');
});

test('tariff matching, service contradictions, missing services and payments are handled conservatively',()=>{
  assert.equal(gradeBulkAnswer('tariff','Ваш тариф BIZ 800, цена 800 грн.',{tariffName:'BIZ 800',tariffPrice:800},verified('billing.tariff')).verdict,'PASS');
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
  const reviewed=structuredClone(batch);
  reviewed.subscribers[0].checks[0].manualVerdict='FAIL';
  reviewed.subscribers[0].checks[0].operatorNote='Ошибка фактической трактовки договора 334455.';
  const manualReport=makeBulkReport(reviewed);
  assert.equal(manualReport.totals.fail,1);
  assert.equal(manualReport.totals.manuallyReviewed,1);
  reviewed.subscribers[0].requestErrors=[{scenario:'tariff',code:'AI_RUNTIME_ERROR',message:'network',at:'2026-11-09'}];
  assert.equal(makeBulkReport(reviewed).totals.requestErrors,1);
  assert.equal(manualReport.cases[0].checks[0].manualVerdict,'FAIL');
  assert.doesNotMatch(JSON.stringify(manualReport),/334455/);
  const identifiable=makeBulkReport(batch,true);
  assert.equal(identifiable.cases[0].subscriber,'334455');
});

test('a batch runs one preflight / isolated Lab turn at a time; STOP and explicit resume use local checkpoint',()=>{
  const bg=file('src/features/ai-operator/bulk-qa-background.js');
  const ui=file('standalone-ai/bulk-qa.js');
  const html=file('standalone-ai/chat.html');
  const manifest=JSON.parse(file('standalone-ai/manifest.json'));
  assert.equal(manifest.version,'0.3.1');
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
  assert.match(ui,/bulkRetryBlocked/);
  assert.match(ui,/manualVerdict/);
  assert.match(ui,/operatorNote/);
  assert.match(ui,/requestErrors/);
  assert.match(ui,/вопрос можно вручную повторить/);
  for(const id of ['bulkQaToggle','bulkQaPanel','bulkFile','bulkScan','bulkRun','bulkStop','bulkResume','bulkExportJson','bulkExportCsv','bulkRetryBlocked'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.ok(BULK_SCENARIOS.length>=6);
});


test('identity-first audit records FOUND, zero-candidate NOT_FOUND, SOURCE_ERROR and repeated attempts',()=>{
  const batch={
    schema:'simnet.bulk-identity-qa.v1',mode:'identity',
    createdAt:'2026-11-09T16:00:00Z',phase:'completed',
    subscribers:[
      {identifier:'abon100001',status:'FOUND',search:{
        status:'FOUND',code:'OK',searchMode:'login',candidateCount:1,
        matched:true,source:'billing-live-read-only',durationMs:28,
        observedAt:'2026-11-09T16:00:00Z',httpTrace:[{kind:'HTTP',endpoint:'/cgi-bin/adm/adm.pl?a=listuser&name=[redacted]',status:200}]
      },attempts:[{status:'FOUND',code:'OK',candidateCount:1}]},
      {identifier:'334455',status:'NOT_FOUND',search:{
        status:'NOT_FOUND',code:'NOT_FOUND',searchMode:'contract',candidateCount:0,
        source:'billing-live-read-only',observedAt:'2026-11-09T16:00:02Z'
      },attempts:[{status:'NOT_FOUND',code:'NOT_FOUND',candidateCount:0}]},
      {identifier:'abon100003',status:'SOURCE_ERROR',search:{
        status:'SOURCE_ERROR',code:'BILLING_TAB_REQUIRED',candidateCount:null,
        source:'none'
      },attempts:[{status:'SOURCE_ERROR',code:'BILLING_TAB_REQUIRED',candidateCount:null},
        {status:'SOURCE_ERROR',code:'BILLING_TAB_REQUIRED',candidateCount:null}]},
      {identifier:'abon100004',status:'MISMATCH',search:{status:'MISMATCH',code:'OK',candidateCount:1,matched:false},
        attempts:[{status:'MISMATCH',code:'OK',candidateCount:1}]},
      {identifier:'abon100005',status:'AMBIGUOUS',search:{status:'AMBIGUOUS',code:'AMBIGUOUS_IDENTITY',candidateCount:2},
        attempts:[{status:'AMBIGUOUS',code:'AMBIGUOUS_IDENTITY',candidateCount:2}]}
    ]
  };
  const totals=bulkTotals(batch);
  assert.equal(totals.found,1);
  assert.equal(totals.notFound,1);
  assert.equal(totals.sourceErrors,1);
  assert.equal(totals.mismatch,1);
  assert.equal(totals.ambiguous,1);
  assert.equal(totals.attempts,6);
  assert.equal(totals.usedTokens,0);
  const report=makeBulkReport(batch);
  assert.equal(report.schema,'simnet.bulk-identity-qa.v1');
  assert.equal(report.cases[1].search.candidateCount,0);
  assert.equal(report.cases[2].search.candidateCount,null);
  assert.equal(report.cases[2].attempts.length,2);
  assert.doesNotMatch(JSON.stringify(report),/abon100001|334455|abon100003/);
  const withIds=makeBulkReport(batch,true);
  assert.equal(withIds.cases[0].subscriber,'abon100001');
  assert.equal(withIds.cases[1].subscriber,'334455');
});

test('control identity preflight uses only customer.lookup; AI stage is independent from financial queries',()=>{
  const ui=file('standalone-ai/bulk-qa.js');
  const bg=file('src/features/ai-operator/bulk-qa-background.js');
  const html=file('standalone-ai/chat.html');
  assert.match(ui,/identityOnly:true/);
  assert.match(ui,/mode:'identity'/);
  assert.match(bg,/function identifySubscriber\(/);
  assert.match(bg,/message\.payload\?\.identityOnly \? identifySubscriber/);
  const isolated=bg.slice(bg.indexOf('async function identifySubscriber'),bg.indexOf('async function preflight'));
  assert.match(isolated,/customer\.lookup/);
  assert.doesNotMatch(isolated,/readBillingSummaryLive|runIsolatedLabCase/);
  assert.match(html,/id="bulkRun">Проверить поиск через AI/);
  assert.match(html,/FOUND \/ NOT_FOUND \/ ZERO_RESULT/);
  assert.match(ui,/stopped-scan/);
  assert.match(ui,/for\(const attempt of sub\.attempts/);
});


test('AI identification checks actual lookup args, result and candidate against Billing control',()=>{
  const ok=(login='abon123456')=>({ok:true,reply:'Нашёл абонента.',degraded:false,
    lookups:[{args:{login,contract:''},ok:true,code:'OK',
      source:'billing-live-read-only',candidateCount:1,candidate:{login}}]});
  assert.equal(gradeIdentityAi({status:'FOUND'},ok(),'abon123456').verdict,'PASS');
  assert.equal(gradeIdentityAi({status:'FOUND'},ok('abon654321'),'abon123456').category,'ai_wrong_identifier');
  assert.equal(gradeIdentityAi({status:'FOUND'},{...ok(),lookups:[]},'abon123456').category,'ai_no_lookup');
  assert.equal(gradeIdentityAi({status:'FOUND'},{...ok(),degraded:true},'abon123456').verdict,'REVIEW');
  const none={ok:true,reply:'Не найден',lookups:[{args:{login:'abon123456',contract:''},
    ok:false,code:'NOT_FOUND',source:'billing-live-read-only',candidateCount:0}]};
  assert.equal(gradeIdentityAi({status:'NOT_FOUND'},none,'abon123456').verdict,'PASS');
  assert.equal(gradeIdentityAi({status:'FOUND'},none,'abon123456').category,'ai_false_not_found');
  assert.equal(gradeIdentityAi({status:'NOT_FOUND'},ok(),'abon123456').category,'ai_source_changed');
  const broken={ok:true,reply:'Нет данных',lookups:[{args:{login:'abon123456',contract:''},
    ok:false,code:'BILLING_TAB_REQUIRED',source:'billing-live-read-only',candidateCount:null}]};
  assert.equal(gradeIdentityAi({status:'FOUND'},broken,'abon123456').category,'ai_source_error');
  const numeric={ok:true,reply:'Договор найден',lookups:[{args:{login:'',contract:'334455'},
    ok:true,code:'OK',source:'billing-live-read-only',candidateCount:1,candidate:{contract:'334455'}}]};
  assert.equal(gradeIdentityAi({status:'FOUND'},numeric,'334455').verdict,'PASS');
  assert.equal(gradeIdentityAi({status:'FOUND'},numeric,'abon123456').category,'ai_wrong_identifier');
});

test('AI identity stage runs one isolated fresh lab case per subscriber and retains STOP/retries',()=>{
  const bg=file('src/features/ai-operator/bulk-qa-background.js');
  const ui=file('standalone-ai/bulk-qa.js');
  const html=file('standalone-ai/chat.html');
  const start=bg.indexOf('async function identifyViaAI(');
  const end=bg.indexOf('async function singleTurn(',start);
  const slice=bg.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(slice,/runIsolatedLabCase\(/);
  assert.match(slice,/toolState:\{\}/);
  assert.match(slice,/customer\.lookup/);
  assert.doesNotMatch(slice,/billing\.balance|billing\.tariff/);
  assert.match(ui,/async function runIdentityAi\(/);
  assert.match(ui,/identityOnly:true,identifier:sub\.identifier/);
  assert.match(ui,/bulkTotals\(batch\)/);
  assert.match(ui,/aiAttempts/);
  assert.match(ui,/stopped-ai/);
  assert.match(html,/id="bulkRun">Проверить поиск через AI/);
});
