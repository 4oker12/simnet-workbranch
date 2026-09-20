'use strict';

import * as base from './semantic-probe-runtime-base.js';
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

export async function analyzeSubscriberIntent(options = {}) {
  return base.analyzeSubscriberIntent({
    ...options,
    transcript: compactRuntimeTranscript(options?.transcript, { maxTurns: 14, maxChars: 620 })
  });
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
