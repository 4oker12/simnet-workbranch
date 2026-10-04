'use strict';

import * as base from './semantic-tool-broker-impl-base.js';
import { normalizeCanonicalFacts } from './canonical-fact-catalog.js';
import { isConsumptionStartQuestion, requiredFactsForDialogueTurn } from './dialogue-runtime-state.js';
import { financeRequiredFacts } from './finance-decision-nodes.js';
import { canonicalEvidenceFallbackResult } from './semantic-tool-broker-core.js';
import { isAddressSpecificAvailabilityQuestion, isGeneralProductQuestion } from './dialogue-policy.js';

export * from './semantic-tool-broker-impl-base.js';

function latestCustomerText(transcript = []) {
  const turn = [...(Array.isArray(transcript) ? transcript : [])].reverse().find(item => item?.role === 'customer' && String(item?.text || '').trim());
  return String(turn?.text || '').trim();
}

function removeUnsafeSubstitutions(facts = [], requestText = '') {
  const normalized = normalizeCanonicalFacts(facts);
  if (!isConsumptionStartQuestion(requestText)) return normalized;
  // Contract signing date is a different business fact. Until a dedicated
  // Billing-backed consumption-start canonical fact is verified, keep this
  // request unresolved rather than answering from subscriber.contract.date.
  return normalized.filter(path => path !== 'subscriber.contract.date');
}

function hasKnownServiceAddress(labState = {}) {
  return Boolean(
    String(labState?.confirmedSubscriber?.address || '').trim()
    || String(labState?.domainContext?.activeServiceAddress?.fullAddress || '').trim()
    || String(labState?.domainContext?.activeBuildingAddress || '').trim()
  );
}

function addressContextSupportFacts(requestText = '', labState = {}) {
  if (!hasKnownServiceAddress(labState) || !isAddressSpecificAvailabilityQuestion(requestText)) return [];
  const request = String(requestText || '').toLowerCase();
  const facts = ['subscriber.serviceAddress.fullAddress'];
  if (/(?:gpon|epon|\bpon\b|оптик|технолог|волокн)/iu.test(request)) {
    facts.push('subscriber.access.connectionFamily');
  }
  if (/(?:гигабит|гігабіт|\b1000\b|скорост|швидк)/iu.test(request)) {
    facts.push('subscriber.tariff.current.speed');
  }
  return facts;
}

function removeIrrelevantBuildingFacts(facts = [], requestText = '') {
  const normalized = normalizeCanonicalFacts(facts);
  if (!isGeneralProductQuestion(requestText) || isAddressSpecificAvailabilityQuestion(requestText)) return normalized;
  // General tariff/payment/process questions do not become building-coverage questions
  // merely because this dialogue already has a service address.
  return normalized.filter(path => !path.startsWith('building.'));
}

export function augmentRequiredFactsForTurn({ analysis = {}, transcript = [], requestText = '', labState = {} } = {}) {
  const currentText = String(requestText || latestCustomerText(transcript) || '').trim();
  const semanticFacts = analysis?.probe?.requiredFacts || analysis?.probe?.required_facts || [];
  const dialogueFacts = requiredFactsForDialogueTurn({ analysis, requestText: currentText, labState });
  const deterministicFinanceFacts = financeRequiredFacts(currentText);
  const addressSupportFacts = addressContextSupportFacts(currentText, labState);
  const safeFacts = removeUnsafeSubstitutions(
    [...semanticFacts, ...dialogueFacts, ...deterministicFinanceFacts, ...addressSupportFacts],
    currentText
  );
  return removeIrrelevantBuildingFacts(safeFacts, currentText);
}

export async function groundSubscriberReply(options = {}) {
  const analysis = options?.analysis && typeof options.analysis === 'object' ? options.analysis : {};
  const requestText = String(options?.latestCustomer?.text || latestCustomerText(options?.transcript || []) || '').trim();
  const requiredFacts = augmentRequiredFactsForTurn({
    analysis,
    transcript: options?.transcript || [],
    requestText,
    labState: options?.labState || {}
  });
  const nextAnalysis = {
    ...analysis,
    probe: {
      ...(analysis?.probe || {}),
      requiredFacts
    }
  };

  const result = await base.groundSubscriberReply({ ...options, analysis: nextAnalysis });
  if (!result?.degraded || !requiredFacts.length || !Array.isArray(result?.factEvidence) || !result.factEvidence.length) return result;

  // semantic-tool-broker-impl-base still owns a legacy tool-trace fallback.
  // Reconstruct the canonical fallback here so its metadata/reply cannot be
  // overwritten while crossing that compatibility bridge.
  const fallback = canonicalEvidenceFallbackResult({
    requestText,
    factResolution: { requestedFacts: requiredFacts, evidence: result.factEvidence },
    language: nextAnalysis?.probe?.language || ''
  });
  if (!fallback.used) return result;

  return {
    ...result,
    reply: fallback.reply,
    evidenceFallback: fallback
  };
}
