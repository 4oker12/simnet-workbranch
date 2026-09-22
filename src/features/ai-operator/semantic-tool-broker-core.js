'use strict';

import * as base from './semantic-tool-broker-core-runtime-base.js';
import { generateGroundedSubscriberReply } from './semantic-probe-runtime-base.js';
import { compactFactResolutionForSynthesis, compactRuntimeAnalysis, compactRuntimeTranscript } from './runtime-projection.js';
import { extractStandaloneSubscriberIdentity, identityToolArgs, resolveSubscriberIdentityHints } from './subscriber-identity.js';
import { buildDialoguePolicyContext, updateDialogueMemory } from './dialogue-runtime-state.js';
import { deriveFinanceDecisionEvidence } from './finance-decision-nodes.js';

export * from './semantic-tool-broker-core-runtime-base.js';

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function stringList(value, maxItems = 5, maxChars = 360) { return (Array.isArray(value) ? value : []).map(item => oneLine(item, maxChars)).filter(Boolean).slice(0, maxItems); }
function usageTotal(...items) { return items.reduce((total, item) => { const usage = item?.usage || item || {}; total.prompt_tokens += Number(usage.prompt_tokens || 0); total.completion_tokens += Number(usage.completion_tokens || 0); total.total_tokens += Number(usage.total_tokens || 0); return total; }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }); }

export function extractIdentityHints(transcript = [], analysis = {}) {
  const standard = base.extractIdentityHints(transcript, analysis);
  const secondary = (standard && typeof standard === 'object' && !Array.isArray(standard) && Object.keys(standard).length) ? standard : null;
  return resolveSubscriberIdentityHints(transcript, analysis, secondary);
}

function canonicalTrace(factResolution = null) {
  return (Array.isArray(factResolution?.sourceTrace) ? factResolution.sourceTrace : []).map(item => ({
    tool: oneLine(item?.tool || 'canonical.fact_resolver', 100),
    requestedBy: { system: 'CanonicalDomain', field: (item?.requestedFacts || []).join(', '), why: 'Resolve only facts selected by semantic understanding.' },
    args: item?.args || {}, ok: Boolean(item?.ok), code: oneLine(item?.code || (item?.ok ? 'OK' : 'ERROR'), 100),
    observedAt: oneLine(item?.observedAt || '', 100), source: oneLine(item?.provenance || item?.source || '', 140), data: {},
    warnings: stringList(item?.warnings), cache: oneLine(item?.cache || '', 20), requestedFacts: [...(item?.requestedFacts || [])]
  }));
}

function latestRequest(options = {}, transcript = []) {
  return oneLine(options?.latestCustomer?.text || (Array.isArray(transcript) ? [...transcript].reverse().find(item => item?.role === 'customer')?.text : ''), 1200);
}
function analysisWithDialoguePolicy(analysis = {}, policy = {}, financeDecision = null) {
  const compact = compactRuntimeAnalysis(analysis);
  return { ...compact, probe: { ...(compact?.probe || {}), dialoguePolicy: { ...policy, financeDecision: financeDecision || null } } };
}

export async function groundSubscriberReply(options = {}) {
  const originalFactResolution = options?.factResolution || null;
  const compactTranscript = compactRuntimeTranscript(options?.transcript, { maxTurns: 8, maxChars: 380 });
  const requestText = latestRequest(options, compactTranscript);
  const sourceState = originalFactResolution?.context || options?.labState || {};
  const finance = deriveFinanceDecisionEvidence({ requestText, evidence: originalFactResolution?.evidence || [] });
  const dialoguePolicy = buildDialoguePolicyContext({ analysis: options?.analysis, requestText, labState: sourceState, factResolution: originalFactResolution });
  const compactAnalysis = analysisWithDialoguePolicy(options?.analysis, dialoguePolicy, finance.decision);

  if (!originalFactResolution) {
    const legacy = await base.groundSubscriberReply({ ...options, transcript: compactTranscript, analysis: compactAnalysis, factResolution: null });
    return { ...legacy, toolState: updateDialogueMemory({ labState: legacy?.toolState || sourceState, analysis: options?.analysis, requestText, factResolution: null }) };
  }

  const projectedFacts = compactFactResolutionForSynthesis(originalFactResolution);
  const trace = canonicalTrace(originalFactResolution);
  const canonicalFactEvidence = [...(projectedFacts?.evidence || []), ...finance.evidence];
  const draft = options?.draft || {};
  try {
    const finalReply = await generateGroundedSubscriberReply({
      transcript: compactTranscript, latestCustomer: options?.latestCustomer || {}, analysis: compactAnalysis,
      useKnowledge: options?.useKnowledge !== false, behavior: draft?.behavior || options?.behavior || {},
      canonicalFactEvidence, toolEvidence: [], meterContext: options?.meterContext || {}
    });
    const toolState = updateDialogueMemory({ labState: sourceState, analysis: options?.analysis, requestText, factResolution: originalFactResolution });
    return {
      ...draft, ...finalReply, model: [draft?.model, finalReply?.model].filter(Boolean).join(' → '),
      usage: usageTotal(draft?.usage, finalReply?.usage), toolTrace: trace, toolEvidence: [],
      factEvidence: originalFactResolution?.evidence || [], derivedFactEvidence: finance.evidence, financeDecision: finance.decision,
      factDiagnostics: originalFactResolution?.diagnostics || {}, degraded: false, degradationReason: '', toolState
    };
  } catch (error) {
    const toolState = updateDialogueMemory({ labState: sourceState, analysis: options?.analysis, requestText, factResolution: originalFactResolution });
    return {
      ...draft, reply: base.ensureNonEmptyReply(draft?.reply, compactAnalysis, trace), subscriberDataNeeded: draft?.subscriberDataNeeded || [],
      toolTrace: trace, toolEvidence: [], factEvidence: originalFactResolution?.evidence || [], derivedFactEvidence: finance.evidence,
      financeDecision: finance.decision, factDiagnostics: originalFactResolution?.diagnostics || {}, degraded: true,
      degradationReason: oneLine(error?.message || error, 600), toolState
    };
  }
}
