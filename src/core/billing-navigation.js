(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.billingNavigation) return;

  const BILLING_HOSTS = new Set(['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua']);
  const SEMANTIC = Object.freeze({
    'billing.technical': { a: 'dopdata', pageKind: 'billing_technical', needsId: true, tmpl: '1', parent_type: '0' },
    'billing.user': { a: 'user', pageKind: 'billing_user', needsId: true },
    'billing.juniper': { a: '252', pageKind: 'billing_juniper', needsId: true, viaStat: true },
    'billing.poll.huawei': { a: '313', pageKind: 'billing_onu_poll', needsId: true, viaStat: true },
    'billing.poll.epon': { a: '310', pageKind: 'billing_onu_poll', needsId: true, viaStat: true },
    'billing.poll.gpon': { a: '311', pageKind: 'billing_onu_poll', needsId: true, viaStat: true },
    'billing.poll.gcom': { a: '312', pageKind: 'billing_onu_poll', needsId: true, viaStat: true }
  });

  const valueOf = fact =>
    fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;

  const compact = (value, max = 300) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function isBillingHost(hostname = location.hostname) {
    return BILLING_HOSTS.has(String(hostname || '').toLowerCase());
  }

  function redactUrl(raw) {
    try {
      return String(raw || '')
        .replace(/([?&](?:pp|password|passwd|pass|token|secret|_csrf|csrf|session|sessionid|sid|auth|authorization)=)[^&#\s]*/gi, '$1[redacted]');
    } catch {
      return '[redacted-url]';
    }
  }

  /**
   * Highest-priority auth page detector.
   * DOM evidence wins over URL route (a=dopdata must not override login form).
   */
  function isBillingAuthPage(doc = document) {
    if (!doc || !isBillingHost()) return false;
    try {
      const password = doc.querySelector?.('input[type="password"]');
      if (password && password.offsetParent !== null) return true;

      const forms = Array.from(doc.querySelectorAll?.('form') || []);
      for (const form of forms) {
        const hasPassword = form.querySelector?.('input[type="password"]');
        const action = String(form.getAttribute?.('action') || form.action || '').toLowerCase();
        const text = String(form.textContent || '').toLowerCase();
        if (hasPassword && (
          /enter|login|auth|passwd|password|вход|авториз/i.test(action)
          || /парол|login|password|войти|вход/i.test(text)
        )) {
          return true;
        }
      }

      // Classic Billing login markers
      const bodyText = String(doc.body?.innerText || '').slice(0, 2000).toLowerCase();
      if (
        doc.querySelector?.('input[type="password"]')
        && (/введите\s+пароль|login|авторизация|authentication/i.test(bodyText))
      ) {
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Resolve current Billing session from the live page only.
   * Never invents pp. Never reads UserSide location for pp.
   */
  function resolveSession() {
    if (!isBillingHost()) {
      return {
        ok: false,
        hasSession: false,
        ppPresent: false,
        source: 'non-billing-page',
        reason: 'BILLING_SESSION_NOT_CONFIRMED'
      };
    }

    if (isBillingAuthPage(document)) {
      return {
        ok: false,
        hasSession: false,
        ppPresent: false,
        source: 'auth-page',
        reason: 'BILLING_AUTH_PAGE_REACHED',
        pageKind: 'billing_login'
      };
    }

    let pp = '';
    let uu = '';
    try {
      const url = new URL(location.href);
      pp = url.searchParams.get('pp') || '';
      uu = url.searchParams.get('uu') || '';
    } catch {}

    const ppPresent = Boolean(pp && String(pp).length > 3);
    if (!ppPresent) {
      return {
        ok: false,
        hasSession: false,
        ppPresent: false,
        source: 'billing-url-no-pp',
        reason: 'BILLING_NAVIGATION_PP_MISSING'
      };
    }

    return {
      ok: true,
      hasSession: true,
      ppPresent: true,
      source: 'current-billing-url',
      // pp value is intentionally NOT returned to callers for storage
      _pp: pp,
      _uu: uu
    };
  }

  function semanticSpec(semanticTargetId) {
    return SEMANTIC[String(semanticTargetId || '')] || null;
  }

  /**
   * Build authenticated Billing URL. Rejects hard if session/pp missing.
   * Feature code must never call this with a fabricated session.
   */
  function buildAuthenticatedUrl(semanticTargetId, entityId, session) {
    const spec = semanticSpec(semanticTargetId);
    if (!spec) {
      return { ok: false, reason: 'unknown-semantic-target', code: 'BILLING_DESTINATION_MISMATCH' };
    }
    if (!session?.ok || !session.ppPresent || !session._pp) {
      return { ok: false, reason: 'pp-missing', code: 'BILLING_NAVIGATION_PP_MISSING' };
    }

    const id = String(entityId || '').trim();
    if (spec.needsId && !/^\d+$/.test(id)) {
      return { ok: false, reason: 'entity-id-missing', code: 'BILLING_DESTINATION_CASE_MISMATCH' };
    }

    try {
      const origin = isBillingHost()
        ? location.origin
        : 'https://admin.simnet.kiev.ua';
      const path = spec.viaStat ? '/cgi-bin/adm/stat.pl' : '/cgi-bin/adm/adm.pl';
      const url = new URL(path, origin);
      url.searchParams.set('pp', session._pp);
      if (session._uu) url.searchParams.set('uu', session._uu);
      url.searchParams.set('a', spec.a);
      if (spec.needsId) url.searchParams.set('id', id);
      if (spec.tmpl) url.searchParams.set('tmpl', spec.tmpl);
      if (spec.parent_type != null) url.searchParams.set('parent_type', spec.parent_type);

      const href = url.href;
      return {
        ok: true,
        url: href,
        urlRedacted: redactUrl(href),
        expectedPageKind: spec.pageKind,
        semanticTargetId
      };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error), code: 'BILLING_NAVIGATION_BUILD_FAILED' };
    }
  }

  function classifyAfterLoad(doc = document, expectedSemantic = '') {
    if (isBillingAuthPage(doc)) {
      return {
        pageKind: 'billing_login',
        matched: false,
        authDetected: true,
        code: 'BILLING_AUTH_PAGE_REACHED'
      };
    }
    const page = WB.runtime?.lastContext || {};
    const expected = semanticSpec(expectedSemantic)?.pageKind || '';
    const actual = page.pageKind || '';
    const matched = Boolean(expected && actual && expected === actual);
    return {
      pageKind: actual || 'unknown',
      matched,
      authDetected: false,
      code: matched ? 'DESTINATION_REACHED' : 'BILLING_DESTINATION_MISMATCH'
    };
  }

  /**
   * Hard invariant: never navigate to authenticated Billing route without pp.
   */
  function assertSafeToNavigate(built) {
    if (!built?.ok || !built.url) return false;
    try {
      const url = new URL(built.url);
      if (!BILLING_HOSTS.has(url.hostname)) return true;
      const a = url.searchParams.get('a') || '';
      // login route itself is ok without pp
      if (a === 'enter') return true;
      if (!url.searchParams.get('pp')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Central navigation entry. Features must use this instead of location.assign.
   */
  async function navigate(options = {}) {
    const {
      caseId = '',
      semanticTargetId = '',
      entityId = '',
      intent = 'DIRECT_NAVIGATION',
      operationId = '',
      sourceAction = '',
      preferFocusSource = true
    } = options;

    const activeCase = WB.store?.activeCase?.() || null;
    const resolvedCaseId = String(caseId || activeCase?.id || '');
    const billingId = String(
      entityId
      || valueOf(activeCase?.identity?.billingId)
      || ''
    );


    // Case isolation: refuse if caller case does not match active diagnostic case
    if (resolvedCaseId && activeCase?.id && String(activeCase.id) !== resolvedCaseId) {
      return {
        ok: false,
        rejected: true,
        reason: 'case-mismatch',
        code: 'BILLING_DESTINATION_CASE_MISMATCH'
      };
    }

    // From UserSide: ask the handoff source tab to build the destination from
    // its CURRENT live Billing URL. The UserSide tab never sees or stores pp.
    const page = WB.runtime?.lastContext || {};
    if (preferFocusSource && page.system === 'userside' && WB.handoff?.focusSource) {
      const focused = await WB.handoff.focusSource(activeCase, {
        semanticTargetId,
        entityId: billingId
      });

      if (focused?.focused && focused?.sessionConfirmed) {
        return {
          ok: true,
          method: 'focus-source-tab',
          focused: true,
          navigated: Boolean(focused.navigated),
          alreadyDestination: Boolean(focused.alreadyDestination),
          expectedPageKind: semanticSpec(semanticTargetId)?.pageKind || '',
          deferredVerification: true
        };
      }

      const code = focused?.code || 'BILLING_SESSION_NOT_CONFIRMED';
      return {
        ok: false,
        rejected: true,
        reason: focused?.reason || 'session-not-confirmed',
        code
      };
    }

    // On Billing page: resolve session from current URL
    const session = resolveSession();

    if (session.reason === 'BILLING_AUTH_PAGE_REACHED') {
      return {
        ok: false,
        rejected: true,
        reason: 'auth-page',
        code: 'BILLING_AUTH_PAGE_REACHED',
        pageKind: 'billing_login'
      };
    }

    if (!session.ok) {
      return {
        ok: false,
        rejected: true,
        reason: session.reason || 'session-not-confirmed',
        code: session.reason || 'BILLING_SESSION_NOT_CONFIRMED'
      };
    }

    const built = buildAuthenticatedUrl(semanticTargetId, billingId, session);
    if (!built.ok || !assertSafeToNavigate(built)) {
      return {
        ok: false,
        rejected: true,
        reason: built.reason || 'build-failed',
        code: built.code || 'BILLING_NAVIGATION_PP_MISSING'
      };
    }


    try {
      location.assign(built.url);
      return {
        ok: true,
        method: 'location.assign',
        urlRedacted: built.urlRedacted,
        expectedPageKind: built.expectedPageKind
      };
    } catch (error) {
      return {
        ok: false,
        reason: String(error?.message || error),
        code: 'BILLING_NAVIGATION_COMMIT_FAILED'
      };
    }
  }

  /**
   * Safe technical URL helper for legacy call sites.
   * Returns '' when session is not confirmed (never returns URL without pp).
   */
  function safeTechnicalUrl(caseData) {
    const session = resolveSession();
    if (!session.ok) return '';
    const billingId = String(valueOf(caseData?.identity?.billingId) || '');
    const built = buildAuthenticatedUrl('billing.technical', billingId, session);
    return built.ok && assertSafeToNavigate(built) ? built.url : '';
  }

  function safeCardUrl(caseData) {
    const session = resolveSession();
    if (!session.ok) return '';
    const billingId = String(valueOf(caseData?.identity?.billingId) || '');
    const built = buildAuthenticatedUrl('billing.user', billingId, session);
    return built.ok && assertSafeToNavigate(built) ? built.url : '';
  }

  WB.billingNavigation = {
    navigate,
    resolveSession,
    buildAuthenticatedUrl,
    isBillingAuthPage,
    classifyAfterLoad,
    assertSafeToNavigate,
    safeTechnicalUrl,
    safeCardUrl,
    redactUrl,
    semanticSpec,
    SEMANTIC
  };
})();
