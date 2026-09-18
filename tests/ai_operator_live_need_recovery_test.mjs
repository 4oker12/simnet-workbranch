import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recoverLiveDataNeeds } from '../src/features/ai-operator/live-need-recovery.js';

function tools(needs = []) {
  return needs.map(item => String(item.field || '').split(':')[0]);
}

test('balance + tariff live request recovers both Billing reads when synthesis omitted subscriber_data_needed', () => {
  const needs = recoverLiveDataNeeds({
    analysis: {
      probe: {
        unresolvedRequests: [
          'Показать баланс абонента abon345834',
          'Показать тариф абонента abon345834'
        ]
      }
    },
    draft: { subscriberDataNeeded: [], degraded: false }
  });

  assert.deepEqual(tools(needs), ['billing.balance', 'billing.tariff']);
});

test('degraded balance turn still recovers Billing read without LLM draft', () => {
  const needs = recoverLiveDataNeeds({
    analysis: { probe: { unresolvedRequests: ['что по балансу?'] } },
    draft: { subscriberDataNeeded: [], degraded: true }
  });
  assert.deepEqual(tools(needs), ['billing.balance']);
});

test('fiber availability routes to building snapshot, not ONU signal', () => {
  const needs = recoverLiveDataNeeds({
    analysis: { probe: { unresolvedRequests: ['можно мне подключить оптику?'] } },
    draft: { subscriberDataNeeded: [], degraded: true }
  });
  assert.deepEqual(tools(needs), ['building.snapshot']);
  assert.doesNotMatch(needs[0]?.field || '', /pon\.signal/i);
});

test('general fiber advantages remain model knowledge and do not trigger subscriber READ', () => {
  const needs = recoverLiveDataNeeds({
    analysis: { probe: { unresolvedRequests: ['что про оптику вообще расскажете? ее преимущества?'] } },
    draft: { subscriberDataNeeded: [], degraded: false }
  });
  assert.deepEqual(needs, []);
});

test('general tariff definition does not become a subscriber tariff READ', () => {
  const needs = recoverLiveDataNeeds({
    analysis: { probe: { unresolvedRequests: ['что такое тариф вообще?'] } },
    draft: { subscriberDataNeeded: [], degraded: false }
  });
  assert.deepEqual(needs, []);
});

test('future payment recovers tariff evidence instead of payment-history lookup', () => {
  const needs = recoverLiveDataNeeds({
    analysis: { probe: { unresolvedRequests: ['сколько платить в следующем месяце?'] } },
    draft: { subscriberDataNeeded: [], degraded: false }
  });
  assert.deepEqual(tools(needs), ['billing.tariff']);
});

test('broker recovery is applied before core grounding and dead qwen 3.6 is absent from runtime pools', () => {
  const broker = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker-impl.js', import.meta.url), 'utf8');
  const semantic = fs.readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../src/config/ai-config.js', import.meta.url), 'utf8');

  assert.match(broker, /recoverLiveDataNeeds\(\{\s*analysis,\s*draft\s*\}\)/);
  assert.doesNotMatch(semantic.match(/GENERATION_FALLBACK_MODELS[\s\S]*?\]\);/)?.[0] || '', /qwen\/qwen3\.6-27b/);
  assert.match(semantic, /RETIRED_MODELS = new Set\(\['qwen\/qwen3\.6-27b'\]\)/);
  assert.match(config, /DEFAULT_MODEL = 'qwen\/qwen3\.8-27b'/);
  assert.match(config, /RETIRED_MODELS = new Set\(\['qwen\/qwen3\.6-27b'\]\)/);
});
