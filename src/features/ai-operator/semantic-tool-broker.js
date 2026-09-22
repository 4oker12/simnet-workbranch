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
export async function groundSubscriberReply(options = {}) {
  const result = await base.groundSubscriberReply(options);
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
