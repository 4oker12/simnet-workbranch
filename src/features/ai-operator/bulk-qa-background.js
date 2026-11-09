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
function lookupClassification(code, candidateCount, verified) {
  if (code === 'NOT_FOUND') return 'NOT_FOUND';
  if (code === 'AMBIGUOUS_IDENTITY') return 'AMBIGUOUS';
  if (code === 'IDENTITY_MISMATCH') return 'MISMATCH';
  if (code === 'OK' && candidateCount === 0) return 'ZERO_RESULT';
  // An unsuccessful source READ is not proof of identity mismatch.
  return 'SOURCE_ERROR';
}

// Identity-only bulk mode: exercise the existing real customer.lookup authority.
// Never call Billing summary or an LLM here; an exact lookup is the first
// separate precondition before evaluating AI semantic reasoning.
async function identifySubscriber(payload = {}) {
  const expected = identifierType(payload.identifier);
  if (!expected) return failure('input', 'INVALID_IDENTIFIER', { status:'INVALID', candidateCount:null });
  const startedAt = Date.now();
  const lookup = await executeOperatorTool({tool:'customer.lookup',
    toolArgs:{[expected.type]:expected.value},labState:{}});
  const data = lookup?.data || {};
  const candidate = data.candidate || null;
  const rawCount = data.count;
  const candidateCount = Number.isInteger(rawCount) && rawCount >= 0 ? rawCount
    : Array.isArray(data.candidates) ? data.candidates.length
      : lookup?.ok && candidate ? 1
        : lookup?.code === 'NOT_FOUND' ? 0 : null;
  const verified = Boolean(candidate && exactIdentity(expected,candidate));
  const code = String(lookup?.code || (lookup?.ok ? 'OK' : 'UNKNOWN'));
  const status = lookup?.ok && verified && candidateCount === 1 &&
    !data.requiresConfirmation && Boolean(lookup.statePatch?.confirmedCaseId)
      ? 'FOUND'
      : lookup?.ok && candidateCount === 0 ? 'ZERO_RESULT'
      : lookup?.ok && !verified ? 'MISMATCH'
      : lookup?.ok && candidateCount !== 1 ? 'AMBIGUOUS'
      : lookupClassification(code,candidateCount,false);
  return {
    ok: status === 'FOUND',
    status,
    stage: status === 'SOURCE_ERROR' ? 'source' : 'identity',
    code,
    identifier: expected.value,
    searchMode: expected.type,
    candidateCount,
    candidate: candidate ? {
      login:clean(candidate.login,80),
      contract:clean(candidate.contract,80),
      billingId:clean(candidate.billingId,30),
      caseId:clean(candidate.caseId,70)
    } : null,
    matched:verified,
    observedAt:lookup?.observedAt || new Date().toISOString(),
    durationMs:Date.now()-startedAt,
    source:clean(data.source || 'unknown',100),
    warnings:Array.isArray(lookup?.warnings) ? lookup.warnings.slice(0,8) : [],
    httpTrace:Array.isArray(data.httpTrace) ? data.httpTrace : []
  };
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
// One isolated, natural-language identity turn per selected subscriber.
// The AI gets no pre-bound confirmedCaseId. Its own customer.lookup calls
// must identify the supplied literal and be compared against the control READ.
async function identifyViaAI(payload = {}) {
  const identity = identifierType(payload.identifier);
  if (!identity) return failure('input','INVALID_IDENTIFIER');
  const question = (identity.type==='login' ? 'Мой договор ' : 'У меня договор ') +
    identity.value+'. Найдите мой договор в Billing. Удалось ли найти именно его?';
  const output=await runIsolatedLabCase({
    text:question,transcript:[],knowledgeMode:'auto',toolState:{},
    scope:clean(payload.scope || 'bulk-identity-qa',160)
  });
  const exp=output.experiment || {};
  const variant=(exp.variants || []).find(v=>v.label===exp.activeVariant) ||
    exp.variants?.[0] || {};
  const trace=Array.isArray(variant.toolTrace) ? variant.toolTrace : [];
  const lookups=trace.filter(t=>t?.tool==='customer.lookup').slice(0,10).map(t=>{
    const data=t.data || {};
    const candidate=data.candidate || null;
    return {
      args:{
        login:clean(t.args?.login || '',100),
        contract:clean(t.args?.contract || '',100),
        address:clean(t.args?.address || '',140),
        ip:clean(t.args?.ip || '',65)
      },
      requestedBy:t.requestedBy || {},
      ok:t.ok===true,code:clean(t.code || 'UNKNOWN',60),
      source:clean(t.source || data.source || 'unknown',100),
      candidateCount:Number.isInteger(data.count) ? data.count
        : Array.isArray(data.candidates) ? data.candidates.length
        : t.ok && candidate ? 1 : t.code==='NOT_FOUND' ? 0 : null,
      candidate:candidate ? {
        login:clean(candidate.login,100),
        contract:clean(candidate.contract,100),
        billingId:clean(candidate.billingId,40)
      } : null,
      observedAt:clean(t.observedAt || '',50),
      httpTrace:Array.isArray(data.httpTrace) ? data.httpTrace.slice(0,35) : []
    };
  });
  return {
    ok:true,code:'OK',question,reply:clean(output.decision?.reply || variant.reply,2800),
    intent:clean(output.decision?.intent || exp.analysis?.probe?.whatUserWants,450),
    lookups,degraded:Boolean(variant.degraded),
    degradationReason:clean(variant.degradationReason,350),
    toolCalls:trace.length,usage:exp.usage || {},
    elapsedMs:Number(exp.elapsedMs || 0),
    observedAt:new Date().toISOString()
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
    ? (message.payload?.identityOnly ? identifySubscriber(message.payload || {}) : preflight(message.payload || {}))
    : (message.payload?.identityOnly ? identifyViaAI(message.payload || {}) : singleTurn(message.payload || {}));
  void action.then(value=>sendResponse({success:true,data:value}),
    error=>sendResponse({success:false,error:clean(error?.message || error,350)}));
  return true;
});
