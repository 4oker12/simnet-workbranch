'use strict';

import * as base from './semantic-tool-broker-impl-base.js';
import { normalizeCanonicalFacts } from './canonical-fact-catalog.js';
import { requiredFactsForDialogueTurn } from './dialogue-runtime-state.js';
import { financeRequiredFacts } from './finance-decision-nodes.js';

export * from './semantic-tool-broker-impl-base.js';

function latestCustomerText(transcript = []) {
  const turn = [...(Array.isArray(transcript) ? transcript : [])].reverse().find(item => item?.role === 'customer' && String(item?.text || '').trim());
  return String(turn?.text || '').trim();
}

export function augmentRequiredFactsForTurn({ analysis = {}, transcript = [], requestText = '', labState = {} } = {}) {
  const currentText = String(requestText || latestCustomerText(transcript) || '').trim();
  const semanticFacts = analysis?.probe?.requiredFacts || analysis?.probe?.required_facts || [];
  const dialogueFacts = requiredFactsForDialogueTurn({ analysis, requestText: currentText, labState });
  const deterministicFinanceFacts = financeRequiredFacts(currentText);
  return normalizeCanonicalFacts([...semanticFacts, ...dialogueFacts, ...deterministicFinanceFacts]);
}

export async function groundSubscriberReply(options = {}) {
  const analysis = options?.analysis && typeof options.analysis === 'object' ? options.analysis : {};
  const requiredFacts = augmentRequiredFactsForTurn({
    analysis,
    transcript: options?.transcript || [],
    requestText: options?.latestCustomer?.text || '',
    labState: options?.labState || {}
  });
  const nextAnalysis = {
    ...analysis,
    probe: {
      ...(analysis?.probe || {}),
      requiredFacts
    }
  };
  return base.groundSubscriberReply({ ...options, analysis: nextAnalysis });
}
