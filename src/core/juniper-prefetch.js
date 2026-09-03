(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const inFlight = new Map();
  const REQUEST_TIMEOUT_MS = 10000;
  const LOADING_LEASE_MS = 20000;
  const BILLING_PREFETCH_PAGES = new Set([
    'billing_user',
    'billing_technical',
    'billing_onu_poll'
  ]);

  function decodeHtmlBytes(bytes, contentType = '') {
    const declared = String(contentType || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || '';
    const labels = [...new Set([
      declared,
      'utf-8',
      'windows-1251'
    ].filter(Boolean))];
    const candidates = [];
    for (const label of labels) {
      try {
        const normalized = /^(?:cp-?1251|windows-?1251)$/i.test(label)
          ? 'windows-1251'
          : label;
        const text = new TextDecoder(normalized, {
          fatal: /^utf-?8$/i.test(normalized)
        }).decode(bytes);
        const replacementCount = (text.match(/\uFFFD/g) || []).length;
        const semanticHits = [
          /Juniper/i,
          /\bBRAS\b/i,
          /Статус\s+сесії/i,
          /Джерело\s+сесії/i,
          /Запит\s+Juniper/i
        ].filter(pattern => pattern.test(text)).length;
        candidates.push({
          text,
          label: normalized,
          score: semanticHits * 100 - replacementCount * 1000
        });
      } catch {}
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || { text: '', label: '', score: -Infinity };
  }

  async function readHtmlResponse(response) {
    const bytes = await response.arrayBuffer();
    return {
      ...decodeHtmlBytes(bytes, response.headers?.get?.('content-type') || ''),
      byteLength: Number(bytes.byteLength || 0)
    };
  }

  async function fetchJuniper(url, label) {
    const controller = new AbortController();
    // This is only an upper bound. There is no artificial wait: a normal
    // Billing response is parsed as soon as its bytes arrive.
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const decoded = await readHtmlResponse(response);
      return { response, decoded };
    } catch (error) {
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function billingHost() {
    return ['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(location.hostname);
  }

  function juniperUrl(caseData) {
    if (!billingHost()) return '';

    const exact = [...document.querySelectorAll('a[href*="a=252"]')]
      .find(link => /Juniper\s*\(NEW\)/i.test(String(link.textContent || '')))
      || document.querySelector('a[href*="a=252"]');
    if (exact?.href) return exact.href;

    const billingId = String(
      caseData?.identity?.billingId?.value
      || caseData?.identity?.billingId
      || new URLSearchParams(location.search).get('id')
      || ''
    );
    if (!billingId) return '';

    const current = new URL(location.href);
    const url = new URL('/cgi-bin/adm/stat.pl', location.origin);
    for (const key of ['pp', 'uu']) {
      const value = current.searchParams.get(key);
      if (value) url.searchParams.set(key, value);
    }
    url.searchParams.set('id', billingId);
    url.searchParams.set('a', '252');
    return url.href;
  }

  function pinnedEvent(base, type) {
    return {
      ...(base || {}),
      eventId: globalThis.crypto?.randomUUID?.()
        || `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      type,
      occurredAt: new Date().toISOString()
    };
  }

  async function storeObservation(parsed, method, sourceUrl, pin, extra = {}) {
    const session = parsed?.session || null;
    const sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions.slice(0, 4).map(item => ({
          subscriberIp: item.subscriberIp || '',
          subscriberMac: item.subscriberMac || '',
          brasName: item.brasName || '',
          brasIp: item.brasIp || '',
          source: item.source || '',
          sessionId: item.sessionId || '',
          status: item.status || '',
          statusRaw: item.statusRaw || '',
          authType: item.authType || '',
          startTime: item.startTime || '',
          bytesRaw: item.bytesRaw || '',
          speedRaw: item.speedRaw || '',
          rxBps: item.rxBps,
          txBps: item.txBps,
          hasTraffic: item.hasTraffic,
          lastEventTime: item.lastEventTime || '',
          lastEvent: item.lastEvent || '',
          vendor: item.vendor || '',
          vlan: item.vlan || '',
          staleRadius: Boolean(item.staleRadius)
        }))
      : [];

    const details = {
      ...(session || {}),
      sessions,
      parserVersion: parsed?.parserVersion || WB.juniperParser?.version || '',
      sourceUrl: WB.utils?.safeUrl?.(sourceUrl) || sourceUrl || '',
      readOnly: true,
      ...extra
    };
    delete details.rawText;

    const response = await chrome.runtime.sendMessage({
      type: 'EVIDENCE_RECORD',
      payload: {
        caseId: String(pin?.caseId || ''),
        envelope: pinnedEvent(pin, 'EVIDENCE_RECORD'),
        observation: {
          type: 'JUNIPER_SESSION',
          result: parsed?.result || 'error',
          method,
          source: 'billing-juniper',
          // Background prefetch is a read-only snapshot. It fills LIVE immediately
          // and never makes SYNC/Disconnect calls. The operator does not have to
          // visit Juniper (NEW) merely to publish the already-read session.
          routeRelation: 'supporting',
          passive: true,
          passiveReason: 'juniper-background-preview',
          details: { ...details, preview: true },
          summary: parsed?.summary || 'Juniper: данные сессии прочитаны в фоновом read-only режиме.'
        }
      }
    });
    if (!response?.success) {
      throw new Error(response?.error || 'Juniper observation was not stored');
    }
    return response.data;
  }

  async function prefetch({ force = false, reason = 'route-first-source' } = {}) {
    const caseData = WB.store?.activeCase?.() || null;
    if (!caseData || !billingHost()) return { ok: false, reason: 'billing-context-required' };

    const caseId = String(caseData.id || WB.store?.localCaseId || '');
    if (!caseId) return { ok: false, reason: 'case-required' };

    const existing = caseData.locator?.sourceStatus?.juniper
      || caseData.locator?.sourceStatus?.juniperPreview
      || (caseData.juniper?.dataStatus === 'available' ? caseData.juniper : null);
    if (existing && !force) return { ok: true, skipped: true, reason: 'already-read' };
    const loadingAt = Date.parse(String(caseData.juniper?.updatedAt || '')) || 0;
    const loadingLeaseActive = caseData.juniper?.dataStatus === 'loading'
      && loadingAt
      && Date.now() - loadingAt < LOADING_LEASE_MS;
    if (loadingLeaseActive && !force) {
      return { ok: true, skipped: true, reason: 'request-in-flight' };
    }
    if (inFlight.has(caseId)) return inFlight.get(caseId);

    const url = juniperUrl(caseData);
    if (!url) return { ok: false, reason: 'juniper-url-not-found' };
    const requestId = globalThis.crypto?.randomUUID?.()
      || `jun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    // Freeze the case/episode/route at request start. Every later callback uses
    // this same passport and never asks the current tab which case it belongs to.
    const pin = WB.store?.correlation?.(
      'JUNIPER_PREFETCH_STATUS',
      { requestId },
      { caseId }
    ) || null;
    if (!pin?.caseId || !pin?.episodeId) {
      return { ok: false, reason: 'correlation-unavailable' };
    }

    const task = (async () => {
      // Status persistence and the read-only GET are independent. Starting them
      // together removes a full Case write from Juniper's critical path.
      const statusPromise = chrome.runtime.sendMessage({
        type: 'JUNIPER_PREFETCH_STATUS',
        payload: {
          caseId,
          status: 'loading',
          envelope: pinnedEvent(pin, 'JUNIPER_PREFETCH_STATUS')
        }
      }).catch(() => {});
      const initialFetch = fetchJuniper(url, 'juniper-initial');
      try {
        const [{ response: initialResponse, decoded }] = await Promise.all([initialFetch, statusPromise]);
        const html = decoded.text;
        if (!/(?:Juniper|Статус\s+сесії|Запит\s+Juniper|\bBRAS\b)/i.test(html)) {
          throw new Error('unexpected Juniper page');
        }
        let parsed = WB.juniperParser?.parseHtml?.(html) || {
          result: 'error',
          session: null,
          sessions: [],
          summary: 'Juniper: parser недоступен.'
        };
        if (String(parsed?.result || '').toLowerCase() === 'error') {
          const parseError = new Error('Juniper parser did not produce a valid result');
          parseError.code = 'JUNIPER_PARSE_FAILED';
          throw parseError;
        }
        let method = 'billing-juniper-prefetch';
        let sourceUrl = url;
        let refreshRequested = false;

        // a=252 is the lightest read. If it has no usable session block but exposes
        // «Запит Juniper», perform exactly one read-only refresh request. Parser
        // errors on a legacy shell are treated like an empty session here. Never
        // call coasync/coadisconnect automatically.
        if (!parsed.session && /(?:act=askjun|Запит\s+Juniper)/i.test(html)) {
          const refreshUrl = new URL(url);
          refreshUrl.searchParams.set('act', 'askjun');
          const { response: refreshResponse, decoded: refreshDecoded } = await fetchJuniper(
            refreshUrl.href,
            'juniper-refresh'
          );
          if (refreshDecoded) {
            const refreshHtml = refreshDecoded.text;
            if (/(?:Juniper|Статус\s+сесії|\bBRAS\b)/i.test(refreshHtml)) {
              parsed = WB.juniperParser?.parseHtml?.(refreshHtml) || parsed;
              if (String(parsed?.result || '').toLowerCase() === 'error') {
                const parseError = new Error('Juniper refresh parser did not produce a valid result');
                parseError.code = 'JUNIPER_PARSE_FAILED';
                throw parseError;
              }
              method = 'billing-juniper-prefetch-askjun';
              sourceUrl = refreshUrl.href;
              refreshRequested = true;
            }
          }
        }

        await storeObservation(parsed, method, sourceUrl, pin, { reason, refreshRequested });
        return { ok: true, parsed, refreshRequested };
      } catch (error) {
        const parsed = {
          parserVersion: WB.juniperParser?.version || '',
          result: 'error',
          session: null,
          sessions: [],
          summary: 'Juniper: фоновое чтение не удалось. Основной маршрут продолжится без блокировки.'
        };
        await storeObservation(parsed, 'billing-juniper-prefetch-error', url, pin, {
          reason,
          error: String(error?.message || error || 'unknown').slice(0, 180)
        }).catch(() => {});
        const timeout = error?.name === 'AbortError';
        const code = timeout
          ? 'JUNIPER_REQUEST_TIMEOUT'
          : error?.code === 'JUNIPER_PARSE_FAILED'
            ? 'JUNIPER_PARSE_FAILED'
            : 'JUNIPER_REQUEST_FAILED';
        return { ok: false, reason: timeout ? 'timeout' : error?.code === 'JUNIPER_PARSE_FAILED' ? 'parse-failed' : 'fetch-failed', error };
      } finally {
        inFlight.delete(caseId);
      }
    })();

    inFlight.set(caseId, task);
    return task;
  }

  function maybePrefetch(reason = 'context') {
    const caseData = WB.store?.activeCase?.() || null;
    if (!caseData || !billingHost()) {
      return Promise.resolve({ ok: false, reason: 'billing-context-required' });
    }
    const pageKind = String(
      WB.runtime?.lastContext?.pageKind
      || caseData.currentContext?.pageKind
      || ''
    );
    // Juniper is a parallel read-only source, not a blocking route step. Start it
    // on the first Billing subscriber page regardless of the current route action.
    if (!BILLING_PREFETCH_PAGES.has(pageKind)) {
      return Promise.resolve({ ok: false, reason: 'not-a-subscriber-page' });
    }
    return prefetch({ reason });
  }

  let lastOpenedDocumentId = '';
  WB.bus?.on?.('context:changed', payload => {
    const context = payload?.context || {};
    if (String(context.pageKind || '') !== 'billing_juniper') return;
    const documentId = String(context?.meta?.documentId || WB.runtime?.documentId || '');
    if (documentId && documentId === lastOpenedDocumentId) return;
    lastOpenedDocumentId = documentId;
    const current = WB.store?.activeCase?.() || null;
    const result = String(current?.juniper?.result || current?.locator?.sourceStatus?.juniper?.result || '');
    if (current?.juniper?.readSource === 'operator-page' && current?.juniper?.dataStatus === 'available') {
    }
  });

  WB.juniper = {
    prefetch,
    maybePrefetch,
    juniperUrl,
    decodeHtmlBytes
  };
})();
