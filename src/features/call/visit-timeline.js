'use strict';

/**
 * Lightweight operator visit timeline for call↔subscriber correlation.
 * Records only significant subscriber page transitions (UserSide / Billing).
 */

export const TIMELINE_RETENTION_MS = 48 * 60 * 60 * 1000;
export const DEDUPE_WINDOW_MS = 2000;

const SIGNIFICANT_KINDS = new Set([
  'userside_customer',
  'billing_user',
  'billing_technical',
  'billing_onu_poll',
  'billing_juniper'
]);

export function isSignificantPageKind(pageKind = '') {
  return SIGNIFICANT_KINDS.has(String(pageKind || ''));
}

export function sourceOfPageKind(pageKind = '') {
  const kind = String(pageKind || '');
  if (kind.startsWith('userside_')) return 'userside';
  if (kind.startsWith('billing_') || kind.startsWith('looknet-')) return 'billing';
  return '';
}

export function subscriberKeyFromContext(context = {}) {
  const kind = String(context.pageKind || '');
  const entityId = String(context.entityId || '').trim();
  const customerId = String(
    context.identity?.customerId?.value
    ?? context.identity?.customerId
    ?? ''
  ).replace(/\D+/g, '');
  const contract = String(
    context.identity?.contract?.value
    ?? context.identity?.contract
    ?? context.identity?.login?.value
    ?? context.identity?.login
    ?? ''
  ).replace(/^abon/i, '').replace(/\D+/g, '');
  const billingId = String(
    context.identity?.billingId?.value
    ?? context.identity?.billingId
    ?? ''
  ).replace(/\D+/g, '');

  if (kind === 'userside_customer' && (entityId || customerId)) {
    return {
      source: 'userside',
      subscriberId: entityId || customerId,
      contractId: contract || '',
      pageType: kind
    };
  }
  if (
    (kind === 'billing_user' || kind === 'billing_technical'
      || kind === 'billing_onu_poll' || kind === 'billing_juniper')
    && (entityId || billingId || contract)
  ) {
    return {
      source: 'billing',
      subscriberId: entityId || billingId || contract,
      contractId: contract || entityId || billingId || '',
      pageType: kind
    };
  }
  return null;
}

/**
 * @returns {{ visits: Array, added: boolean }}
 */
export function appendVisit(timeline = { visits: [] }, visit = {}, atMs = Date.now()) {
  const visits = Array.isArray(timeline.visits) ? [...timeline.visits] : [];
  const source = String(visit.source || '');
  const subscriberId = String(visit.subscriberId || '').trim();
  const pageType = String(visit.pageType || '');
  if (!source || !subscriberId || !pageType) {
    return { visits, added: false };
  }

  const entry = {
    ts: Number.isFinite(visit.ts) ? visit.ts : atMs,
    source,
    subscriberId,
    contractId: String(visit.contractId || ''),
    pageType,
    url: String(visit.url || '').slice(0, 240),
    tabId: visit.tabId == null ? null : Number(visit.tabId),
    caseId: String(visit.caseId || ''),
    handoff: visit.handoff && typeof visit.handoff === 'object' ? {
      purpose: String(visit.handoff.purpose || '').slice(0, 80),
      token: String(visit.handoff.token || '').slice(0, 100)
    } : null
  };

  const last = visits[visits.length - 1];
  if (
    last
    && last.source === entry.source
    && last.subscriberId === entry.subscriberId
    && last.pageType === entry.pageType
    && Math.abs(entry.ts - last.ts) <= DEDUPE_WINDOW_MS
  ) {
    // Event ledger semantics: duplicate document/page events must not move the
    // original timestamp forward. This keeps call-window evidence stable and
    // avoids storage churn from reload+pageshow pairs.
    return { visits: pruneTimeline(visits, atMs), added: false };
  }

  visits.push(entry);
  return { visits: pruneTimeline(visits, atMs), added: true };
}

export function pruneTimeline(visits = [], atMs = Date.now()) {
  const cutoff = atMs - TIMELINE_RETENTION_MS;
  return (Array.isArray(visits) ? visits : [])
    .filter(v => Number(v?.ts || 0) >= cutoff)
    .slice(-600);
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

export function callTimeBounds(call = {}) {
  const durationSec = Math.max(0, Number(call.durationSeconds || 0));
  const anchorMs = Number(call.startedAtMs || 0) || (() => {
    const d = String(call.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = String(call.time || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!d || !t) return 0;
    return new Date(
      Number(d[1]), Number(d[2]) - 1, Number(d[3]),
      Number(t[1]), Number(t[2]), Number(t[3] || 0)
    ).getTime();
  })();
  if (!anchorMs || !Number.isFinite(anchorMs)) {
    return { callStartMs: 0, callEndMs: 0, durationSec: 0, semantics: '' };
  }
  const semantics = String(call.timeSemantics || '').toLowerCase()
    || (String(call.source || '').includes('userside:call_list') ? 'start' : 'end');
  const callStartMs = semantics === 'start'
    ? anchorMs
    : Math.max(0, anchorMs - durationSec * 1000);
  let callEndMs = semantics === 'start'
    ? anchorMs + durationSec * 1000
    : anchorMs;
  // Fresh UserSide call_list rows can represent the call that is still in
  // progress: DATEADD is already known, while duration/recording are not yet
  // written. The refresher stamps liveUntilMs at observation time so the
  // correlation window can still cover operator activity up to that moment.
  if (semantics === 'start' && durationSec <= 0 && call.ongoing === true) {
    const liveUntilMs = Number(call.liveUntilMs || 0) || Date.parse(String(call.observedAt || '')) || 0;
    if (liveUntilMs > anchorMs) callEndMs = liveUntilMs;
  }
  return { callStartMs, callEndMs, durationSec, semantics };
}

function searchTargetId(item = {}) {
  return digits(item.targetSubscriberId || item.targetCustomerId || '');
}

function linkedSubmitForResult(result = {}, allSearches = [], callStartMs = 0, callEndMs = 0) {
  const searchId = String(result.searchId || '');
  const parentSearchTs = Number(result.parentSearchTs || 0);
  const source = String(result.source || '');
  const tabId = result.tabId == null ? null : Number(result.tabId);
  const candidates = (Array.isArray(allSearches) ? allSearches : []).filter(item => {
    const ts = Number(item?.ts || 0);
    if (!['submit', 'query'].includes(String(item?.kind || ''))) return false;
    if (String(item?.source || '') !== source) return false;
    if (ts < callStartMs || ts > callEndMs) return false;
    if (tabId != null && item?.tabId != null && Number(item.tabId) !== tabId) return false;
    if (searchId && String(item?.searchId || '') === searchId) return true;
    if (parentSearchTs && Math.abs(ts - parentSearchTs) <= 1500) return true;
    return ts <= Number(result.ts || 0) && Number(result.ts || 0) - ts <= 3 * 60 * 1000;
  });
  return candidates.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))[0] || null;
}

/**
 * Explain whether the operator deliberately searched for the CURRENT subscriber
 * during this completed call. Search submit must happen inside the call window;
 * a result click/card open may finish shortly after hangup.
 */
export function analyzeCallSearchForCase(call = {}, visits = [], searches = [], identity = {}, options = {}) {
  const { callStartMs, callEndMs } = callTimeBounds(call);
  const graceMs = Math.max(0, Number(options.postWindowMs ?? 15000));
  const empty = {
    status: 'none',
    confirmed: false,
    attempted: false,
    source: '',
    searchKind: '',
    query: '',
    attempts: 0,
    targetSubscriberId: '',
    resultOpened: false,
    resultResolved: false,
    cardConfirmed: false,
    callStartMs,
    callEndMs
  };
  if (!callStartMs || !callEndMs) return empty;

  const customerId = digits(identity.customerId);
  const billingId = digits(identity.billingId);
  const contractId = digits(identity.contractId || identity.contract || identity.login);
  const allSearches = Array.isArray(searches) ? searches : [];
  const inCallSubmits = allSearches.filter(item => {
    const ts = Number(item?.ts || 0);
    return ['submit', 'query'].includes(String(item?.kind || ''))
      && ts >= callStartMs
      && ts <= callEndMs;
  });
  const resultOpens = allSearches.filter(item => {
    const ts = Number(item?.ts || 0);
    return ['result-open', 'resolved'].includes(String(item?.kind || ''))
      && ts >= callStartMs
      && ts <= callEndMs + graceMs;
  });

  const targetMatchesCase = item => {
    const target = searchTargetId(item);
    if (!target) return false;
    if (String(item?.source || '') === 'userside') return Boolean(customerId && target === customerId);
    if (String(item?.source || '') === 'billing') return Boolean(billingId && target === billingId);
    return false;
  };
  const visitMatchesCase = visit => {
    const source = String(visit?.source || '');
    const subscriberId = digits(visit?.subscriberId);
    const visitContract = digits(visit?.contractId);
    if (contractId && visitContract && visitContract === contractId) return true;
    if (source === 'userside' && customerId && subscriberId === customerId) return true;
    if (source === 'billing' && billingId && subscriberId === billingId) return true;
    return false;
  };
  const caseVisits = (Array.isArray(visits) ? visits : []).filter(visit => {
    const ts = Number(visit?.ts || 0);
    return ts >= callStartMs && ts <= callEndMs + graceMs && visitMatchesCase(visit);
  });

  const exact = [...resultOpens].reverse().find(item => {
    if (!targetMatchesCase(item)) return false;
    // Billing chain is deliberately strict: SUBMIT -> INFO -> CARD.
    // UserSide result-open can come from native autocomplete without a form submit.
    if (String(item?.source || '') === 'billing') {
      return Boolean(linkedSubmitForResult(item, allSearches, callStartMs, callEndMs));
    }
    return true;
  }) || null;

  if (exact) {
    const parent = linkedSubmitForResult(exact, allSearches, callStartMs, callEndMs);
    const source = String(exact.source || '');
    const targetId = searchTargetId(exact);
    const resolutionOnly = String(exact.kind || '') === 'resolved';
    const cardConfirmed = caseVisits.some(visit => (
      String(visit?.source || '') === source
      && Number(visit?.ts || 0) >= Number(exact.ts || 0) - 1000
      && Number(visit?.ts || 0) <= Number(exact.ts || 0) + 15000
    ));
    const exactSearchKind = String(exact.searchKind || parent?.searchKind || 'generic');
    const attempts = inCallSubmits.filter(item => (
      String(item?.source || '') === source
      && (exactSearchKind === 'generic' || String(item?.searchKind || 'generic') === exactSearchKind)
    )).length;
    return {
      ...empty,
      status: cardConfirmed ? 'confirmed' : (resolutionOnly ? 'resolved' : 'result-opened'),
      confirmed: cardConfirmed,
      attempted: true,
      source,
      searchKind: exactSearchKind,
      query: String(exact.query || parent?.query || '').slice(0, 180),
      attempts: Math.max(1, attempts),
      targetSubscriberId: targetId,
      resultOpened: !resolutionOnly,
      resultResolved: resolutionOnly,
      resolution: String(exact.resolution || ''),
      resultCount: Number(exact.resultCount || 0) || undefined,
      cardConfirmed,
      searchId: String(exact.searchId || parent?.searchId || ''),
      submittedAt: Number(parent?.ts || 0),
      resultOpenedAt: Number(exact.ts || 0)
    };
  }

  // Fallback for legacy/partial evidence: deliberate submit during the call,
  // followed by opening the current subscriber in the same source within 90 s.
  let fallback = null;
  for (const visit of [...caseVisits].sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))) {
    const submit = [...inCallSubmits].reverse().find(item => (
      String(item?.source || '') === String(visit?.source || '')
      && Number(item?.ts || 0) <= Number(visit?.ts || 0)
      && Number(visit?.ts || 0) - Number(item?.ts || 0) <= 90 * 1000
    ));
    if (submit) fallback = { submit, visit };
  }
  if (fallback) {
    const source = String(fallback.submit.source || '');
    return {
      ...empty,
      status: 'search-then-open',
      confirmed: false,
      attempted: true,
      source,
      searchKind: String(fallback.submit.searchKind || 'generic'),
      query: String(fallback.submit.query || '').slice(0, 180),
      attempts: Math.max(1, inCallSubmits.filter(item => (
        String(item?.source || '') === source
        && String(item?.searchKind || 'generic') === String(fallback.submit.searchKind || 'generic')
      )).length),
      resultOpened: false,
      cardConfirmed: true,
      submittedAt: Number(fallback.submit.ts || 0),
      cardOpenedAt: Number(fallback.visit.ts || 0)
    };
  }

  if (inCallSubmits.length) {
    const last = inCallSubmits[inCallSubmits.length - 1];
    return {
      ...empty,
      status: 'attempted',
      attempted: true,
      source: String(last.source || ''),
      searchKind: String(last.searchKind || 'generic'),
      query: String(last.query || '').slice(0, 180),
      attempts: inCallSubmits.length,
      submittedAt: Number(last.ts || 0)
    };
  }
  return empty;
}

/**
 * Score how strongly a PBX call correlates with a subscriber via timeline.
 *
 * UserSide call_list: DATEADD is START; legacy PBX list: timestamp is END.
 * The call payload carries timeSemantics so correlation uses the correct interval.
 */
export function scoreCallAgainstTimeline(call = {}, visits = [], options = {}) {
  const { callStartMs, callEndMs, durationSec } = callTimeBounds(call);
  if (!callStartMs || !callEndMs) {
    return { score: 0, reasons: ['no-call-time'], candidates: [], searchEvidence: null };
  }

  const preWindowMs = Number(options.preWindowMs ?? 15000);
  const postWindowMs = Number(options.postWindowMs ?? 15000);
  const firstNewBoostWindowMs = Number(options.firstNewWindowMs ?? 30000);
  const windowStart = callStartMs - preWindowMs;
  const windowEnd = callEndMs + postWindowMs;

  const relevant = (Array.isArray(visits) ? visits : []).filter(v => {
    const ts = Number(v.ts || 0);
    return ts >= windowStart && ts <= windowEnd;
  });
  const searches = (Array.isArray(options.searches) ? options.searches : []).filter(item => {
    const ts = Number(item?.ts || 0);
    return ts >= windowStart && ts <= windowEnd;
  });

  const logicalKey = visit => {
    const contractId = digits(visit?.contractId);
    return contractId ? `contract:${contractId}` : `${visit?.source || ''}:${visit?.subscriberId || ''}`;
  };

  /** @type {Map<string, any>} */
  const bySub = new Map();
  for (const v of relevant) {
    const key = logicalKey(v);
    let bucket = bySub.get(key);
    if (!bucket) {
      const contractId = digits(v.contractId);
      bucket = {
        subscriberId: contractId || String(v.subscriberId || ''),
        source: String(v.source || ''),
        contractId,
        score: 0,
        reasons: [],
        visits: [],
        aliases: new Set(),
        sources: new Set(),
        searchEvidence: null
      };
      bySub.set(key, bucket);
    }
    bucket.visits.push(v);
    bucket.sources.add(String(v.source || ''));
    if (v.subscriberId) bucket.aliases.add(String(v.subscriberId));
    if (v.contractId) bucket.aliases.add(digits(v.contractId) || String(v.contractId));
  }

  // A deliberate search may resolve one exact subscriber before the operator
  // opens its card (e.g. UserSide autocomplete returned exactly one customer).
  // Keep that as a soft candidate even without a page visit.
  for (const item of searches) {
    if (!['resolved', 'result-open'].includes(String(item?.kind || ''))) continue;
    const target = searchTargetId(item);
    if (!target) continue;
    const source = String(item?.source || '');
    const key = `${source}:${target}`;
    let bucket = [...bySub.values()].find(candidate => candidate.aliases?.has?.(target)) || bySub.get(key);
    if (!bucket) {
      bucket = {
        subscriberId: target,
        source,
        contractId: '',
        score: 0,
        reasons: [],
        visits: [],
        aliases: new Set([target]),
        sources: new Set(source ? [source] : []),
        searchEvidence: null
      };
      bySub.set(key, bucket);
    } else {
      bucket.aliases.add(target);
      if (source) bucket.sources.add(source);
    }
  }

  // Pre-call open logical subscribers (for penalty).
  const preOpen = new Set(
    (Array.isArray(visits) ? visits : [])
      .filter(v => {
        const ts = Number(v.ts || 0);
        return ts < callStartMs && ts >= callStartMs - 10 * 60 * 1000;
      })
      .map(logicalKey)
  );

  for (const [key, bucket] of bySub) {
    const sorted = [...bucket.visits].sort((a, b) => a.ts - b.ts);
    const firstInWindow = sorted[0] || null;
    const deltaFromStart = firstInWindow ? Number(firstInWindow.ts) - callStartMs : Number.POSITIVE_INFINITY;

    if (firstInWindow && deltaFromStart >= -2000 && deltaFromStart <= firstNewBoostWindowMs) {
      const wasOpenBefore = preOpen.has(key);
      if (!wasOpenBefore) {
        bucket.score += 100;
        bucket.reasons.push('first-new');
      } else {
        bucket.score += 25;
        bucket.reasons.push('already-open-then-return');
      }
    } else if (firstInWindow && deltaFromStart > firstNewBoostWindowMs && Number(firstInWindow.ts) <= callEndMs) {
      bucket.score += 40;
      bucket.reasons.push('mid-call-open');
    } else if (firstInWindow && deltaFromStart < -2000) {
      bucket.score -= 40;
      bucket.reasons.push('pre-call-open');
    }

    if (bucket.sources.has('userside') && bucket.sources.has('billing')) {
      bucket.score += 45;
      bucket.reasons.push('userside+billing');
    }

    if (sorted.length >= 2) {
      bucket.score += 30;
      bucket.reasons.push('repeat-visits');
    }
    if (sorted.length >= 3) {
      bucket.score += 15;
      bucket.reasons.push('heavy-focus');
    }

    if (firstInWindow && Number(firstInWindow.ts) > callStartMs + Math.max(firstNewBoostWindowMs, durationSec * 1000 * 0.7)) {
      bucket.score -= 20;
      bucket.reasons.push('late-only');
    }
    if (firstInWindow && preOpen.has(key) && deltaFromStart > 60000) {
      bucket.score -= 25;
      bucket.reasons.push('recent-revisit');
    }

    // Search is intent evidence. Billing is deliberately strict: its exact
    // result click counts only when linked to a SUBMIT that happened during the call.
    const firstVisitTs = firstInWindow ? Number(firstInWindow.ts || 0) : Number.POSITIVE_INFINITY;
    const allSearches = Array.isArray(options.searches) ? options.searches : [];
    const targeted = [...searches].reverse().find(item => {
      const target = searchTargetId(item);
      if (!target || !bucket.aliases.has(target)) return false;
      if (!['result-open', 'resolved'].includes(String(item?.kind || ''))) return false;
      if (firstInWindow && Number(item.ts || 0) > firstVisitTs + 5000) return false;
      if (String(item?.source || '') === 'billing') {
        return String(item?.kind || '') === 'result-open'
          && Boolean(linkedSubmitForResult(item, allSearches, callStartMs, callEndMs));
      }
      return true;
    });
    if (targeted) {
      const parent = linkedSubmitForResult(targeted, allSearches, callStartMs, callEndMs);
      const resolvedOnly = String(targeted.kind || '') === 'resolved';
      bucket.score += resolvedOnly ? 80 : 110;
      bucket.reasons.push(resolvedOnly ? 'search-unique-resolved' : 'search-result-opened');
      bucket.searchEvidence = {
        kind: String(targeted.kind || 'result-open'),
        source: String(targeted.source || ''),
        searchKind: String(targeted.searchKind || parent?.searchKind || 'generic'),
        query: String(targeted.query || parent?.query || '').slice(0, 180),
        ts: Number(targeted.ts || 0),
        targetSubscriberId: searchTargetId(targeted),
        targetCustomerId: String(targeted.source || '') === 'userside' ? searchTargetId(targeted) : '',
        searchId: String(targeted.searchId || parent?.searchId || ''),
        parentSearchTs: Number(parent?.ts || targeted.parentSearchTs || 0),
        resolution: String(targeted.resolution || ''),
        resultCount: Number(targeted.resultCount || 0) || undefined
      };
    } else if (firstInWindow) {
      const submitted = [...searches].reverse().find(item => {
        const ts = Number(item?.ts || 0);
        return ['submit', 'query'].includes(String(item?.kind || ''))
          && String(item?.source || '') === String(firstInWindow?.source || '')
          && ts >= callStartMs
          && ts <= callEndMs
          && ts <= firstVisitTs
          && firstVisitTs - ts <= 90 * 1000;
      });
      if (submitted) {
        bucket.score += 65;
        bucket.reasons.push('search-then-open');
        bucket.searchEvidence = {
          kind: 'submit',
          source: String(submitted.source || ''),
          searchKind: String(submitted.searchKind || 'generic'),
          query: String(submitted.query || '').slice(0, 180),
          ts: Number(submitted.ts || 0),
          targetSubscriberId: '',
          searchId: String(submitted.searchId || '')
        };
      }
    }
  }

  const callContract = digits(call.contract);
  const callCustomerId = digits(call.customerId);
  const callIp = String(call.subscriberIp || '');
  const callPhone = digits(call.callerId);

  for (const bucket of bySub.values()) {
    // A unique CUSTOMER in UserSide call_list is authoritative identity evidence,
    // but it strengthens only a subscriber that actually appeared in the call
    // activity window. It never creates a candidate out of thin air.
    if (callCustomerId && bucket.aliases.has(callCustomerId)) {
      bucket.score += 140;
      bucket.reasons.push('customer-match');
    }
    if (callContract && bucket.contractId && callContract === bucket.contractId) {
      bucket.score += 80;
      bucket.reasons.push('contract-match');
    }
    if (options.casePhone && callPhone && digits(options.casePhone) === callPhone) {
      bucket.score += 35;
      bucket.reasons.push('phone-match');
    }
    if (options.caseIp && callIp && options.caseIp === callIp) {
      bucket.score += 80;
      bucket.reasons.push('ip-match');
    }
  }

  const candidates = [...bySub.values()]
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(c => ({
      ...c,
      aliases: [...c.aliases],
      sources: [...c.sources]
    }));

  const best = candidates[0] || null;
  return {
    score: best ? best.score : 0,
    reasons: best ? best.reasons : [],
    bestSubscriberId: best?.subscriberId || '',
    bestSource: best?.source || '',
    searchEvidence: best?.searchEvidence || null,
    candidates: candidates.slice(0, 6),
    callStartMs,
    callEndMs
  };
}

/**
 * Map timeline score + classic match into a display level for UI highlighting.
 */
export function correlationLevel(score = 0, classicLevel = 'none') {
  if (score >= 90 || classicLevel === 'strong') return 'strong';
  if (score >= 50 || classicLevel === 'supporting') return 'secondary';
  if (score > 0) return 'weak';
  return 'none';
}
