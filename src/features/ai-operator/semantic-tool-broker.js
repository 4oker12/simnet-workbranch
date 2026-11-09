'use strict';

import * as base from './semantic-tool-broker-runtime-base.js';
import { applyDialoguePolicy } from './dialogue-policy.js';

export * from './semantic-tool-broker-runtime-base.js';

function latestRequest(options = {}) {
  const explicit = String(options?.latestCustomer?.text || '').trim();
  if (explicit) return explicit;
  const turns = Array.isArray(options?.transcript) ? options.transcript : [];
  return String([...turns].reverse().find(item => item?.role === 'customer')?.text || '').trim();
}

/**
 * Final compatibility shell.
 *
 * The historical broker may choose a knowledge fallback when generation is
 * degraded and no legacy toolTrace exists. Canonical resolver evidence lives
 * outside that legacy trace, so a source-backed canonical fallback must have
 * higher priority than raw/summary KB text.
 */
const BILLING_SOURCE_FAILURES = new Set([
  'BILLING_TAB_REQUIRED', 'BILLING_SESSION_REQUIRED', 'BILLING_AUTH_REQUIRED',
  'BILLING_TAB_INVALID', 'BILLING_RUNTIME_UNAVAILABLE', 'BILLING_SEARCH_EXECUTION_FAILED',
  'BILLING_SEARCH_FAILED'
]);

// This is a source/evidence gate, not an LLM-generated conclusion. In particular,
// an inaccessible Billing source must never become "subscriber not found" or
// a request for an unrelated telephone identifier.
export function billingUnavailableReplyForTrace(toolTrace = []) {
  const traces = Array.isArray(toolTrace) ? toolTrace : [];
  const failedLookup = traces.find(item =>
    item?.tool === 'customer.lookup' && !item?.ok && BILLING_SOURCE_FAILURES.has(String(item?.code || ''))
  );
  if (!failedLookup) return '';
  const hasConfirmedSubscriberFact = traces.some(item => item?.ok && [
    'customer.lookup', 'customer.snapshot', 'billing.balance',
    'billing.main_summary', 'billing.tariff', 'billing.payments'
  ].includes(String(item?.tool || '')));
  if (hasConfirmedSubscriberFact) return '';
  return 'Сейчас не могу проверить данные вашего договора: доступ к Billing отсутствует. Полученный идентификатор уже учтён; повторять его или сообщать телефон для устранения этой ошибки не нужно.';
}

export async function groundSubscriberReply(options = {}) {
  const result = await base.groundSubscriberReply(options);
  const sourceReply = billingUnavailableReplyForTrace(result?.toolTrace);
  if (sourceReply) return {
    ...result,
    reply: sourceReply,
    evidenceGate: { applied: true, reason: 'billing_source_unavailable', sourceCodes: (result?.toolTrace || []).filter(item => item?.tool === 'customer.lookup' && !item?.ok).map(item => String(item?.code || '')) }
  };
  const fallback = result?.evidenceFallback;
  if (!result?.generationDegraded || !fallback?.used || !String(fallback?.reply || '').trim()) return result;

  const toolState = result?.toolState || options?.labState || {};
  const actionToolsCalled = (Array.isArray(result?.toolTrace) ? result.toolTrace : [])
    .filter(item => item?.ok)
    .map(item => String(item?.tool || ''))
    .filter(Boolean);
  const policed = applyDialoguePolicy({
    reply: fallback.reply,
    requestText: latestRequest(options),
    labState: toolState,
    alreadyExplainedFacts: Array.isArray(toolState?.alreadyExplainedFacts) ? toolState.alreadyExplainedFacts : [],
    offeredActions: Array.isArray(toolState?.offeredActions) ? toolState.offeredActions : [],
    actionToolsCalled,
    hasWriteCapability: false
  });

  return {
    ...result,
    reply: policed.reply || fallback.reply,
    dialoguePolice: policed.dialoguePolice || null,
    answerRelevance: null,
    relevanceGate: { skipped: true, reason: 'canonical-evidence-fallback-priority' },
    recoveredFromGenerationFailure: Boolean(fallback.complete),
    degraded: fallback.complete ? false : true,
    degradationReason: fallback.complete ? '' : String(result?.degradationReason || result?.generationDegradationReason || ''),
    generationDegraded: true
  };
}
