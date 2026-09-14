const CUSTOMER_TYPES = new Set(['message', 'optionSelectionReply', 'dataCollectionReply']);
const CONVERSATION_TYPES = new Set([
  'message',
  'optionSelection',
  'optionSelectionReply',
  'dataCollection',
  'dataCollectionReply'
]);

function clean(value, max = 8000) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function collectContentText(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectContentText(item, out);
    return;
  }
  if (typeof node !== 'object') return;
  if (typeof node.text === 'string' && node.text.trim()) out.push(node.text);
  if (typeof node.value === 'string' && node.value.trim()) out.push(node.value);
  if (Array.isArray(node.children)) collectContentText(node.children, out);
  if (Array.isArray(node.content)) collectContentText(node.content, out);
}

export function messageText(message = {}) {
  const direct = clean(message.text || message.markdownText || '');
  if (direct && !/^https?:\/\/ucarecdn\.com\//i.test(direct)) return direct;

  const parts = [];
  collectContentText(message.content, parts);
  const content = clean(parts.join('\n'));
  if (content) return content;

  const parameterValue = clean(message?.parameters?.value || '');
  return parameterValue;
}

export function isCustomerTurn(message = {}) {
  return String(message.from || '').toLowerCase() === 'customer'
    && CUSTOMER_TYPES.has(String(message.type || 'message'))
    && Boolean(messageText(message));
}

export function normalizeHelpCrunchMessage(message = {}) {
  const type = String(message.type || 'message');
  if (type === 'tech' || type === 'private') return null;
  if (!CONVERSATION_TYPES.has(type)) return null;

  const text = messageText(message);
  if (!text) return null;

  const from = String(message.from || '').toLowerCase();
  return {
    id: Number(message.id || 0) || 0,
    externalId: String(message.externalId || ''),
    createdAt: String(message.createdAt || ''),
    type,
    role: from === 'customer' ? 'customer' : 'agent',
    agentId: Number(message.agent || 0) || null,
    text
  };
}

export function normalizeHelpCrunchTranscript(messages = [], limit = 24) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map(normalizeHelpCrunchMessage)
    .filter(Boolean)
    .sort((a, b) => {
      const at = Number.parseFloat(a.createdAt) || a.id || 0;
      const bt = Number.parseFloat(b.createdAt) || b.id || 0;
      return at - bt;
    });
  return normalized.slice(Math.max(0, normalized.length - Math.max(1, Number(limit) || 24)));
}

export function latestCustomerTurn(messages = []) {
  const turns = (Array.isArray(messages) ? messages : [])
    .filter(isCustomerTurn)
    .sort((a, b) => {
      const at = Number.parseFloat(a.createdAt) || Number(a.id || 0);
      const bt = Number.parseFloat(b.createdAt) || Number(b.id || 0);
      return bt - at;
    });
  const message = turns[0];
  if (!message) return null;
  return normalizeHelpCrunchMessage(message);
}
