'use strict';

import { EVIDENCE_TYPES, SCORING_VERSION } from '../config.js';
import {
  compactEvidenceCopy,
  identityAliases,
  mergeCallIdentity,
  normalizeCallIdentity
} from '../evidence/normalizer.js';
import { confidenceFromScore } from './confidence.js';

function candidateSeed(identity = {}) {
  return {
    identity: normalizeCallIdentity(identity),
    aliases: new Set(identityAliases(identity)),
    rawScore: 0,
    reasons: [],
    evidence: [],
    sources: new Set(),
    authoritative: false,
    hardConflict: false
  };
}

function mergeBuckets(into, from) {
  into.identity = mergeCallIdentity(into.identity, from.identity);
  for (const alias of from.aliases) into.aliases.add(alias);
  for (const source of from.sources) into.sources.add(source);
  into.rawScore += from.rawScore;
  into.reasons.push(...from.reasons);
  into.evidence.push(...from.evidence);
  into.authoritative ||= from.authoritative;
  into.hardConflict ||= from.hardConflict;
  return into;
}

function addReason(bucket, score, reason) {
  bucket.rawScore += Number(score || 0);
  if (reason && !bucket.reasons.includes(reason)) bucket.reasons.push(reason);
}

function findOrCreateBucket(buckets, identity = {}) {
  const aliases = new Set(identityAliases(identity));
  let bucket = buckets.find(item => [...aliases].some(alias => item.aliases.has(alias))) || null;
  if (!bucket) {
    bucket = candidateSeed(identity);
    buckets.push(bucket);
  } else {
    bucket.identity = mergeCallIdentity(bucket.identity, identity);
    for (const alias of aliases) bucket.aliases.add(alias);
  }

  // New identity data can bridge two buckets that were previously separate.
  for (const other of [...buckets]) {
    if (other === bucket) continue;
    if ([...other.aliases].some(alias => bucket.aliases.has(alias))) {
      mergeBuckets(bucket, other);
      buckets.splice(buckets.indexOf(other), 1);
    }
  }
  return bucket;
}

function linkedSubmit(result = {}, events = [], callStartMs = 0, callEndMs = 0) {
  return [...events].reverse().find(item => {
    if (item.type !== EVIDENCE_TYPES.SEARCH_SUBMIT) return false;
    if (item.source !== result.source) return false;
    if (Number(item.ts || 0) < callStartMs || Number(item.ts || 0) > callEndMs) return false;
    if (result.tabId != null && item.tabId != null && Number(result.tabId) !== Number(item.tabId)) return false;
    if (result.searchId && item.searchId && result.searchId !== item.searchId) return false;
    if (result.parentSearchTs && Math.abs(Number(item.ts || 0) - Number(result.parentSearchTs || 0)) > 1500) return false;
    return Number(item.ts || 0) <= Number(result.ts || 0);
  }) || null;
}

function eventIdentity(event = {}) {
  const identity = normalizeCallIdentity(event.identity || {});
  if (event.source === 'userside' && !identity.customerId && event.targetSubscriberId) identity.customerId = String(event.targetSubscriberId);
  if (event.source === 'billing' && !identity.billingId && event.targetSubscriberId) identity.billingId = String(event.targetSubscriberId);
  return identity;
}

export function scoreSnapshotCandidates(call = {}, events = [], options = {}) {
  const windowStartMs = Number(options.windowStartMs || call.startedAtMs || 0);
  const callEndMs = Number(options.endedAtMs || call.endedAtMs || 0);
  const windowEndMs = Number(options.windowEndMs || callEndMs || 0);
  const selected = (Array.isArray(events) ? events : [])
    .filter(event => Number(event?.ts || 0) >= windowStartMs && Number(event?.ts || 0) <= windowEndMs)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  const buckets = [];

  for (const event of selected) {
    if (event.type === EVIDENCE_TYPES.SEARCH_SUBMIT) continue;
    const identity = eventIdentity(event);
    if (!identityAliases(identity).length) continue;
    const bucket = findOrCreateBucket(buckets, identity);
    bucket.sources.add(String(event.source || ''));
    bucket.evidence.push(compactEvidenceCopy(event));

    if (event.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT) {
      const delta = Number(event.ts || 0) - windowStartMs;
      if (bucket.evidence.filter(item => item.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT).length === 1) {
        if (delta <= 30_000) addReason(bucket, 100, 'first-new');
        else if (Number(event.ts || 0) <= callEndMs) addReason(bucket, 40, 'mid-call-open');
        else addReason(bucket, 20, 'post-call-open');
      } else if (bucket.evidence.filter(item => item.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT).length === 2) {
        addReason(bucket, 30, 'repeat-visits');
      } else if (bucket.evidence.filter(item => item.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT).length === 3) {
        addReason(bucket, 15, 'heavy-focus');
      }
      continue;
    }

    if (event.type === EVIDENCE_TYPES.SEARCH_RESOLVED) {
      const submit = linkedSubmit(event, selected, windowStartMs, callEndMs);
      if (submit) {
        addReason(bucket, 80, 'search-unique-resolved');
        bucket.evidence.push(compactEvidenceCopy(submit));
      }
      continue;
    }

    if (event.type === EVIDENCE_TYPES.SEARCH_RESULT_OPEN) {
      const submit = linkedSubmit(event, selected, windowStartMs, callEndMs);
      // Billing INFO must be causally linked. UserSide native result-open remains
      // valid on its own, but same-source submit/session strengthens provenance.
      if (event.source !== 'billing' || submit) {
        addReason(bucket, 110, 'search-result-opened');
        if (submit) bucket.evidence.push(compactEvidenceCopy(submit));
      }
      continue;
    }

    if (event.type === EVIDENCE_TYPES.HANDOFF) addReason(bucket, 55, 'handoff');
  }

  for (const bucket of buckets) {
    if (bucket.sources.has('userside') && bucket.sources.has('billing')) addReason(bucket, 45, 'userside+billing');
    const visits = bucket.evidence.filter(item => item.type === EVIDENCE_TYPES.SUBSCRIBER_VISIT);
    const submit = selected.find(event => (
      event.type === EVIDENCE_TYPES.SEARCH_SUBMIT
      && visits.some(visit => visit.source === event.source && Number(visit.ts || 0) >= Number(event.ts || 0))
      && visits.some(visit => Number(visit.ts || 0) - Number(event.ts || 0) <= 90_000)
    ));
    const alreadyTargeted = bucket.reasons.includes('search-result-opened') || bucket.reasons.includes('search-unique-resolved');
    if (submit && !alreadyTargeted) {
      addReason(bucket, 65, 'search-then-open');
      bucket.evidence.push(compactEvidenceCopy(submit));
    }
  }

  const authoritativeCustomerId = String(call.customerId || '').replace(/\D+/g, '');
  if (authoritativeCustomerId) {
    const identity = normalizeCallIdentity({
      customerId: authoritativeCustomerId,
      login: call.login || '',
      contract: call.contract || '',
      fullName: call.fio || ''
    });
    const bucket = findOrCreateBucket(buckets, identity);
    bucket.authoritative = true;
    addReason(bucket, 140, 'customer-match');
  }

  for (const bucket of buckets) {
    if (authoritativeCustomerId && bucket.identity.customerId && bucket.identity.customerId !== authoritativeCustomerId) {
      bucket.hardConflict = true;
      if (!bucket.reasons.includes('hard-customer-conflict')) bucket.reasons.push('hard-customer-conflict');
    }
  }

  return buckets
    .filter(bucket => bucket.rawScore > 0 || bucket.hardConflict)
    .map(bucket => {
      const dedupedEvidence = [];
      const seen = new Set();
      for (const event of bucket.evidence.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))) {
        const key = event.id || `${event.type}:${event.source}:${event.ts}:${event.searchId || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedupedEvidence.push(event);
      }
      return {
        identity: normalizeCallIdentity(bucket.identity),
        rawScore: Math.round(bucket.rawScore),
        confidence: confidenceFromScore(bucket.rawScore, {
          authoritative: bucket.authoritative && !bucket.hardConflict,
          hardConflict: bucket.hardConflict
        }),
        authoritative: bucket.authoritative,
        hardConflict: bucket.hardConflict,
        reasons: [...new Set(bucket.reasons)],
        evidenceRefs: dedupedEvidence.map(event => event.id).filter(Boolean),
        evidence: dedupedEvidence.slice(0, 32),
        scoringVersion: SCORING_VERSION
      };
    })
    .sort((a, b) => b.confidence - a.confidence || b.rawScore - a.rawScore)
    .slice(0, 12);
}
