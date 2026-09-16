import { apiCostSummary, saveApiPrice } from './api-cost.js';
import { basicConfirmationValue } from './basic-case-router.js';
import { interpretOperatorTurn } from './groq-planner.js';
import { executeOperatorTool } from './live-tool-runtime.js';
import { runFactTurn } from './fact-runtime.js';

const LAB_KEY = 'simnet_ai_operator_lab_v1';
const OPERATOR_CONFIG_KEY = 'simnet_ai_operator_runtime_v1';
const FEEDBACK_KEY = 'simnet_ai_operator_feedback_v1';
const MAX_MESSAGES = 60;
const MAX_EVENTS = 140;
const MAX_TOOL_TURNS = 6;
const MAX_CONTEXT_TOOL_RESULTS = 6;

const TYPES = Object.freeze({
  GET: 'AI_OPERATOR_LAB_GET',
  SEND: 'AI_OPERATOR_LAB_SEND',
  RESET: 'AI_OPERATOR_LAB_RESET',
  PRICE: 'AI_OPERATOR_LAB_PRICE'
});

let turnPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function compact(value, max = 1200) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeContextToolResults(value) {
  return (Array.isArray(value) ? value : [])
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .slice(-MAX_CONTEXT_TOOL_RESULTS)
    .map(clone);
}

function emptyLab() {
  return {
    version: 1,
    id: id('lab'),
    messages: [],
    events: [],
    pendingCandidate: null,
    confirmedCaseId: '',
    confirmedSubscriber: null,
    contextToolResults: [],
    conversationState: null,
    lastMeterTurnId: null,
    lastDecision: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeLab(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLab();
  return {
    version: 1,
    id: String(raw.id || id('lab')),
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-MAX_MESSAGES) : [],
    events: Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [],
    pendingCandidate: raw.pendingCandidate && typeof raw.pendingCandidate === 'object'
      ? raw.pendingCandidate
      : null,
    confirmedCaseId: String(raw.confirmedCaseId || ''),
    confirmedSubscriber: raw.confirmedSubscriber && typeof raw.confirmedSubscriber === 'object'
      ? raw.confirmedSubscriber
      : null,
    contextToolResults: normalizeContextToolResults(raw.contextToolResults),
    lastMeterTurnId: raw.lastMeterTurnId || null,
    conversationState: raw.conversationState && typeof raw.conversationState === 'object' ? raw.conversationState : null,
    lastDecision: raw.lastDecision && typeof raw.lastDecision === 'object'
      ? raw.lastDecision
      : null,
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

async function readOperatorConfig() {
  const stored = await chrome.storage.local.get([OPERATOR_CONFIG_KEY, FEEDBACK_KEY]);
  const rawConfig = stored?.[OPERATOR_CONFIG_KEY];
  const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
    ? rawConfig
    : {};
  const feedback = Array.isArray(stored?.[FEEDBACK_KEY]) ? stored[FEEDBACK_KEY] : [];
  return { config, feedback };
}

function appendMessage(lab, role, textValue, meta = {}) {
  const message = {
    id: id('msg'),
    role: role === 'agent' ? 'agent' : 'customer',
    text: compact(textValue, 4000),
    at: nowIso(),
    ...meta
  };
  lab.messages = [...lab.messages, message].slice(-MAX_MESSAGES);
  return message;
}

function appendEvent(lab, type, payload = {}) {
  const event = {
    id: id('evt'),
    type: String(type || 'event'),
    at: nowIso(),
    ...clone(payload)
  };
  lab.events = [...lab.events, event].slice(-MAX_EVENTS);
  return event;
}

async function runTurn(customerText) {
  const lab = await readLab();
  const incoming = compact(customerText, 4000);
  if (!incoming) throw new Error('Напиши сообщение от имени абонента.');
  const message = appendMessage(lab, 'customer', incoming);
  lab.lastMeterTurnId = message.id;
  const confirmationOnly = value => basicConfirmationValue(value) !== null;
  appendEvent(lab, 'customer_message', { messageId: message.id, text: incoming, confirmationOnly: confirmationOnly(incoming) });
  await writeLab(lab);
  const { config } = await readOperatorConfig();
  const outcome = await runFactTurn({
    text: incoming,
    state: lab.conversationState || {
      confirmedCaseId: lab.confirmedCaseId,
      confirmedSubscriber: lab.confirmedSubscriber,
      pendingCandidate: lab.pendingCandidate
    },
    transcript: lab.messages,
    interpret: input => interpretOperatorTurn({ ...input, operatorConfig: config, meterContext: { scope: lab.id, turnId: message.id } }),
    execute: executeOperatorTool,
    maxReads: MAX_TOOL_TURNS,
    onEvent: async (event, state) => {
      appendEvent(lab, event.type, event);
      lab.conversationState = state;
      await writeLab(lab);
    }
  });
  // REPEATED_TOOL_CALL is prevented by the shared resolver's per-turn source cache.
  lab.conversationState = outcome.state;
  lab.confirmedCaseId = outcome.state.confirmedCaseId;
  lab.confirmedSubscriber = outcome.state.confirmedSubscriber;
  lab.pendingCandidate = outcome.state.pendingCandidate;
  // Legacy UI projection only; authoritative memory is conversationState.facts.
  lab.contextToolResults = outcome.events.filter(e => e.type === 'tool_result').slice(-MAX_CONTEXT_TOOL_RESULTS);
  lab.lastDecision = outcome.decision;
  appendEvent(lab, 'decision', { ...outcome.decision, promptTokens: outcome.decision.usage?.prompt_tokens || 0 });
  if (outcome.decision.reply) appendMessage(lab, 'agent', outcome.decision.reply, {
    action: outcome.decision.action, intent: outcome.decision.intent, model: outcome.decision.model
  });
  return writeLab(lab);
}

async function resetLab() {
  if (turnPromise) throw new Error('Дождитесь завершения текущего ответа перед сбросом диалога.');
  const next = emptyLab();
  await chrome.storage.local.set({ [LAB_KEY]: next });
  next.apiCost = await apiCostSummary(next.id, null);
  return next;
}

async function serializedTurn(textValue) {
  if (turnPromise) throw new Error('AI уже обрабатывает предыдущее сообщение.');
  turnPromise = runTurn(textValue).finally(() => { turnPromise = null; });
  return turnPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;

  const action = type === TYPES.GET
    ? readLab()
    : type === TYPES.PRICE
      ? saveApiPrice(message?.payload).then(() => readLab())
    : type === TYPES.RESET
      ? resetLab()
      : serializedTurn(message?.payload?.text || '');

  void action.then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({
      success: false,
      error: compact(error?.message || error || 'AI operator Test Lab error', 1200)
    })
  );
  return true;
});

export const AI_OPERATOR_LAB_MESSAGE_TYPES = TYPES;
export const AI_OPERATOR_LAB_KEY = LAB_KEY;
