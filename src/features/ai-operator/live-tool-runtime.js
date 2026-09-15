'use strict';

import { executeOperatorTool as executeLocalOperatorTool, AI_OPERATOR_TOOL_STATE_KEYS } from './tool-runtime.js';
import { searchBillingLive } from './billing-live-search.js';

const BILLING_SNAPSHOT_KEY = 'simnet_ai_operator_billing_snapshots_v1';
const LIVE_CASE_PREFIX = 'billing-live:';
const LOCAL_FALLBACK_CODES = new Set([
  'BILLING_RUNTIME_UNAVAILABLE',
  'BILLING_TAB_REQUIRED',
  'BILLING_SESSION_REQUIRED',
  'BILLING_AUTH_REQUIRED',
  'BILLING_TAB_INVALID',
  'BILLING_SEARCH_EXECUTION_FAILED'
]);

function nowIso() {
  return new Date().toISOString();
}

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

async function readSnapshots() {
  const raw = (await chrome.storage.local.get(BILLING_SNAPSHOT_KEY))?.[BILLING_SNAPSHOT_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
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

async function persistSnapshots(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) return;
  const current = await readSnapshots();
  const merged = { ...current };
  for (const [billingId, snapshot] of Object.entries(patch)) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
    const previous = current[String(billingId)] && typeof current[String(billingId)] === 'object'
      ? current[String(billingId)]
      : {};
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
      payments: Array.isArray(snapshot.payments) && snapshot.payments.length
        ? snapshot.payments
        : (Array.isArray(previous.payments) ? previous.payments : []),
      billingId: String(snapshot.billingId || billingId),
      observedAt: String(snapshot.observedAt || nowIso()),
      source: 'billing-live-read-only'
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
    connectionFamily: ''
  };
}

async function liveLookup(toolArgs = {}) {
  const live = await searchBillingLive(toolArgs);

  if (!live?.ok && LOCAL_FALLBACK_CODES.has(String(live?.code || ''))) {
    const fallback = await executeLocalOperatorTool({ tool: 'customer.lookup', toolArgs, labState: {} });
    const warnings = [
      ...(Array.isArray(fallback?.warnings) ? fallback.warnings : []),
      `Live Billing search недоступен (${String(live?.code || 'unknown')}); использован локальный fallback.`
    ];
    return { ...fallback, warnings };
  }

  if (!live?.ok) {
    const code = String(live?.code || 'BILLING_SEARCH_FAILED');
    const messages = {
      ADDRESS_STREET_NOT_FOUND: 'Улица в штатном поиске Billing не найдена.',
      ADDRESS_STREET_AMBIGUOUS: 'Адрес неоднозначен: нужно уточнить улицу.',
      ADDRESS_BUILDING_REQUIRED: 'Для поиска по адресу нужен номер дома.',
      BILLING_SEARCH_FAILED: 'Штатный поиск Billing завершился ошибкой.'
    };
    return result('customer.lookup', false, code, {
      message: messages[code] || 'Не удалось выполнить поиск абонента в Billing.',
      streets: live?.streets || [],
      street: live?.street || '',
      source: 'billing-live-read-only'
    });
  }

  await persistSnapshots(live.snapshots || {});
  const candidates = (Array.isArray(live.candidates) ? live.candidates : [])
    .map(liveCandidate)
    .filter(item => item.caseId);

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
  return result('customer.lookup', true, 'OK', {
    count: 1,
    candidate,
    requiresConfirmation: true,
    source: 'billing-live-read-only',
    searchMode: live?.request?.mode || ''
  }, [
    'Кандидат найден в реальном Billing. Перед выдачей данных аккаунта требуется подтверждение собеседника.'
  ], {
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

async function liveSnapshotForLab(labState = {}) {
  const billingId = billingIdFromLab(labState);
  if (!billingId) return null;
  const snapshots = await readSnapshots();
  const snapshot = snapshots[billingId];
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
}

function lookupArgsFromLab(labState = {}) {
  const subscriber = labState?.confirmedSubscriber && typeof labState.confirmedSubscriber === 'object'
    ? labState.confirmedSubscriber
    : {};
  const login = text(subscriber.login, 80).replace(/\s+/g, '').toLowerCase();
  const contract = text(subscriber.contract, 80).replace(/\D+/g, '');
  const ip = text(subscriber.ip, 80);
  if (/^abon\d{3,12}$/i.test(login)) return { login };
  if (contract) return { contract };
  if (ip) return { ip };
  return null;
}

async function refreshLiveSnapshotForLab(labState = {}) {
  const lookupArgs = lookupArgsFromLab(labState);
  if (!lookupArgs) return null;
  try {
    const live = await searchBillingLive(lookupArgs);
    if (!live?.ok) return null;
    await persistSnapshots(live.snapshots || {});
    return liveSnapshotForLab(labState);
  } catch {
    return null;
  }
}

function liveSnapshotResult(tool, snapshot) {
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
      evidence: { billingSnapshot: BILLING_SNAPSHOT_KEY, source, observedAt: snapshot?.observedAt || '' }
    });
  }

  if (tool === 'billing.balance') {
    const values = [
      finance.accountBalance,
      finance.balanceAfterTariff,
      finance.balanceWithoutTemporary,
      finance.temporaryPayment,
      finance.price,
      finance.totalDue
    ];
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
    if (!service.currentTariff && !service.nextTariff) {
      return result(tool, false, 'DATA_NOT_AVAILABLE', { message: 'Billing не вернул тариф по найденному абоненту.' });
    }
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

  return null;
}

export async function executeOperatorTool({ tool, toolArgs = {}, labState = {} } = {}) {
  const name = String(tool || '').trim();
  if (name === 'customer.lookup') return liveLookup(toolArgs);

  if (['customer.snapshot', 'billing.balance', 'billing.tariff', 'billing.payments'].includes(name)) {
    let liveSnapshot = await liveSnapshotForLab(labState);
    if (liveSnapshot) {
      let liveResult = liveSnapshotResult(name, liveSnapshot);
      if (['billing.balance', 'billing.tariff'].includes(name) && liveResult?.code === 'DATA_NOT_AVAILABLE') {
        const refreshed = await refreshLiveSnapshotForLab(labState);
        if (refreshed) {
          liveSnapshot = refreshed;
          liveResult = liveSnapshotResult(name, liveSnapshot);
        }
      }
      return liveResult;
    }
  }

  return executeLocalOperatorTool({ tool: name, toolArgs, labState });
}

export { AI_OPERATOR_TOOL_STATE_KEYS };
