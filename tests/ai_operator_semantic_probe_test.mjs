import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSubscriberIntentProbeMessages } from '../src/features/ai-operator/semantic-probe.js';

test('semantic probe asks what the subscriber wants without deterministic intent taxonomy', () => {
  const messages = buildSubscriberIntentProbeMessages({
    transcript: [
      { role: 'agent', text: 'Какая модель роутера? Он поддерживает гигабит?' },
      { role: 'customer', text: 'Я не знаю)' }
    ],
    latestCustomer: { text: 'Я не знаю)' }
  });
  const prompt = messages.map(item => item.content).join('\n');
  assert.match(prompt, /ЧТО АБОНЕНТ ХОЧЕТ/i);
  assert.match(prompt, /непосредственно предыдущую реплику оператора/i);
  assert.match(prompt, /Я не знаю\)/);
  assert.doesNotMatch(prompt, /balance\.amount|tariff\.upgrade|customer\.lookup|recurring_charge\.amount/);
});

test('Replay semantic experiment bypasses deterministic decision files', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/replay-background.js', import.meta.url), 'utf8');
  assert.match(source, /semantic-probe\.js/);
  assert.doesNotMatch(source, /fact-runtime\.js/);
  assert.doesNotMatch(source, /fact-catalog\.js/);
  assert.doesNotMatch(source, /dialogue-state\.js/);
  assert.match(source, /mode: 'semantic_probe'/);
});
