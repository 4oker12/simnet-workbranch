import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUTONOMOUS_OPERATOR_INSTRUCTION
} from '../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js';
import {
  buildSubscriberIntentProbeMessages,
  buildKnowledgeReflectionMessages
} from '../src/features/ai-operator/semantic-probe.js';
import { mapInformationNeedsToTools } from '../src/features/ai-operator/semantic-tool-broker-core.js';

test('production semantic stages inherit the canonical autonomous instruction first', () => {
  const understanding = buildSubscriberIntentProbeMessages({
    transcript: [{ role: 'customer', text: 'сколько до конца года?' }],
    latestCustomer: { text: 'сколько до конца года?' }
  });
  assert.equal(understanding[0]?.role, 'system');
  assert.equal(understanding[0]?.content, AUTONOMOUS_OPERATOR_INSTRUCTION);
  assert.match(understanding[1]?.content || '', /ЭТАП: UNDERSTANDING/i);

  const knowledge = buildKnowledgeReflectionMessages({
    probe: { whatUserWants: 'узнать сумму' },
    candidateArticles: []
  });
  assert.equal(knowledge[0]?.role, 'system');
  assert.equal(knowledge[0]?.content, AUTONOMOUS_OPERATOR_INSTRUCTION);
  assert.match(knowledge[1]?.content || '', /ЭТАП: KNOWLEDGE REFLECTION/i);
});

test('knowledge reflection cannot turn hypothetical exceptions into required blockers', () => {
  const messages = buildKnowledgeReflectionMessages({ probe: {}, candidateArticles: [] });
  const local = messages[1]?.content || '';
  assert.match(local, /не превращай гипотетическую скидку.*в обязательный недостающий факт/is);
  assert.match(local, /must_not_assume.*НЕ запрещает арифметику, сравнение, семантическую интерпретацию/is);
  assert.match(local, /не создавай пробелы «на всякий случай»/i);
});

test('answer and tool-synthesis paths use the central instruction and preserve enough evidence for reasoning', () => {
  const semanticSource = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  const brokerSource = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker-core.js', import.meta.url), 'utf8');

  assert.match(semanticSource, /autonomousOperatorSystemMessages\(replySchemaPrompt\(profile, capabilities\)\)/);
  assert.match(semanticSource, /already_enough:\s*knowledge\.alreadyEnough/);
  assert.match(semanticSource, /subscriber_data_needed допускается только для конкретного отсутствующего факта/i);
  assert.match(brokerSource, /autonomousOperatorSystemMessages\(stageInstruction\)/);
  assert.match(brokerSource, /Сначала рассуждай по уже имеющимся фактам/i);
});

test('PON routing matches PON terms, not accidental substrings in Billing field names', () => {
  const contract = mapInformationNeedsToTools([
    { system: 'Billing', field: 'contract_end_date', why: 'проверить дату договора' }
  ]);
  assert.equal(contract[0]?.tool, 'customer.snapshot');
  assert.notEqual(contract[0]?.tool, 'pon.onu');

  const discount = mapInformationNeedsToTools([
    { system: 'Billing', field: 'discount_info', why: 'проверить скидку' }
  ]);
  assert.equal(discount[0]?.tool, 'customer.snapshot');

  const onu = mapInformationNeedsToTools([
    { system: 'Network', field: 'ONT status', why: 'проверить ONT' }
  ]);
  assert.equal(onu[0]?.tool, 'pon.onu');

  const signal = mapInformationNeedsToTools([
    { system: 'UserSide', field: 'GPON signal RX', why: 'проверить сигнал' }
  ]);
  assert.equal(signal[0]?.tool, 'pon.signal');
});
