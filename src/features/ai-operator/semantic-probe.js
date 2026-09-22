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
  compactRuntimeTranscript,
  projectRuntimeConversationContext
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
    title: text(article?.title, 160),
    summary: text(article?.summary, 320),
    // Keep in sync with runtime-projection compactArticle (≤900).
    text: text(article?.text, 900)
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
  const conversationContext = projectRuntimeConversationContext(options?.transcript, {
    maxActiveTurns: 18,
    maxGeneralTurns: 16
  });
  const compactTranscript = compactRuntimeTranscript(options?.transcript, { maxTurns: 10, maxChars: 420 });
  const semanticOnly = await base.analyzeSubscriberIntent({
    ...options,
    transcript: compactTranscript,
    knowledgeMode: 'off'
  });
  const semanticWithContext = {
    ...semanticOnly,
    conversationContext,
    decision: {
      ...(semanticOnly?.decision || {}),
      diagnostic: {
        ...(semanticOnly?.decision?.diagnostic || {}),
        conversationContext
      }
    }
  };

  const shouldRetrieve = requestedMode === 'on'
    || (requestedMode === 'auto' && base.shouldReadKnowledge(semanticWithContext?.probe || {}));
  if (!shouldRetrieve) {
    return {
      ...semanticWithContext,
      knowledgeMode: requestedMode,
      decision: {
        ...(semanticWithContext?.decision || {}),
        reason: `Свободное понимание обращения; knowledge retrieval пропущен (${requestedMode}).`,
        diagnostic: {
          ...(semanticWithContext?.decision?.diagnostic || {}),
          knowledgeGate: {
            mode: requestedMode,
            need: semanticWithContext?.probe?.knowledgeNeed || '',
            reason: semanticWithContext?.probe?.knowledgeReason || '',
            skipped: true,
            strategy: 'direct_retrieval'
          }
        }
      }
    };
  }

  const query = knowledgeQueryFromUnderstanding({ probe: semanticWithContext?.probe || {}, latestCustomer: options?.latestCustomer || {} });
  const candidateArticles = searchKnowledgeLibrary(query, { limit: 3, minScore: 4 });
  const knowledge = directKnowledge(semanticWithContext?.probe || {}, candidateArticles, requestedMode);
  const candidates = candidateArticles.map(({ id, title, summary, score }) => ({ id, title, summary, score }));
  const ids = candidates.map(item => item.id).filter(Boolean);

  return {
    ...semanticWithContext,
    knowledge,
    knowledgeMode: requestedMode,
    candidates,
    decision: {
      ...(semanticWithContext?.decision || {}),
      action: 'semantic_direct_knowledge_retrieval',
      reply: [
        semanticWithContext?.probe?.whatUserWants ? `1. Что хочет абонент: ${semanticWithContext.probe.whatUserWants}` : '',
        semanticWithContext?.probe?.latestMessageMeans ? `2. Смысл последней реплики: ${semanticWithContext.probe.latestMessageMeans}` : '',
        ids.length ? `3. KB candidates: ${ids.join(', ')}` : '3. KB: релевантных статей не найдено.'
      ].filter(Boolean).join('\n'),
      reason: ids.length
        ? `Semantic understanding → deterministic ${SIMNET_KNOWLEDGE_VERSION} retrieval → final synthesis. Отдельный LLM knowledge-reflection этап не запускается.`
        : `Semantic understanding → deterministic ${SIMNET_KNOWLEDGE_VERSION} retrieval; релевантных статей не найдено.`,
      diagnostic: {
        ...(semanticWithContext?.decision?.diagnostic || {}),
        knowledgeGate: {
          mode: requestedMode,
          need: semanticWithContext?.probe?.knowledgeNeed || '',
          reason: semanticWithContext?.probe?.knowledgeReason || '',
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
    transcript: compactRuntimeTranscript(options?.transcript, { maxTurns: 8, maxChars: 380 }),
    analysis: compactRuntimeAnalysis(options?.analysis),
    capabilities: compactRuntimeCapabilities(options?.capabilities)
  });
}

export async function generateCleanModelReply(options = {}) {
  return base.generateCleanModelReply({
    ...options,
    transcript: compactRuntimeTranscript(options?.transcript, { maxTurns: 8, maxChars: 380 })
  });
}
