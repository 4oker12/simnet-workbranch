'use strict';

function oneLine(value, max = 600) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function block(value, max = 2600) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function requestFrom({ analysis = {}, latestCustomer = {} } = {}) {
  const probe = analysis?.probe || {};
  const unresolved = Array.isArray(probe?.unresolvedRequests) ? probe.unresolvedRequests : [];
  return oneLine(unresolved.join(' ') || probe?.whatUserWants || latestCustomer?.text || '', 800);
}

function successfulTrace(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).filter(item => item?.ok);
}

function failedTrace(toolTrace = []) {
  return (Array.isArray(toolTrace) ? toolTrace : []).filter(item => !item?.ok);
}

function injectedKnowledgePrefixes(analysis = {}) {
  const relevant = Array.isArray(analysis?.knowledge?.relevantInternalKnowledge)
    ? analysis.knowledge.relevantInternalKnowledge
    : [];
  const prefixes = [];
  for (const item of relevant) {
    const raw = String(item || '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    prefixes.push(raw);
    prefixes.push(raw.slice(0, 600).trim());
  }
  return [...new Set(prefixes.filter(Boolean))].sort((a, b) => b.length - a.length);
}

function stripAutoInjectedKnowledgePrefix(reply = '', analysis = {}, toolTrace = []) {
  let text = block(reply, 2200);
  if (!text || !successfulTrace(toolTrace).length) return text;

  for (const prefix of injectedKnowledgePrefixes(analysis)) {
    if (!text.startsWith(prefix)) continue;
    text = text.slice(prefix.length).replace(/^\s+/, '').trim();
    break;
  }
  return text;
}

function keptItems(toolTrace = []) {
  return successfulTrace(toolTrace).slice(0, 12).map(item => {
    const field = oneLine(item?.requestedBy?.field || '', 240);
    const why = oneLine(item?.requestedBy?.why || '', 360);
    const tool = oneLine(item?.tool || '', 120);
    return {
      fact: field ? `${field} подтверждено READ-источником` : `${tool || 'READ'} выполнен успешно`,
      source: tool ? `tool:${tool}` : 'tool',
      reason: why || 'Этот READ был запрошен для текущего пользовательского запроса.'
    };
  });
}

function droppedItems(toolTrace = []) {
  return failedTrace(toolTrace).slice(0, 8).map(item => ({
    fact: oneLine(item?.requestedBy?.field || item?.tool || 'неполученный READ-факт', 300),
    source: item?.tool ? `tool:${oneLine(item.tool, 120)}` : 'tool',
    reason: `READ не подтвердил факт (${oneLine(item?.code || 'ERROR', 120)}); ошибка источника не превращается в отрицательный факт.`
  }));
}

function completeness(toolTrace = [], reply = '') {
  const ok = successfulTrace(toolTrace).length;
  const failed = failedTrace(toolTrace).length;
  if (!block(reply, 2200)) return 'unknown';
  if (ok && !failed) return 'complete';
  if (ok && failed) return 'partial';
  return 'unknown';
}

function currentBalanceTrace(toolTrace = []) {
  return successfulTrace(toolTrace).find(item => {
    if (item?.tool !== 'billing.balance') return false;
    const field = oneLine(item?.requestedBy?.field || '', 240).toLowerCase();
    return /баланс|balance/.test(field) && !/долг|задолж|борг|к\s+оплат|до\s+сплат|after|due/.test(field);
  }) || null;
}

function currentTariffTrace(toolTrace = []) {
  return successfulTrace(toolTrace).find(item => {
    if (item?.tool !== 'billing.tariff') return false;
    const field = oneLine(item?.requestedBy?.field || '', 240).toLowerCase();
    return /тариф|tariff|пакет/.test(field) && !/скорост|швидк|цен|стоим|варт|абонплат|next|future|следующ|наступн/.test(field);
  }) || null;
}

function clientTariffName(value) {
  return oneLine(value, 240)
    .replace(/\s*-\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/u, '')
    .trim();
}

function deterministicConfirmedFactsRecovery({ analysis = {}, latestCustomer = {}, toolTrace = [] } = {}) {
  const request = requestFrom({ analysis, latestCustomer }).toLowerCase();
  const wantsBalance = /баланс|balance|рахун/.test(request);
  const wantsTariff = /тариф|tariff|пакет/.test(request);
  if (!wantsBalance && !wantsTariff) return null;

  const balanceTrace = wantsBalance ? currentBalanceTrace(toolTrace) : null;
  const tariffTrace = wantsTariff ? currentTariffTrace(toolTrace) : null;
  if (wantsBalance && !balanceTrace) return null;
  if (wantsTariff && !tariffTrace) return null;

  const parts = [];
  if (balanceTrace) {
    const raw = balanceTrace?.data?.accountBalance;
    if (raw === '' || raw === null || raw === undefined || !Number.isFinite(Number(raw))) return null;
    parts.push(`Текущий баланс: ${Math.round(Number(raw) * 100) / 100} грн.`);
  }
  if (tariffTrace) {
    const tariff = clientTariffName(tariffTrace?.data?.currentTariff);
    if (!tariff) return null;
    parts.push(`Текущий тариф: ${tariff}.`);
  }

  return parts.length ? parts.join(' ') : null;
}

export async function applyAnswerRelevanceGate({
  reply = '',
  analysis = {},
  toolTrace = [],
  latestCustomer = {}
} = {}) {
  const request = requestFrom({ analysis, latestCustomer });
  const recoveredReply = deterministicConfirmedFactsRecovery({ analysis, latestCustomer, toolTrace });
  const finalReply = recoveredReply
    || stripAutoInjectedKnowledgePrefix(reply, analysis, toolTrace)
    || block(reply, 2200);
  const kept = keptItems(toolTrace);
  const dropped = droppedItems(toolTrace);
  const recovered = Boolean(recoveredReply);

  return {
    reply: finalReply,
    answerRelevance: {
      request,
      kept,
      dropped,
      completeness: completeness(toolTrace, finalReply),
      conclusion: recovered
        ? 'Подтверждённые запрошенные факты восстановлены локально без соседних Billing-полей.'
        : 'Локальная relevance-проверка: semantic frame не переосмысляется отдельной LLM; live-факты учитываются только по результатам READ.'
    },
    gate: {
      skipped: true,
      reason: recovered ? 'deterministic_confirmed_facts_recovery' : 'deterministic_local_relevance_boundary',
      degraded: false,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }
  };
}
