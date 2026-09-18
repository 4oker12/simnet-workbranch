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
  return oneLine(unresolved[0] || probe?.whatUserWants || latestCustomer?.text || '', 500);
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

  // semantic-tool-broker may prepend relevantInternalKnowledge during a degraded
  // synthesis path. Internal KB text is evidence/context, not client-facing copy.
  // If live evidence exists, never let that automatic prefix leak into the reply.
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

/**
 * Final relevance boundary intentionally contains NO model/API call.
 *
 * Understanding already established the semantic frame; READ tools establish live
 * facts; the preceding synthesis forms the human answer. This final step only
 * enforces local invariants and diagnostics. It must never create another LLM
 * dependency, consume quota, reinterpret the request, or turn successful READs
 * into DEGRADED because a verifier model is rate-limited.
 */
export async function applyAnswerRelevanceGate({
  reply = '',
  analysis = {},
  toolTrace = [],
  latestCustomer = {}
} = {}) {
  const request = requestFrom({ analysis, latestCustomer });
  const cleanedReply = stripAutoInjectedKnowledgePrefix(reply, analysis, toolTrace);
  const finalReply = cleanedReply || block(reply, 2200);
  const kept = keptItems(toolTrace);
  const dropped = droppedItems(toolTrace);

  return {
    reply: finalReply,
    answerRelevance: {
      request,
      kept,
      dropped,
      completeness: completeness(toolTrace, finalReply),
      conclusion: 'Локальная relevance-проверка: semantic frame не переосмысляется отдельной LLM; live-факты учитываются только по результатам READ.'
    },
    gate: {
      skipped: true,
      reason: 'deterministic_local_relevance_boundary',
      degraded: false,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }
  };
}
