import { getChatMessages, getCustomerInformation, listInboxChats } from './helpcrunch-client.js';
import { latestCustomerTurn, normalizeHelpCrunchTranscript } from './message-normalizer.js';
import { planAutonomousTurn } from './groq-planner.js';

const CONFIG_KEY = 'simnet_ai_operator_runtime_v1';
const CASES_KEY = 'simnet_ai_operator_cases_v1';
const FEEDBACK_KEY = 'simnet_ai_operator_feedback_v1';
const ALARM_NAME = 'simnet-ai-operator-poll';
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  shadowMode: true,
  inboxIds: [1],
  chatAllowlist: [],
  pollIntervalMinutes: 1,
  maxChatsPerPoll: 30,
  replyStyle: 'compact',
  maxReplyChars: 700,
  customInstructions: '',
  learnFromCorrections: true
});

const TYPES = Object.freeze({
  GET: 'AI_OPERATOR_GET',
  SAVE: 'AI_OPERATOR_SAVE',
  POLL_ONCE: 'AI_OPERATOR_POLL_ONCE',
  CASES: 'AI_OPERATOR_CASES',
  CLEAR_CASES: 'AI_OPERATOR_CLEAR_CASES',
  FEEDBACK_ADD: 'AI_OPERATOR_FEEDBACK_ADD',
  FEEDBACK_CLEAR: 'AI_OPERATOR_FEEDBACK_CLEAR'
});

let pollPromise = null;

function oneLine(value, max = 500) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function block(value, max = 4000) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeIdList(value, max = 100) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of source) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0 || result.includes(id)) continue;
    result.push(id);
    if (result.length >= max) break;
  }
  return result;
}

function normalizeConfig(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const inboxIds = normalizeIdList(value.inboxIds, 10);
  return {
    enabled: Boolean(value.enabled),
    // SEND is intentionally impossible in this stage. The captured endpoint set is read-only.
    shadowMode: true,
    inboxIds: inboxIds.length ? inboxIds : [1],
    chatAllowlist: normalizeIdList(value.chatAllowlist, 100),
    pollIntervalMinutes: Math.max(1, Math.min(60, Number(value.pollIntervalMinutes) || 1)),
    maxChatsPerPoll: Math.max(1, Math.min(100, Number(value.maxChatsPerPoll) || 30)),
    replyStyle: ['compact', 'normal', 'detailed'].includes(String(value.replyStyle || ''))
      ? String(value.replyStyle)
      : 'compact',
    maxReplyChars: Math.max(180, Math.min(1800, Number(value.maxReplyChars) || 700)),
    customInstructions: block(value.customInstructions || '', 4000),
    learnFromCorrections: value.learnFromCorrections !== false,
    updatedAt: String(value.updatedAt || '')
  };
}

async function readConfig() {
  const raw = (await chrome.storage.local.get(CONFIG_KEY))?.[CONFIG_KEY] || DEFAULT_CONFIG;
  return normalizeConfig(raw);
}

async function saveConfig(patch = {}) {
  const current = await readConfig();
  const next = normalizeConfig({ ...current, ...patch, updatedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  await syncAlarm(next);
  return next;
}

async function readCases() {
  const raw = (await chrome.storage.local.get(CASES_KEY))?.[CASES_KEY] || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function readFeedback() {
  const raw = (await chrome.storage.local.get(FEEDBACK_KEY))?.[FEEDBACK_KEY] || [];
  return Array.isArray(raw) ? raw : [];
}

async function addFeedback(payload = {}) {
  const chatId = Number(payload.chatId || 0);
  const customerText = block(payload.customerText || '', 1600);
  const aiReply = block(payload.aiReply || '', 1800);
  const correctedReply = block(payload.correctedReply || '', 1800);
  const note = block(payload.note || '', 1200);
  if (!chatId) throw new Error('Correction requires chatId');
  if (!correctedReply && !note) throw new Error('Enter corrected reply or correction note');

  const current = await readFeedback();
  const item = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    chatId,
    customerText,
    aiReply,
    correctedReply,
    note,
    createdAt: new Date().toISOString()
  };
  const next = [item, ...current].slice(0, 100);
  await chrome.storage.local.set({ [FEEDBACK_KEY]: next });
  return item;
}

async function writeCase(chatId, patch = {}) {
  const cases = await readCases();
  const key = String(chatId);
  cases[key] = {
    ...(cases[key] || {}),
    ...patch,
    chatId: Number(chatId),
    updatedAt: new Date().toISOString()
  };

  const trimmed = Object.values(cases)
    .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
    .slice(0, 100);
  await chrome.storage.local.set({ [CASES_KEY]: Object.fromEntries(trimmed.map(item => [String(item.chatId), item])) });
  return cases[key];
}

async function syncAlarm(config = null) {
  const current = config || await readConfig();
  try { await chrome.alarms.clear(ALARM_NAME); } catch {}
  if (!current.enabled) return;
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: current.pollIntervalMinutes });
}

function mergeCustomer(chat = {}, info = {}) {
  const base = chat?.customer && typeof chat.customer === 'object' ? chat.customer : {};
  const userPath = info?.user_path && typeof info.user_path === 'object' ? info.user_path : {};
  return {
    ...base,
    ...userPath,
    id: Number(userPath.id || base.id || 0) || null,
    address: String(userPath?.custom_data?.address || base?.custom_data?.address || '')
  };
}

async function processChat(chat, config, existingCase = {}) {
  const chatId = Number(chat?.id || 0);
  if (!chatId) return { chatId: null, state: 'invalid_chat' };

  const messages = await getChatMessages(chatId, { limit: 60, offset: 0 });
  const transcript = normalizeHelpCrunchTranscript(messages, 28);
  const latest = latestCustomerTurn(messages);
  if (!latest) return { chatId, state: 'no_customer_turn' };

  const finalTurn = transcript[transcript.length - 1];
  if (!finalTurn || finalTurn.role !== 'customer' || finalTurn.id !== latest.id) {
    return { chatId, state: 'already_answered' };
  }

  if (Number(existingCase.lastProcessedCustomerMessageId || 0) === Number(latest.id || 0)) {
    return { chatId, state: 'unchanged' };
  }

  let info = {};
  const customerId = Number(chat?.customer?.id || 0);
  if (customerId) {
    try { info = await getCustomerInformation(customerId); } catch (error) {
      info = { readError: oneLine(error?.message || error) };
    }
  }
  const customer = mergeCustomer(chat, info);
  const feedback = config.learnFromCorrections ? await readFeedback() : [];

  const decision = await planAutonomousTurn({
    chat,
    customer,
    transcript,
    latestCustomer: latest,
    operatorConfig: config,
    corrections: feedback.slice(0, 12)
  });
  const saved = await writeCase(chatId, {
    customerId: customer.id,
    provider: String(chat?.provider || ''),
    lastProcessedCustomerMessageId: latest.id,
    latestCustomerText: latest.text,
    intent: decision.intent,
    domain: decision.domain,
    decision,
    transcriptTail: transcript.slice(-12),
    sendState: 'blocked_shadow_mode',
    error: ''
  });

  return {
    chatId,
    state: decision.action,
    intent: decision.intent,
    reply: decision.reply,
    tool: decision.tool,
    caseUpdatedAt: saved.updatedAt
  };
}

async function pollOnceInternal({ force = false } = {}) {
  const config = await readConfig();
  if (!config.enabled && !force) return { ok: true, state: 'disabled', processed: [] };
  if (!config.chatAllowlist.length) {
    return { ok: true, state: 'blocked_no_chat_allowlist', processed: [] };
  }

  const allowed = new Set(config.chatAllowlist.map(Number));
  const knownCases = await readCases();
  const chats = new Map();

  for (const inboxId of config.inboxIds) {
    const page = await listInboxChats({ inboxId, limit: config.maxChatsPerPoll, offset: 0 });
    for (const chat of page.chats) {
      const id = Number(chat?.id || 0);
      if (allowed.has(id)) chats.set(id, chat);
    }
  }

  const processed = [];
  for (const [chatId, chat] of chats) {
    try {
      processed.push(await processChat(chat, config, knownCases[String(chatId)] || {}));
    } catch (error) {
      const message = oneLine(error?.message || error, 800);
      await writeCase(chatId, { error: message, sendState: 'blocked_error' });
      processed.push({ chatId, state: 'error', error: message });
    }
  }

  return {
    ok: true,
    state: chats.size ? 'polled' : 'allowlisted_chat_not_in_current_inbox_page',
    processed,
    shadowMode: true,
    checkedAt: new Date().toISOString()
  };
}

export async function pollAutonomousOperator(options = {}) {
  if (pollPromise) return pollPromise;
  pollPromise = pollOnceInternal(options).finally(() => { pollPromise = null; });
  return pollPromise;
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm?.name !== ALARM_NAME) return;
  void pollAutonomousOperator().catch(() => null);
});

chrome.runtime.onStartup.addListener(() => { void syncAlarm(); });
chrome.runtime.onInstalled.addListener(() => { void syncAlarm(); });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes?.[CONFIG_KEY]) return;
  void syncAlarm(normalizeConfig(changes[CONFIG_KEY].newValue || {}));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;

  const action = type === TYPES.GET
    ? Promise.all([readConfig(), readCases(), readFeedback()]).then(([config, cases, feedback]) => ({ config, cases, feedback }))
    : type === TYPES.SAVE
      ? saveConfig(message?.payload || {})
      : type === TYPES.POLL_ONCE
        ? pollAutonomousOperator({ force: true })
        : type === TYPES.CASES
          ? readCases()
          : type === TYPES.CLEAR_CASES
            ? chrome.storage.local.remove(CASES_KEY).then(() => ({ cleared: true }))
            : type === TYPES.FEEDBACK_ADD
              ? addFeedback(message?.payload || {})
              : chrome.storage.local.remove(FEEDBACK_KEY).then(() => ({ cleared: true }));

  void action.then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({ success: false, error: oneLine(error?.message || error || 'AI operator error', 1000) })
  );
  return true;
});

void syncAlarm().catch(() => null);

export const AI_OPERATOR_MESSAGE_TYPES = TYPES;
export const AI_OPERATOR_CONFIG_KEY = CONFIG_KEY;
