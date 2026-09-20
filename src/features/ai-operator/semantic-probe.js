'use strict';

import * as base from './semantic-probe-runtime-base.js';
import {
  SIMNET_KNOWLEDGE_VERSION,
  knowledgeQueryFromUnderstanding,
  searchKnowledgeLibrary
} from './knowledge/index.js';
import {
  compactRuntimeAnalysis,
  compactRuntimeCapabilities,
  compactRuntimeTranscript
} from './runtime-projection.js';

export {
  AI_OPERATOR_GENERATION_MODEL_POOL,
  AI_OPERATOR_PROMPT_GUARD_MODEL,
  AI_OPERATOR_KNOWLEDGE_MODES,
  buildSubscriberIntentProbeMessages,
  buildKnowledgeReflectionMessages,
  shouldReadKnowledge
} from './semantic-probe-runtime-base.js';

function text(value, max = 600) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function knowledgeMode(value) {
  const mode = text(value || 'auto', 12).toLowerCase();
  return ['off', 'auto', 'on'].includes(mode) ? mode : 'auto';
}

function articleEvidence(article = {}) {
  return {
    id: text(article?.id, 100),
    title: text(article?.title, 180),
    summary: text(article?.summary, 420),
    text: text(article?.text, 1800)
  };
}

function directKnowledge(probe = {}, candidateArticles = [], mode = 'auto') {
  if (!candidateArticles.length) {
    return {
      skipped: true,
      skipReason: 'no_relevant_articles',
      usedArticles: [],
      articleEvidence: [],
      relevantInternalKnowledge: [],
      howItApplies: '',
      alreadyEnough: probe?.whatUserWants ? [probe.whatUserWants] : [],
      mustNotAssume: [],
      hypotheses: [],
      knowledgeGaps: []
    };
  }
  const selected = candidateArticles.slice(0, 3);
  return {
    skipped: false,
    skipReason: 'direct_retrieval',
    usedArticles: selected.map(article => ({
      id: text(article?.id, 100),
      why: 'Retrieved candidate for final semantic synthesis; use only if it directly answers the current request.'
    })),
    articleEvidence: selected.map(articleEvidence),
    relevantInternalKnowledge: selected.map(article => text(article?.summary, 420)).filter(Boolean),
    howItApplies: `Deterministic ${SIMNET_KNOWLEDGE_VERSION} retrieval (${mode}); final synthesis selects only evidence relevant to the authoritative semantic frame.`,
    alreadyEnough: [],
    mustNotAssume: [],
    hypotheses: [],
    knowledgeGaps: []
  };
}

export async function analyzeSubscriberIntent(options = {}) {
  const requestedMode = knowledgeMode(options?.knowledgeMode);
  const compactTranscript = compactRuntimeTranscript(options?.transcript, { maxTurns: 14, maxChars: 620 });
  const semanticOnly = await base.analyzeSubscriberIntent({
    ...options,
    transcript: compactTranscript,
    knowledgeMode: 'off'
  });

  const shouldRetrieve = requestedMode === 'on'
    || (requestedMode === 'auto' && base.shouldReadKnowledge(semanticOnly?.probe || {}));
  if (!shouldRetrieve) {
    return {
      ...semanticOnly,
      knowledgeMode: requestedMode,
      decision: {
        ...(semanticOnly?.decision || {}),
        reason: `Свободное понимание обращения; knowledge retrieval пропущен (${requestedMode}).`,
        diagnostic: {
          ...(semanticOnly?.decision?.diagnostic || {}),
          knowledgeGate: {
            mode: requestedMode,
            need: semanticOnly?.probe?.knowledgeNeed || '',
            reason: semanticOnly?.probe?.knowledgeReason || '',
            skipped: true,
            strategy: 'direct_retrieval'
          }
        }
      }
    };
  }

  const query = knowledgeQueryFromUnderstanding({ probe: semanticOnly?.probe || {}, latestCustomer: options?.latestCustomer || {} });
  const candidateArticles = searchKnowledgeLibrary(query, { limit: 3, minScore: 4 });
  const knowledge = directKnowledge(semanticOnly?.probe || {}, candidateArticles, requestedMode);
  const candidates = candidateArticles.map(({ id, title, summary, score }) => ({ id, title, summary, score }));
  const ids = candidates.map(item => item.id).filter(Boolean);

  return {
    ...semanticOnly,
    knowledge,
    knowledgeMode: requestedMode,
    candidates,
    decision: {
      ...(semanticOnly?.decision || {}),
      action: 'semantic_direct_knowledge_retrieval',
      reply: [
        semanticOnly?.probe?.whatUserWants ? `1. Что хочет абонент: ${semanticOnly.probe.whatUserWants}` : '',
        semanticOnly?.probe?.latestMessageMeans ? `2. Смысл последней реплики: ${semanticOnly.probe.latestMessageMeans}` : '',
        ids.length ? `3. KB candidates: ${ids.join(', ')}` : '3. KB: релевантных статей не найдено.'
      ].filter(Boolean).join('\n'),
      reason: ids.length
        ? `Semantic understanding → deterministic ${SIMNET_KNOWLEDGE_VERSION} retrieval → final synthesis. Отдельный LLM knowledge-reflection этап не запускается.`
        : `Semantic understanding → deterministic ${SIMNET_KNOWLEDGE_VERSION} retrieval; релевантных статей не найдено.`,
      diagnostic: {
        ...(semanticOnly?.decision?.diagnostic || {}),
        knowledgeGate: {
          mode: requestedMode,
          need: semanticOnly?.probe?.knowledgeNeed || '',
          reason: semanticOnly?.probe?.knowledgeReason || '',
          skipped: knowledge.skipped,
          strategy: 'direct_retrieval'
        },
        knowledge,
        candidates: candidates.map(({ id, title, score }) => ({ id, title, score }))
      }
    }
  };
}

export async function generateSubscriberReply(options = {}) {
  return base.generateSubscriberReply({
    ...options,
    transcript: compactRuntimeTranscript(options?.transcript, { maxTurns: 10, maxChars: 520 }),
    analysis: compactRuntimeAnalysis(options?.analysis),
    capabilities: compactRuntimeCapabilities(options?.capabilities)
  });
}

export async function generateCleanModelReply(options = {}) {
  return base.generateCleanModelReply({
    ...options,
    transcript: compactRuntimeTranscript(options?.transcript, { maxTurns: 10, maxChars: 520 })
  });
}
