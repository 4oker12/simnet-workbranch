import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAutonomousPromptMessages } from '../src/features/ai-operator/groq-planner.js';

const transcript = Array.from({ length: 30 }, (_, index) => ({
  id: `m${index}`,
  role: index % 2 === 0 ? 'customer' : 'agent',
  text: index === 0
    ? 'ORIGIN: abon259243 сколько платить мне?'
    : index === 29
      ? 'LATEST-CONTEXT: а когда спишется?'
      : `старый ход ${index} `.repeat(40)
}));

const messages = buildAutonomousPromptMessages({
  labMode: true,
  chat: { id: 'lab-test' },
  customer: {},
  transcript,
  latestCustomer: { id: 'm29', text: 'а когда спишется?' },
  labState: {
    confirmedCaseId: 'billing-live:259243',
    confirmedSubscriber: { contract: '259243', billingId: '25924' }
  },
  toolResults: [{
    tool: 'customer.snapshot',
    ok: true,
    code: 'OK',
    data: {
      finance: { accountBalance: 338.89, totalDue: 330, balanceAfterTariff: 8.89 },
      service: { currentTariff: 'Интернет+ТБ 330 (100 Mbit)' }
    }
  }],
  operatorConfig: { replyStyle: 'compact', maxReplyChars: 700 },
  corrections: []
});

assert.equal(messages.length, 2);
const system = String(messages[0]?.content || '');
const user = String(messages[1]?.content || '');
const totalChars = system.length + user.length;

// Keep the ordinary planner payload in roughly the 2–3k-token class instead of
// injecting the full support corpus and full chat on every turn.
assert.ok(totalChars <= 9900, `prompt unexpectedly large: ${totalChars} chars`);
assert.match(system, /DOMAIN/);
assert.match(system, /ENTITY/);
assert.match(system, /TIME/);
assert.match(system, /CHARACTER/);
assert.match(system, /TOOLS = источники данных/);
assert.match(system, /balanceAfterTariff/);

// Intent-shaped tools must not be advertised to the model.
assert.doesNotMatch(system, /billing\.next_charge/);
assert.doesNotMatch(system, /billing\.future_payment/);

// Preserve the original topic, the recent dialogue and verified facts.
assert.match(user, /ORIGIN: abon259243/);
assert.match(user, /LATEST-CONTEXT: а когда спишется/);
assert.match(user, /338\.89/);
assert.match(user, /8\.89/);
assert.match(user, /RECENT_FACTS=/);

const plannerSource = fs.readFileSync(new URL('../src/features/ai-operator/groq-planner.js', import.meta.url), 'utf8');
const labSource = fs.readFileSync(new URL('../src/features/ai-operator/lab-background.js', import.meta.url), 'utf8');
const uiSource = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');

assert.match(plannerSource, /x-ratelimit-remaining-tokens/);
assert.match(plannerSource, /x-ratelimit-reset-tokens/);
assert.match(plannerSource, /retry-after/);
assert.match(labSource, /contextToolResults/);
assert.match(uiSource, /aiLabUsage/);
assert.match(uiSource, /prompt_tokens/);
assert.match(uiSource, /remainingTokens/);

console.log(`ai_operator_compact_context_test: PASS (${totalChars} chars)`);
