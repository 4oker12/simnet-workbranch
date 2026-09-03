(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const POLL_ACTIONS = new Set(['310', '311', '312', '313']);
  const POLL_LABELS = Object.freeze({
    '310': 'BDCOM EPON',
    '311': 'BDCOM GPON',
    '312': 'GCOM',
    '313': 'Huawei'
  });
  const POLL_INTENT_TIMEOUT_MS = 12000;
  const POLL_STALE_TIMEOUT_MS = 30000;
  const POLL_LATE_RESPONSE_MAX_AGE_MS = 180000;
  const WARNING_MAX_SHOWS = 2;
  const WARNING_STORAGE_KEY = 'simnet_wb_guard_warning_counts_v1';
  const RECOVERABLE_POLL_TIMEOUT_REASONS = new Set([
    'poll-request-document-not-opened',
    'poll-attempt-stale',
    'poll-response-timeout'
  ]);

  // This module records native poll attempts for response correlation and emits
  // short warnings for proven Billing conflicts. Warnings are informational only:
  // Workbench never cancels the operator's native Billing poll click.
  const warningCounts = new Map();

  function storedWarningCounts() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(WARNING_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function warningCount(key) {
    if (warningCounts.has(key)) return Number(warningCounts.get(key) || 0);
    const stored = Number(storedWarningCounts()[key] || 0);
    warningCounts.set(key, stored);
    return stored;
  }

  function setWarningCount(key, count) {
    const next = Math.max(0, Number(count || 0));
    warningCounts.set(key, next);
    try {
      const stored = storedWarningCounts();
      stored[key] = next;
      sessionStorage.setItem(WARNING_STORAGE_KEY, JSON.stringify(stored));
    } catch {}
  }


  let pollIntentTimer = null;
  let pollResponseObserver = null;
  let pollResponseDebounceTimer = null;
  let pollResponseDeadlineTimer = null;
  let pollResponseSignature = '';
  let pollResponseRefreshRunning = false;
  const lifecycleController = typeof AbortController === 'function' ? new AbortController() : null;
  const listenerOptions = capture => lifecycleController
    ? { capture: Boolean(capture), signal: lifecycleController.signal }
    : Boolean(capture);
  let destroyed = false;

  function isDocumentReady() {
    return document.readyState === 'interactive' || document.readyState === 'complete';
  }

  function isUiReady() {
    return isDocumentReady();
  }

  function compactText(value, max = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }


  function pollSurfaceIdentity() {
    try {
      const url = new URL(location.href);
      return {
        action: String(url.searchParams.get('a') || ''),
        billingId: String(url.searchParams.get('id') || ''),
        oltIp: String(url.searchParams.get('olt_ip') || ''),
        explicitRequest: url.searchParams.get('act') === 'askolt'
      };
    } catch {
      return { action: '', billingId: '', oltIp: '', explicitRequest: false };
    }
  }

  function pollSurfaceMatchesAttempt(attempt) {
    if (!attempt?.pollAttemptId) return false;
    const surface = pollSurfaceIdentity();
    if (!POLL_ACTIONS.has(surface.action)) return false;
    if (attempt.action && surface.action !== String(attempt.action)) return false;
    if (attempt.billingId && surface.billingId && surface.billingId !== String(attempt.billingId)) return false;
    if (attempt.oltIp && surface.oltIp && surface.oltIp !== String(attempt.oltIp)) return false;
    return true;
  }

  function pollResponseWatchRoot(attempt = null) {
    if (!document.body) return null;
    const action = String(attempt?.action || pollSurfaceIdentity().action || '');
    const billingId = String(attempt?.billingId || pollSurfaceIdentity().billingId || '');
    const links = [...document.querySelectorAll('a[href*="stat.pl"]')];
    const requestLink = links.find(link => {
      try {
        const url = new URL(link.href, location.href);
        return url.searchParams.get('act') === 'askolt'
          && (!action || url.searchParams.get('a') === action)
          && (!billingId || url.searchParams.get('id') === billingId);
      } catch {
        return false;
      }
    }) || null;

    // The native poll result is rendered beside the poll table/form. Observe
    // that bounded surface, not the whole application document. Body is only a
    // last-resort fallback for older Billing markup that has no enclosing form.
    return requestLink?.closest?.('form')
      || requestLink?.closest?.('table')?.parentElement
      || document.querySelector('form[action*="stat.pl"]')
      || document.querySelector('main,#content,.content')
      || document.body;
  }

  function currentPollDomSignature(root = document.body) {
    const bodyText = String(root?.innerText || root?.textContent || '');
    return `${bodyText.length}|${bodyText.slice(0, 700)}|${bodyText.slice(-5200)}`;
  }

  function stopPollResponseWatch() {
    try { pollResponseObserver?.disconnect?.(); } catch {}
    pollResponseObserver = null;
    clearTimeout(pollResponseDebounceTimer);
    clearTimeout(pollResponseDeadlineTimer);
    pollResponseDebounceTimer = null;
    pollResponseDeadlineTimer = null;
    pollResponseSignature = '';
    pollResponseRefreshRunning = false;
  }

  function refreshPollResponseFromDom(reason = 'poll-response-dom') {
    clearTimeout(pollResponseDebounceTimer);
    pollResponseDebounceTimer = setTimeout(async () => {
      pollResponseDebounceTimer = null;
      const attempt = recentPollRequest({ expire: false });
      if (!attempt?.pollAttemptId || attempt.pending === false || !pollSurfaceMatchesAttempt(attempt)) {
        stopPollResponseWatch();
        return;
      }
      const signature = currentPollDomSignature(pollResponseWatchRoot(attempt));
      if (signature === pollResponseSignature || pollResponseRefreshRunning) return;
      pollResponseSignature = signature;
      pollResponseRefreshRunning = true;
      try {
        await WB.runtime?.refreshCurrentPage?.(reason);
      } finally {
        pollResponseRefreshRunning = false;
        const latest = recentPollRequest({ expire: false });
        if (!latest?.pollAttemptId || latest.pollAttemptId !== attempt.pollAttemptId || latest.pending === false) {
          stopPollResponseWatch();
        }
      }
    }, 110);
  }

  function startPollResponseWatch(attempt = recentPollRequest({ expire: false })) {
    stopPollResponseWatch();
    if (!attempt?.pollAttemptId || attempt.pending === false || !document.body || !pollSurfaceMatchesAttempt(attempt)) {
      return false;
    }

    const watchRoot = pollResponseWatchRoot(attempt);
    if (!watchRoot) return false;
    pollResponseSignature = currentPollDomSignature(watchRoot);
    // Billing may paint the OLT answer into the same document via native AJAX.
    // This observer exists only for the active request, is scoped to the native
    // poll surface and disconnects on terminal evidence/navigation/timeout.
    pollResponseObserver = new MutationObserver(() => refreshPollResponseFromDom());
    pollResponseObserver.observe(watchRoot, { childList: true, subtree: true, characterData: true });

    const startedAt = Number(attempt.startedAt || Date.now());
    const remainingMs = Math.max(0, POLL_STALE_TIMEOUT_MS - (Date.now() - startedAt));
    pollResponseDeadlineTimer = setTimeout(() => {
      const latest = recentPollRequest({ expire: false });
      if (latest?.pollAttemptId === attempt.pollAttemptId && latest.pending !== false) {
        finishPollAttempt(latest, 'timeout', 'poll-response-timeout');
      } else {
        stopPollResponseWatch();
      }
    }, Math.max(50, remainingMs + 20));
    return true;
  }

  function resumePollResponseWatch() {
    const attempt = recentPollRequest();
    if (!attempt?.pollAttemptId || attempt.pending === false) return false;
    return startPollResponseWatch(attempt);
  }

  function pollRequestFromAnchor(anchor) {
    if (!(anchor instanceof Element)) return null;
    const link = anchor.closest?.('a[href]');
    if (!link) return null;
    let url = null;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin || !/\/stat\.pl$/i.test(url.pathname)) return null;
    const action = String(url.searchParams.get('a') || '');
    const act = String(url.searchParams.get('act') || '');
    if (!POLL_ACTIONS.has(action) || act !== 'askolt') return null;
    const billingId = String(url.searchParams.get('id') || '');
    const oltIp = String(url.searchParams.get('olt_ip') || '');
    return {
      link,
      url,
      action,
      billingId,
      oltIp,
      key: `${billingId}|${action}|${oltIp}|${url.pathname}`
    };
  }

  function factValue(raw) {
    return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
  }

  function pollActionFromKnownOlt({ oltName = '', interfaceName = '' } = {}) {
    const name = String(oltName || '');
    const iface = String(interfaceName || '');
    if (/\bhuawei\b/i.test(name)) return '313';
    if (/\bg[\s_-]*com\b/i.test(name)) return '312';
    if (/\bepon(?=\d|[\s/_:-]|$)/i.test(iface) || /\bepon\b/i.test(name) || /bdcom\s+olt\s+p36/i.test(name)) return '310';
    if (/\bgpon(?=\d|[\s/_:-]|$)/i.test(iface) || /\bgpon\b/i.test(name)) return '311';
    return '';
  }

  function pollBindingVerdict(info) {
    const caseData = WB.store?.activeCase?.() || null;
    if (!caseData) return { ok: true, verified: false };

    const caseId = String(caseData.id || WB.store?.localCaseId || '');
    if (!caseId) return { ok: true, verified: false };

    const expectedBillingId = String(factValue(caseData.identity?.billingId) || '');
    const billingAction = String(caseData?.diagnostic?.pollAction || '');
    const billingOltIp = String(factValue(caseData.pon?.oltIp) || '');
    const billingTechnicalComplete = caseData?.diagnostic?.billingTechnicalComplete === true;

    const tmcOltName = String(factValue(caseData.pon?.tmcOltName) || '');
    const tmcOltIp = String(factValue(caseData.pon?.tmcOltIp) || '');
    const tmcInterface = String(factValue(caseData.pon?.tmcPort) || '');
    const tmcAction = pollActionFromKnownOlt({ oltName: tmcOltName, interfaceName: tmcInterface });
    const tmcKnown = Boolean(tmcOltIp || tmcAction);

    // For the narrow interaction warning, a TMC binding already matched to this
    // Case is the useful "known head" reference. This does NOT make TMC
    // authoritative for workflow/poll readiness: Billing remains the save gate.
    const expectedSource = tmcKnown ? 'tmc' : (billingTechnicalComplete ? 'billing' : '');
    const expectedAction = tmcKnown ? tmcAction : billingAction;
    const expectedOltIp = tmcKnown ? tmcOltIp : billingOltIp;

    const base = {
      ok: true,
      verified: true,
      caseId,
      expectedSource,
      expectedBillingId,
      expectedAction,
      expectedTechnology: POLL_LABELS[expectedAction] || '',
      expectedOltIp,
      billingAction,
      billingOltIp,
      tmcAction,
      tmcOltIp,
      actualAction: String(info?.action || ''),
      actualTechnology: POLL_LABELS[String(info?.action || '')] || '',
      actualBillingId: String(info?.billingId || ''),
      actualOltIp: String(info?.oltIp || '')
    };

    if (expectedBillingId && expectedBillingId !== base.actualBillingId) {
      return { ...base, warning: 'poll-billing-mismatch' };
    }

    // If TMC knows the head, a manual poll that happens to land on that exact
    // head is allowed even when Billing still contains stale
    // data. The Billing↔TMC conflict remains visible in LIVE independently.
    if (expectedAction && expectedAction !== base.actualAction) {
      return { ...base, warning: 'poll-action-mismatch' };
    }
    if (expectedOltIp && base.actualOltIp && expectedOltIp !== base.actualOltIp) {
      return { ...base, warning: 'poll-olt-mismatch' };
    }

    return base;
  }

  function warningKey(verdict = {}) {
    return [
      verdict.caseId || '',
      verdict.warning || '',
      verdict.expectedBillingId || '',
      verdict.actualBillingId || '',
      verdict.expectedAction || '',
      verdict.actualAction || '',
      verdict.expectedOltIp || '',
      verdict.actualOltIp || ''
    ].join('|');
  }

  function emitWarning(event, verdict) {
    const reason = String(verdict?.warning || '');
    if (!reason) return false;
    const key = warningKey(verdict);
    const shown = warningCount(key);
    if (shown >= WARNING_MAX_SHOWS) return false;
    setWarningCount(key, shown + 1);

    const target = event?.target instanceof Element ? event.target : null;
    const details = {
      reason,
      caseId: String(verdict.caseId || ''),
      expectedSource: String(verdict.expectedSource || ''),
      expectedBillingId: String(verdict.expectedBillingId || ''),
      actualBillingId: String(verdict.actualBillingId || ''),
      expectedAction: String(verdict.expectedAction || ''),
      expectedTechnology: String(verdict.expectedTechnology || ''),
      actualAction: String(verdict.actualAction || ''),
      actualTechnology: String(verdict.actualTechnology || ''),
      expectedOltIp: String(verdict.expectedOltIp || ''),
      actualOltIp: String(verdict.actualOltIp || ''),
      showCount: shown + 1,
      maxShows: WARNING_MAX_SHOWS,
      target: target ? {
        tag: String(target.tagName || '').toLowerCase(),
        text: compactText(target.innerText || target.textContent || target.value || '', 180)
      } : null,
      url: location.href
    };

    WB.bus?.emit?.('guard:warning', details);
    // Keep a minimal audit trace. At most two identical warnings can be written
    // per document, so this cannot turn back into a noisy observer/log layer.
    void WB.store?.addEvent?.(
      'interaction_warning',
      `GUARD WARN · ${reason}`,
      details
    ).catch?.(() => {});
    return true;
  }

  function persistPollAttempt(attempt) {
    if (!attempt) return;
    WB.runtime.pollAttempt = attempt;
    try {
      sessionStorage.setItem('simnet_wb_poll_attempt_v1', JSON.stringify(attempt));
    } catch {}
  }

  function notifyPollAttempt(attempt) {
    const caseId = String(attempt?.caseId || '');
    if (!caseId || !attempt?.episodeId || !attempt?.pollAttemptId) return;
    const envelope = {
      eventId: globalThis.crypto?.randomUUID?.()
        || `poll_evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'POLL_ATTEMPT_UPDATE',
      occurredAt: new Date().toISOString(),
      caseId,
      episodeId: String(attempt.episodeId || ''),
      caseVersion: Number(attempt.caseVersion || 0),
      origin: {
        tabId: null,
        frameId: 0,
        documentId: String(WB.runtime?.documentId || attempt.documentId || ''),
        pageInstanceId: String(WB.runtime?.pageInstanceId || ''),
        pageInstanceStartedAt: Number(WB.runtime?.pageInstanceStartedAt || 0),
        system: 'billing',
        pageKind: 'billing_onu_poll',
        url: location.href
      },
      operation: {
        requestId: '',
        pollAttemptId: String(attempt.pollAttemptId || '')
      },
      identityFingerprint: String(attempt.identityFingerprint || ''),
      bindingFingerprint: String(attempt.bindingFingerprint || ''),
      payload: { stage: String(attempt.stage || '') }
    };
    void chrome.runtime.sendMessage({
      type: 'POLL_ATTEMPT_UPDATE',
      payload: { caseId, attempt, envelope }
    }).then(response => {
      if (!response?.success) throw new Error(response?.error || 'POLL_ATTEMPT_UPDATE rejected');
    }).catch(() => {});
  }

  function finishPollAttempt(attempt, outcome = 'timeout', reason = 'poll-intent-timeout') {
    if (!attempt?.pollAttemptId || attempt.pending === false) return attempt || null;
    const resolved = {
      ...attempt,
      status: outcome === 'timeout' ? 'timeout' : 'failed',
      stage: outcome === 'timeout' ? 'TIMEOUT' : 'FAILED',
      pending: false,
      outcome,
      failureReason: reason,
      resolvedAt: Date.now(),
      updatedAt: new Date().toISOString()
    };
    persistPollAttempt(resolved);
    stopPollResponseWatch();
    WB.bus?.emit?.('poll:attempt-resolved', resolved);
    notifyPollAttempt(resolved);
    return resolved;
  }

  function schedulePollIntentRecovery(attempt, event) {
    clearTimeout(pollIntentTimer);
    setTimeout(() => {
      const current = recentPollRequest({ expire: false });
      if (!current || current.pollAttemptId !== attempt.pollAttemptId || current.pending === false) return;
      // Another native/CRM handler may cancel its own navigation. Workbench never
      // cancels it, but should not keep a phantom pending poll in that case.
      if (event?.defaultPrevented) {
        finishPollAttempt(current, 'failed', 'native-navigation-cancelled');
        return;
      }
      const started = {
        ...current,
        stage: 'REQUEST_STARTED',
        status: 'pending',
        pending: true,
        updatedAt: new Date().toISOString()
      };
      persistPollAttempt(started);
      WB.bus?.emit?.('poll:attempt-started', started);
      notifyPollAttempt(started);
      startPollResponseWatch(started);
    }, 0);

    pollIntentTimer = setTimeout(() => {
      const current = recentPollRequest({ expire: false });
      if (!current || current.pollAttemptId !== attempt.pollAttemptId || current.pending === false) return;
      const params = new URLSearchParams(location.search);
      const requestDocument = params.get('act') === 'askolt'
        && params.get('a') === String(current.action || '')
        && params.get('id') === String(current.billingId || '');
      if (!requestDocument && !pollSurfaceMatchesAttempt(current)) {
        finishPollAttempt(current, 'timeout', 'poll-request-document-not-opened');
      }
      // Same-document Billing AJAX is valid: the operation-scoped response
      // watcher owns it until terminal evidence or the 30 s fallback deadline.
    }, POLL_INTENT_TIMEOUT_MS);
  }

  function preservePollAttemptForNativeNavigation() {
    const current = recentPollRequest({ expire: false });
    if (!current?.pollAttemptId || current.pending === false) return;
    clearTimeout(pollIntentTimer);
    pollIntentTimer = null;
    if (Number(current.navigationStartedAt || 0)) return;
    const advanced = {
      ...current,
      stage: current.stage === 'INTENT_RECORDED' ? 'REQUEST_STARTED' : current.stage,
      status: 'pending',
      pending: true,
      navigationStartedAt: Number(current.navigationStartedAt || Date.now()),
      updatedAt: new Date().toISOString()
    };
    persistPollAttempt(advanced);
    WB.bus?.emit?.('poll:attempt-started', advanced);
    notifyPollAttempt(advanced);
  }

  function rememberPollRequest(info, verdict = {}) {
    const pollAttemptId = globalThis.crypto?.randomUUID?.()
      || `poll_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const caseId = String(verdict?.caseId || WB.store?.localCaseId || '');
    const envelope = WB.store?.correlation?.(
      'POLL_ATTEMPT_UPDATE',
      { pollAttemptId },
      { caseId }
    ) || null;
    const payload = {
      attemptId: pollAttemptId,
      pollAttemptId,
      action: info.action,
      billingId: info.billingId,
      oltIp: info.oltIp,
      href: WB.billingNavigation?.redactUrl?.(info.url.href) || String(info.url.href || ''),
      startedAt: Date.now(),
      status: 'pending',
      stage: 'INTENT_RECORDED',
      pending: true,
      caseId,
      // Keep the canonical Billing expectation separate from what the operator
      // actually clicked. This lets the parser reject a wrong-tech response as
      // completion without preventing the native request itself.
      expectedAction: String(verdict?.expectedAction || ''),
      expectedOltIp: String(verdict?.expectedOltIp || ''),
      warningReason: String(verdict?.warning || ''),
      episodeId: String(envelope?.episodeId || ''),
      caseVersion: Number(envelope?.caseVersion || 0),
      identityFingerprint: String(envelope?.identityFingerprint || ''),
      bindingFingerprint: String(envelope?.bindingFingerprint || ''),
      documentId: String(WB.runtime?.documentId || '')
    };
    persistPollAttempt(payload);
    WB.bus?.emit?.('poll:attempt-started', payload);
    if (envelope?.caseId && envelope?.episodeId) {
      void chrome.runtime.sendMessage({
        type: 'POLL_ATTEMPT_UPDATE',
        payload: { caseId, attempt: payload, envelope }
      }).then(response => {
        if (!response?.success) throw new Error(response?.error || 'POLL_ATTEMPT_UPDATE rejected');
      }).catch(() => {});
    }
    return payload;
  }

  function recentPollRequest({ expire = true } = {}) {
    const activeCase = WB.store?.activeCase?.() || null;
    const stored = activeCase?.operations?.poll?.current || null;
    const runtime = WB.runtime?.pollAttempt;
    let attempt = runtime?.startedAt ? runtime : null;
    try {
      const parsed = JSON.parse(sessionStorage.getItem('simnet_wb_poll_attempt_v1') || 'null');
      if (!attempt?.startedAt && parsed?.startedAt) attempt = parsed;
    } catch {}

    // The durable Case wins over a stale content-script/session copy. This is
    // especially important after the background has confirmed/timed-out or
    // superseded an attempt while the poll page is still open.
    if (stored?.pollAttemptId && (
      !attempt?.pollAttemptId
      || String(stored.pollAttemptId) === String(attempt.pollAttemptId)
      || Number(stored.startedAt || 0) >= Number(attempt.startedAt || 0)
    )) {
      const storedTerminal = stored.pending === false
        || ['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(String(stored.stage || '').toUpperCase());
      const localTerminal = attempt?.pending === false
        || ['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(String(attempt?.stage || '').toUpperCase());
      if (!attempt || storedTerminal || !localTerminal) {
        attempt = stored;
        WB.runtime.pollAttempt = stored;
        try { sessionStorage.setItem('simnet_wb_poll_attempt_v1', JSON.stringify(stored)); } catch {}
        if (storedTerminal) stopPollResponseWatch();
      }
    }

    if (!attempt) return null;

    const currentCaseId = String(WB.store?.localCaseId || activeCase?.id || '');
    if (currentCaseId && String(attempt.caseId || '') !== currentCaseId) {
      if (WB.runtime?.pollAttempt === attempt) WB.runtime.pollAttempt = null;
      return null;
    }
    if (
      expire
      && attempt.pending !== false
      && Number(attempt.startedAt || 0)
      && Date.now() - Number(attempt.startedAt || 0) > POLL_STALE_TIMEOUT_MS
    ) {
      return finishPollAttempt(attempt, 'timeout', 'poll-attempt-stale');
    }
    return attempt;
  }

  function pollAttemptMatchesBinding(attempt, {
    action = '',
    billingId = '',
    oltIp = '',
    maxAgeMs = POLL_LATE_RESPONSE_MAX_AGE_MS
  } = {}) {
    if (!attempt?.pollAttemptId) return false;
    if (action && String(attempt.action || '') !== String(action)) return false;
    if (billingId && String(attempt.billingId || '') !== String(billingId)) return false;
    if (oltIp && attempt.oltIp && String(attempt.oltIp) !== String(oltIp)) return false;
    const ageMs = Date.now() - Number(attempt.startedAt || 0);
    return Boolean(
      Number(attempt.startedAt || 0)
      && ageMs >= 0
      && ageMs <= Number(maxAgeMs || POLL_LATE_RESPONSE_MAX_AGE_MS)
    );
  }

  function isRecoverableLatePollResponse({
    action = '',
    billingId = '',
    oltIp = '',
    maxAgeMs = POLL_LATE_RESPONSE_MAX_AGE_MS,
    responseEvidence = false
  } = {}) {
    if (!responseEvidence) return false;
    const params = new URLSearchParams(location.search);
    const surfaceAction = String(params.get('a') || '');
    if (params.get('act') !== 'askolt' && !POLL_ACTIONS.has(surfaceAction)) return false;
    if (action && surfaceAction !== String(action)) return false;
    if (billingId && params.get('id') && params.get('id') !== String(billingId)) return false;
    if (oltIp && params.get('olt_ip') && params.get('olt_ip') !== String(oltIp)) return false;
    const attempt = recentPollRequest({ expire: false });
    return Boolean(
      attempt
      && attempt.pending === false
      && String(attempt.stage || '') === 'TIMEOUT'
      && RECOVERABLE_POLL_TIMEOUT_REASONS.has(String(attempt.failureReason || ''))
      && pollAttemptMatchesBinding(attempt, { action, billingId, oltIp, maxAgeMs })
    );
  }

  function pollRequestMatches({
    action = '',
    billingId = '',
    oltIp = '',
    maxAgeMs = POLL_LATE_RESPONSE_MAX_AGE_MS,
    responseEvidence = false
  } = {}) {
    const currentParams = new URLSearchParams(location.search);
    const surfaceAction = String(currentParams.get('a') || '');
    if (currentParams.get('act') !== 'askolt' && !POLL_ACTIONS.has(surfaceAction)) return false;
    if (action && surfaceAction !== String(action)) return false;
    if (billingId && currentParams.get('id') && currentParams.get('id') !== String(billingId)) return false;
    if (oltIp && currentParams.get('olt_ip') && currentParams.get('olt_ip') !== String(oltIp)) return false;
    let attempt = recentPollRequest({ expire: false });
    if (!attempt || !pollAttemptMatchesBinding(attempt, { action, billingId, oltIp, maxAgeMs })) {
      return false;
    }
    if (attempt.pending === false) {
      const alreadyConfirmed = Boolean(
        responseEvidence
        && String(attempt.stage || '') === 'CONFIRMED'
        && String(attempt.outcome || '') === 'confirmed'
      );
      if (alreadyConfirmed) return true;
      if (!isRecoverableLatePollResponse({
        action,
        billingId,
        oltIp,
        maxAgeMs,
        responseEvidence
      })) return false;
      attempt = {
        ...attempt,
        lateResponseRecovery: true,
        lateResponseDetectedAt: Date.now(),
        responseDocumentId: String(WB.runtime?.documentId || '')
      };
      persistPollAttempt(attempt);
    }
    if (attempt.stage === 'INTENT_RECORDED') {
      const advanced = {
        ...attempt,
        stage: 'RESPONSE_DOCUMENT',
        status: 'pending',
        pending: true,
        responseDocumentId: String(WB.runtime?.documentId || '')
      };
      persistPollAttempt(advanced);
      WB.bus?.emit?.('poll:attempt-started', advanced);
      notifyPollAttempt(advanced);
    }
    return true;
  }

  function resolvePollRequest({ action = '', billingId = '', outcome = '' } = {}) {
    const attempt = recentPollRequest();
    if (!attempt) return false;
    if (action && String(attempt.action || '') !== String(action)) return false;
    if (billingId && String(attempt.billingId || '') !== String(billingId)) return false;
    const stage = outcome === 'confirmed'
      ? 'CONFIRMED'
      : outcome === 'timeout'
        ? 'TIMEOUT'
        : 'FAILED';
    const resolved = {
      ...attempt,
      status: stage === 'CONFIRMED' ? 'resolved' : stage === 'TIMEOUT' ? 'timeout' : 'failed',
      stage,
      pending: false,
      outcome: String(outcome || ''),
      resolvedAt: Date.now(),
      updatedAt: new Date().toISOString()
    };
    persistPollAttempt(resolved);
    stopPollResponseWatch();
    WB.bus?.emit?.('poll:attempt-resolved', resolved);
    // Terminal parser evidence is the authoritative end event. Persist it to the
    // Case immediately; LIVE timers are fallback presentation only.
    notifyPollAttempt(resolved);
    return true;
  }

  window.addEventListener('beforeunload', preservePollAttemptForNativeNavigation, listenerOptions(true));
  window.addEventListener('pagehide', preservePollAttemptForNativeNavigation, listenerOptions(true));

  document.addEventListener('click', event => {
    const info = pollRequestFromAnchor(event.target);
    if (!info) return;

    const verdict = pollBindingVerdict(info);
    if (verdict.warning) emitWarning(event, verdict);

    // Conflict is a fact/warning, never a click lock. Every native click is
    // allowed through and is remembered only for response correlation.
    WB.clickDebug?.mark?.(
      event,
      'interaction-guards',
      'allowed',
      verdict.warning ? `warning-only:${verdict.warning}` : 'poll-click-allowed',
      {
        expectedAction: verdict.expectedAction || '',
        actualAction: verdict.actualAction || info.action || '',
        expectedOltIp: verdict.expectedOltIp || '',
        actualOltIp: verdict.actualOltIp || info.oltIp || ''
      }
    );
    const attempt = rememberPollRequest(info, verdict);
    schedulePollIntentRecovery(attempt, event);
  }, listenerOptions(true));

  function destroy() {
    if (destroyed) return false;
    destroyed = true;
    clearTimeout(pollIntentTimer);
    pollIntentTimer = null;
    stopPollResponseWatch();
    warningCounts.clear();
    lifecycleController?.abort?.();
    return true;
  }

  WB.interactionGuards = {
    isDocumentReady,
    isUiReady,
    recentPollRequest,
    pollRequestMatches,
    isRecoverableLatePollResponse,
    resolvePollRequest,
    resumePollResponseWatch,
    pollRequestFromAnchor,
    pollBindingVerdict,
    finishPollAttempt,
    destroy,
    constants: {
      pollIntentTimeoutMs: POLL_INTENT_TIMEOUT_MS,
      pollStaleTimeoutMs: POLL_STALE_TIMEOUT_MS,
      warningMaxShows: WARNING_MAX_SHOWS
    }
  };
})();
