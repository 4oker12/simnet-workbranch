'use strict';

import { buildConversationContext, compactConversationContext } from './conversation-context.js';

/**
 * Stage-aware defaults for dialogue tail passed into LLM stages.
 * understanding — needs a bit more context for referent resolution
 * reply / grounded — shorter tail; understanding already carries the frame
 */
export const TRANSCRIPT_STAGE_LIMITS = Object.freeze({
  understanding: { maxTurns: 10, maxChars: 420 },
  reply: { maxTurns: 8, maxChars: 380 },
  grounded: { maxTurns: 8, maxChars: 380 }
});

function text(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function list(value, maxItems = 6, maxChars = 320) {
  return (Array.isArray(value) ? value : [])
    .map(item => text(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function objectList(value, mapper, maxItems = 6) {
  return (Array.isArray(value) ? value : []).slice(0, maxItems).map(mapper).filter(Boolean);
}

/**
 * Runtime dialogue projection.
 *
 * Context comes before token trimming: first select the active subscriber/thread,
 * then apply the stage budget. This prevents facts from a previous subscriber
 * from leaking into a new turn while still allowing an explicit return to a
 * parked subscriber to recover that subscriber's earlier raw dialogue.
 */
export function compactRuntimeTranscript(transcript = [], { maxTurns = 10, maxChars = 420 } = {}) {
  const context = buildConversationContext(transcript, {
    maxActiveTurns: Math.max(18, Number(maxTurns) || 10),
    maxGeneralTurns: Math.max(16, Number(maxTurns) || 10)
  });
  return context.selectedTranscript
    .slice(-maxTurns)
    .map(item => ({
      role: item?.role === 'customer' ? 'customer' : 'operator',
      text: text(item?.text, maxChars)
    }))
    .filter(item => item.text);
}

/** Structured diagnostics for the same projection used by LLM stages. */
export function projectRuntimeConversationContext(transcript = [], options = {}) {
  return compactConversationContext(buildConversationContext(transcript, options));
}

/** Convenience: compact dialogue for a named stage. */
export function compactRuntimeTranscriptForStage(transcript = [], stage = 'reply') {
  const limits = TRANSCRIPT_STAGE_LIMITS[stage] || TRANSCRIPT_STAGE_LIMITS.reply;
  return compactRuntimeTranscript(transcript, limits);
}

export function compactRuntimeProbe(probe = {}) {
  const source = probe && typeof probe === 'object' && !Array.isArray(probe) ? probe : {};
  return {
    language: text(source.language || 'other', 20),
    whatUserWants: text(source.whatUserWants, 160),
    latestMessageMeans: text(source.latestMessageMeans, 220),
    refersTo: text(source.refersTo, 120),
    underlyingGoal: text(source.underlyingGoal, 160),
    ids: {
      contract: text(source?.ids?.contract, 80),
      login: text(source?.ids?.login, 80),
      ip: text(source?.ids?.ip, 80),
      address: text(source?.ids?.address, 240)
    },
    unresolvedRequests: list(source.unresolvedRequests, 5, 140),
    ambiguities: list(source.ambiguities, 3, 120),
    liveDataNeed: text(source.liveDataNeed, 20),
    evidenceNeeds: objectList(source.evidenceNeeds, item => ({
      system: text(item?.system, 40),
      field: text(item?.field, 120),
      why: text(item?.why, 160)
    }), 5),
    requiredFacts: list(source.requiredFacts, 10, 100),
    knowledgeNeed: text(source.knowledgeNeed, 20),
    knowledgeReason: text(source.knowledgeReason, 160),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : 0
  };
}

function compactArticle(article = {}) {
  const id = text(article?.id, 100);
  const title = text(article?.title, 160);
  const summary = text(article?.summary, 320);
  // Synthesis only needs the relevant rule/price, not the full article body.
  const body = text(article?.text, 900);
  if (!id && !title && !summary && !body) return null;
  return { id, title, summary, text: body };
}

export function compactRuntimeKnowledge(knowledge = {}) {
  const source = knowledge && typeof knowledge === 'object' && !Array.isArray(knowledge) ? knowledge : {};
  return {
    skipped: Boolean(source.skipped),
    skipReason: text(source.skipReason, 100),
    usedArticles: objectList(source.usedArticles, item => ({
      id: text(item?.id, 100),
      why: text(item?.why, 140)
    }), 3),
    articleEvidence: objectList(source.articleEvidence, compactArticle, 2),
    relevantInternalKnowledge: list(source.relevantInternalKnowledge, 6, 280),
    howItApplies: text(source.howItApplies, 280),
    alreadyEnough: list(source.alreadyEnough, 3, 180),
    mustNotAssume: list(source.mustNotAssume, 4, 180),
    knowledgeGaps: list(source.knowledgeGaps, 3, 160)
  };
}

export function compactRuntimeAnalysis(analysis = {}) {
  const source = analysis && typeof analysis === 'object' && !Array.isArray(analysis) ? analysis : {};
  return {
    probe: compactRuntimeProbe(source.probe || {}),
    knowledge: compactRuntimeKnowledge(source.knowledge || {}),
    knowledgeMode: text(source.knowledgeMode, 20)
  };
}

export function compactRuntimeCapabilities(capabilities = {}) {
  const source = capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities) ? capabilities : {};
  return {
    billing: Boolean(source.billing),
    userside: Boolean(source.userside),
    network: Boolean(source.network)
  };
}

export function compactFactResolutionForSynthesis(factResolution = null) {
  if (!factResolution || typeof factResolution !== 'object' || Array.isArray(factResolution)) return factResolution;
  return {
    ...factResolution,
    diagnostics: {}
  };
}
