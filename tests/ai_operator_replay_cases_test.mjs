import assert from 'node:assert/strict';
import { extractReplayCases, listReplayChats } from '../src/features/ai-operator/replay-cases.js';

const payload = {
  source: 'HelpCrunch — full messages from saved chat list',
  chats: [
    {
      id: 71748,
      customer: { id: 9, name: 'Test Customer' },
      messages: [
        { id: 1, from: 'agent', type: 'message', text: 'Bot hello', createdAt: '1' },
        { id: 2, from: 'customer', type: 'dataCollectionReply', parameters: { value: '394895' }, createdAt: '2' },
        { id: 3, from: 'agent', type: 'message', text: 'Bot route', createdAt: '3' },
        { id: 4, from: 'customer', type: 'message', text: 'Немає інтернету', createdAt: '4' },
        { id: 5, from: 'customer', type: 'message', text: 'Після перезавантаження теж', createdAt: '5' },
        { id: 6, from: 'agent', agent: 116, type: 'message', text: 'Перевіряю лінію.', createdAt: '6' },
        { id: 7, from: 'agent', agent: 116, type: 'message', text: 'Зараз уточню статус.', createdAt: '7' },
        { id: 8, from: 'agent', type: 'private', text: 'internal', createdAt: '8' },
        { id: 9, from: 'customer', type: 'message', text: 'Добре', createdAt: '9' },
        { id: 10, from: 'agent', agent: 116, type: 'message', text: 'Лінія вже піднялась.', createdAt: '10' }
      ]
    }
  ]
};

assert.equal(listReplayChats(payload).length, 1, 'HelpCrunch chats must be discovered from the export root');

const replay = extractReplayCases(payload, { transcriptLimit: 28 });
assert.equal(replay.stats.chats, 1);
assert.equal(replay.stats.cases, 2, 'bot-only customer→automation pair must be skipped');
assert.equal(replay.stats.skippedAutomation, 1);

const first = replay.cases[0];
assert.equal(first.chatId, 71748);
assert.equal(first.customerText, 'Немає інтернету\nПісля перезавантаження теж');
assert.equal(first.referenceReply, 'Перевіряю лінію.\nЗараз уточню статус.');
assert.equal(first.latestCustomer.id, 5);
assert.equal(first.transcript.at(-1).role, 'customer', 'planner prefix must stop on the customer turn being evaluated');
assert.equal(first.transcript.at(-1).text, 'Після перезавантаження теж');
assert.ok(!first.transcript.some(item => item.id === 6), 'real operator reference must not leak into planner prefix');

const second = replay.cases[1];
assert.equal(second.customerText, 'Добре');
assert.equal(second.referenceReply, 'Лінія вже піднялась.');
assert.ok(second.transcript.some(item => item.id === 6), 'prior real operator context must remain visible on later turns');
assert.ok(second.transcript.some(item => item.id === 7));
assert.ok(!second.transcript.some(item => item.id === 8), 'private notes must not enter replay context');

const nested = { data: { chats: payload.chats } };
assert.equal(extractReplayCases(nested).cases.length, 2, 'nested data.chats export shape must be supported');

const wrapped = {
  source: 'wrapped exporter',
  chats: [{
    chat: { id: 81234, status: 'closed', customer: { id: 22, name: 'Wrapped Customer' } },
    messages: payload.chats[0].messages
  }]
};
const wrappedReplay = extractReplayCases(wrapped);
assert.equal(wrappedReplay.cases.length, 2, 'wrapper {chat,messages} export shape must be supported');
assert.equal(wrappedReplay.cases[0].chatId, 81234);
assert.equal(wrappedReplay.cases[0].customerId, 22);
assert.equal(wrappedReplay.cases[0].customer.name, 'Wrapped Customer');

console.log('ai_operator_replay_cases_test: PASS');
