import assert from 'node:assert/strict';
import {
  calculateRecurringTotal,
  normalizeActiveServices,
  normalizeBillingTariffSnapshot,
  normalizeScheduledTariff,
  normalizeTariffLabel
} from '../src/features/ai-operator/billing-tariff-normalizer.js';
import {
  classifyBillingLookup,
  extractContractIdentifier,
  normalizeContractIdentifier
} from '../src/features/ai-operator/billing-live-search.js';
import { CANONICAL_FACT_CATALOG } from '../src/features/ai-operator/canonical-fact-catalog.js';
import { TARIFF_CATALOG, TARIFF_KNOWLEDGE, findTariffOffer } from '../src/features/ai-operator/knowledge/tariffs.js';
import { SERVICE_KNOWLEDGE } from '../src/features/ai-operator/knowledge/services.js';
import { searchKnowledgeLibrary } from '../src/features/ai-operator/knowledge/index.js';

const codedTariff = normalizeTariffLabel('BZL, 310, 300 MB');
assert.equal(codedTariff.rawName, 'BZL, 310, 300 MB');
assert.equal(codedTariff.displayName, '300 Мбит/с — 310 грн/мес');
assert.equal(codedTariff.priceUAH, 310);
assert.equal(codedTariff.speedMbps, 300);

for (const sample of [
  { nextTariff: '', nextTariffDelay: 'в следующем месяце' },
  { nextTariff: '---', nextTariffDelay: 'в следующем месяце' },
  { nextTariff: 'BZL, 310, 300 MB', nextTariffDelay: '' },
  { nextTariff: 'BZL, 310, 300 MB', nextTariffDelay: 'не выбрано' }
]) {
  assert.equal(normalizeScheduledTariff(sample).hasChange, false, 'partial/placeholder future fields must not create a tariff transition');
}

const scheduled = normalizeScheduledTariff({
  nextTariff: 'BZL, 310, 300 MB',
  nextTariffDelay: 'в следующем месяце',
  now: new Date('2026-09-21T00:30:00+03:00')
});
assert.equal(scheduled.hasChange, true);
assert.equal(scheduled.currentTariffTemporary, true);
assert.equal(scheduled.nextTariff.displayName, '300 Мбит/с — 310 грн/мес');
assert.equal(scheduled.effective.kind, 'next_month');
assert.equal(scheduled.effective.month, '2026-10');

const cableServices = normalizeActiveServices([{ name: 'Кабельное телевидение', amount: 99, amountText: '99 грн' }]);
assert.equal(cableServices[0].kind, 'cable_tv');
assert.equal(cableServices[0].displayName, 'Кабельное телевидение');
assert.equal(calculateRecurringTotal(250, cableServices), 349, '250 + 99 must stay exactly 349, not rounded to 350');

const normalizedSnapshot = normalizeBillingTariffSnapshot({
  service: {
    currentTariff: '89 акционный',
    nextTariff: 'BZL, 310, 300 MB',
    nextTariffDelay: 'в следующем месяце',
    activeServices: [{ name: 'Кабельное телевидение', amount: 99 }]
  },
  finance: {
    price: 250,
    priceSemantics: 'internet_tariff_price_from_main_summary_table'
  }
}, { now: new Date('2026-09-21T00:30:00+03:00') });
assert.equal(normalizedSnapshot.service.currentTariffRaw, '89 акционный');
assert.equal(normalizedSnapshot.service.currentTariffTemporary, true);
assert.equal(normalizedSnapshot.service.hasScheduledTariffChange, true);
assert.equal(normalizedSnapshot.service.scheduledChange.priceUAH, 310);
assert.equal(normalizedSnapshot.service.scheduledChange.speedMbps, 300);
assert.equal(normalizedSnapshot.service.scheduledChange.effective.month, '2026-10');
assert.equal(normalizedSnapshot.finance.recurringTotal, 349);

const uncertainPriceSnapshot = normalizeBillingTariffSnapshot({
  service: { currentTariff: '100 Мбит/с', activeServices: [{ name: 'Кабельное телевидение', amount: 99 }] },
  finance: { price: 349, priceSemantics: 'generic_price_row_not_guaranteed_to_be_internet_tariff' }
});
assert.equal(uncertainPriceSnapshot.finance.recurringTotal, null, 'broad Billing price must not be double-counted as confirmed internet price');

assert.deepEqual(classifyBillingLookup({ contract: 'abc-123/7' }), { mode: 'contract', value: 'abc-123/7' });
assert.deepEqual(classifyBillingLookup({ query: '123456' }), { mode: 'contract', value: '123456' });
assert.deepEqual(classifyBillingLookup({ query: 'ABC123' }), { mode: 'contract', value: 'ABC123' });
assert.deepEqual(classifyBillingLookup({ query: 'договор № ABC123' }), { mode: 'contract', value: 'ABC123' });
assert.deepEqual(classifyBillingLookup({ query: 'номер договора 77-А/12' }), { mode: 'contract', value: '77-А/12' });
assert.deepEqual(classifyBillingLookup({ query: 'abon12345' }), { mode: 'login', value: 'abon12345' });
assert.equal(classifyBillingLookup({ query: 'у меня 123 мегабит, какая цена?' }), null, 'incidental number in normal text must not become contract lookup');
assert.equal(extractContractIdentifier('проверь договор № xy-77/2 пожалуйста'), 'xy-77/2');
assert.equal(normalizeContractIdentifier(' Договор № AbC-55/1 '), 'AbC-55/1');

assert.equal(CANONICAL_FACT_CATALOG['subscriber.tariff.scheduledChange.hasChange'].type, 'boolean');
assert.deepEqual(CANONICAL_FACT_CATALOG['subscriber.tariff.scheduledChange.hasChange'].paths, ['service.hasScheduledTariffChange']);
assert.ok(CANONICAL_FACT_CATALOG['subscriber.finance.recurringTotal']);
assert.ok(CANONICAL_FACT_CATALOG['subscriber.tariff.current.rawName']);

assert.deepEqual(TARIFF_CATALOG.apartmentExisting.map(item => [item.speedMbps, item.priceUAH]), [
  [100, 250], [500, 300], [1000, 350]
]);
assert.deepEqual(TARIFF_CATALOG.apartmentNewConnection.map(item => [item.speedMbps, item.priceUAH]), [
  [100, 300], [500, 350], [1000, 400]
]);
assert.deepEqual(TARIFF_CATALOG.privateSector.map(item => [item.speedMbps, item.priceUAH]), [
  [100, 300], [1000, 400]
]);
assert.equal(findTariffOffer({ sector: 'apartment', pricingClass: 'legacy_existing', speedMbps: 500 })?.priceUAH, 300);
assert.equal(findTariffOffer({ sector: 'apartment', pricingClass: 'new_connection', speedMbps: 500 })?.priceUAH, 350);
assert.equal(findTariffOffer({ sector: 'private_sector', speedMbps: 500 }), null, 'private sector must not invent a 500 Mbps tariff');
assert.equal(findTariffOffer({ sector: 'apartment', speedMbps: 100 }), null, 'apartment price is ambiguous without legacy/new context');

const residential = TARIFF_KNOWLEDGE.find(item => item.id === 'tariff.residential');
assert.match(residential.text, /100 Мбит\/с — 250 грн\/месяц/);
assert.match(residential.text, /500 Мбит\/с — 300 грн\/месяц/);
assert.match(residential.text, /1 Гбит\/с — 350 грн\/месяц/);
assert.match(residential.text, /не нужно вычислять по дате подключения/i);
const residentialNew = TARIFF_KNOWLEDGE.find(item => item.id === 'tariff.residential-new-connection');
assert.match(residentialNew.text, /100 Мбит\/с — 300 грн\/месяц/);
assert.match(residentialNew.text, /500 Мбит\/с — 350 грн\/месяц/);
assert.match(residentialNew.text, /1 Гбит\/с — 400 грн\/месяц/);
assert.match(residentialNew.text, /194 канала/);
const privateSector = TARIFF_KNOWLEDGE.find(item => item.id === 'tariff.private-sector');
assert.match(privateSector.text, /Тарифа 500 Мбит\/с для частного сектора нет/);
assert.match(privateSector.text, /30 каналов/);

const newConnectionHits = searchKnowledgeLibrary('новое подключение квартиры 500 мегабит сколько стоит omega', { limit: 6 });
assert.ok(newConnectionHits.some(item => item.id === 'tariff.residential-new-connection'), 'new apartment tariff knowledge must be retrievable');
const privateHits = searchKnowledgeLibrary('частный сектор 500 мегабит тариф есть ли', { limit: 6 });
assert.ok(privateHits.some(item => item.id === 'tariff.private-sector'), 'private-sector tariff knowledge must be retrievable');

const social = TARIFF_KNOWLEDGE.find(item => item.id === 'tariff.social');
assert.ok(social);
assert.match(social.text, /50 Мбит\/с за 200 грн\/месяц/);
assert.match(social.text, /подтвержд/i);
const futurePayment = TARIFF_KNOWLEDGE.find(item => item.id === 'tariff.future-payment');
assert.match(futurePayment.text, /оба поля содержат осмысленные значения/);
assert.match(futurePayment.text, /349 грн/);
assert.match(futurePayment.text, /нельзя самовольно округлять до 350 грн/);
assert.match(futurePayment.text, /нельзя переносить её на следующий месяц/);

const omega = SERVICE_KNOWLEDGE.find(item => item.id === 'service.omega-tv');
assert.match(omega.text, /примерно на 30 каналов/);
assert.match(omega.text, /НОВЫХ квартирных подключений/);
assert.match(omega.text, /примерно на 194 канала/);
assert.match(omega.text, /100 Мбит\/с — 300 грн\/месяц/);
assert.match(omega.text, /500 Мбит\/с — 350 грн\/месяц/);
assert.match(omega.text, /1 Гбит\/с — 400 грн\/месяц/);
const cable = SERVICE_KNOWLEDGE.find(item => item.id === 'service.cable-tv');
assert.match(cable.text, /фактическая активная сумма Billing имеет приоритет/);
assert.match(cable.text, /250 грн интернет \+ 99 грн активное кабельное ТВ = ровно 349 грн\/месяц/);
assert.match(cable.text, /интернет \+ кабельное телевидение за 330 грн\/месяц/);

console.log('PASS AI Billing tariff semantics');
