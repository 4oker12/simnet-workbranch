import { apiCostSummary, saveApiPrice } from './api-cost.js';
import { analyzeSubscriberIntent, generateSubscriberReply, generateCleanModelReply } from './semantic-probe.js';
import { mergeBehaviorProfile, normalizeBehaviorProfile } from './behavior-profile.js';
import { executeOperatorTool } from './live-tool-runtime.js';
import { planLiveDataNeeds } from './live-need-recovery.js';
import {
  AI_OPERATOR_SOFT_TOOL_CAPABILITIES,
  AI_OPERATOR_TOOL_CAPABILITY_DETAILS,
  ensureNonEmptyReply,
  groundSubscriberReply
} from './semantic-tool-broker.js';

const LAB_KEY = 'simnet_ai_operator_lab_v1';
const MAX_MESSAGES = 60;
const MAX_EVENTS = 140;
const MAX_SNAPSHOTS = 40;
const KNOWLEDGE_MODES = new Set(['off', 'auto', 'on', 'ab', 'clean']);
const DISPLAY_MODES = new Set(['answer', 'answer_analysis', 'analysis']);
const CAPABILITIES = AI_OPERATOR_SOFT_TOOL_CAPABILITIES;
const CAPABILITY_DETAILS = AI_OPERATOR_TOOL_CAPABILITY_DETAILS;
const CLEAN_CAPABILITIES = Object.freeze({ billing: false, userside: false, network: false });

const TYPES = Object.freeze({
  GET: 'AI_OPERATOR_LAB_GET',
  SEND: 'AI_OPERATOR_LAB_SEND',
  RESET: 'AI_OPERATOR_LAB_RESET',
  PRICE: 'AI_OPERATOR_LAB_PRICE',
  CONFIG: 'AI_OPERATOR_LAB_CONFIG',
  REPEAT: 'AI_OPERATOR_LAB_REPEAT',
  SNAPSHOT: 'AI_OPERATOR_LAB_SNAPSHOT'
});

let turnPromise = null;

function nowIso() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function compact(value, max = 1200) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeBehavior(value = {}) {
  return normalizeBehaviorProfile(value);
}


function normalizeKnowledgeMode(value) {
  const mode = String(value || 'auto').toLowerCase();
  return KNOWLEDGE_MODES.has(mode) ? mode : 'auto';
}

function normalizeDisplayMode(value) {
  const mode = String(value || 'answer_analysis').toLowerCase();
  return DISPLAY_MODES.has(mode) ? mode : 'answer_analysis';
}

function normalizeMessage(value = {}) {
  return {
    id: String(value.id || id('msg')),
    role: value.role === 'agent' ? 'agent' : 'customer',
    text: compact(value.text, 4000),
    at: String(value.at || nowIso()),
    ...(value.variant ? { variant: String(value.variant) } : {})
  };
}

function normalizeToolState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    pendingCandidate: source.pendingCandidate || null,
    confirmedCaseId: String(source.confirmedCaseId || ''),
    confirmedSubscriber: source.confirmedSubscriber || null,
    invalidatedAt: Number(source.invalidatedAt || 0) || 0
  };
}

function emptyLab() {
  return {
    version: 5,
    id: id('lab'),
    messages: [],
    events: [],
    knowledgeMode: 'auto',
    displayMode: 'answer_analysis',
    behavior: normalizeBehavior(),
    capabilities: { ...CAPABILITIES },
    capabilityDetails: { ...CAPABILITY_DETAILS },
    toolState: normalizeToolState(),
    snapshots: [],
    lastTurnBase: null,
    lastExperiment: null,
    lastMeterTurnId: null,
    lastDecision: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeLab(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLab();
  return {
    version: 5,
    id: String(raw.id || id('lab')),
    messages: (Array.isArray(raw.messages) ? raw.messages : []).slice(-MAX_MESSAGES).map(normalizeMessage),
    events: (Array.isArray(raw.events) ? raw.events : []).slice(-MAX_EVENTS),
    knowledgeMode: normalizeKnowledgeMode(raw.knowledgeMode),
    displayMode: normalizeDisplayMode(raw.displayMode),
    behavior: normalizeBehavior(raw.behavior),
    capabilities: { ...CAPABILITIES },
    capabilityDetails: { ...CAPABILITY_DETAILS },
    toolState: normalizeToolState(raw.toolState),
    snapshots: (Array.isArray(raw.snapshots) ? raw.snapshots : []).slice(-MAX_SNAPSHOTS),
    lastTurnBase: raw.lastTurnBase && typeof raw.lastTurnBase === 'object' ? raw.lastTurnBase : null,
    lastExperiment: raw.lastExperiment && typeof raw.lastExperiment === 'object' ? raw.lastExperiment : null,
    lastMeterTurnId: raw.lastMeterTurnId || null,
    lastDecision: raw.lastDecision && typeof raw.lastDecision === 'object' ? raw.lastDecision : null,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso())
  };
}

async function readLab() {
  const raw = (await chrome.storage.local.get(LAB_KEY))?.[LAB_KEY];
  const lab = normalizeLab(raw || {});
  lab.apiCost = await apiCostSummary(lab.id, lab.lastMeterTurnId);
  return lab;
}

async function writeLab(lab) {
  const next = normalizeLab({ ...lab, updatedAt: nowIso() });
  await chrome.storage.local.set({ [LAB_KEY]: next });
  next.apiCost = await apiCostSummary(next.id, next.lastMeterTurnId);
  return next;
}

function appendMessage(lab, role, textValue, meta = {}) {
  const message = normalizeMessage({ id: id('msg'), role, text: textValue, at: nowIso(), ...meta });
  lab.messages = [...lab.messages, message].slice(-MAX_MESSAGES);
  return message;
}

function appendEvent(lab, type, payload = {}) {
  const event = { id: id('evt'), type: String(type || 'event'), at: nowIso(), ...clone(payload) };
  lab.events = [...lab.events, event].slice(-MAX_EVENTS);
  return event;
}

function usageTotal(...values) {
  return values.reduce((total, value) => {
    const usage = value?.usage || value || {};
    total.prompt_tokens += Number(usage.prompt_tokens || 0);
    total.completion_tokens += Number(usage.completion_tokens || 0);
    total.total_tokens += Number(usage.total_tokens || 0);
    return total;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

function analysisForUi(analysis = {}) {
  return {
    probe: clone(analysis.probe || {}),
    knowledge: clone(analysis.knowledge || {}),
    knowledgeMode: String(analysis.knowledgeMode || ''),
    candidates: clone(analysis.candidates || []),
    readable: String(analysis.decision?.reply || ''),
    model: String(analysis.decision?.model || ''),
    usage: clone(analysis.decision?.usage || {}),
    semanticDiagnostics: clone(analysis.decision?.semanticDiagnostics || {})
  };
}

function fallbackDraft(analysis, error) {
  return {
    reply: ensureNonEmptyReply('', analysis, []),
    subscriberDataNeeded: [],
    unresolvedRequests: clone(analysis?.probe?.unresolvedRequests || []),
    clarificationQuestions: [],
    verificationNeeded: ['LLM-этап формирования черновика не завершился корректно.'],
    nextStepOffered: '',
    basis: ['dialogue'],
    behaviorEffects: {},
    behavior: {},
    model: '',
    usage: {},
    rateLimit: {},
    answerRelevance: null,
    relevanceGate: null,
    degraded: true,
    degradationReason: compact(error?.message || error, 600)
  };
}

function evidenceFirstDraft(analysis = {}, behavior = {}, needs = []) {
  return {
    reply: '',
    subscriberDataNeeded: clone(needs),
    unresolvedRequests: clone(analysis?.probe?.unresolvedRequests || []),
    clarificationQuestions: [],
    verificationNeeded: [],
    nextStepOffered: '',
    basis: ['dialogue', 'semantic-understanding', 'evidence-plan'],
    behaviorEffects: {},
    behavior: clone(behavior),
    model: '',
    usage: {},
    rateLimit: {},
    answerRelevance: null,
    relevanceGate: null,
    degraded: false,
    degradationReason: '',
    evidenceFirst: true
  };
}

function cleanAnalysis(customer = {}, draft = {}) {
  const request = compact(draft?.answerRelevance?.request || customer?.text || '', 500);
  return {
    probe: {
      language: 'other',
      whatUserWants: request,
      latestMessageMeans: request,
      refersTo: '',
      underlyingGoal: '',
      factsSaidByUser: customer?.text ? [compact(customer.text, 700)] : [],
      factsSaidByOperator: [],
      unresolvedRequests: clone(draft?.unresolvedRequests || (request ? [request] : [])),
      ambiguities: [],
      knowledgeNeed: 'none',
      knowledgeReason: 'CLEAN MODEL: внутренняя база и специальные правила провайдера намеренно не передаются.',
      confidence: 0
    },
    knowledge: {
      skipped: true,
      skipReason: 'clean_model',
      usedArticles: [],
      articleEvidence: [],
      relevantInternalKnowledge: [],
      howItApplies: '',
      alreadyEnough: request ? [request] : [],
      mustNotAssume: [],
      hypotheses: [],
      knowledgeGaps: []
    },
    knowledgeMode: 'clean',
    candidates: [],
    decision: {
      reply: 'CLEAN MODEL: только диалог + базовая роль оператора ISP; без SIMNET KB, tool manifest и live READ-tools.',
      model: draft?.model || '',
      usage: clone(draft?.usage || {}),
      rateLimit: clone(draft?.rateLimit || {}),
      semanticDiagnostics: { cleanModel: true, specialContextInjected: false }
    }
  };
}

async function replyVariant({ lab, transcript, customer, analysis, useKnowledge, label }) {
  const liveNeeds = planLiveDataNeeds(analysis);
  let draft;
  if (liveNeeds.length) {
    draft = evidenceFirstDraft(analysis, lab.behavior, liveNeeds);
  } else {
    try {
      draft = await generateSubscriberReply({
        transcript,
        latestCustomer: customer,
        analysis,
        useKnowledge,
        behavior: lab.behavior,
        capabilities: CAPABILITIES,
        meterContext: { scope: lab.id, turnId: customer.id, variant: label }
      });
    } catch (error) {
      draft = fallbackDraft(analysis, error);
    }
  }

  const grounded = await groundSubscriberReply({
    draft,
    transcript,
    latestCustomer: customer,
    analysis,
    useKnowledge,
    labState: lab.toolState,
    execute: executeOperatorTool,
    meterContext: { scope: lab.id, turnId: customer.id, variant: label }
  });
  lab.toolState = normalizeToolState(grounded.toolState || lab.toolState);
  const { toolState: _toolState, ...result } = grounded;

  for (const trace of result.toolTrace || []) {
    appendEvent(lab, 'tool_execution', {
      customerMessageId: customer.id,
      variant: label,
      tool: trace.tool,
      ok: trace.ok,
      code: trace.code,
      source: trace.source,
      requestedBy: trace.requestedBy,
      args: trace.args,
      data: trace.data,
      warnings: trace.warnings
    });
  }

  appendEvent(lab, 'answer_relevance', {
    customerMessageId: customer.id,
    variant: label,
    answerRelevance: clone(result.answerRelevance || draft?.answerRelevance || null),
    gate: clone(result.relevanceGate || null),
    evidenceFirst: Boolean(draft?.evidenceFirst)
  });

  return { label, useKnowledge, ...result, behavior: clone(lab.behavior), evidenceFirst: Boolean(draft?.evidenceFirst) };
}

async function cleanVariant({ lab, transcript, customer }) {
  const draft = await generateCleanModelReply({
    transcript,
    latestCustomer: customer,
    behavior: lab.behavior,
    meterContext: { scope: lab.id, turnId: customer.id, variant: 'clean_model' }
  });
  const variant = {
    label: 'clean_model',
    useKnowledge: false,
    ...draft,
    behavior: clone(lab.behavior),
    subscriberDataNeeded: [],
    toolTrace: [],
    toolEvidence: [],
    relevanceGate: { skipped: true, reason: 'clean_model_has_no_grounded_sources' }
  };
  appendEvent(lab, 'answer_relevance', {
    customerMessageId: customer.id,
    variant: 'clean_model',
    answerRelevance: clone(variant.answerRelevance || null),
    gate: clone(variant.relevanceGate)
  });
  return variant;
}

async function executeExperiment(lab, baseMessages, customer) {
  const startedAt = performance.now();
  const requestedMode = normalizeKnowledgeMode(lab.knowledgeMode);
  const transcript = [...baseMessages, customer];
  const variants = [];
  const answerRequired = lab.displayMode !== 'analysis' || requestedMode === 'ab';
  let analysis;

  if (requestedMode === 'clean') {
    if (answerRequired) {
      const variant = await cleanVariant({ lab, transcript, customer });
      variants.push(variant);
      analysis = cleanAnalysis(customer, variant);
    } else {
      analysis = cleanAnalysis(customer, {});
    }
  } else {
    const analysisMode = requestedMode === 'ab' ? 'on' : requestedMode;
    analysis = await analyzeSubscriberIntent({
      transcript,
      latestCustomer: customer,
      knowledgeMode: analysisMode,
      meterContext: { scope: lab.id, turnId: customer.id }
    });

    if (answerRequired && requestedMode === 'ab') {
      variants.push(await replyVariant({ lab, transcript, customer, analysis, useKnowledge: false, label: 'without_knowledge' }));
      variants.push(await replyVariant({ lab, transcript, customer, analysis, useKnowledge: true, label: 'with_knowledge' }));
    } else if (answerRequired) {
      const useKnowledge = requestedMode === 'on' || (requestedMode === 'auto' && !analysis.knowledge?.skipped);
      variants.push(await replyVariant({ lab, transcript, customer, analysis, useKnowledge, label: useKnowledge ? 'with_knowledge' : 'without_knowledge' }));
    }
  }

  const activeVariant = requestedMode === 'ab'
    ? variants.find(item => item.label === 'with_knowledge') || variants[0]
    : variants[0];
  if (activeVariant && !compact(activeVariant.reply, 2200)) activeVariant.reply = ensureNonEmptyReply('', analysis, activeVariant.toolTrace || []);

  const elapsedMs = Math.round(performance.now() - startedAt);
  const totalUsage = usageTotal(analysis.decision?.usage, ...variants.map(item => item.usage));
  const model = [analysis.decision?.model, ...variants.map(item => item.model)].filter(Boolean).join(' → ');
  const toolCalls = variants.reduce((sum, item) => sum + Number(item.toolTrace?.length || 0), 0);
  const experimentCapabilities = requestedMode === 'clean' ? CLEAN_CAPABILITIES : CAPABILITIES;
  const experimentDetails = requestedMode === 'clean'
    ? { mode: 'clean-model', billing: 'OFF', userside: 'OFF', network: 'OFF', toolManifestVersion: 'none', toolCount: 0 }
    : CAPABILITY_DETAILS;

  const experiment = {
    id: id('exp'),
    at: nowIso(),
    customerMessageId: customer.id,
    knowledgeMode: requestedMode,
    displayMode: lab.displayMode,
    behavior: clone(lab.behavior),
    capabilities: { ...experimentCapabilities },
    capabilityDetails: { ...experimentDetails },
    elapsedMs,
    analysis: analysisForUi(analysis),
    variants: clone(variants),
    activeVariant: activeVariant?.label || '',
    usage: totalUsage,
    model,
    toolCalls
  };

  lab.lastExperiment = experiment;
  lab.lastDecision = {
    action: requestedMode === 'clean'
      ? (variants.length ? 'clean_model_reply' : 'clean_model_analysis')
      : (variants.length ? (toolCalls ? 'semantic_tool_reply' : 'semantic_reply') : 'semantic_analysis'),
    intent: analysis.probe?.whatUserWants || 'unknown',
    reply: activeVariant?.reply || '',
    reason: requestedMode === 'clean'
      ? 'Manual Lab CLEAN MODEL: только диалог + базовая роль ISP; без SIMNET KB, tool manifest и READ-tools.'
      : 'Manual Lab: UNDERSTANDING → KB при необходимости → evidence plan → READ → один финальный synthesis → локальная проверка. Для live-запросов слепой pre-tool draft пропускается.',
    confidence: Number(analysis.probe?.confidence || 0),
    language: analysis.probe?.language || 'other',
    model,
    usage: totalUsage,
    rateLimit: activeVariant?.rateLimit || analysis.decision?.rateLimit || {},
    diagnostic: {
      knowledgeMode: requestedMode,
      displayMode: lab.displayMode,
      cleanModel: requestedMode === 'clean',
      behavior: clone(lab.behavior),
      capabilities: { ...experimentCapabilities },
      capabilityDetails: { ...experimentDetails },
      elapsedMs,
      understanding: clone(analysis.probe || {}),
      semanticDiagnostics: clone(analysis.decision?.semanticDiagnostics || {}),
      knowledge: clone(analysis.knowledge || {}),
      variants: clone(variants.map(item => ({
        label: item.label,
        evidenceFirst: Boolean(item.evidenceFirst),
        subscriberDataNeeded: item.subscriberDataNeeded,
        unresolvedRequests: item.unresolvedRequests,
        clarificationQuestions: item.clarificationQuestions,
        verificationNeeded: item.verificationNeeded,
        nextStepOffered: item.nextStepOffered,
        basis: item.basis,
        answerRelevance: item.answerRelevance || null,
        relevanceGate: item.relevanceGate || null,
        behaviorEffects: item.behaviorEffects,
        toolTrace: item.toolTrace,
        degraded: Boolean(item.degraded),
        degradationReason: item.degradationReason || '',
        model: item.model,
        usage: item.usage
      })))
    }
  };

  appendEvent(lab, 'semantic_analysis', {
    customerMessageId: customer.id,
    knowledgeMode: requestedMode,
    confidence: analysis.probe?.confidence || 0,
    knowledgeNeed: analysis.probe?.knowledgeNeed || '',
    knowledgeUsed: requestedMode === 'clean' ? false : !analysis.knowledge?.skipped,
    articles: requestedMode === 'clean' ? [] : (analysis.knowledge?.usedArticles || []).map(item => item.id),
    unresolvedRequests: analysis.probe?.unresolvedRequests || [],
    cleanModel: requestedMode === 'clean'
  });
  appendEvent(lab, 'experiment_result', {
    experimentId: experiment.id,
    mode: requestedMode,
    variants: variants.map(item => ({
      label: item.label,
      model: item.model,
      tokens: Number(item.usage?.total_tokens || 0),
      toolCalls: Number(item.toolTrace?.length || 0),
      degraded: Boolean(item.degraded),
      evidenceFirst: Boolean(item.evidenceFirst)
    })),
    toolCalls,
    elapsedMs,
    totalTokens: Number(totalUsage.total_tokens || 0)
  });

  if (activeVariant?.reply && lab.displayMode !== 'analysis') appendMessage(lab, 'agent', activeVariant.reply, { variant: activeVariant.label });
  return experiment;
}

export async function runIsolatedLabCase({
  text,
  transcript = [],
  knowledgeMode = 'auto',
  behavior = {},
  toolState = {},
  scope = ''
} = {}) {
  const incoming = compact(text, 4000);
  if (!incoming) throw new Error('Пустая реплика пакетного теста.');

  const lab = emptyLab();
  lab.id = compact(scope, 180) || id('batch_lab');
  lab.knowledgeMode = normalizeKnowledgeMode(knowledgeMode);
  lab.displayMode = 'answer_analysis';
  lab.behavior = normalizeBehavior(behavior);
  lab.toolState = normalizeToolState(toolState);

  const baseMessages = (Array.isArray(transcript) ? transcript : [])
    .map(normalizeMessage)
    .slice(-MAX_MESSAGES);
  const customer = normalizeMessage({ id: id('msg'), role: 'customer', text: incoming, at: nowIso() });

  await executeExperiment(lab, baseMessages, customer);
  return {
    experiment: clone(lab.lastExperiment),
    decision: clone(lab.lastDecision),
    toolState: clone(lab.toolState),
    events: clone(lab.events)
  };
}

function recoveryAnalysis(customer = {}) {
  const customerText = compact(customer?.text || '', 1400);
  return {
    probe: {
      whatUserWants: customerText,
      latestMessageMeans: customerText,
      unresolvedRequests: customerText ? [customerText] : [],
      factsSaidByUser: customerText ? [customerText] : [],
      language: 'other',
      confidence: 0
    },
    knowledge: { skipped: true, usedArticles: [], articleEvidence: [] },
    knowledgeMode: 'off',
    candidates: [],
    decision: { reply: '', model: '', usage: {}, rateLimit: {} }
  };
}

function subscriberFacingRecoveryReply(customer = {}) {
  const source = compact(customer?.text || '', 1000).toLowerCase();
  if (/баланс|сч[её]т|рахун|долг|борг/.test(source)) return 'Сейчас не получается проверить данные по вашему счёту. Попробуйте, пожалуйста, отправить запрос ещё раз.';
  if (/тариф|пакет|скорост|швидк|гиг/.test(source)) return 'Сейчас не получается проверить данные по вашему тарифу. Попробуйте, пожалуйста, отправить запрос ещё раз.';
  return 'Сейчас не получается проверить данные по вашему обращению. Попробуйте, пожалуйста, отправить запрос ещё раз.';
}

async function recoverCleanTurn(lab, customer, failure) {
  const reply = subscriberFacingRecoveryReply(customer);
  const analysis = cleanAnalysis(customer, {});
  const variant = {
    label: 'clean_model',
    useKnowledge: false,
    reply,
    subscriberDataNeeded: [],
    unresolvedRequests: [compact(customer?.text || '', 500)].filter(Boolean),
    clarificationQuestions: [],
    verificationNeeded: [],
    nextStepOffered: '',
    basis: ['dialogue', 'clean-model'],
    answerRelevance: null,
    relevanceGate: { skipped: true, reason: 'clean_model_error' },
    behaviorEffects: {},
    behavior: clone(lab.behavior),
    model: '',
    usage: {},
    rateLimit: {},
    toolTrace: [],
    toolEvidence: [],
    degraded: true,
    degradationReason: failure
  };
  lab.lastExperiment = {
    id: id('exp'), at: nowIso(), customerMessageId: customer.id,
    knowledgeMode: 'clean', displayMode: lab.displayMode,
    behavior: clone(lab.behavior), capabilities: { ...CLEAN_CAPABILITIES },
    capabilityDetails: { mode: 'clean-model', billing: 'OFF', userside: 'OFF', network: 'OFF', toolCount: 0 },
    elapsedMs: 0, analysis: analysisForUi(analysis), variants: [variant], activeVariant: 'clean_model', usage: {}, model: '', toolCalls: 0
  };
  lab.lastDecision = {
    action: 'clean_model_degraded', intent: customer.text || 'unknown', reply,
    reason: 'CLEAN MODEL fallback; SIMNET KB/tools remain disabled.', confidence: 0, language: 'other', model: '', usage: {}, rateLimit: {},
    diagnostic: { error: failure, degraded: true, cleanModel: true, toolCalls: 0 }
  };
  appendEvent(lab, 'turn_degraded', { customerMessageId: customer.id, error: failure, toolCalls: 0, cleanModel: true });
  if (lab.displayMode !== 'analysis') appendMessage(lab, 'agent', reply, { variant: 'clean_model' });
}

async function recoverTurn(lab, baseMessages, customer, error) {
  const failure = compact(error?.message || error || 'unknown error', 800);
  if (normalizeKnowledgeMode(lab.knowledgeMode) === 'clean') {
    await recoverCleanTurn(lab, customer, failure);
    return;
  }

  const transcript = [...(Array.isArray(baseMessages) ? baseMessages : []), customer];
  const analysis = recoveryAnalysis(customer);
  const recoveryDraft = {
    reply: subscriberFacingRecoveryReply(customer),
    subscriberDataNeeded: [],
    unresolvedRequests: [],
    clarificationQuestions: [],
    verificationNeeded: [],
    nextStepOffered: '',
    basis: ['dialogue'],
    behaviorEffects: {},
    behavior: {},
    model: '',
    usage: {},
    rateLimit: {},
    degraded: true,
    degradationReason: failure
  };

  let grounded;
  try {
    grounded = await groundSubscriberReply({
      draft: recoveryDraft,
      transcript,
      latestCustomer: customer,
      analysis,
      useKnowledge: false,
      labState: lab.toolState,
      execute: executeOperatorTool,
      meterContext: { scope: lab.id, turnId: customer.id, variant: 'degraded' }
    });
  } catch (groundError) {
    grounded = {
      ...recoveryDraft,
      reply: subscriberFacingRecoveryReply(customer),
      toolTrace: [],
      toolEvidence: [],
      toolState: lab.toolState,
      degradationReason: `${failure}; recovery: ${compact(groundError?.message || groundError, 500)}`
    };
  }

  lab.toolState = normalizeToolState(grounded.toolState || lab.toolState);
  const reply = compact(grounded.reply, 2200) || subscriberFacingRecoveryReply(customer);
  const toolTrace = Array.isArray(grounded.toolTrace) ? grounded.toolTrace : [];
  const toolEvidence = Array.isArray(grounded.toolEvidence) ? grounded.toolEvidence : toolTrace.filter(item => item?.ok);

  for (const trace of toolTrace) {
    appendEvent(lab, 'tool_execution', {
      customerMessageId: customer.id,
      variant: 'degraded',
      tool: trace.tool,
      ok: trace.ok,
      code: trace.code,
      source: trace.source,
      requestedBy: trace.requestedBy,
      args: trace.args,
      data: trace.data,
      warnings: trace.warnings
    });
  }

  const variant = {
    ...recoveryDraft,
    ...grounded,
    label: 'degraded',
    useKnowledge: false,
    reply,
    behavior: clone(lab.behavior),
    toolTrace: clone(toolTrace),
    toolEvidence: clone(toolEvidence),
    degraded: true,
    degradationReason: compact(grounded.degradationReason || failure, 800)
  };
  lab.lastExperiment = {
    id: id('exp'), at: nowIso(), customerMessageId: customer.id,
    knowledgeMode: lab.knowledgeMode, displayMode: lab.displayMode,
    behavior: clone(lab.behavior), capabilities: { ...CAPABILITIES }, capabilityDetails: { ...CAPABILITY_DETAILS },
    elapsedMs: 0, analysis: analysisForUi(analysis), variants: [variant], activeVariant: 'degraded', usage: {}, model: '', toolCalls: toolTrace.length
  };
  lab.lastDecision = {
    action: toolTrace.length ? 'degraded_tool_reply' : 'degraded_reply',
    intent: customer.text || 'unknown',
    reply,
    reason: 'Subscriber-facing fallback; внутренняя причина сбоя остаётся только в diagnostic/trace.',
    confidence: 0, language: 'other', model: '', usage: {}, rateLimit: {},
    diagnostic: { error: failure, degraded: true, toolCalls: toolTrace.length, answerRelevance: grounded.answerRelevance || null, relevanceGate: grounded.relevanceGate || null }
  };
  appendEvent(lab, 'turn_degraded', { customerMessageId: customer.id, error: failure, toolCalls: toolTrace.length });
  appendMessage(lab, 'agent', reply, { variant: 'degraded' });
}

async function runTurn(customerText) {
  const lab = await readLab();
  const incoming = compact(customerText, 4000);
  if (!incoming) throw new Error('Напиши сообщение от имени абонента.');
  const baseMessages = clone(lab.messages);
  const customer = appendMessage(lab, 'customer', incoming);
  lab.lastMeterTurnId = customer.id;
  lab.lastTurnBase = { messagesBefore: baseMessages, customer: clone(customer) };
  appendEvent(lab, 'customer_message', { messageId: customer.id, text: incoming });
  await writeLab(lab);
  try { await executeExperiment(lab, baseMessages, customer); }
  catch (error) { await recoverTurn(lab, baseMessages, customer, error); }
  return writeLab(lab);
}

async function repeatLastTurn() {
  const lab = await readLab();
  const base = lab.lastTurnBase;
  if (!base?.customer || !Array.isArray(base.messagesBefore)) throw new Error('Сначала отправь хотя бы одну реплику абонента.');
  const customer = normalizeMessage({ ...base.customer, id: id('msg'), at: nowIso() });
  lab.messages = [...base.messagesBefore.map(normalizeMessage), customer].slice(-MAX_MESSAGES);
  lab.lastMeterTurnId = customer.id;
  lab.lastTurnBase = { messagesBefore: clone(base.messagesBefore), customer: clone(customer) };
  appendEvent(lab, 'repeat_turn', { messageId: customer.id, knowledgeMode: lab.knowledgeMode, behavior: clone(lab.behavior) });
  await writeLab(lab);
  try { await executeExperiment(lab, clone(base.messagesBefore), customer); }
  catch (error) { await recoverTurn(lab, clone(base.messagesBefore), customer, error); }
  return writeLab(lab);
}

async function updateConfig(payload = {}) {
  if (turnPromise) throw new Error('Дождитесь завершения текущего ответа перед изменением профиля.');
  const lab = await readLab();
  if (payload.knowledgeMode != null) lab.knowledgeMode = normalizeKnowledgeMode(payload.knowledgeMode);
  if (payload.displayMode != null) lab.displayMode = normalizeDisplayMode(payload.displayMode);
  if (payload.behavior != null) lab.behavior = mergeBehaviorProfile(lab.behavior, payload.behavior);
  appendEvent(lab, 'profile_change', { knowledgeMode: lab.knowledgeMode, displayMode: lab.displayMode, behavior: clone(lab.behavior) });
  return writeLab(lab);
}

async function takeSnapshot(payload = {}) {
  if (turnPromise) throw new Error('Дождитесь завершения текущего ответа перед слепком.');
  const lab = await readLab();
  if (!lab.lastExperiment) throw new Error('Пока нечего сохранять: сначала прогони реплику.');
  const snapshot = {
    id: id('snap'),
    at: nowIso(),
    note: compact(payload.note || '', 500),
    knowledgeMode: lab.knowledgeMode,
    displayMode: lab.displayMode,
    behavior: clone(lab.behavior),
    capabilities: { ...CAPABILITIES },
    capabilityDetails: { ...CAPABILITY_DETAILS },
    toolState: clone(lab.toolState),
    turnBase: clone(lab.lastTurnBase),
    experiment: clone(lab.lastExperiment)
  };
  lab.snapshots = [...lab.snapshots, snapshot].slice(-MAX_SNAPSHOTS);
  appendEvent(lab, 'snapshot', { snapshotId: snapshot.id, note: snapshot.note });
  return writeLab(lab);
}

async function resetLab() {
  if (turnPromise) throw new Error('Дождитесь завершения текущего ответа перед сбросом диалога.');
  const current = await readLab();
  const next = emptyLab();
  next.knowledgeMode = current.knowledgeMode;
  next.displayMode = current.displayMode;
  next.behavior = clone(current.behavior);
  next.snapshots = clone(current.snapshots);
  await chrome.storage.local.set({ [LAB_KEY]: next });
  next.apiCost = await apiCostSummary(next.id, null);
  return next;
}

async function serialized(action) {
  if (turnPromise) throw new Error('AI уже обрабатывает предыдущее сообщение.');
  turnPromise = Promise.resolve().then(action).finally(() => { turnPromise = null; });
  return turnPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;

  let action;
  if (type === TYPES.GET) action = readLab();
  else if (type === TYPES.PRICE) action = saveApiPrice(message?.payload).then(() => readLab());
  else if (type === TYPES.RESET) action = resetLab();
  else if (type === TYPES.CONFIG) action = updateConfig(message?.payload || {});
  else if (type === TYPES.SNAPSHOT) action = takeSnapshot(message?.payload || {});
  else if (type === TYPES.REPEAT) action = serialized(() => repeatLastTurn());
  else action = serialized(() => runTurn(message?.payload?.text || ''));

  void action.then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({ success: false, error: compact(error?.message || error || 'AI operator Test Lab error', 1200) })
  );
  return true;
});

export const AI_OPERATOR_LAB_MESSAGE_TYPES = TYPES;
export const AI_OPERATOR_LAB_KEY = LAB_KEY;
export const AI_OPERATOR_LAB_CAPABILITIES = CAPABILITIES;