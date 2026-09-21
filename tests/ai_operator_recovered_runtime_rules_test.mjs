import assert from 'node:assert/strict';
import { classifyStandaloneBillingLogin } from '../src/features/ai-operator/billing-login-live.js';
import { normalizeTariffLabel } from '../src/features/ai-operator/billing-tariff-normalizer.js';
import {
  compactRuntimeKnowledge,
  compactRuntimeTranscriptForStage
} from '../src/features/ai-operator/runtime-projection.js';

// Named Billing logins are valid identifiers, case-insensitive, and normalize to one key.
assert.equal(classifyStandaloneBillingLogin('kunetika'), 'kunetika');
assert.equal(classifyStandaloneBillingLogin('KUNETIKA'), 'kunetika');
assert.equal(classifyStandaloneBillingLogin('KuNeTiKa'), 'kunetika');
assert.equal(classifyStandaloneBillingLogin('kundanika'), 'kundanika');
assert.equal(classifyStandaloneBillingLogin('internet'), '', 'common English words must not become subscriber logins');

// Billing may glue a service date and speed appendix to the package label.
// Keep the raw evidence, but expose a clean package name and canonical speed.
const sanitizedTariff = normalizeTariffLabel('Безліміт 310 (15.10.2024) Швидкість - 500 Мбіт/с');
assert.equal(sanitizedTariff.rawName, 'Безліміт 310 (15.10.2024) Швидкість - 500 Мбіт/с');
assert.equal(sanitizedTariff.displayName, 'Безліміт 310');
assert.equal(sanitizedTariff.speedMbps, 500);
assert.equal(sanitizedTariff.priceUAH, null, 'number in package name is not automatically a price');

const sanitizedGigabit = normalizeTariffLabel('Безліміт GIG (01.09.2026) Скорость: 1 Gbit');
assert.equal(sanitizedGigabit.displayName, 'Безліміт GIG');
assert.equal(sanitizedGigabit.speedMbps, 1000);

// Existing stage-aware context compaction from the recovered patch remains active.
const transcript = Array.from({ length: 15 }, (_, index) => ({
  role: index % 2 ? 'operator' : 'customer',
  text: `turn-${index}-${'x'.repeat(600)}`
}));
const understanding = compactRuntimeTranscriptForStage(transcript, 'understanding');
const reply = compactRuntimeTranscriptForStage(transcript, 'reply');
assert.equal(understanding.length, 10);
assert.equal(reply.length, 8);
assert.ok(understanding.every(item => item.text.length <= 420));
assert.ok(reply.every(item => item.text.length <= 380));

const projectedKnowledge = compactRuntimeKnowledge({
  usedArticles: Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, why: 'w'.repeat(300) })),
  articleEvidence: Array.from({ length: 4 }, (_, index) => ({
    id: `a${index}`,
    title: 't'.repeat(300),
    summary: 's'.repeat(500),
    text: 'b'.repeat(1600)
  }))
});
assert.equal(projectedKnowledge.usedArticles.length, 3);
assert.equal(projectedKnowledge.articleEvidence.length, 2);
assert.ok(projectedKnowledge.articleEvidence.every(item => item.text.length <= 900));

console.log('PASS recovered identity, tariff normalization, and compact runtime rules');
