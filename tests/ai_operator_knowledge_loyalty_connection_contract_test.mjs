import test from 'node:test';
import assert from 'node:assert/strict';

import { PROMOTION_KNOWLEDGE } from '../src/features/ai-operator/knowledge/promotions.js';
import { CONNECTION_KNOWLEDGE } from '../src/features/ai-operator/knowledge/connection.js';
import { BILLING_KNOWLEDGE } from '../src/features/ai-operator/knowledge/billing.js';
import { SERVICE_KNOWLEDGE } from '../src/features/ai-operator/knowledge/services.js';
import { BILLING_SETTLEMENT_CYCLE_KNOWLEDGE } from '../src/features/ai-operator/knowledge/billing-settlement-cycle.js';
import { TECHNICAL_KNOWLEDGE } from '../src/features/ai-operator/knowledge/technical.js';

function byId(items, id) {
  const article = items.find(item => item.id === id);
  assert.ok(article, `missing knowledge article ${id}`);
  return article;
}

test('loyalty rules stay atomic and preserve confirmed amounts', () => {
  const newConnection = byId(PROMOTION_KNOWLEDGE, 'promotion.new-connection-89x3');
  assert.match(newConnection.text, /календарным месяцам/u);
  assert.match(newConnection.text, /с 1-го по 10-е число включительно/u);
  assert.match(newConnection.text, /через 4 мес\. на основной пакет/u);
  assert.match(newConnection.text, /может сочетаться с другими акциями/u);

  const cashback = byId(PROMOTION_KNOWLEDGE, 'promotion.friendly-cashback-20');
  assert.match(cashback.text, /1000\s*грн/u);
  assert.match(cashback.text, /не обязана быть кратной 1000/u);
  assert.match(cashback.text, /1500\s*грн.*300\s*грн/us);
  assert.match(cashback.text, /20%/u);
  assert.match(cashback.text, /пользоваться повторно сколько угодно раз/u);
  assert.match(cashback.text, /сочетать с другими акциями/u);
  assert.match(cashback.text, /финансов/u);

  const tenPlusThree = byId(PROMOTION_KNOWLEDGE, 'promotion.prepay-10-plus-3');
  assert.match(tenPlusThree.text, /доступна любому абоненту/u);
  assert.match(tenPlusThree.text, /10 регулярным месячным/u);
  assert.match(tenPlusThree.text, /3 месячным/u);
  assert.match(tenPlusThree.text, /2500\s*грн/u);
  assert.match(tenPlusThree.text, /750\s*грн/u);
  assert.match(tenPlusThree.text, /можно пользоваться повторно/u);
  assert.match(tenPlusThree.text, /сочетать с другими акциями/u);

  const referral = byId(PROMOTION_KNOWLEDGE, 'promotion.referral');
  assert.match(referral.text, /поверх обязательного стартового аванса 300\s*грн/u);
  assert.match(referral.text, /двум месяцам именно его собственного тарифа/u);
  assert.match(referral.text, /700\s*грн/u);
  assert.match(referral.text, /500\s*грн/u);
  assert.match(referral.text, /не блокирует другие акции/u);

  const timely = byId(PROMOTION_KNOWLEDGE, 'promotion.timely-payment-12');
  assert.match(timely.text, /12 месяцев подряд/u);
  assert.match(timely.text, /На баланс начисляется сумма/u);
  assert.match(timely.text, /одной текущей месячной стоимости/u);
  assert.match(timely.text, /повторно каждый год/u);

  const review = byId(PROMOTION_KNOWLEDGE, 'promotion.social-review');
  assert.match(review.text, /скидку 50% на один месяц/u);
  assert.match(review.text, /ссылку на публикацию или скриншот/u);

  const benefit = byId(PROMOTION_KNOWLEDGE, 'promotion.social-benefit-15');
  assert.match(benefit.text, /15%/u);
  assert.match(benefit.text, /постоянно на стоимость тарифного плана/u);
  assert.match(benefit.text, /На дополнительные услуги .* не распространяется/us);
});

test('first-connection advance is not conflated with optical installation price', () => {
  const advance = byId(CONNECTION_KNOWLEDGE, 'connection.initial-advance-300');
  const optical = byId(CONNECTION_KNOWLEDGE, 'connection.optical-installation');
  const prewire = byId(CONNECTION_KNOWLEDGE, 'connection.repair-prewire');

  assert.match(advance.text, /300\s*грн/u);
  assert.match(advance.text, /деньги клиента на балансе/u);
  assert.match(advance.text, /идут в счёт оплаты его услуг/u);
  assert.match(advance.text, /действующего абонента.*300\s*грн не нужно/us);

  assert.match(optical.text, /500\s*грн/u);
  assert.match(optical.text, /стартовый аванс 300\s*грн повторно не вносится/u);
  assert.match(optical.text, /PoE/u);
  assert.match(optical.text, /ONU\/ONT/u);

  assert.match(prewire.text, /заведение оптического кабеля .* бесплатно/u);
  assert.match(prewire.text, /300\s*грн/u);
  assert.match(prewire.text, /500\s*грн/u);
  assert.match(prewire.text, /повторно эти же 500\s*грн не взимаются/u);
  assert.match(prewire.text, /кабель без установки\/оставления терминала.*500\s*грн.*при окончательном подключении/us);
  assert.match(prewire.text, /не следует путать .*«паузой»/u);
});

test('returning subscriber and new occupant stay separate from historical contract debt', () => {
  const returning = byId(CONNECTION_KNOWLEDGE, 'connection.returning-after-inactivity');
  assert.match(returning.text, /нет фиксированного правила|не вводи жёсткий порог/u);
  assert.match(returning.text, /финансовый тикет/u);
  assert.match(returning.text, /не.*автоматически.*сначала погасите/us);
  assert.match(returning.text, /2–3 лет/u);
  assert.match(returning.text, /может восстановить старый договор.*либо зарегистрировать новый договор/us);
  assert.match(returning.text, /это ориентир, а не запрет на восстановление/u);

  const occupant = byId(CONNECTION_KNOWLEDGE, 'connection.new-occupant-existing-line');
  assert.match(occupant.text, /не подтверждает принадлежность договора новому человеку/u);
  assert.match(occupant.text, /MAC\/ONU/u);
  assert.match(occupant.text, /не переносится/u);

  const owner = byId(CONNECTION_KNOWLEDGE, 'connection.contract-owner');
  assert.match(owner.text, /не нужно автоматически навязывать переоформление/u);
  assert.match(owner.text, /не.*обязательный отдельный звонок владельца/us);

  const pause = byId(SERVICE_KNOWLEDGE, 'service.pause');
  assert.match(pause.text, /С даты вступления паузы в силу.*начисление.*прекращается/us);
  assert.match(pause.text, /если паузу не поставили.*начисления могли продолжаться/isu);
  assert.match(pause.text, /автоматическая пауза.*один месяц/isu);
  assert.match(pause.text, /снимается автоматически/u);
  assert.match(pause.text, /вплоть до 6 месяцев/u);

  const settlement = byId(BILLING_SETTLEMENT_CYCLE_KNOWLEDGE, 'billing.settlement-cycle');
  assert.match(settlement.text, /L1 создаёт финансовый тикет/u);
  assert.match(settlement.text, /временный платёж.*мост/us);
  assert.match(settlement.text, /новый жилец.*не переносится/us);
  assert.match(settlement.text, /от 1 до 5 суток/u);
  assert.match(settlement.text, /1–3 суток/u);
  assert.match(settlement.text, /в течение 3 суток/u);
  assert.match(settlement.text, /Billing рассчитывает сумму пропорционально/u);
});

test('guest access is a hard remote-recovery split for the old-line scenario', () => {
  const guest = byId(TECHNICAL_KNOWLEDGE, 'technical.guest-access-recovery');
  assert.match(guest.text, /WAN Link.*предварительный признак/us);
  assert.match(guest.text, /Если гостевой доступ появился.*удалённого решения/us);
  assert.match(guest.text, /выезд мастера.*не нужен/us);
  assert.match(guest.text, /гостевой доступ не появляется.*вызов мастера/us);
  assert.match(guest.text, /отвязать этот MAC от старого договора.*привязать к новому/us);

  const occupant = byId(CONNECTION_KNOWLEDGE, 'connection.new-occupant-existing-line');
  assert.match(occupant.text, /guest-доступа.*достаточным операционным признаком/us);
  assert.match(occupant.text, /guest-доступ не появляется.*вызову мастера/us);
});

test('payment knowledge keeps calendar billing separate from mid-month resumed service', () => {
  const payment = byId(BILLING_KNOWLEDGE, 'billing.payment');
  const cycle = byId(BILLING_KNOWLEDGE, 'billing.billing-cycle');
  const state = byId(BILLING_KNOWLEDGE, 'billing.service-state');

  assert.match(payment.text, /28–30/u);
  assert.match(payment.text, /до начала следующего расчётного периода/u);
  assert.match(payment.text, /не превращать конкретные даты 28–30 числа в универсальное правило/iu);
  assert.match(payment.text, /не подтверждением поступления денег/u);

  assert.match(cycle.text, /13-го числа.*сама по себе не означает.*до 13-го числа следующего месяца/isu);
  assert.match(cycle.text, /календарного расчётного периода/iu);
  assert.match(cycle.text, /стояла на паузе.*неполного периода или перерасчёта/isu);
  assert.match(cycle.text, /точную формулу и сумму не выводить/iu);
  assert.match(cycle.text, /Поздняя оплата.*не является доказательством права на пропорциональный расчёт/isu);

  assert.match(state.text, /Фактическое состояние доступа брать из accessState\/serviceState/iu);
  assert.match(state.text, /не создаёт новый расчётный период от даты платежа/iu);
});

test('credit days and Omega TV preserve operational practice without inventing actions', () => {
  const credit = byId(SERVICE_KNOWLEDGE, 'service.credit-days');
  assert.match(credit.text, /обычно удовлетворяют/u);
  assert.match(credit.text, /не более одного предоставления.*в течение одного месяца/us);
  assert.match(credit.text, /возможны ручные исключения/u);
  assert.match(credit.text, /злоупотребляет.*могут отказать/us);
  assert.match(credit.text, /Максимальная длительность.*не зафиксирована/us);

  const omega = byId(SERVICE_KNOWLEDGE, 'service.omega-tv');
  assert.match(omega.text, /доступен всем абонентам SIMNET/u);
  assert.match(omega.text, /без отдельной абонплаты/u);
  assert.match(omega.text, /личный кабинет/u);
  assert.match(omega.text, /предпочтительно.*оператор\/поддержка/us);
  assert.match(omega.text, /Факт уже выполненной активации Omega TV.*должен подтверждаться/us);
});
