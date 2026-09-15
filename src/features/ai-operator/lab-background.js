import { planAutonomousTurn } from './groq-planner.js';
import { executeOperatorTool } from './tool-runtime.js';
import {
  normalizeLabLookupDecision,
  publicPendingCandidate,
  sanitizeLookupToolResultData
} from './lab-identity-policy.js';

const LAB_KEY = 'simnet_ai_operator_lab_v1';
const OPERATOR_CONFIG_KEY = 'simnet_ai_operator_runtime_v1';
const FEEDBACK_KEY = 'simnet_ai_operator_feedback_v1';
const MAX_MESSAGES = 60;
const MAX_EVENTS = 140;
const MAX_TOOL_TURNS = 6;

const TYPES = Object.freeze({
  GET: 'AI_OPERATOR_LAB_GET',
  SEND: 'AI_OPERATOR_LAB_SEND',
  RESET: 'AI_OPERATOR_LAB_RESET'
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

function emptyLab() {
  return {
    version: 1,
    id: id('lab'),
    messages: [],
    events: [],
    pendingCandidate: null,
    confirmedCaseId: '',
    confirmedSubscriber: null,
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
    lastDecision: raw.lastDecision && typeof raw.lastDecision === 'object'
      ? raw.lastDecision
      : null,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso())
  };
}

async function readLab() {
  const raw = (await chrome.storage.local.get(LAB_KEY))?.[LAB_KEY];
  return normalizeLab(raw || {});
}

async function writeLab(lab) {
  const next = normalizeLab({ ...lab, updatedAt: nowIso() });
  await chrome.storage.local.set({ [LAB_KEY]: next });
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

function plannerLabState(lab) {
  return {
    pendingCandidate: publicPendingCandidate(lab.pendingCandidate),
    confirmedCaseId: String(lab.confirmedCaseId || ''),
    confirmedSubscriber: clone(lab.confirmedSubscriber)
  };
}

function toolLabState(lab) {
  return {
    pendingCandidate: clone(lab.pendingCandidate),
    confirmedCaseId: String(lab.confirmedCaseId || ''),
    confirmedSubscriber: clone(lab.confirmedSubscriber)
  };
}

function applyStatePatch(lab, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
  if (Object.prototype.hasOwnProperty.call(patch, 'pendingCandidate')) {
    lab.pendingCandidate = patch.pendingCandidate && typeof patch.pendingCandidate === 'object'
      ? clone(patch.pendingCandidate)
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'confirmedCaseId')) {
    lab.confirmedCaseId = String(patch.confirmedCaseId || '');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'confirmedSubscriber')) {
    lab.confirmedSubscriber = patch.confirmedSubscriber && typeof patch.confirmedSubscriber === 'object'
      ? clone(patch.confirmedSubscriber)
      : null;
  }
}

function publicToolResult(toolResult = {}) {
  const tool = String(toolResult.tool || '');
  return {
    tool,
    ok: Boolean(toolResult.ok),
    code: String(toolResult.code || ''),
    observedAt: String(toolResult.observedAt || ''),
    data: tool === 'customer.lookup'
      ? sanitizeLookupToolResultData(toolResult.data || {})
      : clone(toolResult.data || {}),
    warnings: Array.isArray(toolResult.warnings) ? clone(toolResult.warnings) : []
  };
}

function toolSignature(decision = {}) {
  let args = '';
  try { args = JSON.stringify(decision.toolArgs || {}); } catch {}
  return `${String(decision.tool || '')}|${args}`;
}

async function runTurn(customerText) {
  const lab = await readLab();
  const incoming = compact(customerText, 4000);
  if (!incoming) throw new Error('Напиши сообщение от имени абонента.');

  const customerMessage = appendMessage(lab, 'customer', incoming);
  appendEvent(lab, 'customer_message', { messageId: customerMessage.id, text: incoming });
  await writeLab(lab);

  const { config, feedback } = await readOperatorConfig();
  const toolResults = [];
  const seenToolCalls = new Set();
  let finalDecision = null;

  for (let turn = 0; turn <= MAX_TOOL_TURNS; turn += 1) {
    const transcript = lab.messages.map(message => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.at
    }));

    const plannedDecision = await planAutonomousTurn({
      labMode: true,
      chat: { id: lab.id, provider: 'manual-test-lab' },
      customer: {},
      transcript,
      latestCustomer: { id: customerMessage.id, text: customerMessage.text },
      operatorConfig: config,
      corrections: feedback.slice(0, 12),
      labState: plannerLabState(lab),
      toolResults
    });
    const decision = normalizeLabLookupDecision(plannedDecision);

    lab.lastDecision = clone(decision);
    appendEvent(lab, 'decision', {
      action: decision.action,
      domain: decision.domain,
      intent: decision.intent,
      tool: decision.tool,
      toolArgs: clone(decision.toolArgs || {}),
      reply: decision.reply,
      reason: decision.reason,
      confidence: decision.confidence,
      model: decision.model
    });

    if (decision.action !== 'tool_required') {
      finalDecision = decision;
      break;
    }

    if (!decision.tool) {
      appendEvent(lab, 'error', { code: 'EMPTY_TOOL', message: 'AI запросил tool_required без имени инструмента.' });
      finalDecision = {
        ...decision,
        action: 'escalate',
        reply: 'Не удалось выбрать проверку. Нужна проверка оператором.'
      };
      break;
    }

    if (turn >= MAX_TOOL_TURNS) {
      const message = `Достигнут лимит ${MAX_TOOL_TURNS} READ-вызовов за один ход.`;
      appendEvent(lab, 'error', { code: 'TOOL_LOOP_LIMIT', message });
      finalDecision = {
        ...decision,
        action: 'escalate',
        intent: 'tool_loop_limit',
        reply: 'Не удалось завершить проверку автоматически. Нужна проверка оператором.',
        reason: message
      };
      break;
    }

    const signature = toolSignature(decision);
    if (seenToolCalls.has(signature)) {
      appendEvent(lab, 'error', {
        code: 'REPEATED_TOOL_CALL',
        tool: decision.tool,
        message: 'AI повторил тот же tool-вызов без изменения аргументов.'
      });
      finalDecision = {
        ...decision,
        action: 'escalate',
        reply: 'Эта проверка не дала новых данных. Нужна дополнительная проверка оператором.'
      };
      break;
    }
    seenToolCalls.add(signature);

    appendEvent(lab, 'tool_call', {
      tool: decision.tool,
      toolArgs: clone(decision.toolArgs || {})
    });

    const toolResult = await executeOperatorTool({
      tool: decision.tool,
      toolArgs: decision.toolArgs || {},
      labState: toolLabState(lab)
    });

    applyStatePatch(lab, toolResult.statePatch || {});
    const visibleResult = publicToolResult(toolResult);
    toolResults.push(visibleResult);
    appendEvent(lab, 'tool_result', visibleResult);
    await writeLab(lab);
  }

  if (!finalDecision) {
    finalDecision = {
      action: 'escalate',
      domain: 'other',
      intent: 'tool_loop_limit',
      reply: 'Не удалось завершить проверку автоматически. Нужна проверка оператором.',
      reason: `Достигнут лимит ${MAX_TOOL_TURNS} READ-вызовов за один ход.`,
      confidence: 0,
      model: ''
    };
    appendEvent(lab, 'error', {
      code: 'TOOL_LOOP_LIMIT',
      message: finalDecision.reason
    });
  }

  const reply = compact(finalDecision.reply, Number(config.maxReplyChars || 700) || 700);
  if (['reply', 'ask', 'escalate'].includes(finalDecision.action)) {
    const output = reply || 'Не удалось сформировать текст ответа. Нужна проверка оператором.';
    appendMessage(lab, 'agent', output, {
      action: finalDecision.action,
      intent: finalDecision.intent || '',
      model: finalDecision.model || ''
    });
  }

  lab.lastDecision = clone(finalDecision);
  return writeLab(lab);
}

async function resetLab() {
  const next = emptyLab();
  await chrome.storage.local.set({ [LAB_KEY]: next });
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