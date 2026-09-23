'use strict';

const WORKBENCH_STATE_KEYS = Object.freeze([
  'simnet_workbench_state_v5',
  'simnet_workbench_state_v4'
]);
const BILLING_SNAPSHOT_KEY = 'simnet_ai_operator_billing_snapshots_v1';

const ACCOUNT_TOOLS = new Set([
  'customer.snapshot',
  'billing.balance',
  'billing.tariff',
  'billing.payments',
  'billing.next_charge',
  'network.session',
  'network.last_session',
  'pon.onu',
  'pon.signal',
  'outage.by_customer'
]);

function nowIso() { return new Date().toISOString(); }
function text(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function factValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value;
}
function valueAt(object, path) {
  let current = object;
  for (const part of String(path || '').split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object') return '';
    current = current[part];
  }
  return factValue(current);
}
function firstValue(object, paths = []) {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}
function firstDefined(...values) {
  for (const value of values) if (value !== undefined && value !== null && value !== '') return value;
  return '';
}
function normalizeContract(value) {
  const source = String(value == null ? '' : value).trim().replace(/\s/g, '');
  const abon = source.match(/^abon(\d{3,12})$/i)?.[1] || '';
  return abon || (/^\d{3,12}$/.test(source) ? source : '');
}
function normalizeAddress(value) {
  return String(value == null ? '' : value)
    .toLowerCase().replace(/[.,;:()№#]/g, ' ')
    .replace(/\b(?:м\.?|місто|город|вул\.?|улица|ул\.?|просп\.?|проспект|буд\.?|дом|д\.?|кв\.?|квартира)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
function normalizeIp(value) {
  const candidate = String(value == null ? '' : value).trim();
  const match = candidate.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (!match) return '';
  const parts = match[0].split('.').map(Number);
  return parts.every(part => part >= 0 && part <= 255) ? match[0] : '';
}
function compactObject(input, maxDepth = 5, depth = 0) {
  if (depth >= maxDepth) return text(input, 300);
  if (Array.isArray(input)) return input.slice(0, 12).map(item => compactObject(item, maxDepth, depth + 1));
  if (!input || typeof input !== 'object') return input;
  const output = {};
  for (const [key, raw] of Object.entries(input).slice(0, 60)) {
    if (/^(?:pp|password|passwd|pass|token|secret|csrf|authorization)$/i.test(key)) continue;
    output[key] = compactObject(raw, maxDepth, depth + 1);
  }
  return output;
}
async function loadWorkbenchState() {
  const stored = await chrome.storage.local.get([...WORKBENCH_STATE_KEYS]);
  for (const key of WORKBENCH_STATE_KEYS) {
    const state = stored?.[key];
    if (state && typeof state === 'object' && !Array.isArray(state)) return { key, state };
  }
  return { key: '', state: { cases: {} } };
}
async function loadBillingSnapshots() {
  const raw = (await chrome.storage.local.get(BILLING_SNAPSHOT_KEY))?.[BILLING_SNAPSHOT_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}
function snapshotForCase(caseId, caseData = {}, snapshots = {}) {
  const billingId = text(firstValue(caseData, ['identity.billingId']) || caseId, 80);
  if (billingId && snapshots[billingId]) {
    const found = snapshots[billingId];
    const contract = text(firstValue(caseData, ['identity.contract']), 80);
    const login = text(firstValue(caseData, ['identity.login']), 80).toLowerCase();
    if (contract && found.identity?.contract && contract !== String(found.identity.contract)) return null;
    if (login && found.identity?.login && login !== String(found.identity.login).toLowerCase()) return null;
    return found;
  }
  const contract = text(firstValue(caseData, ['identity.contract']), 80);
  const login = text(firstValue(caseData, ['identity.login']), 80).toLowerCase();
  const matches = Object.values(snapshots).filter(snapshot => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const identity = snapshot.identity || {};
    if (contract && identity.contract && contract !== String(identity.contract)) return false;
    if (login && identity.login && login !== String(identity.login).toLowerCase()) return false;
    return Boolean((contract && String(identity.contract) === contract) || (login && String(identity.login).toLowerCase() === login));
  });
  return matches.length === 1 ? matches[0] : null;
}
function caseSummary(caseId, caseData = {}, snapshot = null) {
  const contract = text(firstDefined(firstValue(caseData, ['identity.contract']), snapshot?.identity?.contract), 80);
  const login = text(firstDefined(firstValue(caseData, ['identity.login']), snapshot?.identity?.login), 80);
  const billingId = text(firstDefined(firstValue(caseData, ['identity.billingId']), snapshot?.identity?.billingId, caseId), 80);
  const address = text(firstDefined(firstValue(caseData, ['profile.address']), snapshot?.address?.full), 240);
  const fullName = text(firstDefined(firstValue(caseData, ['profile.fullName']), snapshot?.identity?.fullName), 180);
  const ip = text(firstDefined(firstValue(caseData, ['network.ip']), snapshot?.network?.ip), 80);
  const connectionFamily = text(firstValue(caseData, ['network.connectionFamily']), 80);
  return { caseId: String(caseId || caseData?.id || ''), billingId, contract, login, address, fullName, ip, connectionFamily };
}
function candidateMatchScore(summary, query = {}) {
  let score = 0;
  const contract = normalizeContract(query.contract);
  const soughtLogin = text(query.login, 80).replace(/\s/g, '').toLowerCase();
  const address = normalizeAddress(query.address);
  const ip = normalizeIp(query.ip);
  const raw = text(query.query, 300);
  const rawContract = normalizeContract(raw);
  const rawIp = normalizeIp(raw);
  const rawAddress = normalizeAddress(raw);
  const candidateContract = normalizeContract(summary.contract);
  const candidateLogin = text(summary.login, 80).replace(/\s/g, '').toLowerCase();
  const candidateAddress = normalizeAddress(summary.address);
  const candidateIp = normalizeIp(summary.ip);
  const soughtContract = contract || rawContract;
  const soughtIp = ip || rawIp;
  const soughtAddress = address || (!soughtContract && !soughtLogin && !soughtIp ? rawAddress : '');
  if (soughtLogin) {
    if (candidateLogin === soughtLogin) score += 100;
    else return 0;
  }
  if (soughtContract) {
    if (candidateContract === soughtContract) score += 100;
    else return 0;
  }
  if (soughtIp) {
    if (candidateIp === soughtIp) score += 100;
    else return 0;
  }
  if (soughtAddress) {
    if (!candidateAddress) return 0;
    if (candidateAddress === soughtAddress) score += 100;
    else if (candidateAddress.includes(soughtAddress) || soughtAddress.includes(candidateAddress)) score += 65;
    else {
      const tokens = soughtAddress.split(' ').filter(token => token.length >= 2);
      const matched = tokens.filter(token => candidateAddress.includes(token)).length;
      if (!tokens.length || matched / tokens.length < 0.7) return 0;
      score += 40 + matched;
    }
  }
  return score;
}
function result(tool, ok, code, data = {}, warnings = [], statePatch = {}) {
  return { ok: Boolean(ok), tool: String(tool || ''), code: String(code || (ok ? 'OK' : 'ERROR')), observedAt: nowIso(),
    data: compactObject(data), warnings: Array.isArray(warnings) ? warnings.map(item => text(item, 400)).filter(Boolean) : [], statePatch: compactObject(statePatch) };
}
async function lookupCustomer(toolArgs = {}) {
  const [{ key, state }, snapshots] = await Promise.all([loadWorkbenchState(), loadBillingSnapshots()]);
  const entries = Object.entries(state?.cases || {});
  const explicitContract = normalizeContract(toolArgs.contract) || normalizeContract(toolArgs.query);
  const hasQuery = Boolean(explicitContract || text(toolArgs.login, 80) || normalizeAddress(toolArgs.address) || normalizeIp(toolArgs.ip) || text(toolArgs.query, 300));
  if (!hasQuery) return result('customer.lookup', false, 'IDENTITY_QUERY_REQUIRED', { message: 'Нужен номер договора, IP или полный адрес подключения.' });
  const matches = entries.map(([caseId, caseData]) => {
    const snapshot = snapshotForCase(caseId, caseData, snapshots);
    const summary = caseSummary(caseId, caseData, snapshot);
    return { summary, score: candidateMatchScore(summary, toolArgs) };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  if (!matches.length) return result('customer.lookup', false, 'NOT_FOUND', {
    message: 'Совпадений в локальном READ-контексте Workbench не найдено.', source: key || 'none', searchedCases: entries.length,
    capturedBillingSnapshots: Object.keys(snapshots).length
  }, ['Это поиск по уже прочитанным Workbench/Billing кейсам, а не глобальный поиск по базе Billing.']);
  const topScore = matches[0].score;
  const top = matches.filter(item => item.score === topScore);
  if (top.length !== 1) return result('customer.lookup', false, 'AMBIGUOUS_IDENTITY', {
    count: matches.length, candidates: matches.map(item => item.summary), source: key
  }, ['Нужно уточнить один идентификатор, чтобы выбрать конкретного абонента.']);
  const candidate = top[0].summary;
  if (explicitContract) return result('customer.lookup', true, 'OK', { count: 1, candidate, requiresConfirmation: false, source: key }, [], {
    pendingCandidate: null, confirmedCaseId: String(candidate.caseId), confirmedSubscriber: candidate
  });
  return result('customer.lookup', true, 'OK', { count: 1, candidate, requiresConfirmation: true, source: key }, [
    'Перед выдачей данных аккаунта кандидат должен быть явно подтверждён собеседником.'
  ], { pendingCandidate: candidate, confirmedCaseId: '', confirmedSubscriber: null });
}
function confirmCustomer(toolArgs = {}, labState = {}) {
  const pending = labState?.pendingCandidate;
  if (!pending?.caseId) return result('customer.confirm', false, 'NO_PENDING_CANDIDATE', { message: 'Нет найденного кандидата для подтверждения.' });
  const confirmed = toolArgs.confirmed === true || /^(?:yes|true|1|да|так|верно|вірно)$/i.test(String(toolArgs.confirmed || '').trim());
  if (!confirmed) return result('customer.confirm', true, 'REJECTED', { confirmed: false }, [], { pendingCandidate: null, confirmedCaseId: '', confirmedSubscriber: null });
  return result('customer.confirm', true, 'OK', { confirmed: true, customer: pending }, [], {
    pendingCandidate: null, confirmedCaseId: String(pending.caseId), confirmedSubscriber: pending
  });
}
async function confirmedCase(tool, labState = {}) {
  const caseId = String(labState?.confirmedCaseId || '').trim();
  if (!caseId) return { error: result(tool, false, 'IDENTITY_REQUIRED', { message: 'Абонент ещё не идентифицирован и не подтверждён.' }) };
  const [{ key, state }, snapshots] = await Promise.all([loadWorkbenchState(), loadBillingSnapshots()]);
  const caseData = state?.cases?.[caseId];
  if (!caseData) return { error: result(tool, false, 'CASE_NOT_FOUND', { caseId, message: 'Подтверждённый кейс больше не найден в локальном состоянии Workbench.' }) };
  return { caseId, caseData, snapshot: snapshotForCase(caseId, caseData, snapshots), sourceKey: key };
}
function ponSnapshot(caseData = {}) {
  const liveSnapshot = caseData?.live?.oltSnapshot && typeof caseData.live.oltSnapshot === 'object' ? caseData.live.oltSnapshot : {};
  const currentPoll = caseData?.operations?.poll?.current && typeof caseData.operations.poll.current === 'object' ? caseData.operations.poll.current : {};
  return {
    connectionFamily: text(firstValue(caseData, ['network.connectionFamily']), 80), onuMac: text(firstValue(caseData, ['pon.onuMac']), 100),
    onuSerial: text(firstValue(caseData, ['pon.onuSerial']), 120), oltName: text(firstValue(caseData, ['pon.oltName']), 180),
    oltIp: text(firstValue(caseData, ['pon.oltIp']), 80), port: text(firstValue(caseData, ['pon.port', 'pon.locatedInterface']), 120),
    status: text(firstValue(caseData, ['pon.status']) || liveSnapshot.onuStatus || liveSnapshot.status, 100), rx: text(firstValue(caseData, ['pon.rx']) || liveSnapshot.rx, 100),
    tx: text(firstValue(caseData, ['pon.tx']) || liveSnapshot.tx, 100), oltRx: text(liveSnapshot.oltRx, 100),
    distance: text(firstValue(caseData, ['pon.distance']) || liveSnapshot.distance, 100), offlineSince: text(liveSnapshot.offlineSince, 100),
    offlineDuration: text(liveSnapshot.offlineDuration, 100), pollOutcome: text(liveSnapshot.outcome || currentPoll.outcome || currentPoll.status, 100),
    pollUpdatedAt: text(currentPoll.updatedAt || currentPoll.resolvedAt || caseData?.visits?.onuPollConfirmedAt, 100)
  };
}
function richSubscriberSnapshot(caseId, caseData = {}, snapshot = null, sourceKey = '') {
  const canonical = caseSummary(caseId, caseData, snapshot);
  const finance = snapshot?.finance && typeof snapshot.finance === 'object' ? snapshot.finance : {};
  const service = snapshot?.service && typeof snapshot.service === 'object' ? snapshot.service : {};
  const network = snapshot?.network && typeof snapshot.network === 'object' ? snapshot.network : {};
  const technical = snapshot?.technical && typeof snapshot.technical === 'object' ? snapshot.technical : {};
  const auth = network?.authorization && typeof network.authorization === 'object' ? network.authorization : {};
  return {
    identity: { billingId: canonical.billingId, contract: canonical.contract, login: canonical.login, fullName: canonical.fullName, contractDate: text(snapshot?.identity?.contractDate, 80) },
    address: compactObject(snapshot?.address || (canonical.address ? { full: canonical.address } : {})), contacts: compactObject(snapshot?.contacts || {}), customer: compactObject(snapshot?.customer || {}),
    service: { group: text(service.group, 260), currentTariff: text(firstDefined(service.currentTariff, firstValue(caseData, ['profile.tariff'])), 320),
      nextTariff: typeof service.nextTariff === 'string' ? text(service.nextTariff, 320) : null, nextTariffDelay: text(service.nextTariffDelay, 120),
      nextTariffPrice: service.nextTariffPrice ?? null, activeServices: service.activeServices, activeServicesTotal: service.activeServicesTotal,
      accessState: text(service.accessState, 120), serviceState: text(service.serviceState, 120), startDay: text(service.startDay, 80), limit: text(service.limit, 120),
      connectionFamily: text(firstValue(caseData, ['network.connectionFamily']), 80), connectionRaw: text(firstValue(caseData, ['network.connectionRaw']), 160) },
    finance: { accountBalance: firstDefined(finance.accountBalance, ''), price: firstDefined(finance.price, ''), totalDue: firstDefined(finance.totalDue, ''),
      balanceAfterTariff: firstDefined(finance.balanceAfterTariff, firstValue(caseData, ['profile.balance'])), balanceWithoutTemporary: firstDefined(finance.balanceWithoutTemporary, ''),
      temporaryPayment: firstDefined(finance.temporaryPayment, ''), temporaryPaymentText: text(finance.temporaryPaymentText, 260) },
    network: { ip: text(firstDefined(network.ip, firstValue(caseData, ['network.ip'])), 80), mac: text(firstDefined(technical.subscriberMac, firstValue(caseData, ['network.mac'])), 100),
      authStatus: text(auth.title, 180), authorized: auth.authorized === true ? true : auth.authorized === false ? false : null,
      accessAllowed: auth.accessAllowed === true ? true : auth.accessAllowed === false ? false : null, lastActivity: text(auth.lastActivity, 100),
      trafficIncomingBytes: text(network.trafficIncomingBytes, 120), trafficOutgoingBytes: text(network.trafficOutgoingBytes, 120) },
    technical: compactObject(technical), pon: ponSnapshot(caseData), payments: Array.isArray(snapshot?.payments) ? compactObject(snapshot.payments) : [],
    evidence: { workbenchState: sourceKey, billingSnapshot: snapshot ? BILLING_SNAPSHOT_KEY : '', billingSnapshotObservedAt: text(snapshot?.financeObservedAt || snapshot?.observedAt, 100), fieldObservedAt: snapshot?.fieldObservedAt }
  };
}
function snapshotResult(caseId, caseData, snapshot, sourceKey) {
  const data = richSubscriberSnapshot(caseId, caseData, snapshot, sourceKey);
  const hasData = Boolean(data.identity.contract || data.identity.login || data.service.currentTariff || data.finance.balanceAfterTariff !== '' || data.address?.full || data.network.ip);
  return hasData ? result('customer.snapshot', true, 'OK', data, snapshot ? [] : ['Расширенный Billing snapshot ещё не накоплен; показаны доступные факты канонического кейса.'])
    : result('customer.snapshot', false, 'DATA_NOT_AVAILABLE', { message: 'По подтверждённому абоненту ещё нет прочитанного Billing-контекста.' });
}
function balanceResult(caseId, caseData, snapshot, sourceKey) {
  const data = richSubscriberSnapshot(caseId, caseData, snapshot, sourceKey);
  const hasFinancialData = [data.finance.accountBalance, data.finance.balanceAfterTariff, data.finance.balanceWithoutTemporary, data.finance.temporaryPayment, data.finance.price, data.finance.totalDue]
    .some(value => value !== '' && value !== null && value !== undefined);
  return hasFinancialData ? result('billing.balance', true, 'OK', { ...data.finance, currentTariff: data.service.currentTariff, accessState: data.service.accessState,
    serviceState: data.service.serviceState, source: snapshot ? BILLING_SNAPSHOT_KEY : sourceKey })
    : result('billing.balance', false, 'DATA_NOT_AVAILABLE', { message: 'Финансовые данные не прочитаны в текущем кейсе Workbench/Billing.' });
}
function tariffResult(caseId, caseData, snapshot, sourceKey) {
  const data = richSubscriberSnapshot(caseId, caseData, snapshot, sourceKey);
  const hasTariff = Boolean(data.service.currentTariff || data.service.nextTariff);
  return hasTariff ? result('billing.tariff', true, 'OK', { currentTariff: data.service.currentTariff, nextTariff: data.service.nextTariff,
    nextTariffDelay: data.service.nextTariffDelay, price: data.finance.price, totalDue: data.finance.totalDue, accessState: data.service.accessState,
    serviceState: data.service.serviceState, group: data.service.group, source: snapshot ? BILLING_SNAPSHOT_KEY : sourceKey })
    : result('billing.tariff', false, 'DATA_NOT_AVAILABLE', { message: 'Тариф не прочитан в текущем кейсе Workbench/Billing.' });
}
function paymentsResult(snapshot) {
  const payments = Array.isArray(snapshot?.payments) ? snapshot.payments : [];
  return payments.length ? result('billing.payments', true, 'OK', { payments, count: payments.length, source: BILLING_SNAPSHOT_KEY })
    : result('billing.payments', false, 'DATA_NOT_AVAILABLE', { message: 'Последние платежи ещё не прочитаны с Billing-карточки.' });
}
function networkSessionResult(tool, caseData, sourceKey) {
  const juniper = caseData?.juniper && typeof caseData.juniper === 'object' ? caseData.juniper : {};
  const details = juniper?.details && typeof juniper.details === 'object' ? juniper.details : {};
  const hasObservation = Boolean(juniper.readAt || juniper.lastReadAt || juniper.verifiedAt || juniper.result || Object.keys(details).length);
  if (!hasObservation) return result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'Juniper/BRAS-сессия ещё не была прочитана для этого кейса.' });
  return result(tool, true, 'OK', { result: text(juniper.result, 80), dataStatus: text(juniper.dataStatus, 80), verified: Boolean(juniper.verified), readSource: text(juniper.readSource, 80),
    summary: text(juniper.summary, 700), observedAt: text(juniper.lastReadAt || juniper.verifiedAt || juniper.readAt, 80), subscriberIp: text(details.subscriberIp || firstValue(caseData, ['network.ip']), 80),
    subscriberMac: text(details.subscriberMac || firstValue(caseData, ['network.mac']), 80), status: text(details.status || juniper.result, 80), startTime: text(details.startTime, 100),
    lastEventTime: text(details.lastEventTime, 100), lastEvent: text(details.lastEvent, 160), router: text(details.router, 120), vendor: text(details.vendor, 120), vlan: text(details.vlan, 80),
    hasTraffic: details.hasTraffic === true ? true : details.hasTraffic === false ? false : null, source: sourceKey });
}
function ponOnuResult(caseData, sourceKey) {
  const snapshot = ponSnapshot(caseData); const hasData = Boolean(snapshot.onuMac || snapshot.onuSerial || snapshot.oltName || snapshot.port || snapshot.status);
  return hasData ? result('pon.onu', true, 'OK', { ...snapshot, source: sourceKey }) : result('pon.onu', false, 'DATA_NOT_AVAILABLE', { message: 'ONU/OLT-данные ещё не прочитаны в текущем кейсе.' });
}
function ponSignalResult(caseData, sourceKey) {
  const snapshot = ponSnapshot(caseData); const hasData = Boolean(snapshot.rx || snapshot.tx || snapshot.oltRx || snapshot.distance || snapshot.status || snapshot.offlineSince);
  return hasData ? result('pon.signal', true, 'OK', { status: snapshot.status, rx: snapshot.rx, tx: snapshot.tx, oltRx: snapshot.oltRx, distance: snapshot.distance,
    offlineSince: snapshot.offlineSince, offlineDuration: snapshot.offlineDuration, pollOutcome: snapshot.pollOutcome, observedAt: snapshot.pollUpdatedAt, source: sourceKey })
    : result('pon.signal', false, 'DATA_NOT_AVAILABLE', { message: 'Оптические показатели/состояние ONU ещё не прочитаны в текущем кейсе.' });
}
export async function executeOperatorTool({ tool, toolArgs = {}, labState = {} } = {}) {
  const name = String(tool || '').trim();
  if (name === 'customer.lookup') return lookupCustomer(toolArgs);
  if (name === 'customer.confirm') return confirmCustomer(toolArgs, labState);
  if (!ACCOUNT_TOOLS.has(name)) return result(name, false, 'UNKNOWN_TOOL', { message: `Неизвестный READ-tool: ${name || 'empty'}` });
  const resolved = await confirmedCase(name, labState);
  if (resolved.error) return resolved.error;
  const { caseId, caseData, snapshot, sourceKey } = resolved;
  if (name === 'customer.snapshot') return snapshotResult(caseId, caseData, snapshot, sourceKey);
  if (name === 'billing.balance') return balanceResult(caseId, caseData, snapshot, sourceKey);
  if (name === 'billing.tariff') return tariffResult(caseId, caseData, snapshot, sourceKey);
  if (name === 'billing.payments') return paymentsResult(snapshot);
  if (name === 'network.session' || name === 'network.last_session') return networkSessionResult(name, caseData, sourceKey);
  if (name === 'pon.onu') return ponOnuResult(caseData, sourceKey);
  if (name === 'pon.signal') return ponSignalResult(caseData, sourceKey);
  if (name === 'billing.next_charge') return result(name, false, 'DATA_NOT_AVAILABLE', { message: 'Дата/сумма следующего списания не выводится без прямого подтверждённого источника.' });
  return result(name, false, 'DATA_NOT_AVAILABLE', { message: 'Аварии пока не подключены к подтверждённому READ-адаптеру.' });
}
export const AI_OPERATOR_TOOL_STATE_KEYS = [...WORKBENCH_STATE_KEYS, BILLING_SNAPSHOT_KEY];
