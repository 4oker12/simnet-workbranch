import { interpretOperatorTurn as planAutonomousTurn } from './groq-planner.js';
import { runFactTurn } from './fact-runtime.js';

const OPERATOR_CONFIG_KEY = 'simnet_ai_operator_runtime_v1';
const FEEDBACK_KEY = 'simnet_ai_operator_feedback_v1';
const RESULTS_KEY = 'simnet_ai_operator_replay_results_v1';
const MAX_RESULTS = 1000;

const TYPES = Object.freeze({
  EVALUATE: 'AI_OPERATOR_REPLAY_EVALUATE',
  RECORD: 'AI_OPERATOR_REPLAY_RECORD',
  RESULTS: 'AI_OPERATOR_REPLAY_RESULTS',
  CLEAR: 'AI_OPERATOR_REPLAY_CLEAR'
});

function compact(value, max = 4000) {
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

function normalizedCase(raw = {}) {
  const transcript = Array.isArray(raw.transcript)
    ? raw.transcript.slice(-40).map(item => ({
        id: Number(item?.id || 0) || 0,
        role: item?.role === 'customer' ? 'customer' : 'agent',
        text: compact(item?.text || '', 2200),
        createdAt: String(item?.createdAt || '')
      })).filter(item => item.text)
    : [];
  const latest = raw.latestCustomer && typeof raw.latestCustomer === 'object'
    ? raw.latestCustomer
    : transcript.filter(item => item.role === 'customer').at(-1) || {};
  return {
    id: compact(raw.id || '', 180),
    chatId: Number(raw.chatId || raw?.chat?.id || 0) || 0,
    chat: raw.chat && typeof raw.chat === 'object' ? clone(raw.chat) : {},
    customer: raw.customer && typeof raw.customer === 'object' ? clone(raw.customer) : {},
    transcript,
    latestCustomer: {
      id: Number(latest?.id || 0) || 0,
      text: compact(latest?.text || raw.customerText || '', 2200),
      createdAt: String(latest?.createdAt || '')
    },
    customerText: compact(raw.customerText || latest?.text || '', 2200),
    referenceReply: compact(raw.referenceReply || '', 3200),
    source: compact(raw.source || 'HelpCrunch export', 240)
  };
}

async function readOperatorContext() {
  const stored = await chrome.storage.local.get([OPERATOR_CONFIG_KEY, FEEDBACK_KEY]);
  const config = stored?.[OPERATOR_CONFIG_KEY];
  const feedback = stored?.[FEEDBACK_KEY];
  return {
    config: config && typeof config === 'object' && !Array.isArray(config) ? config : {},
    feedback: Array.isArray(feedback) ? feedback : []
  };
}

async function evaluateReplayCase(rawCase = {}) {
  const replayCase = normalizedCase(rawCase);
  if (!replayCase.customerText || !replayCase.transcript.length) {
    throw new Error('Replay case does not contain a customer turn.');
  }
  const { config, feedback } = await readOperatorContext();
  const outcome = await runFactTurn({
    text: replayCase.latestCustomer.text,
    state: {},
    transcript: replayCase.transcript,
    interpret: input => planAutonomousTurn({ ...input, operatorConfig: config, meterContext: { scope: `replay:${replayCase.id}`, turnId: `replay:${Date.now()}` } }),
    replay: true,
    now: Number.isFinite(Date.parse(replayCase.latestCustomer.createdAt)) ? Date.parse(replayCase.latestCustomer.createdAt) : Date.now()
  });
  const decision = outcome.decision;
  return {
    case: replayCase,
    decision,
    evaluatedAt: new Date().toISOString()
  };
}

async function readResults() {
  const raw = (await chrome.storage.local.get(RESULTS_KEY))?.[RESULTS_KEY];
  return Array.isArray(raw) ? raw : [];
}

async function recordResult(payload = {}) {
  const replayCase = normalizedCase(payload.case || {});
  const verdict = ['pass', 'gap', 'skip'].includes(String(payload.verdict || ''))
    ? String(payload.verdict)
    : 'skip';
  const decision = payload.decision && typeof payload.decision === 'object'
    ? clone(payload.decision)
    : {};
  const item = {
    id: `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    caseId: replayCase.id,
    chatId: replayCase.chatId,
    source: replayCase.source,
    verdict,
    customerText: replayCase.customerText,
    referenceReply: replayCase.referenceReply,
    decision: {
      action: String(decision.action || ''),
      domain: String(decision.domain || ''),
      intent: String(decision.intent || ''),
      tool: String(decision.tool || ''),
      reply: compact(decision.reply || '', 3200),
      reason: compact(decision.reason || '', 1200),
      confidence: Number(decision.confidence || 0) || 0,
      model: String(decision.model || '')
    },
    note: compact(payload.note || '', 1600),
    createdAt: new Date().toISOString()
  };
  const current = await readResults();
  const next = [item, ...current].slice(0, MAX_RESULTS);
  await chrome.storage.local.set({ [RESULTS_KEY]: next });
  return item;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;

  const action = type === TYPES.EVALUATE
    ? evaluateReplayCase(message?.payload?.case || {})
    : type === TYPES.RECORD
      ? recordResult(message?.payload || {})
      : type === TYPES.RESULTS
        ? readResults()
        : chrome.storage.local.remove(RESULTS_KEY).then(() => ({ cleared: true }));

  void action.then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({ success: false, error: compact(error?.message || error || 'Replay error', 1000) })
  );
  return true;
});

export const AI_OPERATOR_REPLAY_MESSAGE_TYPES = TYPES;
export const AI_OPERATOR_REPLAY_RESULTS_KEY = RESULTS_KEY;
