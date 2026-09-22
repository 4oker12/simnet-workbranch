'use strict';

import * as base from './semantic-tool-broker-core-runtime-base.js';
import { generateGroundedSubscriberReply } from './semantic-probe-runtime-base.js';
import { compactFactResolutionForSynthesis, compactRuntimeAnalysis, compactRuntimeTranscript } from './runtime-projection.js';
import { extractStandaloneSubscriberIdentity, identityToolArgs, resolveSubscriberIdentityHints } from './subscriber-identity.js';
import { buildDialoguePolicyContext, updateDialogueMemory } from './dialogue-runtime-state.js';
import { deriveFinanceDecisionEvidence } from './finance-decision-nodes.js';

export * from './semantic-tool-broker-core-runtime-base.js';

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function stringList(value, maxItems = 5, maxChars = 360) { return (Array.isArray(value) ? value : []).map(item => oneLine(item, maxChars)).filter(Boolean).slice(0, maxItems); }
function usageTotal(...items) { return items.reduce((total, item) => { const usage = item?.usage || item || {}; total.prompt_tokens += Number(usage.prompt_tokens || 0); total.completion_tokens += Number(usage.completion_tokens || 0); total.total_tokens += Number(usage.total_tokens || 0); return total; }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }); }
function numberValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const normalized = String(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}
function moneyText(value) {
  const numeric = numberValue(value);
  if (numeric === null) return '';
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2, maximumFractionDigits: 2 }).format(numeric);
}

export function extractIdentityHints(transcript = [], analysis = {}) {
  const standard = base.extractIdentityHints(transcript, analysis);
  const secondary = (standard && typeof standard === 'object' && !Array.isArray(standard) && Object.keys(standard).length) ? standard : null;
  return resolveSubscriberIdentityHints(transcript, analysis, secondary);
}

function canonicalTrace(factResolution = null) {
  return (Array.isArray(factResolution?.sourceTrace) ? factResolution.sourceTrace : []).map(item => ({
    tool: oneLine(item?.tool || 'canonical.fact_resolver', 100),
    requestedBy: { system: 'CanonicalDomain', field: (item?.requestedFacts || []).join(', '), why: 'Resolve only facts selected by semantic understanding.' },
    args: item?.args || {}, ok: Boolean(item?.ok), code: oneLine(item?.code || (item?.ok ? 'OK' : 'ERROR'), 100),
    observedAt: oneLine(item?.observedAt || '', 100), source: oneLine(item?.provenance || item?.source || '', 140), data: {},
    warnings: stringList(item?.warnings), cache: oneLine(item?.cache || '', 20), requestedFacts: [...(item?.requestedFacts || [])]
  }));
}

function latestRequest(options = {}, transcript = []) {
  return oneLine(options?.latestCustomer?.text || (Array.isArray(transcript) ? [...transcript].reverse().find(item => item?.role === 'customer')?.text : ''), 1200);
}
function analysisWithDialoguePolicy(analysis = {}, policy = {}, financeDecision = null) {
  const compact = compactRuntimeAnalysis(analysis);
  return { ...compact, probe: { ...(compact?.probe || {}), dialoguePolicy: { ...policy, financeDecision: financeDecision || null } } };
}

function factMap(factResolution = {}) {
  return new Map((Array.isArray(factResolution?.evidence) ? factResolution.evidence : []).map(item => [String(item?.path || ''), item]));
}
function known(map, path) {
  const item = map.get(path);
  return item && item.status === 'known' ? item.value : undefined;
}
function humanState(value) {
  const source = oneLine(value, 120);
  return source || '';
}
function isRestorePaymentQuestion(requestText = '') {
  const request = String(requestText || '').toLowerCase();
  return /(?:сколько|скільки).{0,35}(?:оплат|внести|закин|пополн).{0,55}(?:интернет|інтернет|восстанов|віднов|заработ|запрац)/iu.test(request)
    || /(?:чтобы|щоб).{0,45}(?:интернет|інтернет).{0,25}(?:заработ|запрац|восстанов|віднов)/iu.test(request);
}

export function canonicalEvidenceFallbackResult({ requestText = '', factResolution = null, language = '' } = {}) {
  const requested = Array.isArray(factResolution?.requestedFacts) ? factResolution.requestedFacts : [];
  const map = factMap(factResolution || {});
  const requestedEvidence = requested.map(path => map.get(path)).filter(Boolean);
  const allRequestedResolved = requested.length > 0 && requested.every(path => ['known', 'absent'].includes(String(map.get(path)?.status || 'unknown')));
  const uk = String(language || '').toLowerCase() === 'uk';
  const parts = [];

  const balance = known(map, 'subscriber.finance.balance.account');
  const totalDue = known(map, 'subscriber.finance.totalDue');
  const accessState = known(map, 'subscriber.service.accessState');
  const serviceState = known(map, 'subscriber.service.serviceState');
  const tariffName = known(map, 'subscriber.tariff.current.name');
  const tariffPrice = known(map, 'subscriber.tariff.current.price');
  const connectionFamily = known(map, 'subscriber.access.connectionFamily');
  const buildingGpon = known(map, 'building.gpon');
  const contractNumber = known(map, 'subscriber.contract.number');

  if (balance !== undefined && requested.includes('subscriber.finance.balance.account')) {
    const value = moneyText(balance);
    if (value) parts.push(uk ? `Баланс: ${value} грн.` : `Баланс: ${value} грн.`);
  }
  if (totalDue !== undefined && requested.includes('subscriber.finance.totalDue')) {
    const value = moneyText(totalDue);
    if (value) parts.push(uk ? `Поле «до сплати» в Billing: ${value} грн.` : `Поле «к оплате» в Billing: ${value} грн.`);
  }
  if (serviceState !== undefined && requested.includes('subscriber.service.serviceState')) parts.push(uk ? `Стан послуги: ${humanState(serviceState)}.` : `Состояние услуги: ${humanState(serviceState)}.`);
  if (accessState !== undefined && requested.includes('subscriber.service.accessState')) parts.push(uk ? `Доступ: ${humanState(accessState)}.` : `Доступ: ${humanState(accessState)}.`);
  if (tariffName !== undefined && requested.includes('subscriber.tariff.current.name')) parts.push(uk ? `Поточний тариф: ${humanState(tariffName)}.` : `Текущий тариф: ${humanState(tariffName)}.`);
  if (tariffPrice !== undefined && requested.includes('subscriber.tariff.current.price')) {
    const value = moneyText(tariffPrice);
    if (value) parts.push(uk ? `Ціна: ${value} грн.` : `Цена: ${value} грн.`);
  }
  if (connectionFamily !== undefined && requested.includes('subscriber.access.connectionFamily')) parts.push(uk ? `Тип підключення: ${humanState(connectionFamily)}.` : `Тип подключения: ${humanState(connectionFamily)}.`);
  if (buildingGpon !== undefined && requested.includes('building.gpon')) parts.push(uk ? `GPON по будинку: ${humanState(buildingGpon)}.` : `GPON по дому: ${humanState(buildingGpon)}.`);
  if (contractNumber !== undefined && requested.includes('subscriber.contract.number')) parts.push(uk ? `Договір: ${humanState(contractNumber)}.` : `Договор: ${humanState(contractNumber)}.`);

  let complete = allRequestedResolved && parts.length > 0;
  let note = '';
  if (isRestorePaymentQuestion(requestText)) {
    const balanceNumber = numberValue(balance);
    const dueNumber = numberValue(totalDue);
    // A negative balance together with zero/absent Billing totalDue is not enough
    // to infer the business amount that will restore a paused/blocked service.
    if (balanceNumber !== null && balanceNumber < 0 && (dueNumber === null || dueNumber === 0)) {
      note = uk
        ? 'Точну суму саме для відновлення послуги з цих полів однозначно визначити не можна.'
        : 'Точную сумму именно для восстановления услуги по этим полям однозначно определить нельзя.';
      complete = false;
    } else if (dueNumber !== null && dueNumber > 0) {
      note = uk ? `До сплати: ${moneyText(dueNumber)} грн.` : `К оплате: ${moneyText(dueNumber)} грн.`;
    }
  }

  const reply = oneLine([...parts, note].filter(Boolean).join(' '), 1800);
  return {
    used: Boolean(reply),
    reply,
    complete,
    requestedFacts: [...requested],
    resolvedRequestedFacts: requestedEvidence.filter(item => ['known', 'absent'].includes(String(item?.status || ''))).map(item => item.path),
    reason: note ? 'source-backed-facts-with-business-ambiguity' : (complete ? 'all-requested-facts-resolved' : 'partial-canonical-evidence')
  };
}

export async function groundSubscriberReply(options = {}) {
  const originalFactResolution = options?.factResolution || null;
  const compactTranscript = compactRuntimeTranscript(options?.transcript, { maxTurns: 8, maxChars: 380 });
  const requestText = latestRequest(options, compactTranscript);
  const sourceState = originalFactResolution?.context || options?.labState || {};
  const finance = deriveFinanceDecisionEvidence({ requestText, evidence: originalFactResolution?.evidence || [] });
  const dialoguePolicy = buildDialoguePolicyContext({ analysis: options?.analysis, requestText, labState: sourceState, factResolution: originalFactResolution });
  const compactAnalysis = analysisWithDialoguePolicy(options?.analysis, dialoguePolicy, finance.decision);

  if (!originalFactResolution) {
    const legacy = await base.groundSubscriberReply({ ...options, transcript: compactTranscript, analysis: compactAnalysis, factResolution: null });
    return { ...legacy, toolState: updateDialogueMemory({ labState: legacy?.toolState || sourceState, analysis: options?.analysis, requestText, factResolution: null }) };
  }

  const projectedFacts = compactFactResolutionForSynthesis(originalFactResolution);
  const trace = canonicalTrace(originalFactResolution);
  const canonicalFactEvidence = [...(projectedFacts?.evidence || []), ...finance.evidence];
  const draft = options?.draft || {};
  try {
    const finalReply = await generateGroundedSubscriberReply({
      transcript: compactTranscript, latestCustomer: options?.latestCustomer || {}, analysis: compactAnalysis,
      useKnowledge: options?.useKnowledge !== false, behavior: draft?.behavior || options?.behavior || {},
      canonicalFactEvidence, toolEvidence: [], meterContext: options?.meterContext || {}
    });
    const toolState = updateDialogueMemory({ labState: sourceState, analysis: options?.analysis, requestText, factResolution: originalFactResolution });
    return {
      ...draft, ...finalReply, model: [draft?.model, finalReply?.model].filter(Boolean).join(' → '),
      usage: usageTotal(draft?.usage, finalReply?.usage), toolTrace: trace, toolEvidence: [],
      factEvidence: originalFactResolution?.evidence || [], derivedFactEvidence: finance.evidence, financeDecision: finance.decision,
      factDiagnostics: originalFactResolution?.diagnostics || {}, degraded: false, degradationReason: '', toolState
    };
  } catch (error) {
    const toolState = updateDialogueMemory({ labState: sourceState, analysis: options?.analysis, requestText, factResolution: originalFactResolution });
    const evidenceFallback = canonicalEvidenceFallbackResult({
      requestText,
      factResolution: originalFactResolution,
      language: options?.analysis?.probe?.language || ''
    });
    return {
      ...draft,
      reply: evidenceFallback.reply || base.ensureNonEmptyReply(draft?.reply, compactAnalysis, trace),
      subscriberDataNeeded: draft?.subscriberDataNeeded || [],
      toolTrace: trace, toolEvidence: [], factEvidence: originalFactResolution?.evidence || [], derivedFactEvidence: finance.evidence,
      financeDecision: finance.decision, factDiagnostics: originalFactResolution?.diagnostics || {},
      evidenceFallback,
      degraded: true,
      degradationReason: oneLine(error?.message || error, 600), toolState
    };
  }
}
