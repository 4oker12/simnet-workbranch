import { FACT_CATALOG, FACT_RECIPES, RULE_VERSION, STATIC_IP_PRICE_KOP, moneyKop, periodAt, readFact, ingestFacts, subscriberStatus, derivePayment, formatMoney } from './fact-catalog.js';
import { newConversationState, localDialogueControl, normalizeInterpretation, lookupFromText } from './dialogue-state.js';
import { sanitizeLookupToolResultData } from './lab-identity-policy.js';
import { interpretationErrorDetails } from './interpretation-error.js';

export async function runFactTurn({ text, state: previous = {}, transcript = [], interpret, execute, now: evaluationTime, maxReads = 6, replay = false, onEvent = async () => {} }) {
  let now = evaluationTime ?? Date.now();
  const tick = () => { now = evaluationTime ?? Date.now(); };
  const state = newConversationState(previous);
  const events = [];
  const emit = async (type, payload) => { const event = { type, ...payload }; events.push(event); await onEvent(event, state); };
  let raw;
  try { raw = localDialogueControl(text, state) || await interpret({ text, state, transcript }); }
  catch (error) {
    const details = interpretationErrorDetails(error);
    await emit('interpretation_error', details);
    const reply = state.language === 'uk' ? 'Не вдалося розібрати повідомлення через помилку AI-інтерпретатора. Спробуйте ще раз.' : 'Не удалось разобрать сообщение из-за ошибки AI-интерпретатора. Попробуйте ещё раз.';
    return { state, events, decision: { action: 'ask', reply, intent: 'interpretation_unavailable', reason: details.message, diagnostic: details, model: 'fact-runtime' } };
  }
  tick();
  const interpretation = normalizeInterpretation(raw);
  const shortAcknowledgement = ['confirm', 'deny'].includes(interpretation.speechAct) && !interpretation.questions.length;
  if (!shortAcknowledgement) state.language = interpretation.language;
  const uk = state.language === 'uk';
  const say = (ru, ua) => uk ? ua : ru;
  const money = value => formatMoney(value, state.language);
  const lines = [];
  const answerFacts = [];
  const unknown = [];
  let action = 'reply';
  let readCount = 0;
  let pendingRead = null;
  const attempted = new Map();
  const finish = () => ({ state, events, decision: {
    action: pendingRead ? 'tool_required' : action,
    domain: interpretation.questions.some(q => q.entity === 'network') ? 'technical' : 'account',
    intent: state.topic.map(q => `${q.entity}.${q.relation}`).join('+') || interpretation.speechAct,
    semantic: interpretation, language: state.language, tool: pendingRead?.tool || '', toolArgs: pendingRead?.toolArgs || {},
    reply: [...new Set(lines)].join(' '), reason: 'Validated facts and SIMNET rules',
    answerPlan: { facts: answerFacts, unknown, executedActions: events.filter(x => x.type === 'tool_result' && x.ok).map(x => x.tool) },
    model: raw.model || 'fact-runtime', usage: raw.usage || {}, rateLimit: raw.rateLimit || {}, promptChars: raw.promptChars || 0
  } });
  if (interpretation.speechAct === 'request_human') {
    action = 'escalate';
    lines.push(say('Для продолжения нужен оператор. Автоматическая передача чата здесь пока недоступна.', 'Для продовження потрібен оператор. Автоматичне передавання чату тут поки недоступне.'));
    return finish();
  }
  const hadPending = Boolean(state.pendingCandidate);
  if (interpretation.questions.length) state.topic = interpretation.questions;
  else if (interpretation.speechAct === 'new' && !Object.keys(interpretation.ids).length && !interpretation.refresh) state.topic = [{ entity: 'unknown', relation: 'info', period: 'current' }];
  if (shortAcknowledgement && !hadPending) { lines.push(say('Понял.', 'Зрозуміло.')); return finish(); }
  if (interpretation.refresh) {
    for (const [name, spec] of Object.entries(FACT_CATALOG)) {
      const financial = ['customer.snapshot', 'billing.payments'].includes(spec.source);
      if (interpretation.refresh === 'all' || (interpretation.refresh === 'finance' ? financial : !financial)) delete state.facts[name];
    }
    state.reads = {}; state.derived = []; state.invalidatedAt = now;
  }
  async function read(tool, args = {}) {
    const key = JSON.stringify([state.confirmedCaseId, tool, Object.entries(args).sort(([a], [b]) => a.localeCompare(b))]);
    if (attempted.has(key)) return attempted.get(key);
    if (replay) { pendingRead = { tool, toolArgs: args }; return null; }
    if (readCount >= maxReads) return null;
    readCount++;
    await emit('tool_call', { tool, toolArgs: args });
    let result;
    try { result = await execute({ tool, toolArgs: args, labState: state }); }
    catch { result = { tool, ok: false, code: 'SOURCE_UNAVAILABLE', observedAt: new Date(now).toISOString(), data: {} }; }
    tick();
    if (tool === 'customer.snapshot' && result.ok) {
      const actual = result.data?.identity || {};
      const expected = state.confirmedSubscriber || {};
      if (['billingId', 'contract', 'login'].some(field => actual[field] && expected[field] && String(actual[field]).toLowerCase() !== String(expected[field]).toLowerCase())) {
        result = { tool, ok: false, code: 'IDENTITY_CONFLICT', data: {}, observedAt: new Date(now).toISOString() };
        state.facts = {}; state.derived = [];
      }
    }
    attempted.set(key, result);
    const safe = { ...result, data: tool === 'customer.lookup' ? sanitizeLookupToolResultData(result.data) : result.data };
    delete safe.statePatch;
    await emit('tool_result', safe);
    if (tool === 'customer.lookup') {
      // Never inherit facts across identity attempts, but preserve a direct confirmed binding returned for an explicit account identifier.
      state.facts = {}; state.reads = {}; state.derived = [];
      if (result.ok && result.statePatch) {
        state.confirmedCaseId = String(result.statePatch.confirmedCaseId || '');
        state.confirmedSubscriber = result.statePatch.confirmedSubscriber || null;
        state.pendingCandidate = result.statePatch.pendingCandidate || null;
      } else {
        state.confirmedCaseId = ''; state.confirmedSubscriber = null; state.pendingCandidate = null;
      }
    } else if (tool === 'customer.confirm') {
      if (result.ok && result.statePatch) { Object.assign(state, result.statePatch); state.facts = {}; state.reads = {}; state.derived = []; }
    } else {
      ingestFacts(state.facts, result, state.confirmedCaseId, now, state.invalidatedAt);
      state.reads[tool] = { caseId: state.confirmedCaseId, period: periodAt(now), at: now, code: result.code, ok: result.ok };
    }
    return result;
  }
  const lookup = lookupFromText(interpretation.ids, text);
  if (lookup && (!state.confirmedCaseId || interpretation.speechAct === 'correct' || (lookup.contract && lookup.contract !== state.confirmedSubscriber?.contract) || (lookup.address && lookup.address !== state.confirmedSubscriber?.address))) {
    await read('customer.lookup', lookup);
    if (pendingRead) {
      // Replay is intentionally isolated from live Billing. Still remember an explicit contract so later
      // turns of the same historical chat do not repeatedly ask for an identifier already supplied.
      if (replay && lookup.contract) {
        const replayCaseId = `replay-contract:${lookup.contract}`;
        state.facts = {}; state.reads = {}; state.derived = [];
        state.pendingCandidate = null;
        state.confirmedCaseId = replayCaseId;
        state.confirmedSubscriber = { caseId: replayCaseId, contract: lookup.contract };
      }
      return finish();
    }
  }
  if (hadPending && !lookup && interpretation.confirmation !== null) { await read('customer.confirm', { confirmed: interpretation.confirmation }); if (pendingRead) return finish(); }
  if (state.pendingCandidate) {
    const candidate = state.pendingCandidate;
    lines.push(say(`Нашёл ${candidate.contract ? `договор ${candidate.contract}` : 'подключение'}${candidate.address ? ` по адресу ${candidate.address}` : ''}. Это ваше подключение?`, `Знайшов ${candidate.contract ? `договір ${candidate.contract}` : 'підключення'}${candidate.address ? ` за адресою ${candidate.address}` : ''}. Це ваше підключення?`));
    action = 'ask'; return finish();
  }
  const questions = state.topic.length ? state.topic : [{ entity: 'unknown', relation: 'info', period: 'current' }];
  const nonPersonal = new Set(['payment.instructions', 'network.info', 'tariff.upgrade', 'tariff.downgrade', 'tariff.change', 'equipment.compatibility']);
  const personal = questions.some(q => !['static_ip', 'unknown'].includes(q.entity) && !nonPersonal.has(`${q.entity}.${q.relation}`));
  if (personal && !state.confirmedCaseId) { lines.push(say('Подскажите номер договора или полный адрес подключения.', 'Підкажіть номер договору або повну адресу підключення.')); action = 'ask'; return finish(); }
  const values = () => Object.fromEntries(Object.keys(FACT_CATALOG).map(name => [name, readFact(state.facts, name, state.confirmedCaseId, now)?.value]).filter(([, v]) => v !== undefined));
  async function ensure(names) {
    const sources = [...new Set(names.filter(name => !readFact(state.facts, name, state.confirmedCaseId, now)).map(name => FACT_CATALOG[name]?.source).filter(Boolean))];
    for (const source of sources) {
      const last = state.reads[source];
      const recent = last?.caseId === state.confirmedCaseId && last.period === periodAt(now) && now - last.at < 30000 && last.at >= state.invalidatedAt;
      if (!recent) await read(source, { refresh: true, maxAgeMs: Math.min(...names.filter(n => FACT_CATALOG[n]?.source === source).map(n => FACT_CATALOG[n].ttlMs)) });
      if (pendingRead) break;
    }
  }
  function gap(name, ru, ua) { unknown.push(name); lines.push(say(ru, ua)); }
  function record(name, value, question, dependencies = []) {
    const fact = { name, value, caseId: state.confirmedCaseId, period: question.period || periodAt(now), provenance: dependencies.length ? 'derived' : 'direct', ruleVersion: RULE_VERSION, source: dependencies.length ? 'domain-rule' : state.facts[name]?.source || 'confirmed-identity', expiresAt: dependencies.length ? Math.min(...dependencies.map(n => state.facts[n]?.expiresAt || now)) : state.facts[name]?.expiresAt || now, dependsOn: dependencies.map(n => ({ name: n, version: state.facts[n]?.version || '' })) };
    answerFacts.push(fact); if (dependencies.length) state.derived.push(fact);
  }
  for (const q of questions) {
    const key = `${q.entity}.${q.relation}`;
    if (key === 'network.info') { lines.push(say('Роутер соединяет домашние устройства с сетью провайдера и раздаёт Wi-Fi. Поэтому его проверка помогает отделить проблему дома от проблемы линии. Сама рекомендация проверить роутер ещё не означает, что неисправен именно он.', 'Роутер з’єднує домашні пристрої з мережею провайдера та роздає Wi-Fi. Тому його перевірка допомагає відрізнити проблему вдома від проблеми лінії. Сама рекомендація перевірити роутер ще не означає, що несправний саме він.')); continue; }
    if (key === 'equipment.compatibility') { lines.push(say('Если модель роутера не знаете, посмотрите её на наклейке снизу или сзади. Для гигабитного тарифа нужны гигабитные WAN/LAN-порты роутера и 8-жильный Ethernet-кабель; по Wi-Fi фактическая скорость может быть ниже гигабита.', 'Якщо модель роутера не знаєте, подивіться її на наліпці знизу або ззаду. Для гігабітного тарифу потрібні гігабітні WAN/LAN-порти роутера та 8-жильний Ethernet-кабель; через Wi-Fi фактична швидкість може бути нижчою за гігабіт.')); continue; }
    if (key === 'tariff.upgrade') { lines.push(say('На более быстрый тариф можно перейти в любой день месяца. Разница в стоимости списывается сразу полностью, не пропорционально дням: например, при переходе 250 → 350 грн спишется 100 грн. Перед переключением нужно согласие абонента на это списание. Для гигабита оборудование клиента должно поддерживать 1 Гбит/с.', 'На швидший тариф можна перейти в будь-який день місяця. Різниця у вартості списується одразу повністю, не пропорційно дням: наприклад, при переході 250 → 350 грн спишеться 100 грн. Перед перемиканням потрібна згода абонента на це списання. Для гігабіта обладнання клієнта має підтримувати 1 Гбіт/с.')); continue; }
    if (key === 'tariff.downgrade') { lines.push(say('Понизить тариф с 1-го по 10-е число включительно можно сразу, выбрав более дешёвый текущий пакет. После 10-го снижение ставится как следующий пакет на следующий месяц; текущий тариф работает до конца месяца.', 'Знизити тариф з 1-го по 10-те число включно можна одразу, вибравши дешевший поточний пакет. Після 10-го зниження ставиться як наступний пакет на наступний місяць; поточний тариф працює до кінця місяця.')); continue; }
    if (key === 'tariff.change') { lines.push(say('Если повышаете тариф, перейти можно в любой день: полная разница в цене списывается сразу после согласия. Если понижаете — до 10-го включительно можно сменить текущий пакет, после 10-го новый тариф ставится со следующего месяца.', 'Якщо підвищуєте тариф, перейти можна в будь-який день: повна різниця в ціні списується одразу після згоди. Якщо знижуєте — до 10-го включно можна змінити поточний пакет, після 10-го новий тариф ставиться з наступного місяця.')); continue; }
    if (key === 'payment.instructions') { const contract = state.confirmedSubscriber?.contract; lines.push(say(`Оплатить можно через онлайн-банкинг: Платежи → Интернет → SIMNET${contract ? ` → договор ${contract}` : ' → номер вашего договора'}.`, `Оплатити можна через онлайн-банкінг: Платежі → Інтернет → SIMNET${contract ? ` → договір ${contract}` : ' → номер вашого договору'}.`)); continue; }
    if (q.entity === 'static_ip') {
      lines.push(say(`Статический IP стоит ${money(STATIC_IP_PRICE_KOP)} в месяц. При подключении ${money(STATIC_IP_PRICE_KOP)} спишутся сразу; затем услуга добавляется к ежемесячной оплате.`, `Статична IP-адреса коштує ${money(STATIC_IP_PRICE_KOP)} на місяць. При підключенні ${money(STATIC_IP_PRICE_KOP)} спишуться одразу; далі послуга додається до щомісячної оплати.`));
      if (q.relation === 'change') { action = 'escalate'; lines.push(say('Подключение должен выполнить оператор; здесь услуга ещё не подключена. После подключения выключите и снова включите питание роутера.', 'Підключення має виконати оператор; тут послугу ще не підключено. Після підключення вимкніть і знову ввімкніть живлення роутера.')); }
      record('staticIpPrice', STATIC_IP_PRICE_KOP, q, ['policy.staticIp']); continue;
    }
    if (key === 'contract.info') { const contract = state.confirmedSubscriber?.contract; if (contract) { lines.push(say(`Ваш номер договора — ${contract}.`, `Ваш номер договору — ${contract}.`)); record('contract', contract, q); } else gap('contract', 'Номер договора в полученных данных не указан.', 'Номер договору в отриманих даних не вказано.'); continue; }
    if (key === 'service.change') { action = 'escalate'; lines.push(say('Изменение по договору должен выполнить оператор. Здесь данные ещё не менялись.', 'Зміну за договором має виконати оператор. Тут дані ще не змінювалися.')); continue; }
    if (!FACT_RECIPES[key]) { action = 'ask'; lines.push(say('Уточните, пожалуйста, что именно хотите узнать или изменить?', 'Уточніть, будь ласка, що саме хочете дізнатися або змінити?')); continue; }
    await ensure(FACT_RECIPES[key]); if (pendingRead) return finish();
    let v = values(); const status = subscriberStatus(v);
    if (['recurring_charge.amount', 'recurring_charge.coverage', 'service.status', 'network.cause'].includes(key) && status === 'inactive_removed') { lines.push(say('Договор деактивирован. Для восстановления оператору нужно вернуть рабочую группу, назначить актуальный тариф и активировать услугу. Сумму пополнения можно определить после выбора тарифа.', 'Договір деактивовано. Для відновлення оператору потрібно повернути робочу групу, призначити актуальний тариф і активувати послугу. Суму поповнення можна визначити після вибору тарифу.')); record('subscriberStatus', status, q, ['group', 'currentTariff', 'accessState', 'startDay']); continue; }
    if (key === 'balance.amount') {
      if (v.accountBalance !== undefined) { lines.push(say(`На счёте сейчас ${money(v.accountBalance)}.`, `На рахунку зараз ${money(v.accountBalance)}.`)); record('accountBalance', v.accountBalance, q); } else gap('accountBalance', 'Не удалось получить актуальный баланс.', 'Не вдалося отримати актуальний баланс.');
    } else if (key === 'tariff.info') {
      const tariff = q.period === 'next' ? (v.nextTariff === '' ? v.currentTariff : v.nextTariff) : v.currentTariff;
      if (q.period === 'next' && v.nextTariff === undefined) { await ensure(['nextTariff']); v = values(); }
      const actual = q.period === 'next' ? (v.nextTariff === '' ? v.currentTariff : v.nextTariff) : tariff;
      if (actual) lines.push(say(`Тариф ${q.period === 'next' ? 'на следующий месяц' : 'сейчас'} — «${actual.replace(/\s*-\s*\(\d{2}\.\d{2}\.\d{4}\)\s*$/, '')}».`, `Тариф ${q.period === 'next' ? 'на наступний місяць' : 'зараз'} — «${actual.replace(/\s*-\s*\(\d{2}\.\d{2}\.\d{4}\)\s*$/, '')}».`)); else gap('currentTariff', 'Не удалось получить актуальный тариф.', 'Не вдалося отримати актуальний тариф.');
    } else if (key === 'recurring_charge.timing') {
      if (v.nextChargeAt && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v.nextChargeAt)) lines.push(say(`Следующее списание — ${v.nextChargeAt.slice(0, 10)}.`, `Наступне списання — ${v.nextChargeAt.slice(0, 10)}.`)); else gap('nextChargeAt', 'Точная дата следующего списания в полученных данных не указана.', 'Точну дату наступного списання в отриманих даних не вказано.');
    } else if (key === 'recurring_charge.coverage') {
      if (status === 'active' && v.balanceAfterCurrentPeriod !== undefined && q.period === 'current') { const covered = v.balanceAfterCurrentPeriod >= 0; lines.push(covered ? say('Текущий месяц оплачен.', 'Поточний місяць оплачено.') : say(`Для покрытия текущего месяца не хватает ${money(-v.balanceAfterCurrentPeriod)}.`, `Для покриття поточного місяця не вистачає ${money(-v.balanceAfterCurrentPeriod)}.`)); record('currentPeriodCovered', covered, q, ['balanceAfterCurrentPeriod', 'accessState', 'startDay', 'currentTariff']); } else gap('coverage', 'По полученным данным пока нельзя подтвердить оплату этого периода.', 'За отриманими даними поки не можна підтвердити оплату цього періоду.');
    } else if (key === 'recurring_charge.amount') {
      if (v.nextTariff && q.period !== 'current') { await ensure(['nextTariffPrice', 'activeServicesTotal']); v = values(); }
      const calculated = derivePayment(v, q, now);
      if (!calculated.ok) gap(calculated.gap, calculated.gap === 'nextTariffPrice' ? 'Запланирована смена тарифа, но его подтверждённой цены пока нет. Точную сумму назвать не могу.' : 'Для точного расчёта не хватает актуальных данных о тарифе, состоянии услуги или остатке после текущего месяца.', calculated.gap === 'nextTariffPrice' ? 'Заплановано зміну тарифу, але його підтвердженої ціни поки немає. Точну суму назвати не можу.' : 'Для точного розрахунку не вистачає актуальних даних про тариф, стан послуги або залишок після поточного місяця.');
      else if (q.period === 'current') { lines.push(say(`Сейчас ежемесячная сумма — ${money(calculated.monthlyTotal)}.`, `Зараз щомісячна сума — ${money(calculated.monthlyTotal)}.`)); record('monthlyTotal', calculated.monthlyTotal, { period: calculated.period }, ['monthlyTotal']); }
      else { lines.push(q.period === 'year_end' ? say(`До конца ${q.year || Number(periodAt(now).slice(0, 4))} года пополнить нужно на ${money(calculated.requiredTopUp)} — при неизменном составе услуг и стоимости после уже запланированных изменений.`, `До кінця ${q.year || Number(periodAt(now).slice(0, 4))} року поповнити потрібно на ${money(calculated.requiredTopUp)} — за незмінного складу послуг і вартості після вже запланованих змін.`) : say(`На следующий месяц нужно ${money(calculated.monthlyTotal)}. С учётом остатка после текущего месяца пополнить нужно на ${money(calculated.requiredTopUp)}.`, `На наступний місяць потрібно ${money(calculated.monthlyTotal)}. З урахуванням залишку після поточного місяця поповнити потрібно на ${money(calculated.requiredTopUp)}.`)); record('requiredTopUp', calculated.requiredTopUp, { period: calculated.period }, ['monthlyTotal', 'balanceAfterCurrentPeriod', 'nextTariff', ...(v.nextTariff ? ['nextTariffPrice', 'activeServicesTotal'] : [])]); }
    } else if (key === 'service.status' || key === 'network.cause') {
      if (status === 'access_denied' || status === 'inactive_unknown') { lines.push(say('По данным учётной системы доступ не активен. Причина пока не подтверждена; нужна проверка состояния услуги оператором.', 'За даними облікової системи доступ не активний. Причину поки не підтверджено; потрібна перевірка стану послуги оператором.')); continue; }
      if (status !== 'active') { gap('service_state', 'Не удалось подтвердить текущее состояние услуги. Без этого причину отсутствия интернета определить нельзя.', 'Не вдалося підтвердити поточний стан послуги. Без цього причину відсутності інтернету визначити не можна.'); continue; }
      if (key === 'service.status') { lines.push(say('В учётной системе доступ разрешён. Это ещё не подтверждает, что соединение работает.', 'В обліковій системі доступ дозволено. Це ще не підтверджує, що з’єднання працює.')); continue; }
      await ensure(['sessionStatus']); if (pendingRead) return finish(); v = values();
      if (v.sessionStatus) lines.push(say(`Состояние интернет-сессии: ${v.sessionStatus}.`, `Стан інтернет-сесії: ${v.sessionStatus}.`));
      if (/pon/i.test(v.accessTechnology || '')) { await ensure(['onuStatus']); if (pendingRead) return finish(); v = values(); if (v.onuStatus) lines.push(say(`Состояние оптического терминала: ${v.onuStatus}.`, `Стан оптичного термінала: ${v.onuStatus}.`)); }
      gap('network_cause', 'Причина пока не установлена. Интернет не работает на всех устройствах или только на одном?', 'Причину поки не встановлено. Інтернет не працює на всіх пристроях чи лише на одному?'); action = 'ask';
    } else if (key === 'payment.history') {
      const payment = Array.isArray(v.payments) ? v.payments[0] : null; const amount = moneyKop(payment?.amount); const date = String(payment?.date || '');
      if (amount !== null && /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(date)) lines.push(say(`В доступной истории есть запись от ${date} на ${money(amount)}.`, `У доступній історії є запис від ${date} на ${money(amount)}.`)); else gap('payments', 'Не удалось получить подтверждённую историю платежей.', 'Не вдалося отримати підтверджену історію платежів.');
    }
  }
  return finish();
}
