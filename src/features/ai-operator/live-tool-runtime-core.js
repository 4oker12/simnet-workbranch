'use strict';

import { executeOperatorTool as executeLocalOperatorTool, AI_OPERATOR_TOOL_STATE_KEYS } from './tool-runtime.js';
import { searchBillingLive } from './billing-live-search.js';
import { searchUserSideLive } from './userside-live-search.js';

const BILLING_SNAPSHOT_KEY = 'simnet_ai_operator_billing_snapshots_v1';
const USERSIDE_SNAPSHOT_KEY = 'simnet_ai_operator_userside_snapshots_v1';
const LIVE_CASE_PREFIX = 'billing-live:';
const LOCAL_FALLBACK_CODES = new Set([
  'BILLING_RUNTIME_UNAVAILABLE',
  'BILLING_TAB_REQUIRED',
  'BILLING_SESSION_REQUIRED',
  'BILLING_AUTH_REQUIRED',
  'BILLING_TAB_INVALID',
  'BILLING_SEARCH_EXECUTION_FAILED'
]);

function nowIso() { return new Date().toISOString(); }
function text(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function compactObject(input, maxDepth = 5, depth = 0) {
  if (depth >= maxDepth) return text(input, 300);
  if (Array.isArray(input)) return input.slice(0, 16).map(item => compactObject(item, maxDepth, depth + 1));
  if (!input || typeof input !== 'object') return input;
  const output = {};
  for (const [key, raw] of Object.entries(input).slice(0, 80)) {
    if (/^(?:pp|password|passwd|pass|token|secret|csrf|authorization)$/i.test(key)) continue;
    output[key] = compactObject(raw, maxDepth, depth + 1);
  }
  return output;
}
function result(tool, ok, code, data = {}, warnings = [], statePatch = {}) {
  return {
    ok: Boolean(ok),
    tool: String(tool || ''),
    code: String(code || (ok ? 'OK' : 'ERROR')),
    observedAt: nowIso(),
    data: compactObject(data),
    warnings: Array.isArray(warnings) ? warnings.map(item => text(item, 400)).filter(Boolean) : [],
    statePatch: compactObject(statePatch)
  };
}
function mergeObject(currentValue, incomingValue) {
  return {
    ...(currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) ? currentValue : {}),
    ...(incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue) ? incomingValue : {})
  };
}
function mergeFinance(currentFinance, incomingFinance) {
  const merged = mergeObject(currentFinance, {});
  if (!incomingFinance || typeof incomingFinance !== 'object' || Array.isArray(incomingFinance)) return merged;
  for (const [key, value] of Object.entries(incomingFinance)) {
    if (value === null || value === undefined || value === '') continue;
    merged[key] = value;
  }
  return merged;
}
function normalizeAddress(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[.,;:()№#]/g, ' ')
    .replace(/\b(?:м\.?|місто|город|вул\.?|улица|ул\.?|просп\.?|проспект|пров\.?|переулок|буд\.?|будинок|дом|д\.?|кв\.?|квартира)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readObjectStore(key) {
  const raw = (await chrome.storage.local.get(key))?.[key];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function readBillingSnapshots() {
  return readObjectStore(BILLING_SNAPSHOT_KEY);
}

async function persistBillingSnapshots(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) return;
  const current = await readBillingSnapshots();
  const merged = { ...current };
  for (const [billingId, snapshot] of Object.entries(patch)) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
    const previous = current[String(billingId)] && typeof current[String(billingId)] === 'object' ? current[String(billingId)] : {};
    const fieldObservedAt = { ...(previous.fieldObservedAt || {}) };
    for (const section of ['finance', 'service']) {
      for (const field of Object.keys(previous[section] || {})) {
        const key = `${section}.${field}`;
        if (!fieldObservedAt[key]) fieldObservedAt[key] = previous.financeObservedAt || previous.observedAt || '';
      }
      for (const [field, value] of Object.entries(snapshot[section] || {})) {
        if (value === null || value === undefined || (value === '' && field !== 'nextTariff')) continue;
        fieldObservedAt[`${section}.${field}`] = snapshot.observedAt || '';
      }
    }
    merged[String(billingId)] = {
      ...previous,
      ...snapshot,
      identity: mergeObject(previous.identity, snapshot.identity),
      address: mergeObject(previous.address, snapshot.address),
      contacts: mergeObject(previous.contacts, snapshot.contacts),
      customer: mergeObject(previous.customer, snapshot.customer),
      service: mergeObject(previous.service, snapshot.service),
      finance: mergeFinance(previous.finance, snapshot.finance),
      network: mergeObject(previous.network, snapshot.network),
      payments: Array.isArray(snapshot.payments) && snapshot.payments.length ? snapshot.payments : (Array.isArray(previous.payments) ? previous.payments : []),
      billingId: String(snapshot.billingId || billingId),
      observedAt: String(snapshot.observedAt || nowIso()),
      source: 'billing-live-read-only',
      fieldObservedAt
    };
  }
  const trimmed = Object.values(merged)
    .filter(item => item && typeof item === 'object')
    .sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0))
    .slice(0, 120);
  await chrome.storage.local.set({
    [BILLING_SNAPSHOT_KEY]: Object.fromEntries(trimmed.map(item => [String(item.billingId || ''), item]).filter(([id]) => id))
  });
}

function liveCandidate(candidate = {}) {
  const billingId = String(candidate.billingId || '').replace(/\D+/g, '').slice(0, 12);
  return {
    caseId: billingId ? `${LIVE_CASE_PREFIX}${billingId}` : '',
    billingId,
    contract: text(candidate.contract, 80),
    login: text(candidate.login, 80),
    address: text(candidate.address, 260),
    fullName: text(candidate.fullName, 180),
    ip: text(candidate.ip, 80),
    customerId: text(candidate.customerId, 40),
    connectionFamily: text(candidate.connectionFamily, 80)
  };
}

async function liveLookup(toolArgs = {}) {
  const live = await searchBillingLive(toolArgs);
  if (!live?.ok && LOCAL_FALLBACK_CODES.has(String(live?.code || ''))) {
    const fallback = await executeLocalOperatorTool({ tool: 'customer.lookup', toolArgs, labState: {} });
    return {
      ...fallback,
      warnings: [
        ...(Array.isArray(fallback?.warnings) ? fallback.warnings : []),
        `Live Billing search недоступен (${String(live?.code || 'unknown')}); использован локальный fallback.`
      ]
    };
  }
  if (!live?.ok) {
    const code = String(live?.code || 'BILLING_SEARCH_FAILED');
    return result('customer.lookup', false, code, {
      message: 'Не удалось выполнить поиск абонента в Billing.',
      streets: live?.streets || [],
      street: live?.street || '',
      source: 'billing-live-read-only'
    });
  }
  await persistBillingSnapshots(live.snapshots || {});
  const candidates = (Array.isArray(live.candidates) ? live.candidates : []).map(liveCandidate).filter(item => item.caseId);
  if (!candidates.length) {
    return result('customer.lookup', false, 'NOT_FOUND', {
      message: 'Абонент не найден штатным поиском Billing.',
      source: 'billing-live-read-only',
      searchMode: live?.request?.mode || ''
    });
  }
  if (candidates.length !== 1) {
    return result('customer.lookup', false, 'AMBIGUOUS_IDENTITY', {
      count: candidates.length,
      candidates,
      source: 'billing-live-read-only',
      searchMode: live?.request?.mode || ''
    }, ['Нужно уточнить идентификатор или адрес, чтобы выбрать конкретного абонента.']);
  }
  const candidate = candidates[0];
  const explicitContract = Boolean(String(toolArgs.contract || '').replace(/\D+/g, ''));
  const explicitLogin = /^abon\d{3,12}$/i.test(String(toolArgs.login || '').trim());
  const explicitIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(toolArgs.ip || '').trim());
  if (explicitContract || explicitLogin || explicitIp) {
    return result('customer.lookup', true, 'OK', {
      count: 1,
      candidate,
      requiresConfirmation: false,
      source: 'billing-live-read-only',
      searchMode: live?.request?.mode || ''
    }, [], { pendingCandidate: null, confirmedCaseId: candidate.caseId, confirmedSubscriber: candidate });
  }
  return result('customer.lookup', true, 'OK', {
    count: 1,
    candidate,
    requiresConfirmation: true,
    source: 'billing-live-read-only',
    searchMode: live?.request?.mode || ''
  }, ['Кандидат найден по адресу. Нужно убедиться, что выбрано нужное подключение.'], {
    pendingCandidate: candidate,
    confirmedCaseId: '',
    confirmedSubscriber: null
  });
}

function billingIdFromLab(labState = {}) {
  const explicit = String(labState?.confirmedSubscriber?.billingId || '').replace(/\D+/g, '').slice(0, 12);
  if (explicit) return explicit;
  const caseId = String(labState?.confirmedCaseId || '');
  if (caseId.startsWith(LIVE_CASE_PREFIX)) return caseId.slice(LIVE_CASE_PREFIX.length).replace(/\D+/g, '').slice(0, 12);
  return '';
}

async function liveBillingSnapshotForLab(labState = {}) {
  const billingId = billingIdFromLab(labState);
  if (!billingId) return null;
  const snapshots = await readBillingSnapshots();
  const snapshot = snapshots[billingId];
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
}

function lookupArgsFromLab(labState = {}) {
  const subscriber = labState?.confirmedSubscriber && typeof labState.confirmedSubscriber === 'object' ? labState.confirmedSubscriber : {};
  const login = text(subscriber.login, 80).replace(/\s+/g, '').toLowerCase();
  const contract = text(subscriber.contract, 80).replace(/\D+/g, '');
  const ip = text(subscriber.ip, 80);
  const address = text(subscriber.address, 260);
  if (/^abon\d{3,12}$/i.test(login)) return { login };
  if (contract) return { contract };
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return { ip };
  if (address) return { address };
  return null;
}

async function refreshLiveBillingSnapshotForLab(labState = {}) {
  const lookupArgs = lookupArgsFromLab(labState);
  if (!lookupArgs) return null;
  try {
    const live = await searchBillingLive(lookupArgs);
    if (!live?.ok) return null;
    const id = billingIdFromLab(labState);
    const fresh = live.snapshots?.[id];
    if (!fresh || String(fresh.identity?.billingId || fresh.billingId || '') !== id) return null;
    await persistBillingSnapshots(live.snapshots || {});
    return liveBillingSnapshotForLab(labState);
  } catch {
    return null;
  }
}

function liveBillingSnapshotResult(tool, snapshot) {
  const identity = snapshot?.identity || {};
  const address = snapshot?.address || {};
  const service = snapshot?.service || {};
  const finance = snapshot?.finance || {};
  const network = snapshot?.network || {};
  const source = 'billing-live-read-only';
  if (tool === 'customer.snapshot') {
    return result(tool, true, 'OK', {
      identity,
      address,
      contacts: snapshot?.contacts || {},
      customer: snapshot?.customer || {},
      service,
      finance,
      network,
      payments: Array.isArray(snapshot?.payments) ? snapshot.payments : [],
      evidence: {
        billingSnapshot: BILLING_SNAPSHOT_KEY,
        source,
        observedAt: snapshot?.financeObservedAt || snapshot?.observedAt || '',
        fieldObservedAt: snapshot?.fieldObservedAt
      }
    });
  }
  if (tool === 'billing.balance') {
    const values = [finance.accountBalance, finance.balanceAfterTariff, finance.balanceWithoutTemporary, finance.temporaryPayment, finance.price, finance.totalDue];
    if (!values.some(value => value !== '' && value !== null && value !== undefined)) {
      return result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'Billing не вернул финансовые данные по найденному абоненту.' });
    }
    return result(tool, true, 'OK', {
      ...finance,
      currentTariff: service.currentTariff || '',
      accessState: service.accessState || '',
      serviceState: service.serviceState || '',
      source
    });
  }
  if (tool === 'billing.tariff') {
    if (!service.currentTariff && !service.nextTariff) return result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'Billing не вернул тариф по найденному абоненту.' });
    return result(tool, true, 'OK', {
      currentTariff: service.currentTariff || '',
      nextTariff: service.nextTariff || '',
      nextTariffDelay: service.nextTariffDelay || '',
      price: finance.price ?? '',
      totalDue: finance.totalDue ?? '',
      accessState: service.accessState || '',
      serviceState: service.serviceState || '',
      group: service.group || '',
      source
    });
  }
  if (tool === 'billing.payments') {
    const payments = Array.isArray(snapshot?.payments) ? snapshot.payments : [];
    return payments.length
      ? result(tool, true, 'OK', { payments, count: payments.length, source })
      : result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'Последние платежи не прочитаны при live-поиске Billing.' });
  }
  if (tool === 'billing.next_charge') {
    return result(tool, false, 'DATA_NOT_AVAILABLE', {
      message: 'Billing live-read не даёт подтверждённую точную дату и сумму следующего списания.',
      currentTariff: service.currentTariff || '',
      nextTariff: service.nextTariff || '',
      nextTariffDelay: service.nextTariffDelay || '',
      accountBalance: finance.accountBalance ?? '',
      price: finance.price ?? '',
      totalDue: finance.totalDue ?? '',
      source
    }, ['Не выводить следующее списание из price, totalDue или текущего тарифа без отдельного подтверждённого источника.']);
  }
  return null;
}

function userSideStoreKey(labState = {}) {
  const billingId = billingIdFromLab(labState);
  if (billingId) return `billing:${billingId}`;
  const subscriber = labState?.confirmedSubscriber || {};
  if (subscriber.login) return `login:${String(subscriber.login).toLowerCase()}`;
  if (subscriber.contract) return `contract:${String(subscriber.contract).replace(/\D+/g, '')}`;
  return '';
}

async function readUserSideSnapshotForLab(labState = {}) {
  const key = userSideStoreKey(labState);
  if (!key) return null;
  const snapshots = await readObjectStore(USERSIDE_SNAPSHOT_KEY);
  const snapshot = snapshots[key];
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
}

async function persistUserSideSnapshot(labState = {}, snapshot = null) {
  const key = userSideStoreKey(labState);
  if (!key || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  const current = await readObjectStore(USERSIDE_SNAPSHOT_KEY);
  const merged = {
    ...current,
    [key]: {
      ...snapshot,
      observedAt: String(snapshot.observedAt || nowIso()),
      source: 'userside-live-read-only'
    }
  };
  const trimmed = Object.entries(merged)
    .filter(([, item]) => item && typeof item === 'object')
    .sort(([, a], [, b]) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0))
    .slice(0, 120);
  await chrome.storage.local.set({ [USERSIDE_SNAPSHOT_KEY]: Object.fromEntries(trimmed) });
}

function userSideLookupArgsFromLab(labState = {}) {
  const subscriber = labState?.confirmedSubscriber && typeof labState.confirmedSubscriber === 'object' ? labState.confirmedSubscriber : {};
  const customerId = String(subscriber.customerId || '').replace(/\D+/g, '').slice(0, 12);
  const login = text(subscriber.login, 80).replace(/\s+/g, '').toLowerCase();
  const contract = text(subscriber.contract, 80).replace(/\D+/g, '');
  const ip = text(subscriber.ip, 80);
  const address = text(subscriber.address, 260);
  if (customerId) return { customerId };
  if (/^abon\d{3,12}$/i.test(login)) return { login };
  if (contract) return { contract };
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return { ip };
  if (address) return { address };
  return null;
}

export function userSideIdentityMatches(snapshot = {}, labState = {}) {
  const expected = labState?.confirmedSubscriber || {};
  const identity = snapshot?.identity || {};
  const strongChecks = [];
  const expectedLogin = text(expected.login, 80).toLowerCase();
  const actualLogin = text(identity.login, 80).toLowerCase();
  if (expectedLogin && actualLogin) strongChecks.push(expectedLogin === actualLogin);
  const expectedContract = text(expected.contract, 80).replace(/\D+/g, '');
  const actualContract = text(identity.contract, 80).replace(/\D+/g, '');
  if (expectedContract && actualContract) strongChecks.push(expectedContract === actualContract);
  const expectedIp = text(expected.ip, 80);
  const actualIp = text(snapshot?.network?.ip, 80);
  if (expectedIp && actualIp) strongChecks.push(expectedIp === actualIp);
  if (strongChecks.length) return strongChecks.every(Boolean);

  const expectedAddress = normalizeAddress(expected.address);
  const actualAddress = normalizeAddress(snapshot?.address?.full);
  if (expectedAddress && actualAddress) {
    return expectedAddress === actualAddress || expectedAddress.includes(actualAddress) || actualAddress.includes(expectedAddress);
  }
  return false;
}

function userSideStatePatch(snapshot = {}, labState = {}) {
  const current = labState?.confirmedSubscriber && typeof labState.confirmedSubscriber === 'object' ? labState.confirmedSubscriber : {};
  const identity = snapshot?.identity || {};
  const network = snapshot?.network || {};
  const merged = {
    ...current,
    customerId: text(identity.customerId || snapshot.customerId || current.customerId, 40),
    login: text(current.login || identity.login, 80),
    contract: text(current.contract || identity.contract, 80),
    fullName: text(current.fullName || identity.fullName, 180),
    address: text(current.address || snapshot?.address?.full, 260),
    ip: text(current.ip || network.ip, 80),
    connectionFamily: text(network.connectionFamily || current.connectionFamily, 80)
  };
  return { confirmedSubscriber: merged };
}

async function refreshUserSideSnapshotForLab(labState = {}) {
  const lookupArgs = userSideLookupArgsFromLab(labState);
  if (!lookupArgs) return { ok: false, code: 'IDENTITY_QUERY_REQUIRED', snapshot: null };
  try {
    const live = await searchUserSideLive(lookupArgs);
    if (!live?.ok || !live.snapshot) return { ok: false, code: String(live?.code || 'USERSIDE_SEARCH_FAILED'), live, snapshot: null };
    if (!userSideIdentityMatches(live.snapshot, labState)) {
      return { ok: false, code: 'USERSIDE_IDENTITY_MISMATCH', live, snapshot: null };
    }
    await persistUserSideSnapshot(labState, live.snapshot);
    return { ok: true, code: 'OK', live, snapshot: live.snapshot };
  } catch (error) {
    return { ok: false, code: 'USERSIDE_SEARCH_EXECUTION_FAILED', error, snapshot: null };
  }
}

function userSideSnapshotResult(tool, snapshot, labState = {}) {
  const identity = snapshot?.identity || {};
  const network = snapshot?.network || {};
  const pon = snapshot?.pon || {};
  const source = 'userside-live-read-only';
  const statePatch = userSideStatePatch(snapshot, labState);

  if (tool === 'userside.snapshot') {
    return result(tool, true, 'OK', {
      identity,
      address: snapshot?.address || {},
      network,
      pon,
      observedAt: snapshot?.observedAt || '',
      source,
      evidence: { source, pageUrl: snapshot?.pageUrl || '', storage: USERSIDE_SNAPSHOT_KEY }
    }, [], statePatch);
  }
  if (tool === 'pon.onu') {
    const hasData = Boolean(pon.onuSerial || pon.onuMac || pon.oltName || pon.oltIp || pon.port || pon.onuDeviceId || pon.onuLanPort || network.connectionFamily === 'PON');
    if (!hasData) {
      if (network.connectionFamily === 'Ethernet') return result(tool, false, 'NOT_APPLICABLE', { message: 'Для абонента подтверждён Ethernet-доступ; ONU/OLT к этой ветке не относится.', source }, [], statePatch);
      return result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'UserSide не вернул ONU/OLT-данные по этому абоненту.', source }, [], statePatch);
    }
    return result(tool, true, 'OK', {
      connectionFamily: network.connectionFamily || '',
      onuSerial: pon.onuSerial || '',
      onuMac: pon.onuMac || '',
      onuDeviceId: pon.onuDeviceId || '',
      onuDeviceName: pon.onuDeviceName || '',
      onuDeviceIp: pon.onuDeviceIp || '',
      onuLanPort: pon.onuLanPort || '',
      onuLanInterface: pon.onuLanInterface || '',
      onuLanLinkState: pon.onuLanLinkState || '',
      onuLanSpeedMbps: pon.onuLanSpeedMbps || '',
      oltName: pon.oltName || '',
      oltIp: pon.oltIp || '',
      oltDeviceId: pon.oltDeviceId || '',
      port: pon.port || pon.interface || '',
      foundOnOlt: pon.foundOnOlt === true,
      source,
      observedAt: snapshot?.observedAt || ''
    }, [], statePatch);
  }
  if (tool === 'pon.signal') {
    const hasSignal = Boolean(pon.rx || pon.tx || pon.oltRx || pon.onuLanLinkState || pon.foundOnOlt);
    if (!hasSignal) {
      if (network.connectionFamily === 'Ethernet') return result(tool, false, 'NOT_APPLICABLE', { message: 'Оптический сигнал не применяется к подтверждённому Ethernet-подключению.', source }, [], statePatch);
      return result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'В UserSide нет свежих оптических показателей для этого абонента.', source }, [], statePatch);
    }
    return result(tool, true, 'OK', {
      rx: pon.rx || '',
      tx: pon.tx || '',
      oltRx: pon.oltRx || '',
      foundOnOlt: pon.foundOnOlt === true,
      onuLanLinkState: pon.onuLanLinkState || '',
      observedAt: snapshot?.observedAt || '',
      source
    }, [], statePatch);
  }
  return null;
}

async function executeUserSideTool(name, toolArgs = {}, labState = {}) {
  if (!String(labState.confirmedCaseId || '').trim()) return result(name, false, 'IDENTITY_REQUIRED');
  let snapshot = await readUserSideSnapshotForLab(labState);
  const observed = Date.parse(snapshot?.observedAt || '');
  const maxAge = Number(toolArgs.maxAgeMs) || 120000;
  const invalidatedAt = Number(labState.invalidatedAt || 0);
  const outdated = !Number.isFinite(observed) || Date.now() - observed >= maxAge || observed < invalidatedAt;
  if (!snapshot || toolArgs.refresh || outdated) {
    const fresh = await refreshUserSideSnapshotForLab(labState);
    if (fresh.ok) snapshot = fresh.snapshot;
    else if (!snapshot || toolArgs.refresh) {
      return result(name, false, fresh.code, {
        message: fresh.code === 'USERSIDE_TAB_REQUIRED'
          ? 'Для live-проверки UserSide нужна открытая авторизованная вкладка UserSide.'
          : 'Не удалось получить свежие данные UserSide по подтверждённому абоненту.',
        source: 'userside-live-read-only'
      });
    }
  }
  return userSideSnapshotResult(name, snapshot, labState) || result(name, false, 'UNKNOWN_TOOL');
}

async function executeLocalAgainstConfirmedSubscriber(name, toolArgs = {}, labState = {}) {
  if (!String(labState.confirmedCaseId || '').startsWith(LIVE_CASE_PREFIX)) {
    return executeLocalOperatorTool({ tool: name, toolArgs, labState });
  }
  const identity = lookupArgsFromLab(labState);
  if (!identity) return executeLocalOperatorTool({ tool: name, toolArgs, labState });
  try {
    const lookup = await executeLocalOperatorTool({ tool: 'customer.lookup', toolArgs: identity, labState: {} });
    if (!lookup?.ok || !lookup?.statePatch?.confirmedCaseId) {
      return result(name, false, 'DATA_NOT_AVAILABLE', {
        message: 'В локальном Workbench-контексте нет совпадающего кейса для этой live Billing-идентификации.'
      });
    }
    const localState = { ...labState, ...lookup.statePatch };
    const localResult = await executeLocalOperatorTool({ tool: name, toolArgs, labState: localState });
    return {
      ...localResult,
      warnings: [
        ...(Array.isArray(localResult?.warnings) ? localResult.warnings : []),
        'Источник Network/Workbench привязан к тому же абоненту повторным поиском по подтверждённому идентификатору.'
      ],
      statePatch: {}
    };
  } catch (error) {
    return result(name, false, 'LOCAL_CONTEXT_BRIDGE_FAILED', { message: text(error?.message || error, 500) });
  }
}

export async function executeOperatorTool({ tool, toolArgs = {}, labState = {} } = {}) {
  const name = String(tool || '').trim();
  if (name === 'customer.lookup') return liveLookup(toolArgs);

  if (['customer.snapshot', 'billing.balance', 'billing.tariff', 'billing.payments', 'billing.next_charge'].includes(name)) {
    if (!String(labState.confirmedCaseId || '').trim()) return result(name, false, 'IDENTITY_REQUIRED');
    let liveSnapshot = await liveBillingSnapshotForLab(labState);
    if (toolArgs.refresh) {
      const observed = Date.parse(liveSnapshot?.financeObservedAt || liveSnapshot?.observedAt || '');
      const maxAge = Number(toolArgs.maxAgeMs) || 120000;
      const outdated = !Number.isFinite(observed) || Date.now() - observed >= maxAge || observed < Number(labState.invalidatedAt || 0);
      if (outdated) {
        const refreshed = await refreshLiveBillingSnapshotForLab(labState);
        if (refreshed) liveSnapshot = refreshed;
        else return result(name, false, 'FRESH_DATA_UNAVAILABLE');
      }
    }
    if (liveSnapshot) {
      let liveResult = liveBillingSnapshotResult(name, liveSnapshot);
      if (['billing.balance', 'billing.tariff'].includes(name) && liveResult?.code === 'DATA_NOT_AVAILABLE') {
        const refreshed = await refreshLiveBillingSnapshotForLab(labState);
        if (refreshed) {
          liveSnapshot = refreshed;
          liveResult = liveBillingSnapshotResult(name, liveSnapshot);
        }
      }
      return liveResult;
    }
  }

  if (name === 'userside.snapshot') return executeUserSideTool(name, toolArgs, labState);
  if (name === 'pon.onu' || name === 'pon.signal') {
    const liveUserSide = await executeUserSideTool(name, { refresh: toolArgs.refresh !== false, maxAgeMs: toolArgs.maxAgeMs }, labState);
    if (liveUserSide?.ok || liveUserSide?.code === 'NOT_APPLICABLE') return liveUserSide;
    const local = await executeLocalAgainstConfirmedSubscriber(name, toolArgs, labState);
    if (local?.ok) {
      return {
        ...local,
        warnings: [
          ...(Array.isArray(local.warnings) ? local.warnings : []),
          `Fresh UserSide read недоступен (${liveUserSide?.code || 'unknown'}); использован накопленный Workbench-контекст.`
        ]
      };
    }
    return liveUserSide;
  }
  if (name === 'network.session' || name === 'network.last_session') {
    return executeLocalAgainstConfirmedSubscriber(name, toolArgs, labState);
  }

  return executeLocalOperatorTool({ tool: name, toolArgs, labState });
}

export { AI_OPERATOR_TOOL_STATE_KEYS };
