'use strict';

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

export function compactRuntimeTranscript(transcript = [], { maxTurns = 12, maxChars = 600 } = {}) {
  return (Array.isArray(transcript) ? transcript : [])
    .slice(-maxTurns)
    .map(item => ({
      role: item?.role === 'customer' ? 'customer' : 'operator',
      text: text(item?.text, maxChars)
    }))
    .filter(item => item.text);
}

export function compactRuntimeProbe(probe = {}) {
  const source = probe && typeof probe === 'object' && !Array.isArray(probe) ? probe : {};
  return {
    language: text(source.language || 'other', 20),
    whatUserWants: text(source.whatUserWants, 500),
    latestMessageMeans: text(source.latestMessageMeans, 520),
    refersTo: text(source.refersTo, 320),
    underlyingGoal: text(source.underlyingGoal, 320),
    unresolvedRequests: list(source.unresolvedRequests, 5, 320),
    ambiguities: list(source.ambiguities, 4, 240),
    liveDataNeed: text(source.liveDataNeed, 20),
    evidenceNeeds: objectList(source.evidenceNeeds, item => ({
      system: text(item?.system, 50),
      field: text(item?.field, 140),
      why: text(item?.why, 220)
    }), 5),
    requiredFacts: list(source.requiredFacts, 12, 140),
    knowledgeNeed: text(source.knowledgeNeed, 20),
    knowledgeReason: text(source.knowledgeReason, 260),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : 0
  };
}

function compactArticle(article = {}) {
  const id = text(article?.id, 100);
  const title = text(article?.title, 180);
  const summary = text(article?.summary, 420);
  const body = text(article?.text, 1000);
  if (!id && !title && !summary && !body) return null;
  return { id, title, summary, text: body };
}

export function compactRuntimeKnowledge(knowledge = {}) {
  const source = knowledge && typeof knowledge === 'object' && !Array.isArray(knowledge) ? knowledge : {};
  return {
    skipped: Boolean(source.skipped),
    skipReason: text(source.skipReason, 120),
    usedArticles: objectList(source.usedArticles, item => ({
      id: text(item?.id, 100),
      why: text(item?.why, 220)
    }), 4),
    articleEvidence: objectList(source.articleEvidence, compactArticle, 3),
    relevantInternalKnowledge: list(source.relevantInternalKnowledge, 6, 360),
    howItApplies: text(source.howItApplies, 520),
    alreadyEnough: list(source.alreadyEnough, 4, 260),
    mustNotAssume: list(source.mustNotAssume, 5, 280),
    knowledgeGaps: list(source.knowledgeGaps, 4, 260)
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
