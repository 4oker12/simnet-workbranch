'use strict';

import * as base from './semantic-tool-broker-impl-base.js';
import { normalizeCanonicalFacts } from './canonical-fact-catalog.js';
import { isConsumptionStartQuestion, requiredFactsForDialogueTurn } from './dialogue-runtime-state.js';
import { financeRequiredFacts } from './finance-decision-nodes.js';
import { canonicalEvidenceFallbackResult } from './semantic-tool-broker-core.js';

export * from './semantic-tool-broker-impl-base.js';

function latestCustomerText(transcript = []) {
  const turn = [...(Array.isArray(transcript) ? transcript : [])].reverse().find(item => item?.role === 'customer' && String(item?.text || '').trim());
  return String(turn?.text || '').trim();
}

function explicitCurrentAccountFacts({ analysis = {}, requestText = '' } = {}) {
  const probe = analysis?.probe || {};
  const context = [
    requestText,
    probe.whatUserWants,
    probe.latestMessageMeans,
    ...(Array.isArray(probe.unresolvedRequests) ? probe.unresolvedRequests : [])
  ].map(value => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();

  const facts = [];
  const asksBalance = /(?:баланс|на\s+сч[её]т|на\s+рахунк|остаток[^.!?]{0,30}(?:сч[её]т|рахунк))/iu.test(context);
  const asksTariff = /(?:тариф|пакет)/iu.test(context);
  const subscriberScoped = asksBalance || /(?:\bмой\b|\bмо[её]м\b|у\s+меня|сейчас|зараз|текущ|поточн|абонент|договор|договір|видит[^.!?]{0,35}оператор|бачить[^.!?]{0,35}оператор)/iu.test(context);

  if (asksBalance) facts.push('subscriber.finance.balance.account');
  if (asksTariff && subscriberScoped) {
    facts.push('subscriber.tariff.current.name', 'subscriber.tariff.current.price');
  }
  return normalizeCanonicalFacts(facts);
}

function removeUnsafeSubstitutions(facts = [], requestText = '') {
  const normalized = normalizeCanonicalFacts(facts);
  if (!isConsumptionStartQuestion(requestText)) return normalized;
  // Contract signing date is a different business fact. Until a dedicated
  // Billing-backed consumption-start canonical fact is verified, keep this
  // request unresolved rather than answering from subscriber.contract.date.
  return normalized.filter(path => path !== 'subscriber.contract.date');
}

export function augmentRequiredFactsForTurn({ analysis = {}, transcript = [], requestText = '', labState = {} } = {}) {
  const currentText = String(requestText || latestCustomerText(transcript) || '').trim();
  const semanticFacts = analysis?.probe?.requiredFacts || analysis?.probe?.required_facts || [];
  const dialogueFacts = requiredFactsForDialogueTurn({ analysis, requestText: currentText, labState });
  const deterministicFinanceFacts = financeRequiredFacts(currentText);
  const explicitAccountFacts = explicitCurrentAccountFacts({ analysis, requestText: currentText });
  return removeUnsafeSubstitutions([...semanticFacts, ...dialogueFacts, ...deterministicFinanceFacts, ...explicitAccountFacts], currentText);
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
