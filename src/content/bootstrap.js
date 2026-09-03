(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.runtime.booted) return;
  WB.runtime.booted = true;

  const lifecycle = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let running = null;
  let lastSignature = '';
  let lastJuniperKey = '';
  let tmcRefreshDocumentId = '';

  const extensionInvalidated = error => (
    error?.code === 'EXTENSION_CONTEXT_INVALIDATED'
    || /Extension context invalidated|Расширение было перезагружено/i.test(String(error?.message || error || ''))
  );

  function stopStaleRuntime(message = '') {
    if (WB.runtime.extensionContextStopped) return;
    WB.runtime.extensionContextStopped = true;
    WB.runtime.extensionContextInvalidated = true;
    WB.runtime.destroyed = true;
    lifecycle?.abort?.();
    WB.rail?.notifyExtensionContextInvalidated?.(message);
  }

  WB.runtime.invalidateExtensionContext = stopStaleRuntime;

  function signatureOf(context = {}) {
    return JSON.stringify({
      key: context.key || '',
      identity: context.identity || {},
      network: context.network || {},
      pon: context.pon || {},
      profile: context.profile || {},
      quality: context.quality || {}
    });
  }

  function isPollPage(context = WB.runtime?.lastContext || null) {
    if (context?.pageKind === 'billing_onu_poll') return true;
    try {
      return ['310', '311', '312', '313'].includes(String(new URL(location.href).searchParams.get('a') || ''));
    } catch {
      return false;
    }
  }

  async function readCurrentPage(reason = 'read', force = false) {
    if (WB.runtime.destroyed || document.hidden) return null;
    if (running) return running;

    running = (async () => {
      try {
        if (isPollPage()) {
          if (WB.pollTerminal?.__lazy) await WB.pollTerminal.ensure?.();
          WB.pollTerminal?.scan?.();
        }

        const context = WB.pageContext.detect();
        WB.runtime.lastContext = context;
        const signature = signatureOf(context);
        if (!force && signature === lastSignature) return null;
        lastSignature = signature;

        const result = await WB.store.applyContext(context);
        const currentCase = WB.store.activeCase?.() || null;
        WB.bus?.emit?.('context:changed', { context, result, reason });

        if ((context.system === 'billing' || context.system === 'looknet-billing') && currentCase) {
          const juniperKey = [
            currentCase.id || '',
            currentCase.network?.ip?.value || currentCase.network?.ip || '',
            currentCase.network?.mac?.value || currentCase.network?.mac || ''
          ].join('|');
          if (juniperKey && juniperKey !== lastJuniperKey) {
            lastJuniperKey = juniperKey;
            queueMicrotask(() => { void WB.juniper?.maybePrefetch?.(`identity:${reason}`); });
          }
        }

        return result;
      } catch (error) {
        if (extensionInvalidated(error)) {
          stopStaleRuntime(error?.message || String(error));
          return null;
        }
        WB.fail?.(error, `Ошибка чтения страницы (${reason})`);
        return null;
      } finally {
        running = null;
      }
    })();

    return running;
  }

  async function refreshUsersideTmcOnce(reason = 'userside-tmc-ready') {
    const context = WB.runtime?.lastContext || {};
    if (context.pageKind !== 'userside_customer') return null;
    const documentId = String(WB.runtime?.documentId || WB.runtime?.pageInstanceId || location.href);
    if (tmcRefreshDocumentId === documentId) return null;
    tmcRefreshDocumentId = documentId;

    // UserSide may draw the native TMC/PON block after document_idle. This is the
    // only page-DOM wait in the main runtime: bounded, target-specific and removed
    // immediately when the real TMC block appears or the timeout expires.
    const resolved = await WB.browser?.actions?.usersideTmc?.waitForTmcBlock?.(1400);
    if (!resolved || WB.runtime.destroyed || document.hidden) return null;
    return readCurrentPage(reason, false);
  }

  const listenOptions = capture => lifecycle
    ? { capture: Boolean(capture), signal: lifecycle.signal }
    : Boolean(capture);

  let lastCallSearchSignature = '';
  let lastCallSearchAt = 0;
  let lastAddressSearch = null;
  let callEvidenceAbort = null;
  let unbindCallState = null;

  function submitCallSearchEvidence(evidence = {}) {
    if (WB.callEvidenceObserver?.enabled?.() === false) return;
    const source = String(evidence.source || '');
    const kind = String(evidence.kind || '');
    const query = String(evidence.query || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const searchKind = String(evidence.searchKind || '').replace(/[^a-z_-]/gi, '').slice(0, 24);
    const targetSubscriberId = String(
      evidence.targetSubscriberId || evidence.targetCustomerId || ''
    ).replace(/\D+/g, '').slice(0, 12);
    if (!source || !kind || (!query && !targetSubscriberId)) return;
    const signature = `${source}|${kind}|${searchKind}|${query}|${targetSubscriberId}`;
    const now = Date.now();
    if (signature === lastCallSearchSignature && now - lastCallSearchAt < 1200) return;
    lastCallSearchSignature = signature;
    lastCallSearchAt = now;
    void WB.store.recordCallSearch?.({
      source,
      kind,
      searchKind,
      query,
      targetSubscriberId,
      searchId: String(evidence.searchId || '').slice(0, 120),
      resolution: String(evidence.resolution || '').slice(0, 60),
      resultCount: Number(evidence.resultCount || 0) || 0,
      // Backward compatibility for the first implementation of UserSide search evidence.
      targetCustomerId: source === 'userside' ? targetSubscriberId : '',
      pageUrl: location.href
    }).catch(error => {
      if (extensionInvalidated(error)) stopStaleRuntime(error?.message || String(error));
    });
  }

  function billingSearchSnapshot(form) {
    if (!(form instanceof HTMLFormElement)) return { query: '', searchKind: '' };
    const currentUrl = (() => { try { return new URL(location.href); } catch { return null; } })();
    const actionUrl = (() => { try { return new URL(form?.action || location.href, location.href); } catch { return null; } })();
    const hiddenAction = String(form?.querySelector?.('input[name="a"]')?.value || '').trim();
    const fieldNames = new Set(Array.from(form?.elements || []).map(field => String(field?.name || '').trim()).filter(Boolean));
    const hasSubscriberSearchFields = fieldNames.has('name')
      || ['dopfield_5', 'dopfield_6', 'dopfield_11', 'dopfield_8'].some(name => fieldNames.has(name));
    const isListSearch = actionUrl?.searchParams?.get('a') === 'listuser'
      || hiddenAction === 'listuser'
      || (currentUrl?.searchParams?.get('a') === 'listuser' && hasSubscriberSearchFields);
    if (!isListSearch || !hasSubscriberSearchFields) return { query: '', searchKind: '' };

    const valueOfField = name => {
      const field = form.querySelector?.(`[name="${name}"]`);
      if (!field) return '';
      const raw = field.tagName === 'SELECT'
        ? (field.options?.[field.selectedIndex]?.textContent || field.value || '')
        : (field.value || '');
      return String(raw).replace(/\s+/g, ' ').trim();
    };
    const mode = String(
      form.querySelector?.('input[name="f"]')?.value
      || currentUrl?.searchParams?.get('f')
      || actionUrl?.searchParams?.get('f')
      || ''
    ).trim().toLowerCase();
    const contractQuery = valueOfField('name');
    const addressValues = ['dopfield_5', 'dopfield_6', 'dopfield_11', 'dopfield_8']
      .map(valueOfField)
      .filter(Boolean);
    const searchKind = mode === 'd' || addressValues.length >= 2
      ? 'address'
      : mode === 'n' || contractQuery
        ? 'contract'
        : 'generic';

    const parts = [];
    for (const field of Array.from(form?.elements || [])) {
      const name = String(field?.name || '').trim();
      const type = String(field?.type || '').toLowerCase();
      if (!name || ['hidden', 'password', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) continue;
      if (type === 'checkbox' || type === 'radio') {
        if (!field.checked) continue;
      }
      const rawValue = field?.tagName === 'SELECT'
        ? (field.options?.[field.selectedIndex]?.textContent || field.value || '')
        : (field?.value || '');
      const value = String(rawValue).replace(/\s+/g, ' ').trim();
      if (!value || value.length > 120) continue;
      // Never journal service/auth plumbing even if Billing renders it visibly.
      if (/^(?:pp|pass|password|token|sid|session|csrf)$/i.test(name)) continue;
      parts.push(`${name}=${value}`);
      if (parts.length >= 8) break;
    }
    return { query: parts.join('; ').slice(0, 180), searchKind };
  }

  function billingSearchFormOnPage() {
    for (const form of Array.from(document.forms || [])) {
      const snapshot = billingSearchSnapshot(form);
      if (snapshot.query) return { form, ...snapshot };
    }
    return null;
  }

  function makeCallSearchId(source = 'search') {
    return `${String(source || 'search')}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }

  function uniqueUsersideAutocompleteResult(query = '') {
    if (location.hostname !== 'userside.simnet.kiev.ua') return null;
    const root = document.querySelector('#top_find_result,#top_find_result2');
    if (!root) return null;
    const links = Array.from(root.querySelectorAll('a[href*="/customer/"]'))
      .map(link => {
        const match = String(link.getAttribute('href') || '').match(/\/customer\/(\d+)/i);
        return match ? { customerId: match[1], text: String(link.textContent || '').replace(/\s+/g, ' ').trim() } : null;
      })
      .filter(Boolean);
    if (links.length !== 1) return null;
    const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalizedQuery) return null;
    return { ...links[0], resultCount: 1, query: normalizedQuery };
  }

  function observeSearchSubmit(event) {
    const form = event?.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (location.hostname === 'userside.simnet.kiev.ua' && (form.id === 'top_search' || form.name === 'formGlobalSearch')) {
      const query = String(form.querySelector('#top_field,[name="search"]')?.value || '').trim();
      if (query) {
        const searchId = makeCallSearchId('userside');
        submitCallSearchEvidence({ source: 'userside', kind: 'submit', searchKind: 'global', query, searchId });

        // Post-factum only: UserSide has already rendered its autocomplete response.
        // If that response contains exactly one customer, preserve the resolved
        // customer as soft canonical evidence even when the operator opens a task
        // or another related object instead of the customer card itself.
        const unique = uniqueUsersideAutocompleteResult(query);
        if (unique?.customerId) {
          submitCallSearchEvidence({
            source: 'userside',
            kind: 'resolved',
            searchKind: 'global',
            query,
            targetSubscriberId: unique.customerId,
            searchId,
            resolution: 'unique-autocomplete',
            resultCount: unique.resultCount
          });
        }
      }
      return;
    }
    if (/^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(location.hostname)) {
      const snapshot = billingSearchSnapshot(form);
      if (snapshot.query) submitCallSearchEvidence({ source: 'billing', kind: 'submit',
        searchKind: snapshot.searchKind,
        query: snapshot.query
      });
    }
  }

  function observeAddressSearchInput(event) {
    if (location.hostname !== 'userside.simnet.kiev.ua') return;
    const input = event?.target;
    if (!(input instanceof HTMLInputElement) || !/^inputAddressFastFind/i.test(String(input.id || ''))) return;
    const query = String(input.value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!query) return;
    lastAddressSearch = { query, ts: Date.now() };
  }

  function observeSearchResultClick(event) {
    const host = location.hostname;
    if (host === 'userside.simnet.kiev.ua') {
      const link = event?.target?.closest?.('a[href*="/customer/"]');
      if (!link) return;
      const match = String(link.getAttribute('href') || '').match(/\/customer\/(\d+)/i);
      if (!match) return;

      const inTopResult = Boolean(link.closest('#top_find_result,#top_find_result2'));
      const inAddressSubscriberResult = Boolean(link.closest('#task_apart_used_info2_id')) || link.id === 'linkCustomerId';
      let query = '';
      let searchKind = 'global';
      if (inTopResult) {
        query = String(document.querySelector('#top_field')?.value || '').trim();
      } else if (inAddressSubscriberResult) {
        if (!lastAddressSearch || Date.now() - Number(lastAddressSearch.ts || 0) > 2 * 60 * 1000) return;
        query = String(lastAddressSearch.query || '').trim();
        searchKind = 'address';
      } else {
        const current = (() => { try { return new URL(location.href); } catch { return null; } })();
        const isSearchPage = current?.pathname.startsWith('/customer_list')
          && Boolean(current.searchParams.get('search'));
        if (!isSearchPage) return;
        query = String(current.searchParams.get('search') || '').trim();
      }

      // UserSide autocomplete/navigation does not always submit the search form.
      // Record an implicit intent immediately before RESULT_OPEN so CALL evidence
      // remains causal even when native autocomplete navigates directly.
      const clickSearchId = makeCallSearchId('userside-click');
      if (query) {
        submitCallSearchEvidence({
          source: 'userside',
          kind: 'submit',
          searchKind,
          query,
          searchId: clickSearchId
        });
      }
      submitCallSearchEvidence({
        source: 'userside',
        kind: 'result-open',
        searchKind,
        query,
        targetSubscriberId: match[1],
        searchId: clickSearchId
      });
      return;
    }

    if (!/^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/i.test(host)) return;
    const current = (() => { try { return new URL(location.href); } catch { return null; } })();
    if (String(current?.searchParams?.get('a') || '').toLowerCase() !== 'listuser') return;
    const link = event?.target?.closest?.('a[href]');
    if (!link) return;
    let target = null;
    try { target = new URL(link.getAttribute('href') || '', location.href); } catch { return; }
    if (String(target.searchParams.get('a') || '').toLowerCase() !== 'user') return;
    const billingId = String(target.searchParams.get('id') || '').replace(/\D+/g, '').slice(0, 12);
    if (!billingId) return;

    // The result page keeps the subscriber search form. Read its live values
    // before navigation so Cyrillic block/street data is not lost in URL encoding.
    const snapshot = billingSearchFormOnPage();
    submitCallSearchEvidence({
      source: 'billing',
      kind: 'result-open',
      searchKind: snapshot?.searchKind || 'generic',
      query: snapshot?.query || '',
      targetSubscriberId: billingId
    });
  }

  function enableCallEvidenceListeners() {
    if (callEvidenceAbort || WB.runtime.destroyed) return false;
    callEvidenceAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const options = capture => callEvidenceAbort
      ? { capture: Boolean(capture), signal: callEvidenceAbort.signal }
      : Boolean(capture);
    document.addEventListener('submit', observeSearchSubmit, options(true));
    document.addEventListener('input', observeAddressSearchInput, options(true));
    document.addEventListener('click', observeSearchResultClick, options(true));
    WB.callEvidenceObserver?.enable?.();
    return true;
  }

  function disableCallEvidenceListeners() {
    callEvidenceAbort?.abort?.();
    callEvidenceAbort = null;
    WB.callEvidenceObserver?.disable?.();
    return true;
  }

  function syncCallEvidenceLifecycle(state = WB.store?.state || {}) {
    if (state?.callModule?.config?.enabled === false) {
      disableCallEvidenceListeners();
      WB.callRegistration?.disable?.();
      WB.callRegistration?.close?.();
    } else {
      enableCallEvidenceListeners();
      WB.callRegistration?.enable?.();
    }
  }

  async function boot() {
    WB.rail.mount();
    await WB.store.init();
    await WB.handoff?.init?.();

    if (!document.hidden) {
      await readCurrentPage('boot', true);
      // A native OLT request may finish by AJAX in the same Billing document.
      // Resume only the one active request watcher after reload/navigation; the
      // watcher is bounded and disconnects on terminal evidence or 30 s fallback.
      WB.interactionGuards?.resumePollResponseWatch?.();
      await WB.handoff?.resumePendingTmcCommand?.('boot');
      queueMicrotask(() => { void refreshUsersideTmcOnce(); });
    }

    // No permanent MutationObserver and no form-change scanner. A document is
    // read on entry/navigation; operator edits become canonical only after the
    // native Billing Save creates a fresh server-backed document.
    window.addEventListener('pageshow', event => {
      if (event?.persisted) void readCurrentPage('pageshow', true);
    }, listenOptions(false));
    window.addEventListener('popstate', () => {
      void readCurrentPage('popstate', true).then(() => refreshUsersideTmcOnce('userside-popstate-tmc'));
    }, listenOptions(false));
    window.addEventListener('hashchange', () => {
      void readCurrentPage('hashchange', true).then(() => refreshUsersideTmcOnce('userside-hash-tmc'));
    }, listenOptions(false));

    // Lightweight event-driven CALL evidence. Its own AbortController means
    // CALL OFF removes the listeners instead of merely ignoring their output.
    syncCallEvidenceLifecycle(WB.store.state);
    unbindCallState = WB.bus?.on?.('store:state', syncCallEvidenceLifecycle) || null;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden || WB.runtime.destroyed) return;
      WB.store.resume?.();
      queueMicrotask(() => { void WB.handoff?.resumePendingTmcCommand?.('visible'); });
    }, listenOptions(false));

    WB.runtime.readCurrentPage = (reason, force = false) => readCurrentPage(reason || 'read', force);
    WB.runtime.refreshCurrentPage = reason => readCurrentPage(reason || 'explicit-refresh', true);
    WB.runtime.destroy = () => {
      if (WB.runtime.destroyed) return;
      WB.runtime.destroyed = true;
      lifecycle?.abort?.();
      disableCallEvidenceListeners();
      unbindCallState?.();
      unbindCallState = null;
      WB.interactionGuards?.destroy?.();
      WB.clickDebug?.destroy?.();
      WB.junctionDebug?.destroy?.();
      WB.callRegistration?.destroy?.();
      WB.taskFormAssistant?.destroy?.();
      WB.operatorCompanion?.destroy?.();
      WB.store.destroy();
      WB.rail.destroy();
    };
  }

  boot().catch(error => {
    if (extensionInvalidated(error)) {
      stopStaleRuntime(error?.message || String(error));
      return;
    }
    WB.fail?.(error, 'Workbench не запустился');
  });
})();
