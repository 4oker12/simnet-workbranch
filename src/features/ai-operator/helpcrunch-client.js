const HELPCRUNCH_ORIGIN = 'https://stargroup.helpcrunch.com';
const BRIDGE_MESSAGE_TYPE = 'AI_OPERATOR_HC_READ';

function cleanError(value, max = 500) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function assertPositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

async function directRead(path) {
  const response = await fetch(`${HELPCRUNCH_ORIGIN}${path}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(`HelpCrunch HTTP ${response.status}${text ? ` — ${cleanError(text, 300)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function bridgeRead(path) {
  const tabs = await chrome.tabs.query({ url: `${HELPCRUNCH_ORIGIN}/*` });
  const candidates = tabs.filter(tab => tab.id != null && !tab.discarded);
  let lastError = null;
  for (const tab of candidates) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: BRIDGE_MESSAGE_TYPE, path });
      if (response?.success) return response.data;
      lastError = new Error(response?.error || 'HelpCrunch page bridge failed');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('HelpCrunch session unavailable: open an authenticated HelpCrunch tab');
}

async function read(path) {
  try {
    return await directRead(path);
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status && status !== 401 && status !== 403) throw error;
    return bridgeRead(path);
  }
}

export async function listInboxChats({ inboxId = 1, limit = 30, offset = 0 } = {}) {
  const inbox = assertPositiveInt(inboxId, 'inboxId');
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const params = new URLSearchParams({
    limit: String(safeLimit),
    read: 'true',
    offset: String(safeOffset),
    sortBy: '0',
    inbox: String(inbox)
  });
  const payload = await read(`/new-api/agent/chat-search?${params}`);
  return {
    chats: Array.isArray(payload?.data) ? payload.data : [],
    total: Math.max(0, Number(payload?.total || 0) || 0),
    totalByFilter: Math.max(0, Number(payload?.totalByFilter || 0) || 0)
  };
}

export async function readUnreadCounts(inboxId = null) {
  const path = inboxId == null
    ? '/new-api/agent/inbox/unread-chats'
    : `/new-api/agent/inbox/${assertPositiveInt(inboxId, 'inboxId')}/unread-chats`;
  const payload = await read(path);
  return payload && typeof payload === 'object' ? payload : {};
}

export async function getChatMessages(chatId, { limit = 50, offset = 0 } = {}) {
  const id = assertPositiveInt(chatId, 'chatId');
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const params = new URLSearchParams({ limit: String(safeLimit), offset: String(safeOffset) });
  const payload = await read(`/new-api/agent/chat/${id}/messages?${params}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function getCustomerInformation(customerId) {
  const id = assertPositiveInt(customerId, 'customerId');
  const payload = await read(`/api/v4/customer/${id}/information`);
  return payload && typeof payload === 'object' ? payload : {};
}

export async function getCustomerChatCount(customerId) {
  const id = assertPositiveInt(customerId, 'customerId');
  const payload = await read(`/new-api/agent/chat/customer/${id}/chats/count`);
  return Math.max(0, Number(payload?.data || 0) || 0);
}

export const HELPCRUNCH_READ_ORIGIN = HELPCRUNCH_ORIGIN;
