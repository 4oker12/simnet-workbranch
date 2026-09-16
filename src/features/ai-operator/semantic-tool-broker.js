'use strict';

import * as core from './semantic-tool-broker-core.js';

/*
Evidence contract inherited from the core broker and enforced again by the runtime fallback:
- source=userside-live-read-only is fresh UserSide evidence.
- source=billing-live-read-only is fresh Billing evidence.
- Workbench/Network fallback не выдавай за свежий Juniper/UserSide запрос.
- ok=false означает «проверить не удалось», а НЕ доказательство отрицательного факта.
- поле reply ОБЯЗАТЕЛЬНО должно быть непустым.
*/

export const AI_OPERATOR_SOFT_TOOL_CAPABILITIES = core.AI_OPERATOR_SOFT_TOOL_CAPABILITIES;
export const AI_OPERATOR_TOOL_CAPABILITY_DETAILS = core.AI_OPERATOR_TOOL_CAPABILITY_DETAILS;
export const AI_OPERATOR_SOFT_TOOL_CATALOG = core.AI_OPERATOR_SOFT_TOOL_CATALOG;
export const mapInformationNeedsToTools = core.mapInformationNeedsToTools;
export const extractIdentityHints = core.extractIdentityHints;
export const ensureNonEmptyReply = core.ensureNonEmptyReply;

const TECHNICAL_TOOLS = new Set(['userside.snapshot', 'network.session', 'pon.onu', 'pon.signal']);

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function block(value, max = 2200) {
  const normalized = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function cloneState(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
}

function applyStatePatch(state = {}, patch = {}) {
  return {
    ...(state && typeof state === 'object' && !Array.isArray(state) ? state : {}),
    ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {})
  };
}

function evidenceSource(result = {}) {
  return oneLine(result?.data?.source || result?.data?.evidence?.source || result?.data?.evidence?.workbenchState || result?.tool || '', 140);
}

function traceEntry(result = {}, requestedBy = {}, args = {}) {
  return {
    tool: oneLine(result?.tool || '', 100),
    requestedBy: cloneState(requestedBy),
    args: cloneState(args),
    ok: Boolean(result?.ok),
    code: oneLine(result?.code || (result?.ok ? 'OK' : 'ERROR'), 100),
    observedAt: oneLine(result?.observedAt || '', 100),
    source: evidenceSource(result),
    data: cloneState(result?.data || {}),
    warnings: (Array.isArray(result?.warnings) ? result.warnings : []).map(item => oneLine(item, 360)).filter(Boolean).slice(0, 5)
  };
}

async function runDirectTool({ execute, tool, toolArgs = {}, labState = {}, requestedBy = {} }) {
  let result;
  try {
    result = await execute({ tool, toolArgs, labState });
  } catch (error) {
    result = {
      ok: false,
      tool,
      code: 'TOOL_EXECUTION_ERROR',
      observedAt: new Date().toISOString(),
      data: { message: oneLine(error?.message || error, 500) },
      warnings: [],
      statePatch: {}
    };
  }
  return {
    result,
    trace: traceEntry(result, requestedBy, toolArgs),
    labState: applyStatePatch(labState, result?.statePatch || {})
  };
}

function strongIdentity(identity = {}) {
  return Boolean(identity.login || identity.contract || identity.ip);
}

async function bootstrapExplicitIdentity({ transcript = [], analysis = {}, labState = {}, execute, includeSnapshot = false } = {}) {
  let state = cloneState(labState);
  const trace = [];
  if (typeof execute !== 'function') return { trace, labState: state };
  if (String(state.confirmedCaseId || '').trim() || state.pendingCandidate) return { trace, labState: state };

  const identity = core.extractIdentityHints(transcript, analysis);
  if (!identity || !Object.keys(identity).length) return { trace, labState: state };

  const lookup = await runDirectTool({
    execute,
    tool: 'customer.lookup',
    toolArgs: identity,
    labState: state,
    requestedBy: {
      system: 'identity',
      field: Object.keys(identity)[0],
      why: 'Явный идентификатор абонента привязывает live-контекст независимо от LLM-черновика.'
    }
  });
  state = lookup.labState;
  trace.push(lookup.trace);

  if (includeSnapshot && strongIdentity(identity) && String(state.confirmedCaseId || '').trim()) {
    const snapshot = await runDirectTool({
      execute,
      tool: 'customer.snapshot',
      toolArgs: { refresh: false, maxAgeMs: 120000 },
      labState: state,
      requestedBy: {
        system: 'Billing',
        field: 'subscriber snapshot',
        why: 'LLM-черновик недоступен; используем уже подтверждённый Billing-снимок для безопасного ответа.'
      }
    });
    state = snapshot.labState;
    trace.push(snapshot.trace);
  }

  return { trace, labState: state };
}

function mergeTrace(first = [], second = []) {
  return [...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])];
}

function uniqueEvidence(trace = []) {
  return (Array.isArray(trace) ? trace : []).filter(item => item?.ok);
}

export async function executeInformationNeeds({ needs = [], transcript = [], analysis = {}, labState = {}, execute } = {}) {
  if (typeof execute !== 'function') throw new Error('Soft tool broker requires execute(tool)');
  const pre = await bootstrapExplicitIdentity({ transcript, analysis, labState, execute, includeSnapshot: false });

  if (pre.trace.length && !String(pre.labState.confirmedCaseId || '').trim()) {
    return {
      planned: core.mapInformationNeedsToTools(needs),
      trace: pre.trace,
      labState: pre.labState
    };
  }

  const delegated = await core.executeInformationNeeds({
    needs,
    transcript,
    analysis,
    labState: pre.labState,
    execute
  });

  return {
    ...delegated,
    trace: mergeTrace(pre.trace, delegated?.trace),
    labState: delegated?.labState || pre.labState
  };
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== '' && value !== null && value !== undefined) return value;
  }
  return '';
}

function moneyText(value) {
  if (value === '' || value === null || value === undefined) return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.round(numeric * 100) / 100) : oneLine(value, 80);
}

function successfulTool(trace = [], tool) {
  return (Array.isArray(trace) ? trace : []).find(item => item?.ok && item?.tool === tool) || null;
}

export function evidenceFallbackReply(analysis = {}, toolTrace = []) {
  const trace = Array.isArray(toolTrace) ? toolTrace : [];
  const successful = trace.filter(item => item?.ok);
  if (!successful.length) return core.ensureNonEmptyReply('', analysis, trace);

  const uk = oneLine(analysis?.probe?.language, 20).toLowerCase() === 'uk';
  const lookup = successfulTool(trace, 'customer.lookup')?.data || {};
  const snapshot = successfulTool(trace, 'customer.snapshot')?.data || {};
  const balance = successfulTool(trace, 'billing.balance')?.data || {};
  const tariff = successfulTool(trace, 'billing.tariff')?.data || {};
  const userSide = successfulTool(trace, 'userside.snapshot')?.data || {};
  const onu = successfulTool(trace, 'pon.onu')?.data || {};

  const contract = firstPresent(lookup?.candidate?.contract, snapshot?.identity?.contract);
  const accessState = firstPresent(balance.accessState, tariff.accessState, snapshot?.service?.accessState);
  const serviceState = firstPresent(balance.serviceState, tariff.serviceState, snapshot?.service?.serviceState);
  const accountBalance = firstPresent(balance.accountBalance, snapshot?.finance?.accountBalance);
  const currentTariff = firstPresent(tariff.currentTariff, balance.currentTariff, snapshot?.service?.currentTariff);
  const connectionFamily = firstPresent(
    userSide?.network?.connectionFamily,
    onu.connectionFamily,
    snapshot?.network?.connectionFamily,
    lookup?.candidate?.connectionFamily
  );

  const semanticText = [
    analysis?.probe?.whatUserWants,
    analysis?.probe?.latestMessageMeans,
    ...(Array.isArray(analysis?.probe?.unresolvedRequests) ? analysis.probe.unresolvedRequests : [])
  ].map(item => oneLine(item, 500)).join(' ').toLowerCase();
  const moneyRelevant = /баланс|сч[её]т|рахун|деньг|грн|оплат|плат[её]ж|задолж|борг/.test(semanticText);
  const tariffRelevant = /тариф|пакет|скорост|швидк|абонплат/.test(semanticText);

  const parts = [];
  if (contract && lookup?.candidate) parts.push(uk ? `Договір ${contract} знайдено.` : `Договор ${contract} найден.`);
  if (accessState || serviceState) {
    const values = [
      accessState ? `доступ — ${oneLine(accessState, 120)}` : '',
      serviceState ? (uk ? `стан послуги — ${oneLine(serviceState, 160)}` : `состояние услуги — ${oneLine(serviceState, 160)}`) : ''
    ].filter(Boolean).join(', ');
    parts.push(uk ? `За даними Billing: ${values}.` : `По данным Billing: ${values}.`);
  }
  if (moneyRelevant && accountBalance !== '') {
    const value = moneyText(accountBalance);
    if (value) parts.push(uk ? `Поточний баланс: ${value} грн.` : `Текущий баланс: ${value} грн.`);
  }
  if (tariffRelevant && currentTariff) parts.push(uk ? `Поточний тариф: ${oneLine(currentTariff, 220)}.` : `Текущий тариф: ${oneLine(currentTariff, 220)}.`);
  if (connectionFamily) parts.push(uk ? `Тип підключення: ${oneLine(connectionFamily, 100)}.` : `Тип подключения: ${oneLine(connectionFamily, 100)}.`);

  if (trace.some(item => !item?.ok && TECHNICAL_TOOLS.has(item?.tool))) {
    parts.push(uk
      ? 'Технічну частину лінії зараз повністю перевірити не вдалося; це не означає, що на лінії підтверджена несправність.'
      : 'Техническую часть линии сейчас полностью проверить не удалось; это не означает, что на линии подтверждена неисправность.');
  }

  return block(parts.join(' '), 2200) || core.ensureNonEmptyReply('', analysis, trace);
}

export async function groundSubscriberReply(options = {}) {
  const {
    draft = {},
    transcript = [],
    analysis = {},
    labState = {},
    execute,
    coreGround = core.groundSubscriberReply,
    ...rest
  } = options;

  if (typeof execute !== 'function') throw new Error('Soft tool broker requires execute(tool)');

  const needs = Array.isArray(draft?.subscriberDataNeeded) ? draft.subscriberDataNeeded : [];
  const pre = await bootstrapExplicitIdentity({
    transcript,
    analysis,
    labState,
    execute,
    includeSnapshot: Boolean(draft?.degraded && needs.length === 0)
  });

  const result = await coreGround({
    ...rest,
    draft,
    transcript,
    analysis,
    labState: pre.labState,
    execute
  });

  const toolTrace = mergeTrace(pre.trace, result?.toolTrace);
  const toolEvidence = uniqueEvidence(toolTrace);
  const mustUseEvidenceFallback = toolEvidence.length > 0 && Boolean(result?.degraded || draft?.degraded);

  return {
    ...result,
    reply: mustUseEvidenceFallback
      ? evidenceFallbackReply(analysis, toolTrace)
      : core.ensureNonEmptyReply(result?.reply, analysis, toolTrace),
    toolTrace,
    toolEvidence,
    toolState: result?.toolState || pre.labState
  };
}
