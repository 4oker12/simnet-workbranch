'use strict';

import * as core from './live-tool-runtime-core.js';
import { readNetworkSessionLive } from './network-live-search.js';
import { readBillingMainLive } from './billing-main-live.js';
import { billingBalanceView, billingTariffView, hasBillingMainData, normalizeBillingMainSnapshot } from './billing-main-snapshot.js';
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
      message: 'Не удалось выполнить поиск login в Billing.', source: 'billing-live-read-only', searchMode: 'login'
    });
  }
  const candidates = (Array.isArray(live.candidates) ? live.candidates : []).map(liveLookupCandidate).filter(item => item.caseId);
  if (!candidates.length) {
    return result('customer.lookup', false, 'NOT_FOUND', {
      message: 'Абонент не найден штатным поиском Billing по login.', source: 'billing-live-read-only', searchMode: 'login'
    });
  }
  if (candidates.length !== 1) {
    return result('customer.lookup', false, 'AMBIGUOUS_IDENTITY', {
      count: candidates.length, candidates, source: 'billing-live-read-only', searchMode: 'login'
    }, ['Нужно уточнить login/договор, чтобы выбрать конкретного абонента.']);
  }
  const candidate = candidates[0];
  return result('customer.lookup', true, 'OK', {
    count: 1, candidate, requiresConfirmation: false, source: 'billing-live-read-only', searchMode: 'login'
  }, [], { pendingCandidate: null, confirmedCaseId: candidate.caseId, confirmedSubscriber: candidate });
}

async function executeBillingMainSnapshot(toolName, toolArgs = {}, labState = {}) {
  const compatibilityTool = toolName === 'billing.main' ? 'customer.snapshot' : toolName;
  if (!String(labState?.confirmedCaseId || '').trim()) {
    return core.executeOperatorTool({ tool: compatibilityTool, toolArgs, labState });
  }
  const id = billingIdFromLab(labState);
  if (!id) return core.executeOperatorTool({ tool: compatibilityTool, toolArgs, labState });

  const [live, base] = await Promise.all([
    readBillingMainLive({
      billingId: id,
      refresh: Boolean(toolArgs.refresh),
      forceRefresh: Boolean(toolArgs.forceRefresh),
      maxAgeMs: toolArgs.maxAgeMs || 30000
    }),
    core.executeOperatorTool({ tool: 'customer.snapshot', toolArgs: { ...toolArgs, refresh: false }, labState })
  ]);

  if (!live?.ok) {
    if (base?.ok) {
      return result(toolName, true, 'OK', base.data || {}, [
        ...(Array.isArray(base.warnings) ? base.warnings : []),
        `Billing main read недоступен (${String(live?.code || 'unknown')}); использован накопленный Billing snapshot.`
      ]);
    }
    return result(toolName, false, String(live?.code || base?.code || 'BILLING_MAIN_READ_FAILED'), {
      message: 'Не удалось прочитать основную карточку Billing.', source: 'billing-main-live-read-only', billingId: id
    });
  }

  const snapshot = normalizeBillingMainSnapshot({
    billingId: id,
    liveData: live.data || {},
    baseData: base?.ok ? base.data || {} : {},
    observedAt: live.observedAt || nowIso(),
    cache: live.cache || ''
  });
  if (!hasBillingMainData(snapshot)) return result(toolName, false, 'DATA_NOT_AVAILABLE', { source: snapshot.source, evidence: snapshot.evidence });
  return result(toolName, true, 'OK', snapshot, base?.ok ? [] : ['Накопленный Billing snapshot недоступен; использована свежая основная карточка.']);
}

async function executeBillingSummaryTool(name, toolArgs = {}, labState = {}) {
  const canonical = await executeBillingMainSnapshot('billing.main', toolArgs, labState);
  if (!canonical?.ok) return result(name, false, canonical?.code || 'BILLING_MAIN_READ_FAILED', canonical?.data || {}, canonical?.warnings || []);
  const snapshot = canonical.data || {};

  if (name === 'billing.balance') {
    const view = billingBalanceView(snapshot);
    const hasFinance = [view.accountBalance, view.balanceAfterTariff, view.balanceWithoutTemporary, view.temporaryPayment, view.price, view.totalDue]
      .some(value => value !== '' && value !== null && value !== undefined);
    return hasFinance
      ? result(name, true, 'OK', view, canonical.warnings || [])
      : result(name, false, 'DATA_NOT_AVAILABLE', { source: snapshot.source, evidence: snapshot.evidence });
  }

  if (name === 'billing.tariff') {
    const view = billingTariffView(snapshot);
    return view.currentTariff || view.nextTariff
      ? result(name, true, 'OK', view, canonical.warnings || [])
      : result(name, false, 'DATA_NOT_AVAILABLE', { source: snapshot.source, evidence: snapshot.evidence });
  }

  return canonical;
}

async function executeNetworkSessionTool(name, toolArgs = {}, labState = {}) {
  if (!String(labState?.confirmedCaseId || '').trim()) return core.executeOperatorTool({ tool: name, toolArgs, labState });
  const billingId = billingIdFromLab(labState);
  if (billingId) {
    const live = await readNetworkSessionLive({ billingId });
    if (live?.ok) {
      return result(name, true, 'OK', { ...(live.data || {}), source: 'billing-stat-live-read-only', observedAt: live.observedAt || nowIso() });
    }
    const fallback = await core.executeOperatorTool({ tool: name, toolArgs, labState });
    if (fallback?.ok) {
      return { ...fallback, warnings: [
        ...(Array.isArray(fallback.warnings) ? fallback.warnings : []),
        `Fresh Billing stat.pl a=252 read недоступен (${String(live?.code || 'unknown')}); использован накопленный Workbench network context.`
      ] };
    }
    return result(name, false, String(live?.code || fallback?.code || 'NETWORK_SESSION_FETCH_FAILED'), {
      message: 'Не удалось получить свежие данные сетевой сессии через Billing stat.pl a=252.', source: 'billing-stat-live-read-only', billingId
    }, ['Не трактовать неудачный запрос как доказательство отсутствия сессии.']);
  }
  return core.executeOperatorTool({ tool: name, toolArgs, labState });
}

export async function executeOperatorTool({ tool, toolArgs = {}, labState = {} } = {}) {
  const name = String(tool || '').trim();
  const genericLogin = name === 'customer.lookup' ? classifyStandaloneBillingLogin(toolArgs.login) : '';
  if (genericLogin && !/^abon\d{3,12}$/i.test(genericLogin)) return executeGenericLoginLookup({ ...toolArgs, login: genericLogin });
  if (name === 'building.snapshot') return readBuildingSnapshot({ toolArgs, labState });
  if (name === 'customer.snapshot' || name === 'billing.main') return executeBillingMainSnapshot(name, toolArgs, labState);
  if (name === 'billing.balance' || name === 'billing.tariff') return executeBillingSummaryTool(name, toolArgs, labState);
  if (name === 'network.session' || name === 'network.last_session') return executeNetworkSessionTool(name, toolArgs, labState);
  return core.executeOperatorTool({ tool: name, toolArgs, labState });
}

export const AI_OPERATOR_TOOL_STATE_KEYS = core.AI_OPERATOR_TOOL_STATE_KEYS;
