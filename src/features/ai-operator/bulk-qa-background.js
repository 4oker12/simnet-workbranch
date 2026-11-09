'use strict';

// READ-only Bulk QA bridge. The UI owns a bounded, user-stoppable queue;
// the worker only executes ONE requested subscriber preflight or ONE Lab turn.
import { executeOperatorTool } from './live-tool-runtime.js';
import { readBillingSummaryLive } from './billing-summary-live.js';
import { runIsolatedLabCase } from './lab-background.js';

const TYPES = new Set(['AI_OPERATOR_BULK_PREFLIGHT', 'AI_OPERATOR_BULK_TURN']);
const LOGIN_PATTERN = /^abon\d{3,12}$/i;
const CONTRACT_PATTERN = /^\d{3,12}$/;

function identifierType(value) {
  const input = String(value || '').trim();
  if (LOGIN_PATTERN.test(input)) return { type: 'login', value: input.toLowerCase() };
  if (CONTRACT_PATTERN.test(input)) return { type: 'contract', value: input };
  return null;
}
function failure(stage, code, detail = {}) {
  return { ok: false, stage, code: String(code || 'UNKNOWN'), ...detail };
}
function compactMoney(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
function clean(value, max = 180) { return String(value == null ? '' : value).trim().slice(0, max); }
function exactIdentity(expected, candidate) {
  if (expected.type === 'login') return clean(candidate.login).toLowerCase() === expected.value;
  return clean(candidate.contract).replace(/\s/g, '') === expected.value;
}
function verifiedSummary(expected, data = {}) {
  const identity = data.identity || {};
  const actual = expected.type === 'login' ? clean(identity.login).toLowerCase()
    : clean(identity.contract).replace(/\s/g, '');
  // If the summary itself does not expose a given identifier, do not silently
  // convert its absence into a mismatching identity; preflight lookup was exact.
  return !actual || actual === expected.value;
}
async function preflight(payload = {}) {
  const expected = identifierType(payload.identifier);
  if (!expected) return failure('input','INVALID_IDENTIFIER');
  const lookup = await executeOperatorTool({ tool:'customer.lookup',
    toolArgs: { [expected.type]: expected.value }, labState: {} });
  const lookupTrace = { tool:lookup?.tool || 'customer.lookup', ok:Boolean(lookup?.ok),
    code:lookup?.code || 'UNKNOWN', observedAt:lookup?.observedAt || '',
    httpTrace:Array.isArray(lookup?.data?.httpTrace) ? lookup.data.httpTrace : [] };
  if (!lookup?.ok) return failure('lookup',lookup?.code || 'LOOKUP_FAILED',{ lookupTrace });
  const candidate = lookup?.data?.candidate || {};
  if (!exactIdentity(expected,candidate)) return failure('identity','IDENTITY_MISMATCH',{ lookupTrace });
  const billingId = String(candidate.billingId || '').replace(/\D/g,'');
  if (!/^\d{1,12}$/.test(billingId) || !lookup?.statePatch?.confirmedCaseId) {
    return failure('identity','CONFIRMED_BILLING_ID_REQUIRED',{ lookupTrace });
  }
  const summary = await readBillingSummaryLive({ billingId, refresh:true });
  const summaryTrace = { tool:'billing.main_summary', ok:Boolean(summary?.ok),
    code:summary?.code || 'UNKNOWN', observedAt:summary?.observedAt || '',
    httpTrace:Array.isArray(summary?.data?.evidence?.httpTrace) ? summary.data.evidence.httpTrace : [] };
  if (!summary?.ok) return failure('billing_read',summary?.code || 'BILLING_SUMMARY_READ_FAILED',{ lookupTrace,summaryTrace });
  if (!verifiedSummary(expected, summary?.data)) return failure('identity','SUMMARY_IDENTITY_MISMATCH',{ lookupTrace,summaryTrace });
  const finance = summary?.data?.finance || {};
  const service = summary?.data?.service || {};
  const facts = {
    balance:compactMoney(finance.accountBalance),
    tariffPrice:compactMoney(finance.price),
    totalDue:compactMoney(finance.totalDue),
    balanceAfterTariff:compactMoney(finance.balanceAfterTariff),
    balanceWithoutTemporary:compactMoney(finance.balanceWithoutTemporary),
    temporaryPayment:compactMoney(finance.temporaryPayment),
    tariffName:clean(service.currentTariff,180),
    accessState:clean(service.accessState,90),
    serviceState:clean(service.serviceState,90),
    // An empty services list may mean the HTML parser did not observe rows.
    services:Array.isArray(service.activeServices) ? service.activeServices.map(x=>({
      name:clean(x?.name || x?.label || x?.title || x,120),
      price:compactMoney(x?.price ?? x?.amount)
    })).slice(0,30) : null
  };
  return {
    ok:true, stage:'preflight', code:'OK', identifier:expected.value,
    facts, identity:{ login:clean(candidate.login,90), contract:clean(candidate.contract,90) },
    observedAt:summary.observedAt || '', source:summary.source || 'billing-main-summary-live-read-only',
    evidence:{ lookup:lookupTrace, summary:summaryTrace, transport:summary?.data?.evidence?.transport || '', cache:summary.cache || '' },
    // Real identity, bounded to this subscriber; never pooled or shared among cases.
    toolState: { confirmedCaseId:String(lookup.statePatch.confirmedCaseId),
      confirmedSubscriber:lookup.statePatch.confirmedSubscriber || candidate,
      pendingCandidate:null, domainContext:{}, factSourceCache:{} }
  };
}
async function singleTurn(payload = {}) {
  const identity = identifierType(payload.identifier);
  if (!identity) return failure('input','INVALID_IDENTIFIER');
  const state = payload.toolState || {};
  const candidate = state.confirmedSubscriber || {};
  if (!state.confirmedCaseId || !exactIdentity(identity,candidate)) {
    return failure('identity','CASE_CONTEXT_MISMATCH');
  }
  const question = clean(payload.question,1000);
  if (!question) return failure('input','EMPTY_QUESTION');
  const transcript = (Array.isArray(payload.transcript) ? payload.transcript : []).slice(-16)
    .map(item=>({role:item.role === 'agent' ? 'agent':'customer',text:clean(item.text,2200)}));
  const output = await runIsolatedLabCase({
    text:question, transcript, knowledgeMode:'auto', toolState:state,
    scope:clean(payload.scope || 'bulk-finance-qa',160)
  });
  const exp = output.experiment || {};
  const variant = (exp.variants || []).find(item=>item.label === exp.activeVariant)
    || exp.variants?.[0] || {};
  return {
    ok:true, code:'OK',
    reply:clean(output.decision?.reply || variant.reply,5000),
    understanding:{intent:clean(output.decision?.intent || exp.analysis?.probe?.whatUserWants,500),
      confidence:Number(output.decision?.confidence || 0)},
    evidence:variant.factEvidence || [], evidenceGate:variant.evidenceGate || null,
    toolTrace:(variant.toolTrace || []).slice(0,18).map(t=>({
      tool:t.tool,ok:t.ok,code:t.code,source:t.source || t.data?.source || '',
      observedAt:t.observedAt || '',warnings:(t.warnings || []).slice(0,8),
      httpTrace:t.data?.httpTrace || t.data?.evidence?.httpTrace || []
    })),
    degraded:Boolean(variant.degraded), degradationReason:clean(variant.degradationReason,400),
    usage:exp.usage || {}, elapsedMs:Number(exp.elapsedMs || 0),
    toolState:output.toolState || state
  };
}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(!TYPES.has(String(message?.type || ''))) return false;
  const action=message.type === 'AI_OPERATOR_BULK_PREFLIGHT'
    ? preflight(message.payload || {}) : singleTurn(message.payload || {});
  void action.then(value=>sendResponse({success:true,data:value}),
    error=>sendResponse({success:false,error:clean(error?.message || error,350)}));
  return true;
});
