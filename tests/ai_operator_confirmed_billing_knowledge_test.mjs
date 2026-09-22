import assert from 'node:assert/strict';
import { BILLING_FINANCE_KNOWLEDGE } from '../src/features/ai-operator/knowledge/billing-finance.js';
import { BILLING_KNOWLEDGE } from '../src/features/ai-operator/knowledge/billing.js';
import { TARIFF_CONTEXT_KNOWLEDGE } from '../src/features/ai-operator/knowledge/tariff-context.js';
import { SIMNET_KNOWLEDGE_VERSION, searchKnowledgeLibrary } from '../src/features/ai-operator/knowledge/index.js';

assert.equal(SIMNET_KNOWLEDGE_VERSION, 'simnet-encyclopedia-v3.3');

const balance = BILLING_FINANCE_KNOWLEDGE.find(item => item.id === 'billing.balance');
assert.ok(balance);
assert.match(balance.text, /accountBalance/);
assert.match(balance.text, /totalDue/);
assert.match(balance.text, /balanceAfterTariff/);
assert.match(balance.text, /balanceWithoutTemporary/);
assert.match(balance.text, /temporaryPayment/);
assert.match(balance.text, /balanceWithoutTemporary \+ temporaryPayment ≈ balanceAfterTariff/);

const temporaryPayment = BILLING_FINANCE_KNOWLEDGE.find(item => item.id === 'billing.temporary-payment');
assert.ok(temporaryPayment);
assert.match(temporaryPayment.text, /короткий кредит/i);
assert.match(temporaryPayment.text, /любой отрицательной сумме/i);

const autoBlock = BILLING_FINANCE_KNOWLEDGE.find(item => item.id === 'billing.auto-block');
assert.ok(autoBlock);
assert.match(autoBlock.text, /−0\.01 грн/);
assert.match(autoBlock.text, /блокируется автоматически/i);

const insufficientFunds = BILLING_FINANCE_KNOWLEDGE.find(item => item.id === 'billing.insufficient-funds');
assert.ok(insufficientFunds);
assert.match(insufficientFunds.text, /не хватает примерно Y−Z/);
assert.match(insufficientFunds.text, /заявление клиента ≠ факт в Billing/);

const identification = BILLING_KNOWLEDGE.find(item => item.id === 'billing.identification');
assert.ok(identification);
assert.match(identification.text, /лицевой счёт и особовий рахунок в SIMNET — одна сущность/);
assert.match(identification.text, /Именной login латиницей/);

const serviceState = BILLING_KNOWLEDGE.find(item => item.id === 'billing.service-state');
assert.ok(serviceState);
assert.match(serviceState.text, /Любой минус на релевантном балансе приводит к автоблоку/);

const priceVsName = TARIFF_CONTEXT_KNOWLEDGE.find(item => item.id === 'tariff.price-vs-name');
assert.ok(priceVsName);
assert.match(priceVsName.text, /«сколько плачу сейчас» → live-цена из Billing/);
assert.match(priceVsName.text, /nextTariff/);
assert.match(priceVsName.text, /3×89/);

const bundleKtv = TARIFF_CONTEXT_KNOWLEDGE.find(item => item.id === 'tariff.bundle-ktv');
assert.ok(bundleKtv);
assert.match(bundleKtv.text, /330 грн\/месяц/);
assert.match(bundleKtv.text, /не IPTV\/Omega/);

const balanceHits = searchKnowledgeLibrary('временный платеж минус без учета временных заблокируют', { limit: 6 });
assert.ok(balanceHits.some(item => item.id === 'billing.temporary-payment'));
assert.ok(balanceHits.some(item => item.id === 'billing.auto-block'));

const promoHits = searchKnowledgeLibrary('почему сейчас 89 грн а пакет безлимит 310 и что будет потом', { limit: 6 });
assert.ok(promoHits.some(item => item.id === 'tariff.price-vs-name'));

const bundleHits = searchKnowledgeLibrary('кабельное тв интернет бандл 330', { limit: 6 });
assert.ok(bundleHits.some(item => item.id === 'tariff.bundle-ktv'));

console.log('PASS confirmed Billing finance and tariff context knowledge');
