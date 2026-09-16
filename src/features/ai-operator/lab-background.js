import { apiCostSummary, saveApiPrice } from './api-cost.js';
import { analyzeSubscriberIntent, generateSubscriberReply } from './semantic-probe.js';

const LAB_KEY = 'simnet_ai_operator_lab_v1';
const MAX_MESSAGES = 60;
const MAX_EVENTS = 140;
const MAX_SNAPSHOTS = 40;
const KNOWLEDGE_MODES = new Set(['off', 'auto', 'on', 'ab']);
const DISPLAY_MODES = new Set(['answer', 'answer_analysis', 'analysis']);
const CAPABILITIES = Object.freeze({ billing: false, userside: false, network: false });

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

function clamp(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function normalizeBehavior(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    confidenceStyle: clamp(source.confidenceStyle, 45),
    curiosity: clamp(source.curiosity, 55),
    initiative: clamp(source.initiative, 50),
    skepticism: clamp(source.skepticism, 75),
    brevity: clamp(source.brevity, 65),
    maxFollowUpQuestions: Math.max(1, Math.min(3, Math.round(Number(source.maxFollowUpQuestions || 2))))
  };
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

function emptyLab() {
  return {
    version: 2,
    id: id('lab'),
    messages: [],
    events: [],
    knowledgeMode: 'auto',
    displayMode: 'answer_analysis',
    behavior: normalizeBehavior(),
    capabilities: { ...CAPABILITIES },
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
    version: 2,
    id: String(raw.id || id('lab')),
    messages: (Array.isArray(raw.messages) ? raw.messages : []).slice(-MAX_MESSAGES).map(normalizeMessage),
    events: (Array.isArray(raw.events) ? raw.events : []).slice(-MAX_EVENTS),
    knowledgeMode: normalizeKnowledgeMode(raw.knowledgeMode),
    displayMode: normalizeDisplayMode(raw.displayMode),
    behavior: normalizeBehavior(raw.behavior),
    capabilities: { ...CAPABILITIES },
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
    usage: clone(analysis.decision?.usage || {})
  };
}

async function replyVariant({ lab, transcript, customer, analysis, useKnowledge, label }) {
  const result = await generateSubscriberReply({
    transcript,
    latestCustomer: customer,
    analysis,
    useKnowledge,
    behavior: lab.behavior,
    capabilities: CAPABILITIES,
    meterContext: { scope: lab.id, turnId: customer.id, variant: label }
  });
  return { label, useKnowledge, ...result };
}

async function executeExperiment(lab, baseMessages, customer) {
  const startedAt = performance.now();
  const requestedMode = normalizeKnowledgeMode(lab.knowledgeMode);
  const transcript = [...baseMessages, customer];
  const analysisMode = requestedMode === 'ab' ? 'on' : requestedMode;
  const analysis = await analyzeSubscriberIntent({
    transcript,
    latestCustomer: customer,
    knowledgeMode: analysisMode,
    meterContext: { scope: lab.id, turnId: customer.id }
  });

  const variants = [];
  const answerRequired = lab.displayMode !== 'analysis' || requestedMode === 'ab';
  if (answerRequired && requestedMode === 'ab') {
    variants.push(await replyVariant({ lab, transcript, customer, analysis, useKnowledge: false, label: 'without_knowledge' }));
    variants.push(await replyVariant({ lab, transcript, customer, analysis, useKnowledge: true, label: 'with_knowledge' }));
  } else if (answerRequired) {
    const useKnowledge = requestedMode === 'on' || (requestedMode === 'auto' && !analysis.knowledge?.skipped);
    variants.push(await replyVariant({ lab, transcript, customer, analysis, useKnowledge, label: useKnowledge ? 'with_knowledge' : 'without_knowledge' }));
  }

  const activeVariant = requestedMode === 'ab'
    ? variants.find(item => item.label === 'with_knowledge') || variants[0]
    : variants[0];
  const elapsedMs = Math.round(performance.now() - startedAt);
  const totalUsage = usageTotal(analysis.decision?.usage, ...variants.map(item => item.usage));
  const model = [analysis.decision?.model, ...variants.map(item => item.model)].filter(Boolean).join(' → ');

  const experiment = {
    id: id('exp'),
    at: nowIso(),
    customerMessageId: customer.id,
    knowledgeMode: requestedMode,
    displayMode: lab.displayMode,
    behavior: clone(lab.behavior),
    capabilities: { ...CAPABILITIES },
    elapsedMs,
    analysis: analysisForUi(analysis),
    variants: clone(variants),
    activeVariant: activeVariant?.label || '',
    usage: totalUsage,
    model
  };

  lab.lastExperiment = experiment;
  lab.lastDecision = {
    action: variants.length ? 'semantic_reply' : 'semantic_analysis',
    intent: analysis.probe?.whatUserWants || 'unknown',
    reply: activeVariant?.reply || '',
    reason: `Manual Lab semantic experiment · KB ${requestedMode} · fact-runtime не участвует.`,
    confidence: Number(analysis.probe?.confidence || 0),
    language: analysis.probe?.language || 'other',
    model,
    usage: totalUsage,
    rateLimit: activeVariant?.rateLimit || analysis.decision?.rateLimit || {},
    diagnostic: {
      knowledgeMode: requestedMode,
      displayMode: lab.displayMode,
      behavior: clone(lab.behavior),
      elapsedMs,
      understanding: clone(analysis.probe || {}),
      knowledge: clone(analysis.knowledge || {}),
      variants: clone(variants.map(item => ({
        label: item.label,
        subscriberDataNeeded: item.subscriberDataNeeded,
        unresolvedRequests: item.unresolvedRequests,
        clarificationQuestions: item.clarificationQuestions,
        verificationNeeded: item.verificationNeeded,
        nextStepOffered: item.nextStepOffered,
        basis: item.basis,
        behaviorEffects: item.behaviorEffects,
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
    knowledgeUsed: !analysis.knowledge?.skipped,
    articles: (analysis.knowledge?.usedArticles || []).map(item => item.id),
    unresolvedRequests: analysis.probe?.unresolvedRequests || []
  });
  appendEvent(lab, 'experiment_result', {
    experimentId: experiment.id,
    mode: requestedMode,
    variants: variants.map(item => ({ label: item.label, model: item.model, tokens: Number(item.usage?.total_tokens || 0) })),
    elapsedMs,
    totalTokens: Number(totalUsage.total_tokens || 0)
  });

  if (activeVariant?.reply) appendMessage(lab, 'agent', activeVariant.reply, { variant: activeVariant.label });
  return experiment;
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
  await executeExperiment(lab, baseMessages, customer);
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
  await executeExperiment(lab, clone(base.messagesBefore), customer);
  return writeLab(lab);
}

async function updateConfig(payload = {}) {
  if (turnPromise) throw new Error('Дождитесь завершения текущего ответа перед изменением профиля.');
  const lab = await readLab();
  if (payload.knowledgeMode != null) lab.knowledgeMode = normalizeKnowledgeMode(payload.knowledgeMode);
  if (payload.displayMode != null) lab.displayMode = normalizeDisplayMode(payload.displayMode);
  if (payload.behavior != null) lab.behavior = normalizeBehavior({ ...lab.behavior, ...payload.behavior });
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