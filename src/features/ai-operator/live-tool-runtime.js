'use strict';

import * as core from './live-tool-runtime-core.js';
import { readNetworkSessionLive } from './network-live-search.js';

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
  if (name === 'network.session' || name === 'network.last_session') {
    return executeNetworkSessionTool(name, toolArgs, labState);
  }
  return core.executeOperatorTool({ tool: name, toolArgs, labState });
}

export const AI_OPERATOR_TOOL_STATE_KEYS = core.AI_OPERATOR_TOOL_STATE_KEYS;
