'use strict';

import * as core from './semantic-tool-broker-core.js';
import { recoverLiveDataNeeds } from './live-need-recovery.js';
import { normalizeCanonicalFacts } from './canonical-fact-catalog.js';
import { resolveFacts } from './canonical-fact-resolver.js';

/*
Evidence contract inherited from the core broker and enforced again by the runtime fallback:
- source=userside-live-read-only is fresh UserSide evidence.
- source=billing-live-read-only is fresh Billing evidence.
- Workbench/Network fallback не выдавай за свежий Juniper/UserSide запрос.
- ok=false означает «проверить не удалось», а НЕ доказательство отрицательного факта.
- поле reply ОБЯЗАТЕЛЬНО должно быть непустым.
*/

const TOOL_MANIFEST = Object.freeze([
  Object.freeze({
    name: 'customer.lookup', system: 'Billing', capability: 'billing', implementation: 'implemented', mode: 'billing-live-read-only',
    establishes: 'Устанавливает, какой конкретный абонент/договор соответствует переданному login, номеру договора, IP или адресу, и привязывает live-контекст к найденному кейсу.',
    answers: ['Какой это абонент?', 'Какой договор соответствует abon/login?', 'Какой Billing ID, адрес, IP и тип подключения у найденного абонента?', 'Однозначно ли найден клиент?'],
    recommendedWhen: ['По умолчанию это ПЕРВЫЙ и основной поиск конкретного абонента: если клиент сообщил abon/login, договор, IP или адрес, сначала ищи его через Billing.', 'Перед subscriber-specific READ-tools, если кейс ещё не подтверждён.'],
    returns: ['billingId', 'contract', 'login', 'address', 'fullName', 'ip', 'connectionFamily', 'requiresConfirmation'],
    requires: ['Для свежего Billing-поиска нужна открытая авторизованная Billing-сессия; фактическая готовность подтверждается результатом вызова.'],
    limitations: ['Поиск по адресу может потребовать customer.confirm.', 'ok=false означает, что идентификацию подтвердить не удалось, а не что абонента точно не существует.']
  }),
  Object.freeze({
    name: 'customer.confirm', system: 'Conversation', capability: 'billing', implementation: 'implemented', mode: 'conversation-state',
    establishes: 'Подтверждает или отклоняет кандидата, которого система нашла неоднозначным способом, обычно по адресу.',
    answers: ['Это именно тот найденный абонент?', 'Можно ли привязать последующие проверки к этому кандидату?'],
    recommendedWhen: ['После customer.lookup, если requiresConfirmation=true и клиент подтвердил или отклонил найденное подключение.'],
    returns: ['confirmedCaseId', 'confirmedSubscriber или сброс pendingCandidate'],
    requires: ['pendingCandidate в состоянии диалога и явное подтверждение/отрицание клиента.'],
    limitations: ['Не используется вместо customer.lookup и не придумывает идентификацию самостоятельно.']
  }),
  Object.freeze({
    name: 'customer.snapshot', system: 'Billing', capability: 'billing', implementation: 'implemented', mode: 'billing-live-read-only',
    establishes: 'Устанавливает текущий доступный Billing-снимок уже подтверждённого абонента: идентификацию, адрес, услугу, финансы, IP и последние прочитанные платежи.',
    answers: ['Что сейчас показывает карточка Billing?', 'Разрешён ли доступ?', 'Какой статус услуги?', 'Какой тариф, баланс, IP и базовые данные записаны в Billing?'],
    recommendedWhen: ['Нужен общий Billing-контекст сразу по нескольким полям.', 'После идентификации, если нужно безопасно восстановить ответ при сбое LLM.', 'Когда узкий billing.* tool не покрывает весь требуемый набор фактов.'],
    returns: ['identity', 'address', 'service', 'finance', 'network', 'payments', 'observedAt/source'],
    requires: ['Подтверждённый subscriber case.', 'Для refresh нужна доступная Billing-сессия; результат вызова сообщает, удалось ли получить свежие данные.'],
    limitations: ['Статус «Разрешен/Все ОК» не доказывает фактическую работоспособность интернета.', 'Billing snapshot не заменяет BRAS/Juniper или линию.']
  }),
  Object.freeze({
    name: 'billing.balance', system: 'Billing', capability: 'billing', implementation: 'implemented', mode: 'billing-live-read-only',
    establishes: 'Устанавливает подтверждённые финансовые поля Billing по текущему абоненту.',
    answers: ['Какой текущий баланс?', 'Есть ли временный платёж?', 'Что Billing показывает по финансовому состоянию?', 'Какой статус услуги сопутствует финансовой карточке?'],
    recommendedWhen: ['Клиент спрашивает баланс, долг, оплату, состояние счёта или доступ после финансовой операции.'],
    returns: ['accountBalance', 'balanceAfterTariff', 'balanceWithoutTemporary', 'temporaryPayment', 'price', 'totalDue', 'accessState', 'serviceState'],
    requires: ['Подтверждённый subscriber case и доступный Billing snapshot/live read.'],
    limitations: ['price и totalDue имеют отдельную семантику и не должны автоматически трактоваться как будущая абонплата.', 'Не подтверждает внешний платёж, если он не появился в Billing.']
  }),
  Object.freeze({
    name: 'billing.tariff', system: 'Billing', capability: 'billing', implementation: 'implemented', mode: 'billing-live-read-only',
    establishes: 'Устанавливает текущий и, если есть, следующий тариф вместе с Billing-состоянием услуги.',
    answers: ['Какой тариф сейчас?', 'Какая тарифная скорость записана в Billing?', 'Есть ли следующий тариф?', 'Когда Billing планирует его применить?', 'Разрешена ли услуга?'],
    recommendedWhen: ['Вопросы о текущем тарифе, скорости по тарифу, смене тарифа или состоянии услуги, связанном с тарифом.'],
    returns: ['currentTariff', 'nextTariff', 'nextTariffDelay', 'price', 'totalDue', 'accessState', 'serviceState', 'group'],
    requires: ['Подтверждённый subscriber case и Billing data.'],
    limitations: ['Не измеряет фактическую скорость линии.', 'Не выводит точную будущую сумму списания без отдельного подтверждённого расчёта/источника.']
  }),
  Object.freeze({
    name: 'billing.payments', system: 'Billing', capability: 'billing', implementation: 'implemented', mode: 'billing-live-read-only',
    establishes: 'Устанавливает последние доступные записи истории платежей/списаний в Billing.',
    answers: ['Виден ли недавний платёж?', 'Когда и на какую сумму Billing зафиксировал операцию?', 'Какие последние начисления/платежи доступны?'],
    recommendedWhen: ['Клиент говорит «я оплатил», спрашивает, дошёл ли платёж, или нужна история последних операций.'],
    returns: ['payments[]', 'count'],
    requires: ['Подтверждённый subscriber case и Billing snapshot с историей платежей.'],
    limitations: ['Не подтверждает банковскую операцию, которой ещё нет в Billing.', 'Не придумывает время зачисления.']
  }),
  Object.freeze({
    name: 'userside.snapshot', system: 'UserSide', capability: 'userside', implementation: 'implemented', mode: 'userside-live-read-only',
    establishes: 'Устанавливает свежий технический снимок того же уже идентифицированного абонента в UserSide: точку подключения, access family и доступные PON/Ethernet данные.',
    answers: ['Как абонент подключён технически?', 'Какая точка подключения/устройство/порт?', 'Это PON или Ethernet?', 'Какие технические данные есть в UserSide/TMC?'],
    recommendedWhen: ['После первичной идентификации абонента через Billing нужна техническая диагностика.', 'Диагностика «нет интернета».', 'Нужно определить ветку PON vs Ethernet.', 'Нужны точка подключения, switch/port или технический контекст перед дальнейшей диагностикой.'],
    returns: ['identity', 'address', 'network.connectionFamily', 'connection point/device/port', 'pon data', 'observedAt/source'],
    requires: ['Подтверждённый subscriber case, полученный по умолчанию через Billing customer.lookup.', 'Для свежего чтения нужна открытая авторизованная вкладка UserSide.'],
    limitations: ['Не использовать UserSide как основной первичный поиск абонента, если Billing доступен.', 'Если вкладки/сессии UserSide нет, вызов может вернуть USERSIDE_TAB_REQUIRED/USERSIDE_AUTH_REQUIRED.', 'Не считать неудачный read доказательством неисправности линии.']
  }),
  Object.freeze({
    name: 'building.snapshot', system: 'UserSide', capability: 'userside', implementation: 'implemented', mode: 'userside-building-snapshot-local',
    establishes: 'Устанавливает всю сохранённую рабочую карточку конкретного здания по адресу: GPON, собственника, заметки, рабочую заметку, УК/ОСББ, ключи, этажи, подъезды, квартиры, проникновение, менеджера, КТВ и другие реально присутствующие поля.',
    answers: ['Есть ли по этому дому GPON/оптическое покрытие?', 'Что вообще известно про этот дом в UserSide?', 'Кто собственник/УК/ОСББ, какие есть заметки и ключи?', 'Сколько этажей/подъездов/квартир и какие другие поля заполнены в карточке?'],
    recommendedWhen: ['Вопрос относится к дому/зданию или покрытию GPON по адресу, собственнике, ключах или заметках, а не к текущему сигналу конкретной ONU.', 'Нужно проверить GPON по дому, собственника, ключи, заметки, УК/ОСББ или другие поля карточки здания.'],
    returns: ['buildingId', 'address', 'url', 'fields', 'fieldList', 'snapshotGeneratedAt', 'snapshotComplete', 'source'],
    requires: ['Известны улица и номер дома напрямую или через адрес подтверждённого абонента.', 'В chrome.storage.local существует simnet_crm_building_snapshot_v1.'],
    limitations: ['Это сохранённый snapshot, а не автоматический live refresh карточки /building/{id}.', 'NOT_FOUND/BUILDING_SNAPSHOT_MISSING не доказывает отсутствие GPON/покрытия.', 'При нескольких совпадениях возвращает AMBIGUOUS_BUILDING и не выбирает дом наугад.']
  }),
  Object.freeze({
    name: 'network.session', system: 'Network', capability: 'network', implementation: 'implemented_limited', mode: 'workbench-case-read-only',
    establishes: 'Устанавливает последнюю доступную сетевую/BRAS-сессию из Workbench-контекста того же абонента. Помогает понять наличие авторизации и сетевой сессии, но сейчас это НЕ самостоятельный fresh-запрос непосредственно в Juniper.',
    answers: ['Есть ли доступная текущая/последняя BRAS-сессия?', 'Была ли авторизация?', 'Какой IP/MAC/BRAS/тип авторизации/последнее событие/VLAN доступны в сетевом контексте?', 'Когда стартовала или завершилась известная сессия?'],
    recommendedWhen: ['«Нет интернета» после идентификации и проверки Billing.', 'Нужно проверить авторизацию, DHCP, IP, MAC, BRAS, VLAN или наличие сетевой сессии.', 'Нужно отделить проблему доступа/авторизации от домашнего Wi‑Fi или приложения.'],
    returns: ['session status', 'start/stop/last event time', 'BRAS', 'IP', 'MAC', 'authorization type', 'VLAN/traffic when present'],
    requires: ['Подтверждённый subscriber case и совпадающий накопленный Workbench network context.'],
    limitations: ['Не выдавать результат за свежий прямой Juniper query.', 'Активная сессия не доказывает исправность Wi‑Fi, роутера или приложений.', 'Отсутствие данных Workbench не доказывает отсутствие сессии на BRAS.']
  }),
  Object.freeze({
    name: 'pon.onu', system: 'UserSide', capability: 'userside', implementation: 'implemented_with_fallback', mode: 'userside-live-read-only + workbench-fallback',
    establishes: 'Устанавливает доступные ONU/ONT/OLT и портовые данные PON-подключения: идентификаторы ONU, OLT, порт, foundOnOlt и LAN-link сведения, если они доступны.',
    answers: ['Есть ли ONU/ONT в технических данных?', 'На каком OLT/порту она находится?', 'Найдена ли ONU на OLT?', 'Какой ONU MAC/serial?', 'Что известно о LAN-порту ONU?'],
    recommendedWhen: ['После подтверждения, что access family = EPON/GPON/PON.', 'При «нет интернета» на PON после базовой проверки Billing/сессии.', 'Когда нужно проверить ONU/OLT/порт вместо Ethernet-switch ветки.'],
    returns: ['connectionFamily', 'onuSerial', 'onuMac', 'OLT name/IP/deviceId', 'port', 'foundOnOlt', 'ONU LAN port/link/speed'],
    requires: ['Подтверждённый subscriber case.', 'Для fresh результата желательно доступное UserSide; при недоступности возможен подтверждённый Workbench fallback.'],
    limitations: ['Для подтверждённого Ethernet возвращает NOT_APPLICABLE.', 'Fallback нельзя выдавать за свежий UserSide/OLT poll.']
  }),
  Object.freeze({
    name: 'pon.signal', system: 'UserSide', capability: 'userside', implementation: 'implemented_with_fallback', mode: 'userside-live-read-only + workbench-fallback',
    establishes: 'Устанавливает доступные оптические показатели PON-линии и признаки видимости ONU.',
    answers: ['Какой ONU RX/TX?', 'Какой OLT RX?', 'Видит ли OLT ONU?', 'Есть ли доступный признак LAN-link ONU?'],
    recommendedWhen: ['Подтверждён PON и требуется оптическая диагностика.', 'Нужно проверить сигнал/затухание/RX/TX/dBm после установления PON-ветки.'],
    returns: ['rx', 'tx', 'oltRx', 'foundOnOlt', 'onuLanLinkState', 'observedAt/source'],
    requires: ['Подтверждённый PON subscriber case; для свежих значений желательно доступное UserSide.'],
    limitations: ['Для Ethernet возвращает NOT_APPLICABLE.', 'Отсутствие свежих показателей не означает автоматически плохой сигнал или offline ONU.']
  })
]);

const TOOL_NAMES = new Set(TOOL_MANIFEST.map(item => item.name));
const TOOL_PLANNER = Object.freeze({
  version: 2,
  identityPolicy: Object.freeze({
    primarySystem: 'Billing',
    primaryTool: 'customer.lookup',
    rule: 'По умолчанию первый и основной поиск конкретного абонента выполняется через Billing customer.lookup. UserSide, Network и PON-инструменты применяются после привязки подтверждённого subscriber case и не заменяют первичную Billing-идентификацию.'
  }),
  instruction: 'Сначала пойми цель клиента. Если для задачи нужен конкретный абонент и кейс ещё не подтверждён, ПЕРВЫМ действием используй Billing customer.lookup по известному abon/login, договору, IP или адресу. UserSide не используй как основной первичный поиск, когда Billing доступен. После Billing-идентификации перечисли, какие конкретные факты ещё неизвестны. Для каждого факта выбери один наиболее подходящий tool из tools. Не проси абстрактную «техническую проверку», если есть конкретный инструмент. Для вопроса о доме, здании, покрытии GPON по адресу, собственнике, ключах или заметках выбирай building.snapshot; pon.signal предназначен только для текущих RX/TX/dBm конкретной PON-линии абонента. В subscriber_data_needed сохраняй system как Billing|UserSide|Network, а field начинай с точного имени инструмента, например «network.session: current/last BRAS session». Поле why должно объяснять, какой вопрос клиента этот вызов помогает закрыть. Явно выбранное имя tool имеет приоритет над эвристикой по словам.',
  successRule: 'Только результат вызова с ok=true подтверждает возвращённые факты. ok=false означает, что проверку выполнить/подтвердить не удалось; это не отрицательный факт.',
  planningRule: 'Цель клиента → Billing customer.lookup/подтверждённый case → неизвестный факт → подходящий tool → результат tool → вывод/следующая проверка.',
  tools: TOOL_MANIFEST
});

export const AI_OPERATOR_SOFT_TOOL_CAPABILITIES = Object.freeze({ billing: true, userside: true, network: true, toolPlanner: TOOL_PLANNER });
export const AI_OPERATOR_TOOL_CAPABILITY_DETAILS = Object.freeze({ ...core.AI_OPERATOR_TOOL_CAPABILITY_DETAILS, toolManifestVersion: TOOL_PLANNER.version, toolCount: TOOL_MANIFEST.length, primarySubscriberLookup: 'Billing/customer.lookup' });
export const AI_OPERATOR_SOFT_TOOL_CATALOG = TOOL_MANIFEST;
export const extractIdentityHints = core.extractIdentityHints;
export const ensureNonEmptyReply = core.ensureNonEmptyReply;

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function block(value, max = 2200) {
  const normalized = String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function cloneState(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
}
function applyStatePatch(state = {}, patch = {}) {
  return { ...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}), ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) };
}
function explicitToolFromNeed(need = {}) {
  const source = `${oneLine(need?.system, 100)} ${oneLine(need?.field, 220)}`;
  for (const name of TOOL_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|\\s)${escaped}(?=\\s|:|$)`, 'i').test(source)) return name;
  }
  return '';
}
function routeNeedForCore(need = {}) {
  const explicit = explicitToolFromNeed(need);
  if (!explicit) return need;
  const routedSystem = explicit === 'pon.onu' ? 'PON' : oneLine(need?.system, 80);
  return {
    ...need,
    system: routedSystem,
    field: `${explicit}: ${oneLine(need?.field, 160).replace(new RegExp(`^${explicit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*`, 'i'), '')}`.trim()
  };
}
function routeNeedsForCore(needs = []) {
  return (Array.isArray(needs) ? needs : []).map(routeNeedForCore);
}
function requiresSubscriberBootstrap(routedNeeds = []) {
  const planned = core.mapInformationNeedsToTools(routedNeeds);
  return planned.some(item => item?.tool && item.tool !== 'building.snapshot');
}
export function mapInformationNeedsToTools(needs = []) {
  return core.mapInformationNeedsToTools(routeNeedsForCore(needs));
}

function evidenceSource(result = {}) {
  return oneLine(result?.data?.source || result?.data?.evidence?.source || result?.data?.evidence?.workbenchState || result?.tool || '', 140);
}
function traceEntry(result = {}, requestedBy = {}, args = {}) {
  return {
    tool: oneLine(result?.tool || '', 100), requestedBy: cloneState(requestedBy), args: cloneState(args), ok: Boolean(result?.ok),
    code: oneLine(result?.code || (result?.ok ? 'OK' : 'ERROR'), 100), observedAt: oneLine(result?.observedAt || '', 100),
    source: evidenceSource(result), data: cloneState(result?.data || {}),
    warnings: (Array.isArray(result?.warnings) ? result.warnings : []).map(item => oneLine(item, 360)).filter(Boolean).slice(0, 5)
  };
}
async function runDirectTool({ execute, tool, toolArgs = {}, labState = {}, requestedBy = {} }) {
  let result;
  try { result = await execute({ tool, toolArgs, labState }); }
  catch (error) {
    result = { ok: false, tool, code: 'TOOL_EXECUTION_ERROR', observedAt: new Date().toISOString(), data: { message: oneLine(error?.message || error, 500) }, warnings: [], statePatch: {} };
  }
  return { result, trace: traceEntry(result, requestedBy, toolArgs), labState: applyStatePatch(labState, result?.statePatch || {}) };
}
function strongIdentity(identity = {}) { return Boolean(identity.login || identity.contract || identity.ip); }

async function bootstrapExplicitIdentity({ transcript = [], analysis = {}, labState = {}, execute, includeSnapshot = false } = {}) {
  let state = cloneState(labState);
  const trace = [];
  if (typeof execute !== 'function') return { trace, labState: state };
  if (String(state.confirmedCaseId || '').trim() || state.pendingCandidate) return { trace, labState: state };
  const identity = core.extractIdentityHints(transcript, analysis);
  if (!identity || !Object.keys(identity).length) return { trace, labState: state };

  const lookup = await runDirectTool({
    execute, tool: 'customer.lookup', toolArgs: identity, labState: state,
    requestedBy: { system: 'identity', field: Object.keys(identity)[0], why: 'Первичный и основной поиск абонента выполняется через Billing customer.lookup; явный идентификатор привязывает live-контекст независимо от LLM-черновика.' }
  });
  state = lookup.labState;
  trace.push(lookup.trace);

  if (includeSnapshot && strongIdentity(identity) && String(state.confirmedCaseId || '').trim()) {
    const snapshot = await runDirectTool({
      execute, tool: 'customer.snapshot', toolArgs: { refresh: false, maxAgeMs: 120000 }, labState: state,
      requestedBy: { system: 'Billing', field: 'subscriber snapshot', why: 'LLM-черновик недоступен; используем уже подтверждённый Billing-снимок для безопасного ответа.' }
    });
    state = snapshot.labState;
    trace.push(snapshot.trace);
  }
  return { trace, labState: state };
}

function mergeTrace(first = [], second = []) { return [...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])]; }
function uniqueEvidence(trace = []) { return (Array.isArray(trace) ? trace : []).filter(item => item?.ok); }
function isCanonicalSourceTrace(item = {}) { return Array.isArray(item?.requestedFacts) && item.requestedFacts.length > 0; }
function splitResultTrace(trace = []) {
  const legacy = [];
  const canonical = [];
  for (const item of Array.isArray(trace) ? trace : []) {
    (isCanonicalSourceTrace(item) ? canonical : legacy).push(item);
  }
  return { legacy, canonical };
}
function fallbackEvidence(trace = []) {
  return uniqueEvidence(trace).filter(item => !['customer.lookup', 'customer.confirm'].includes(String(item?.tool || '')));
}

export async function executeInformationNeeds({ needs = [], transcript = [], analysis = {}, labState = {}, execute } = {}) {
  if (typeof execute !== 'function') throw new Error('Soft tool broker requires execute(tool)');
  const routedNeeds = routeNeedsForCore(needs);
  const shouldBootstrap = routedNeeds.length === 0 || requiresSubscriberBootstrap(routedNeeds);
  const pre = shouldBootstrap
    ? await bootstrapExplicitIdentity({ transcript, analysis, labState, execute, includeSnapshot: false })
    : { trace: [], labState: cloneState(labState) };
  if (pre.trace.length && !String(pre.labState.confirmedCaseId || '').trim()) {
    return { planned: core.mapInformationNeedsToTools(routedNeeds), trace: pre.trace, labState: pre.labState };
  }
  const delegated = await core.executeInformationNeeds({ needs: routedNeeds, transcript, analysis, labState: pre.labState, execute });
  return { ...delegated, trace: mergeTrace(pre.trace, delegated?.trace), labState: delegated?.labState || pre.labState };
}

function firstPresent(...values) {
  for (const value of values) if (value !== '' && value !== null && value !== undefined) return value;
  return '';
}
function moneyText(value) {
  if (value === '' || value === null || value === undefined) return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.round(numeric * 100) / 100) : oneLine(value, 80);
}
function clientTariffName(value) {
  return oneLine(value, 240)
    .replace(/\s*-\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/u, '')
    .trim();
}
function successfulTool(trace = [], tool) { return (Array.isArray(trace) ? trace : []).find(item => item?.ok && item?.tool === tool) || null; }
function requestedEntries(trace = []) {
  return (Array.isArray(trace) ? trace : [])
    .filter(item => !['customer.lookup', 'customer.confirm'].includes(String(item?.tool || '')))
    .map(item => ({
      tool: String(item?.tool || '').trim(),
      field: oneLine(item?.requestedBy?.field || '', 260),
      ok: Boolean(item?.ok)
    }))
    .filter(item => item.tool);
}
function semanticRequestedField(entry = {}) {
  const tool = String(entry?.tool || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return oneLine(entry?.field || '', 260).replace(new RegExp(`^${tool}\\s*:?\\s*`, 'i'), '').trim();
}
function isCurrentBalanceFact(entry = {}) {
  const field = semanticRequestedField(entry).toLowerCase();
  if (!field) return false;
  const asksBalance = /баланс|на\s+сч[её]т|на\s+рахунк|account\s+balance/i.test(field);
  const asksDifferentFinance = /долг|борг|задолж|заборг|к\s+оплат|до\s+сплат|сколько.*плат|скільки.*плат|временн.*плат|тимчасов.*плат|balance\s+after|total\s+due/i.test(field);
  return asksBalance && !asksDifferentFinance;
}
function isCurrentTariffFact(entry = {}) {
  const field = semanticRequestedField(entry).toLowerCase();
  if (!field) return false;
  const asksTariff = /тариф|пакет|current\s+tariff/i.test(field);
  const asksDifferentTariffFact = /скорост|швидк|цен|стоим|варт|абонплат|следующ|наступн|майбут|future|next/i.test(field);
  return asksTariff && !asksDifferentTariffFact;
}
function isBuildingAvailabilityFact(entry = {}) {
  const field = semanticRequestedField(entry).toLowerCase();
  if (!field) return false;
  return /оптик|fiber|gpon|epon|\bpon\b|покрыт|покрит|coverage|перейти|переход|перехід|переключ|перемкн|подключ|підключ|доступн|возмож|можлив/i.test(field);
}
function buildingGponValue(data = {}) {
  const fields = data?.fields && typeof data.fields === 'object' && !Array.isArray(data.fields) ? data.fields : {};
  for (const [key, value] of Object.entries(fields)) {
    if (/^gpon$/i.test(String(key || '').trim())) return oneLine(Array.isArray(value) ? value[0] : value, 120);
  }
  for (const item of Array.isArray(data?.fieldList) ? data.fieldList : []) {
    if (/^gpon$/i.test(oneLine(item?.key || item?.label, 80))) return oneLine(item?.text, 120);
  }
  return '';
}
function classifyAvailability(value) {
  const source = oneLine(value, 120).toLowerCase();
  if (!source) return null;
  if (/^(?:да|так|є|есть|yes|available|доступн)/iu.test(source)) return true;
  if (/^(?:нет|ні|no|відсут|отсутств)/iu.test(source)) return false;
  return null;
}

export function evidenceFallbackResult(analysis = {}, toolTrace = []) {
  const trace = Array.isArray(toolTrace) ? toolTrace : [];
  const entries = requestedEntries(trace);
  const requestedTools = [...new Set(entries.map(item => item.tool))];
  const successful = trace.filter(item => item?.ok);
  if (!successful.length) {
    return {
      reply: core.ensureNonEmptyReply('', analysis, trace),
      requestedTools,
      coveredTools: [],
      coverage: entries.map(item => ({ ...item, covered: false })),
      complete: false
    };
  }

  const uk = oneLine(analysis?.probe?.language, 20).toLowerCase() === 'uk';
  const snapshot = successfulTool(trace, 'customer.snapshot')?.data || {};
  const balance = successfulTool(trace, 'billing.balance')?.data || {};
  const tariff = successfulTool(trace, 'billing.tariff')?.data || {};
  const building = successfulTool(trace, 'building.snapshot')?.data || {};
  const parts = [];
  const coverage = [];
  let balanceAdded = false;
  let tariffAdded = false;
  let buildingAdded = false;

  // Deterministic fallback is intentionally fact-scoped, not tool-scoped.
  // A successful broad tool can expose many adjacent fields; only the requested
  // semantic fact may count as covered and appear in subscriber copy.
  for (const entry of entries) {
    let covered = false;
    if (entry.tool === 'billing.balance' && entry.ok && isCurrentBalanceFact(entry)) {
      const value = moneyText(firstPresent(balance.accountBalance, snapshot?.finance?.accountBalance));
      if (value) {
        if (!balanceAdded) parts.push(uk ? `Поточний баланс: ${value} грн.` : `Текущий баланс: ${value} грн.`);
        balanceAdded = true;
        covered = true;
      }
    }
    if (entry.tool === 'billing.tariff' && entry.ok && isCurrentTariffFact(entry)) {
      const value = clientTariffName(firstPresent(tariff.currentTariff, balance.currentTariff, snapshot?.service?.currentTariff));
      if (value) {
        if (!tariffAdded) parts.push(uk ? `Поточний тариф: ${value}.` : `Текущий тариф: ${value}.`);
        tariffAdded = true;
        covered = true;
      }
    }
    if (entry.tool === 'building.snapshot' && entry.ok && isBuildingAvailabilityFact(entry)) {
      const availability = classifyAvailability(buildingGponValue(building));
      const address = oneLine(building?.address, 260);
      if (availability !== null) {
        if (!buildingAdded) {
          if (availability) {
            parts.push(uk
              ? `За карткою будинку GPON є${address ? ` (${address})` : ''}. Можна оформлювати перехід на оптику.`
              : `По карточке дома GPON есть${address ? ` (${address})` : ''}. Можно оформлять переход на оптику.`);
          } else {
            parts.push(uk
              ? `За карткою будинку GPON не позначений як доступний${address ? ` (${address})` : ''}.`
              : `По карточке дома GPON не отмечен как доступный${address ? ` (${address})` : ''}.`);
          }
        }
        buildingAdded = true;
        covered = true;
      }
    }
    coverage.push({ tool: entry.tool, field: entry.field, ok: entry.ok, covered });
  }

  const coveredTools = [...new Set(coverage.filter(item => item.covered).map(item => item.tool))];
  const complete = coverage.length > 0 && coverage.every(item => item.ok && item.covered);

  return {
    reply: block(parts.join(' '), 2200) || core.ensureNonEmptyReply('', analysis, trace),
    requestedTools,
    coveredTools,
    coverage,
    complete
  };
}

export function evidenceFallbackReply(analysis = {}, toolTrace = []) {
  return evidenceFallbackResult(analysis, toolTrace).reply;
}

export async function groundSubscriberReply(options = {}) {
  const { draft = {}, transcript = [], analysis = {}, labState = {}, execute, coreGround = core.groundSubscriberReply, ...rest } = options;
  if (typeof execute !== 'function') throw new Error('Soft tool broker requires execute(tool)');
  const needs = recoverLiveDataNeeds({ analysis, draft });
  const routedNeeds = routeNeedsForCore(needs);
  const requiredFacts = normalizeCanonicalFacts(analysis?.probe?.requiredFacts || []);
  const routedDraft = { ...draft, subscriberDataNeeded: requiredFacts.length ? [] : routedNeeds };
  const canonicalNeedsSubscriber = requiredFacts.some(path => !path.startsWith('building.'));
  const shouldBootstrap = requiredFacts.length
    ? canonicalNeedsSubscriber
    : (routedNeeds.length === 0 || requiresSubscriberBootstrap(routedNeeds));
  const pre = shouldBootstrap
    ? await bootstrapExplicitIdentity({ transcript, analysis, labState, execute, includeSnapshot: Boolean(draft?.degraded && needs.length === 0) })
    : { trace: [], labState: cloneState(labState) };
  const identity = core.extractIdentityHints(transcript, analysis);
  const factResolution = requiredFacts.length
    ? await resolveFacts({
      context: pre.labState,
      facts: requiredFacts,
      execute,
      request: { address: identity?.address || '', refresh: false }
    })
    : null;
  const result = await coreGround({ ...rest, draft: routedDraft, transcript, analysis, labState: pre.labState, execute, factResolution });
  const split = splitResultTrace(result?.toolTrace);
  const toolTrace = mergeTrace(pre.trace, split.legacy);
  const factSourceTrace = mergeTrace(result?.factSourceTrace, split.canonical);
  const toolEvidence = uniqueEvidence(toolTrace);
  const legacyFallbackEvidence = fallbackEvidence(toolTrace);
  const mustUseEvidenceFallback = legacyFallbackEvidence.length > 0 && Boolean(result?.degraded || draft?.degraded);
  const evidenceFallback = mustUseEvidenceFallback
    ? evidenceFallbackResult(analysis, toolTrace)
    : { reply: '', requestedTools: [], coveredTools: [], coverage: [], complete: false };
  return {
    ...result,
    reply: mustUseEvidenceFallback ? evidenceFallback.reply : core.ensureNonEmptyReply(result?.reply, analysis, toolTrace),
    evidenceFallback: {
      used: mustUseEvidenceFallback,
      requestedTools: evidenceFallback.requestedTools,
      coveredTools: evidenceFallback.coveredTools,
      coverage: evidenceFallback.coverage,
      complete: Boolean(evidenceFallback.complete)
    },
    toolTrace,
    toolEvidence,
    factSourceTrace,
    factEvidence: result?.factEvidence || factResolution?.evidence || [],
    factDiagnostics: result?.factDiagnostics || factResolution?.diagnostics || {},
    toolState: result?.toolState || pre.labState
  };
}
