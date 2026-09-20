'use strict';

import * as base from './semantic-tool-broker-core-runtime-base.js';
import { generateGroundedSubscriberReply } from './semantic-probe-runtime-base.js';
import {
  compactFactResolutionForSynthesis,
  compactRuntimeAnalysis,
  compactRuntimeTranscript
} from './runtime-projection.js';

export * from './semantic-tool-broker-core-runtime-base.js';

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function stringList(value, maxItems = 5, maxChars = 360) {
  return (Array.isArray(value) ? value : []).map(item => oneLine(item, maxChars)).filter(Boolean).slice(0, maxItems);
}

function usageTotal(...items) {
  return items.reduce((total, item) => {
    const usage = item?.usage || item || {};
    total.prompt_tokens += Number(usage.prompt_tokens || 0);
    total.completion_tokens += Number(usage.completion_tokens || 0);
    total.total_tokens += Number(usage.total_tokens || 0);
    return total;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

function canonicalTrace(factResolution = null) {
  return (Array.isArray(factResolution?.sourceTrace) ? factResolution.sourceTrace : []).map(item => ({
    tool: oneLine(item?.tool || 'canonical.fact_resolver', 100),
    requestedBy: {
      system: 'CanonicalDomain',
      field: (item?.requestedFacts || []).join(', '),
      why: 'Resolve only facts selected by semantic understanding.'
    },
    args: item?.args || {},
    ok: Boolean(item?.ok),
    code: oneLine(item?.code || (item?.ok ? 'OK' : 'ERROR'), 100),
    observedAt: oneLine(item?.observedAt || '', 100),
    source: oneLine(item?.provenance || item?.source || '', 140),
    data: {},
    warnings: stringList(item?.warnings),
    cache: oneLine(item?.cache || '', 20),
    requestedFacts: [...(item?.requestedFacts || [])]
  }));
}

export async function groundSubscriberReply(options = {}) {
  const originalFactResolution = options?.factResolution || null;
  const compactTranscript = compactRuntimeTranscript(options?.transcript, { maxTurns: 8, maxChars: 380 });
  const compactAnalysis = compactRuntimeAnalysis(options?.analysis);

  // Legacy/degraded routing keeps the compatibility implementation. The canonical
  // resolver path uses one compact FINAL stage instead of the old duplicate
  // tool-evidence synthesis instruction.
  if (!originalFactResolution) {
    return base.groundSubscriberReply({
      ...options,
      transcript: compactTranscript,
      analysis: compactAnalysis,
      factResolution: null
    });
  }

  const projectedFacts = compactFactResolutionForSynthesis(originalFactResolution);
  const trace = canonicalTrace(originalFactResolution);
  const draft = options?.draft || {};
  try {
    const finalReply = await generateGroundedSubscriberReply({
      transcript: compactTranscript,
      latestCustomer: options?.latestCustomer || {},
      analysis: compactAnalysis,
      useKnowledge: options?.useKnowledge !== false,
      behavior: draft?.behavior || options?.behavior || {},
      canonicalFactEvidence: projectedFacts?.evidence || [],
      toolEvidence: [],
      meterContext: options?.meterContext || {}
    });
    return {
      ...draft,
      ...finalReply,
      model: [draft?.model, finalReply?.model].filter(Boolean).join(' → '),
      usage: usageTotal(draft?.usage, finalReply?.usage),
      toolTrace: trace,
      toolEvidence: [],
      factEvidence: originalFactResolution?.evidence || [],
      factDiagnostics: originalFactResolution?.diagnostics || {},
      degraded: false,
      degradationReason: '',
      toolState: originalFactResolution?.context || options?.labState || {}
    };
  } catch (error) {
    return {
      ...draft,
      reply: base.ensureNonEmptyReply(draft?.reply, compactAnalysis, trace),
      subscriberDataNeeded: draft?.subscriberDataNeeded || [],
      toolTrace: trace,
      toolEvidence: [],
      factEvidence: originalFactResolution?.evidence || [],
      factDiagnostics: originalFactResolution?.diagnostics || {},
      degraded: true,
      degradationReason: oneLine(error?.message || error, 600),
      toolState: originalFactResolution?.context || options?.labState || {}
    };
  }
}
