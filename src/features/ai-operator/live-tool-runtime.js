'use strict';

import * as core from './live-tool-runtime-core.js';
import { readNetworkSessionLive } from './network-live-search.js';
import { readBillingSummaryLive } from './billing-summary-live.js';
import { classifyStandaloneBillingLogin, searchBillingLoginLive } from './billing-login-live.js';
import { readBuildingSnapshot } from './building-snapshot-tool.js';

const LIVE_CASE_PREFIX = 'billing-live:';

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
function billingIdFromLab(labState = {}) {
  const explicit = String(labState?.confirmedSubscriber?.billingId || '').replace(/\D+/g, '').slice(0, 12);
  if (explicit) return explicit;
  const caseId = String(labState?.confirmedCaseId || '');
  if (caseId.startsWith(LIVE_CASE_PREFIX)) return caseId.slice(LIVE_CASE_PREFIX.length).replace(/\D+/g, '').slice(0, 12);
  return '';
}
function mergePresent(base = {}, overlay = {}) {
  const merged = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(overlay && typeof overlay === 'object' && !Array.isArray(overlay) ? overlay : {})) {
    if (value === null || value === undefined || value === '') continue;
    merged[key] = value;
  }
  return merged;
}
function liveLookupCandidate(candidate = {}) {
  const billingId = String(candidate.billingId || '').replace(/\D+/g, '').slice(0, 12);
  return {
    caseId: billingId ? `${LIVE_CASE_PREFIX}${billingId}` : '',
    billingId,
    contract: text(candidate.contract, 80),
    login: text(candidate.login, 80).toLowerCase(),
    address: text(candidate.address, 260),
    fullName: text(candidate.fullName, 180),
    ip: text(candidate.ip, 80),
    customerId: text(candidate.customerId, 40),
    connectionFamily: text(candidate.connectionFamily, 80)
  };
}

async function executeGenericLoginLookup(toolArgs = {}) {
  const login = classifyStandaloneBillingLogin(toolArgs.login);
  const live = await searchBillingLoginLive({ login });
  if (!live?.ok) {
    return result('customer.lookup', false, String(live?.code || 'BILLING_SEARCH_FAILED'), {
      message: 'Не удалось выполнить поиск login в Billing.',
      source: 'billing-live-read-only',
      searchMode: 'login'
    });
  }
  const candidates = (Array.isArray(live.candidates) ? live.candidates : []).map(liveLookupCandidate).filter(item => item.caseId);
  if (!candidates.length) {
    return result('customer.lookup', false, 'NOT_FOUND', {
      message: 'Абонент не найден штатным поиском Billing по login.',
      source: 'billing-live-read-only',
      searchMode: 'login'
    });
  }
  if (candidates.length !== 1) {
    return result('customer.lookup', false, 'AMBIGUOUS_IDENTITY', {
      count: candidates.length,
      candidates,
      source: 'billing-live-read-only',
      searchMode: 'login'
    }, ['Нужно уточнить login/договор, чтобы выбрать конкретного абонента.']);
  }
  const candidate = candidates[0];
  return result('customer.lookup', true, 'OK', {
    count: 1,
    candidate,
    requiresConfirmation: false,
    source: 'billing-live-read-only',
    searchMode: 'login'
  }, [], {
    pendingCandidate: null,
    confirmedCaseId: candidate.caseId,
    confirmedSubscriber: candidate
  });
}

async function executeBillingSummaryTool(name, toolArgs = {}, labState = {}) {
  if (!String(labState?.confirmedCaseId || '').trim()) {
    return core.executeOperatorTool({ tool: name, toolArgs, labState });
  }
  const id = billingIdFromLab(labState);
  if (!id) return core.executeOperatorTool({ tool: name, toolArgs, labState });

  const baseTool = name === 'billing.main_summary' ? 'customer.snapshot' : name;
  const [live, base] = await Promise.all([
    readBillingSummaryLive({ billingId: id, refresh: Boolean(toolArgs.refresh), maxAgeMs: toolArgs.maxAgeMs || 30000 }),
    core.executeOperatorTool({ tool: baseTool, toolArgs: { ...toolArgs, refresh: false }, labState })
  ]);

  if (!live?.ok) {
    if (base?.ok) {
      return {
        ...base,
        warnings: [
          ...(Array.isArray(base.warnings) ? base.warnings : []),
          `Billing main-summary table read недоступен (${String(live?.code || 'unknown')}); использован Billing snapshot fallback.`
        ]
      };
    }
    return result(name, false, String(live?.code || base?.code || 'BILLING_SUMMARY_READ_FAILED'), {
      message: 'Не удалось прочитать основную карточку Billing.',
      source: 'billing-main-summary-live-read-only',
      billingId: id
    });
  }

  const service = live.data?.service || {};
  const finance = live.data?.finance || {};
  const payments = Array.isArray(live.data?.payments) ? live.data.payments : null;
  const network = live.data?.network || {};
  const evidence = live.data?.evidence || {};
  const baseData = base?.data || {};

  if (name === 'billing.main_summary') {
    // The single a=user page owns every field it actually exposes. Broader cached
    // snapshots are fallback only for fields not present on that page; no dopdata
    // request is needed for finance, tariff, service-state or payment facts.
    const mergedService = { ...(baseData.service || {}), ...service };
    const mergedFinance = { ...(baseData.finance || {}), ...finance };
    const liveFieldObservedAt = {};
    for (const key of Object.keys(service)) liveFieldObservedAt[`service.${key}`] = live.observedAt;
    for (const key of Object.keys(finance)) liveFieldObservedAt[`finance.${key}`] = live.observedAt;
    if (payments) liveFieldObservedAt.payments = live.observedAt;
    const hasData = [
      mergedService.currentTariff,
      mergedService.nextTariff,
      mergedService.accessState,
      mergedService.serviceState,
      mergedFinance.accountBalance,
      mergedFinance.price,
      mergedFinance.totalDue,
      mergedFinance.balanceAfterTariff,
      payments?.length
    ].some(value => value !== '' && value !== null && value !== undefined && value !== false);
    if (!hasData) return result(name, false, 'DATA_NOT_AVAILABLE', { source: 'billing-main-summary-live-read-only', evidence });
    return result(name, true, 'OK', {
      identity: baseData.identity || {},
      service: mergedService,
      finance: mergedFinance,
      ...(payments ? { payments } : (Array.isArray(baseData.payments) ? { payments: baseData.payments } : {})),
      network: mergePresent(baseData.network || {}, network),
      source: 'billing-main-summary-live-read-only',
      evidence: {
        ...evidence,
        fieldObservedAt: {
          ...(baseData?.evidence?.fieldObservedAt || {}),
          ...liveFieldObservedAt
        }
      },
      cache: live.cache || ''
    });
  }

  if (name === 'billing.balance') {
    const mergedFinance = mergePresent(baseData, finance);
    const hasFinance = [
      mergedFinance.accountBalance,
      mergedFinance.balanceAfterTariff,
      mergedFinance.balanceWithoutTemporary,
      mergedFinance.temporaryPayment,
      mergedFinance.price,
      mergedFinance.totalDue
    ].some(value => value !== '' && value !== null && value !== undefined);
    if (!hasFinance) return result(name, false, 'DATA_NOT_AVAILABLE', { source: 'billing-main-summary-live-read-only', evidence });
    return result(name, true, 'OK', {
      ...mergedFinance,
      currentTariff: service.currentTariff || baseData.currentTariff || '',
      accessState: service.accessState ?? baseData.accessState ?? '',
      serviceState: service.serviceState ?? baseData.serviceState ?? '',
      trafficIncomingBytes: network.trafficIncomingBytes || '',
      trafficOutgoingBytes: network.trafficOutgoingBytes || '',
      source: 'billing-main-summary-live-read-only',
      evidence,
      cache: live.cache || ''
    });
  }

  if (name === 'billing.tariff') {
    const currentTariff = service.currentTariff || baseData.currentTariff || '';
    const nextTariff = service.nextTariff ?? baseData.nextTariff ?? '';
    if (!currentTariff && !nextTariff) return result(name, false, 'DATA_NOT_AVAILABLE', { source: 'billing-main-summary-live-read-only', evidence });
    return result(name, true, 'OK', {
      ...baseData,
      currentTariff,
      nextTariff,
      nextTariffDelay: service.nextTariffDelay ?? baseData.nextTariffDelay ?? '',
      accessState: service.accessState ?? baseData.accessState ?? '',
      serviceState: service.serviceState ?? baseData.serviceState ?? '',
      group: service.group ?? baseData.group ?? '',
      activeServices: service.activeServices ?? baseData.activeServices ?? [],
      tariffId: service.tariffId || '',
      tariffDisplay: service.tariffDisplay || '',
      price: finance.price ?? baseData.price ?? '',
      totalDue: finance.totalDue ?? baseData.totalDue ?? '',
      balanceAfterTariff: finance.balanceAfterTariff ?? baseData.balanceAfterTariff ?? '',
      trafficIncomingBytes: network.trafficIncomingBytes || '',
      trafficOutgoingBytes: network.trafficOutgoingBytes || '',
      source: 'billing-main-summary-live-read-only',
      evidence,
      cache: live.cache || ''
    });
  }

  if (name === 'billing.payments') {
    const fallbackPayments = Array.isArray(baseData.payments) ? baseData.payments : [];
    const observedPayments = payments ?? fallbackPayments;
    if (!observedPayments.length) {
      return result(name, false, 'DATA_NOT_AVAILABLE', {
        message: 'На основной карточке Billing нет доступных записей платежей.',
        source: 'billing-main-summary-live-read-only',
        evidence
      });
    }
    return result(name, true, 'OK', {
      payments: observedPayments,
      count: observedPayments.length,
      source: 'billing-main-summary-live-read-only',
      evidence,
      cache: live.cache || ''
    });
  }

  return core.executeOperatorTool({ tool: name, toolArgs, labState });
}

async function executeNetworkSessionTool(name, toolArgs = {}, labState = {}) {
  if (!String(labState?.confirmedCaseId || '').trim()) {
    return core.executeOperatorTool({ tool: name, toolArgs, labState });
  }

  const billingId = billingIdFromLab(labState);
  if (billingId) {
    const live = await readNetworkSessionLive({ billingId });
    if (live?.ok) {
      return result(name, true, 'OK', {
        ...(live.data || {}),
        source: 'billing-stat-live-read-only',
        observedAt: live.observedAt || nowIso()
      });
    }

    const fallback = await core.executeOperatorTool({ tool: name, toolArgs, labState });
    if (fallback?.ok) {
      return {
        ...fallback,
        warnings: [
          ...(Array.isArray(fallback.warnings) ? fallback.warnings : []),
          `Fresh Billing stat.pl a=252 read недоступен (${String(live?.code || 'unknown')}); использован накопленный Workbench network context.`
        ]
      };
    }

    return result(name, false, String(live?.code || fallback?.code || 'NETWORK_SESSION_FETCH_FAILED'), {
      message: 'Не удалось получить свежие данные сетевой сессии через Billing stat.pl a=252.',
      source: 'billing-stat-live-read-only',
      billingId
    }, [
      'Не трактовать неудачный запрос как доказательство отсутствия сессии.'
    ]);
  }

  return core.executeOperatorTool({ tool: name, toolArgs, labState });
}

export async function executeOperatorTool({ tool, toolArgs = {}, labState = {} } = {}) {
  const name = String(tool || '').trim();
  const genericLogin = name === 'customer.lookup' ? classifyStandaloneBillingLogin(toolArgs.login) : '';
  if (genericLogin && !/^abon\d{3,12}$/i.test(genericLogin)) {
    return executeGenericLoginLookup({ ...toolArgs, login: genericLogin });
  }
  if (name === 'building.snapshot') {
    return readBuildingSnapshot({ toolArgs, labState });
  }
  if (['billing.main_summary', 'billing.balance', 'billing.tariff', 'billing.payments'].includes(name)) {
    return executeBillingSummaryTool(name, toolArgs, labState);
  }
  if (name === 'network.session' || name === 'network.last_session') {
    return executeNetworkSessionTool(name, toolArgs, labState);
  }
  return core.executeOperatorTool({ tool: name, toolArgs, labState });
}

export const AI_OPERATOR_TOOL_STATE_KEYS = core.AI_OPERATOR_TOOL_STATE_KEYS;
