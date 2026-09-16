import { normalizeHelpCrunchTranscript } from './message-normalizer.js';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function numericId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function chatCore(record = {}) {
  return record?.chat && typeof record.chat === 'object' && !Array.isArray(record.chat)
    ? record.chat
    : record;
}

function messageArray(record = {}) {
  const chat = chatCore(record);
  const candidates = [
    record.messages,
    record?.messages?.data,
    record?.messages?.items,
    record.conversation,
    record.history,
    chat.messages,
    chat?.messages?.data,
    chat?.messages?.items,
    chat.conversation,
    chat.history
  ];
  return candidates.find(Array.isArray) || [];
}

function chatArrays(payload) {
  if (Array.isArray(payload)) return [payload];
  if (!payload || typeof payload !== 'object') return [];
  return [
    payload.chats,
    payload?.data?.chats,
    payload?.data?.items,
    payload.items,
    payload.results,
    payload.data
  ].filter(Array.isArray);
}

function looksLikeChat(value) {
  return Boolean(value && typeof value === 'object' && messageArray(value).length);
}

export function listReplayChats(payload) {
  const arrays = chatArrays(payload);
  for (const candidate of arrays) {
    if (candidate.some(looksLikeChat)) return candidate.filter(looksLikeChat);
  }
  return [];
}

function groupByRole(transcript = []) {
  const groups = [];
  for (const item of transcript) {
    const role = item?.role === 'customer' ? 'customer' : 'agent';
    const last = groups[groups.length - 1];
    if (last?.role === role) {
      last.items.push(item);
      continue;
    }
    groups.push({ role, items: [item] });
  }
  return groups;
}

function blockText(items = []) {
  return items.map(item => text(item?.text)).filter(Boolean).join('\n');
}

function customerOf(record = {}) {
  const chat = chatCore(record);
  const candidates = [
    record.customer,
    record.customerInfo,
    record.customerInformation,
    chat.customer,
    chat.customerInfo,
    chat.customerInformation
  ];
  return candidates.find(value => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function chatIdOf(record = {}, index = 0) {
  const chat = chatCore(record);
  return numericId(record.id || record.chatId || record.chat_id || chat.id || chat.chatId || chat.chat_id) || index + 1;
}

function replayChatMetadata(record = {}, chatId = 0) {
  const chat = chatCore(record);
  const customer = customerOf(record);
  return {
    id: chatId,
    provider: text(record.provider || chat.provider || 'helpcrunch'),
    status: text(record.status || chat.status || ''),
    inboxId: numericId(
      record.inboxId || record.inbox_id || record?.inbox?.id ||
      chat.inboxId || chat.inbox_id || chat?.inbox?.id
    ) || null,
    customer
  };
}

function replayCustomer(record = {}) {
  return { ...customerOf(record) };
}

function humanReference(group = {}) {
  return arrayFrom(group.items).some(item => Number(item?.agentId || 0) > 0);
}

function lastCustomerItem(group = {}) {
  const items = arrayFrom(group.items);
  return items[items.length - 1] || null;
}

export function extractReplayCases(payload, options = {}) {
  const maxChats = Math.max(1, Math.min(5000, Number(options.maxChats) || 1000));
  const maxCases = Math.max(1, Math.min(20000, Number(options.maxCases) || 5000));
  const transcriptLimit = Math.max(4, Math.min(80, Number(options.transcriptLimit) || 28));
  const includeAutomation = options.includeAutomation === true;
  const chats = listReplayChats(payload).slice(0, maxChats);
  const cases = [];
  let semanticMessages = 0;
  let skippedAutomation = 0;
  let skippedNoReference = 0;

  for (let chatIndex = 0; chatIndex < chats.length && cases.length < maxCases; chatIndex += 1) {
    const record = chats[chatIndex];
    const rawMessages = messageArray(record);
    const transcript = normalizeHelpCrunchTranscript(rawMessages, Math.max(transcriptLimit * 4, 120));
    semanticMessages += transcript.length;
    const groups = groupByRole(transcript);
    const chatId = chatIdOf(record, chatIndex);
    const customer = replayCustomer(record);

    for (let groupIndex = 0; groupIndex < groups.length - 1 && cases.length < maxCases; groupIndex += 1) {
      const customerGroup = groups[groupIndex];
      const agentGroup = groups[groupIndex + 1];
      if (customerGroup.role !== 'customer' || agentGroup.role !== 'agent') continue;

      const customerText = blockText(customerGroup.items);
      const referenceReply = blockText(agentGroup.items);
      if (!customerText || !referenceReply) {
        skippedNoReference += 1;
        continue;
      }
      if (!includeAutomation && !humanReference(agentGroup)) {
        skippedAutomation += 1;
        continue;
      }

      const latestCustomer = lastCustomerItem(customerGroup);
      if (!latestCustomer) continue;
      const prefix = groups
        .slice(0, groupIndex + 1)
        .flatMap(group => group.items)
        .slice(-transcriptLimit);
      const turnKey = latestCustomer.id || latestCustomer.externalId || `${groupIndex + 1}`;

      cases.push({
        id: `${chatId}:${turnKey}`,
        chatId,
        customerId: numericId(customer?.id) || null,
        chat: replayChatMetadata(record, chatId),
        customer,
        transcript: prefix,
        latestCustomer: { ...latestCustomer },
        customerText,
        referenceReply,
        referenceAgentIds: [...new Set(agentGroup.items.map(item => Number(item?.agentId || 0)).filter(Boolean))],
        source: text(payload?.source || 'HelpCrunch export') || 'HelpCrunch export'
      });
    }
  }

  return {
    cases,
    stats: {
      chats: chats.length,
      semanticMessages,
      cases: cases.length,
      skippedAutomation,
      skippedNoReference
    }
  };
}
