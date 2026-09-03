(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  // Loader may set a lazy stub on WB.auditLauncher; only block real double-init.
  if (!WB || window.top !== window.self || WB.__auditLauncherLoaded) return;
  WB.__auditLauncherLoaded = true;

  const HOST_ID = 'simnet-data-audit-host';
  const BUTTON_ID = 'simnet-data-audit-launcher';
  const RAIL_GAP = 56;
  const MIN_WIDTH = 520;
  const MAX_PAGES = 120;
  const AUDIT_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;
  const HOST_ORIGIN = location.origin;

  const state = {
    host: null,
    frame: null,
    button: null,
    resizer: null,
    width: Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.46)),
    open: false,
    expanded: false,
    capture: null,
    originalBodyMarginRight: '',
    originalBodyTransition: '',
    ready: false
  };

  const esc = value => String(value == null ? '' : value)
    .replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);

  function isBillingListUrl(raw = location.href) {
    try {
      const url = new URL(raw, location.href);
      return url.hostname === 'admin.simnet.kiev.ua'
        && url.searchParams.get('a') === 'listuser';
    } catch {
      return false;
    }
  }

  function sanitizeUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (/^(pp|token|salt|sid|session)$/i.test(key)) url.searchParams.delete(key);
      }
      return url.toString();
    } catch {
      return String(raw || '');
    }
  }

  function post(type, payload = {}) {
    if (!state.frame?.contentWindow) return;
    state.frame.contentWindow.postMessage({
      __simnetDataAudit: true,
      type,
      payload
    }, AUDIT_ORIGIN);
  }

  function currentHostInfo() {
    const context = WB.runtime.lastContext || null;
    return {
      href: sanitizeUrl(location.href),
      host: location.hostname,
      title: document.title || '',
      pageKind: context?.pageKind || '',
      system: context?.system || '',
      canCaptureBillingList: isBillingListUrl(),
      captureEstimate: captureEstimate(),
      workbenchVersion: WB.version
    };
  }

  function applyWidth(nextWidth, options = {}) {
    // Resize can fire before mount() creates the Audit host. Width calculation is
    // harmless at that point; touching host.style is not. Never let an optional
    // Audit launcher crash the main Workbench boot path.
    if (!state.host?.isConnected) return false;
    const max = Math.max(MIN_WIDTH, window.innerWidth - RAIL_GAP - 260);
    state.width = Math.max(MIN_WIDTH, Math.min(Number(nextWidth) || state.width, max));

    if (state.expanded) {
      state.host.style.width = `${Math.max(MIN_WIDTH, window.innerWidth - RAIL_GAP)}px`;
    } else {
      state.host.style.width = `${state.width}px`;
    }

    if (state.open) adjustPage();
    if (options.persist !== false) post('HOST_WIDTH_CHANGED', {
      width: state.width,
      expanded: state.expanded
    });
  }

  function adjustPage() {
    if (!document.body) return;
    const actual = state.expanded
      ? Math.max(MIN_WIDTH, window.innerWidth - RAIL_GAP)
      : state.width;
    document.body.style.marginRight = `${actual + RAIL_GAP}px`;
    document.body.style.transition = 'margin-right .16s ease';
  }

  function restorePage() {
    if (!document.body) return;
    document.body.style.marginRight = state.originalBodyMarginRight;
    document.body.style.transition = state.originalBodyTransition;
  }

  function ensureWorkspace() {
    if (state.frame?.isConnected) return state.frame;
    if (!state.host) return null;

    const resizer = document.createElement('div');
    Object.assign(resizer.style, {
      position: 'absolute',
      left: '-5px',
      top: '0',
      bottom: '0',
      width: '10px',
      cursor: 'col-resize',
      zIndex: '3',
      background: 'transparent'
    });
    resizer.title = 'Изменить ширину Data Audit';

    const frame = document.createElement('iframe');
    const auditUrl = new URL(chrome.runtime.getURL('src/audit/audit.html'));
    auditUrl.searchParams.set('parentOrigin', HOST_ORIGIN);
    frame.src = auditUrl.toString();
    frame.title = 'SIMNET Workbench Data Audit';
    frame.setAttribute('allow', 'clipboard-write');
    Object.assign(frame.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      border: '0',
      background: '#f5f7fb'
    });

    let drag = null;
    resizer.addEventListener('pointerdown', event => {
      if (state.expanded) return;
      drag = { startX: event.clientX, startWidth: state.width };
      resizer.setPointerCapture(event.pointerId);
      document.documentElement.style.cursor = 'col-resize';
      document.documentElement.style.userSelect = 'none';
      event.preventDefault();
    });
    resizer.addEventListener('pointermove', event => {
      if (!drag) return;
      const delta = drag.startX - event.clientX;
      applyWidth(drag.startWidth + delta, { persist: false });
      post('HOST_RESIZE_PREVIEW', { width: state.width });
    });
    const finishResize = event => {
      if (!drag) return;
      drag = null;
      try { resizer.releasePointerCapture(event.pointerId); } catch {}
      document.documentElement.style.cursor = '';
      document.documentElement.style.userSelect = '';
      post('HOST_WIDTH_CHANGED', { width: state.width, expanded: state.expanded });
    };
    resizer.addEventListener('pointerup', finishResize);
    resizer.addEventListener('pointercancel', finishResize);

    state.host.append(resizer, frame);
    state.frame = frame;
    state.resizer = resizer;
    return frame;
  }

  function openAudit({ persist = true } = {}) {
    if (!state.host) buildUi();
    if (!state.host) return false;
    ensureWorkspace();
    window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', {
      detail: { module: 'audit' }
    }));
    state.open = true;
    state.host.style.display = 'block';
    if (state.button) state.button.style.display = 'none';
    applyWidth(state.width, { persist: false });
    adjustPage();
    post('HOST_OPEN_STATE', { open: true, persist });
    return true;
  }

  function closeAudit({ persist = true } = {}) {
    state.open = false;
    if (state.host) state.host.style.display = 'none';
    if (state.button) state.button.style.display = 'grid';
    restorePage();
    post('HOST_OPEN_STATE', { open: false, persist });
  }

  function setExpanded(expanded) {
    state.expanded = Boolean(expanded);
    applyWidth(state.width, { persist: true });
  }

  function buildUi() {
    // Preserve the old Audit surface exactly: the launcher exists only on
    // Billing listuser. The heavy audit.html/audit.js workspace is created
    // lazily by ensureWorkspace() on the first operator open.
    if (!isBillingListUrl()) return;
    if (document.getElementById(HOST_ID) || document.getElementById(BUTTON_ID)) return;

    state.originalBodyMarginRight = document.body?.style.marginRight || '';
    state.originalBodyTransition = document.body?.style.transition || '';

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = 'Data Audit';
    button.setAttribute('aria-label', 'Открыть Data Audit');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v4H4zM4 11h7v8H4zM13 11h7v8h-7z"/>
      </svg>
      <span>Audit</span>
    `;
    Object.assign(button.style, {
      position: 'fixed',
      right: `${RAIL_GAP + 10}px`,
      bottom: '12px',
      zIndex: '2147483605',
      height: '38px',
      minWidth: '82px',
      padding: '0 11px',
      display: 'grid',
      gridTemplateColumns: '20px auto',
      alignItems: 'center',
      gap: '7px',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: '11px',
      background: 'rgba(18,24,32,.97)',
      color: '#f7f9fb',
      boxShadow: '0 10px 28px rgba(0,0,0,.28)',
      font: '600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif',
      cursor: 'pointer'
    });
    button.querySelector('svg').style.cssText = 'width:18px;height:18px;fill:none;stroke:#60a5fa;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round';
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(28,36,47,.99)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'rgba(18,24,32,.97)'; });
    button.addEventListener('click', () => openAudit());

    const host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      right: `${RAIL_GAP}px`,
      bottom: '0',
      width: `${state.width}px`,
      zIndex: '2147483600',
      display: 'none',
      background: '#f5f7fb',
      borderLeft: '1px solid rgba(16,24,40,.13)',
      boxShadow: '-16px 0 36px rgba(15,23,42,.16)'
    });

    document.documentElement.append(button, host);
    state.button = button;
    state.host = host;
    window.addEventListener('simnet-workbench-module-open', event => {
      if (event.detail?.module !== 'audit' && state.open) closeAudit({ persist: false });
    });
  }

  function pageSignature(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      url.searchParams.delete('start');
      url.searchParams.delete('pp');
      const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
      return `${url.origin}${url.pathname}?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
    } catch {
      return '';
    }
  }

  function listPageLinks(doc, baseUrl, signature) {
    const urls = [];
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const raw = anchor.getAttribute('href') || '';
      let url;
      try { url = new URL(raw, baseUrl); } catch { continue; }
      if (url.hostname !== 'admin.simnet.kiev.ua') continue;
      if (url.searchParams.get('a') !== 'listuser') continue;
      if (!url.searchParams.has('start')) continue;
      if (pageSignature(url.toString()) !== signature) continue;
      urls.push(url.toString());
    }
    return [...new Set(urls)];
  }

  function captureEstimate() {
    if (!isBillingListUrl()) return null;
    try {
      const currentMembers = parseBillingListDocument(document, location.href).length;
      const url = new URL(location.href);
      return {
        currentMembers,
        currentPage: Number(url.searchParams.get('start') || 1) || 1,
        estimatedPages: 1,
        estimatedRequests: 0
      };
    } catch {
      return null;
    }
  }

  function parseBillingListDocument(doc, sourceUrl) {
    const members = [];
    const memberIndex = new Map();

    const push = (login, billingId = '') => {
      const normalized = String(login || '').toLowerCase();
      const match = normalized.match(/^abon(\d{3,12})$/i);
      const cleanBillingId = String(billingId || '');
      if (!match || !/^\d+$/.test(cleanBillingId)) return;

      const existingIndex = memberIndex.get(normalized);
      if (existingIndex != null) {
        // Defensive rule: if a duplicate ever appears, keep the record that has
        // a real Billing id instead of letting an earlier weak match poison it.
        if (!members[existingIndex].billingId && cleanBillingId) {
          members[existingIndex].billingId = cleanBillingId;
        }
        return;
      }

      memberIndex.set(normalized, members.length);
      members.push({
        login: normalized,
        contract: match[1],
        billingId: cleanBillingId,
        sourceUrl: sanitizeUrl(sourceUrl)
      });
    };

    for (const row of doc.querySelectorAll('tr')) {
      // A bare "abon123..." in a note/history/service row is not enough.
      // Treat a row as a subscriber only when the SAME row contains a real
      // Billing subscriber/technical-data link with a numeric id.
      let billingId = '';
      for (const anchor of row.querySelectorAll('a[href]')) {
        try {
          const url = new URL(anchor.getAttribute('href') || '', sourceUrl);
          const action = url.searchParams.get('a');
          if (action !== 'user' && action !== 'dopdata') continue;
          const id = url.searchParams.get('id') || '';
          if (/^\d+$/.test(id)) { billingId = id; break; }
        } catch {}
      }
      if (!billingId) continue;

      const text = String(row.innerText || row.textContent || '');
      const login = text.match(/\babon\d{3,12}\b/i)?.[0] || '';
      if (!login) continue;
      push(login, billingId);
    }

    // Deliberately no page-wide fallback. It used to collect abon numbers from
    // notes/history rows and could hide the later genuine subscriber row.
    return members;
  }

  async function waitWhilePaused(task) {
    while (task.paused && !task.stopped && !task.finishHere) {
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    if (task.stopped) throw new Error('Сбор отменён оператором');
    return !task.finishHere;
  }


  function billingPageUrl(rawUrl, pageNumber) {
    const url = new URL(rawUrl, location.href);
    const page = Math.max(1, Number(pageNumber || 1));
    if (page <= 1) url.searchParams.delete('start');
    else {
      url.searchParams.set('start', String(page));
      // Billing's own pagination drops this display-only parameter after page 1.
      // Mirroring the native URL avoids treating a column-layout flag as a filter.
      url.searchParams.delete('colnarrow');
    }
    return url.toString();
  }

  function captureNetwork(task) {
    const elapsedMs = Math.max(0, Date.now() - Number(task.startedAtMs || Date.now()));
    const rate = task.requests && elapsedMs ? Math.round((task.requests * 60000) / Math.max(1000, elapsedMs)) : 0;
    return {
      requests: Number(task.requests || 0),
      billingRequests: Number(task.requests || 0),
      userSideRequests: 0,
      elapsedMs,
      avgRequestsPerMinute: rate,
      avgLatencyMs: task.requests ? Math.round(Number(task.totalLatencyMs || 0) / task.requests) : 0,
      inFlight: Number(task.inFlight || 0),
      maxInFlight: Number(task.maxInFlight || 0)
    };
  }

  async function captureBillingPages(requestedCount) {
    if (!isBillingListUrl()) throw new Error('Сейчас не открыт Billing → listuser');
    if (state.capture) throw new Error('Сбор списка уже выполняется');

    const count = Math.min(MAX_PAGES, Math.max(1, Number(requestedCount || 1)));
    const initialUrl = location.href;
    const currentUrl = new URL(initialUrl);
    const currentPage = Math.max(1, Number(currentUrl.searchParams.get('start') || 1) || 1);
    const signature = pageSignature(initialUrl);
    const task = { paused:false, stopped:false, finishHere:false, pages:0, requests:0, controller:null, requestedCount:count, startedAtMs:Date.now(), totalLatencyMs:0, inFlight:0, maxInFlight:0 };
    state.capture = task;

    try {
      for (let offset = 0; offset < count; offset += 1) {
        const shouldContinue = await waitWhilePaused(task);
        if (!shouldContinue || task.finishHere) break;
        const page = currentPage + offset;
        const pageUrl = billingPageUrl(initialUrl, page);
        let doc;
        let sourceUrl = pageUrl;

        if (offset === 0) {
          doc = document;
        } else {
          task.controller = new AbortController();
          let response;
          const requestStarted = performance.now();
          task.requests += 1;
          task.inFlight = 1;
          task.maxInFlight = Math.max(task.maxInFlight, task.inFlight);
          post('SOURCE_PROGRESS', {
            phase:'fetch', pages:task.pages, totalPages:count, requests:task.requests, members:0, network:captureNetwork(task),
            message:`Загружаю Billing страницу ${page} · GET ${task.requests}`
          });
          try {
            response = await fetch(pageUrl, { credentials:'include', cache:'no-store', signal:task.controller.signal });
          } catch (error) {
            if (task.stopped && error?.name === 'AbortError') throw new Error('Сбор отменён оператором');
            throw error;
          } finally {
            task.totalLatencyMs += Math.max(0, performance.now() - requestStarted);
            task.inFlight = 0;
            task.controller = null;
          }
          if (!response.ok) throw new Error(`Billing listuser page ${page}: HTTP ${response.status}`);
          sourceUrl = response.url || pageUrl;
          const html = await response.text();
          doc = new DOMParser().parseFromString(html, 'text/html');
        }

        const members = parseBillingListDocument(doc, sourceUrl);
        if (!members.length) {
          if (offset === 0) throw new Error('На текущей странице не найдено ни одного договора abon...');
          post('SOURCE_PROGRESS', {
            phase:'collect', pages:task.pages, totalPages:count, requests:task.requests, members:0, network:captureNetwork(task),
            message:`Страница ${page} пуста — сбор остановлен раньше заданного диапазона`
          });
          break;
        }

        task.pages += 1;
        post('SOURCE_PAGE_RESULT', {
          members,
          meta: {
            sourceType:'billing-listuser-page',
            sourceUrl:sanitizeUrl(sourceUrl),
            sourceTitle:document.title || 'Billing listuser',
            page,
            signature,
            pages:1,
            requests:task.requests,
            network:captureNetwork(task),
            capturedAt:new Date().toISOString(),
            partial:false,
            manualPage:false
          }
        });
        post('SOURCE_PROGRESS', {
          phase:'collect', pages:task.pages, totalPages:count, requests:task.requests, members:members.length, network:captureNetwork(task),
          message:`Собрана страница ${page} · ${task.pages}/${count} · GET ${task.requests}`
        });
      }

      return {
        pages: task.pages,
        requests: task.requests,
        requestedCount: count,
        startPage: currentPage,
        partial: Boolean(task.finishHere || task.pages < count),
        network: captureNetwork(task)
      };
    } finally {
      state.capture = null;
    }
  }

  async function captureCurrentBillingList() {
    if (!isBillingListUrl()) throw new Error('Сейчас не открыт Billing → listuser');
    if (state.capture) throw new Error('Сбор списка уже выполняется');

    const estimate = captureEstimate() || { estimatedPages: 1, estimatedRequests: 0 };
    const task = { paused: false, stopped: false, finishHere: false, pages: 0, requests: 0, controller: null, estimatedPages: Number(estimate.estimatedPages || 1), estimatedRequests: Number(estimate.estimatedRequests || 0) };
    state.capture = task;

    try {
      const initialUrl = location.href;
      const signature = pageSignature(initialUrl);
      const queue = [];
      const visited = new Set([new URL(initialUrl).toString()]);
      const allMembers = new Map();

      const addMembers = members => {
        for (const member of members) {
          const previous = allMembers.get(member.login);
          if (!previous || (!previous.billingId && member.billingId)) allMembers.set(member.login, member);
        }
      };

      addMembers(parseBillingListDocument(document, initialUrl));
      for (const url of listPageLinks(document, initialUrl, signature)) {
        if (!visited.has(url)) queue.push(url);
      }
      task.pages = 1;
      post('SOURCE_PROGRESS', {
        phase: 'collect', pages: task.pages, totalPages: task.estimatedPages, requests: task.requests, members: allMembers.size,
        message: `Страница ${task.pages}/${task.estimatedPages} · собрано ${allMembers.size} абонентов`
      });

      while (queue.length && visited.size < MAX_PAGES) {
        const shouldContinue = await waitWhilePaused(task);
        if (!shouldContinue || task.finishHere) break;
        const url = queue.shift();
        if (!url || visited.has(url)) continue;
        visited.add(url);

        task.controller = new AbortController();
        let response;
        try {
          response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: task.controller.signal });
        } catch (error) {
          if (task.stopped && error?.name === 'AbortError') throw new Error('Сбор отменён оператором');
          throw error;
        } finally {
          task.controller = null;
        }
        task.requests += 1;
        if (!response.ok) throw new Error(`Billing listuser: HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        task.pages += 1;
        addMembers(parseBillingListDocument(doc, response.url || url));

        for (const next of listPageLinks(doc, response.url || url, signature)) {
          if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        }

        post('SOURCE_PROGRESS', {
          phase: 'collect', pages: task.pages, totalPages: Math.max(task.estimatedPages, task.pages + queue.length), requests: task.requests, members: allMembers.size,
          message: `Страница ${task.pages}/${Math.max(task.estimatedPages, task.pages + queue.length)} · собрано ${allMembers.size} абонентов`
        });
      }

      return {
        members: [...allMembers.values()],
        meta: {
          sourceType: 'billing-listuser',
          sourceUrl: sanitizeUrl(initialUrl),
          sourceTitle: document.title || 'Billing listuser',
          pages: task.pages,
          requests: task.requests,
          capturedAt: new Date().toISOString(),
          partial: Boolean(task.finishHere),
          truncated: visited.size >= MAX_PAGES && queue.length > 0
        }
      };
    } finally {
      state.capture = null;
    }
  }

  window.addEventListener('message', async event => {
    if (event.source !== state.frame?.contentWindow || event.origin !== AUDIT_ORIGIN) return;
    const message = event.data;
    if (!message || message.__simnetDataAudit !== true) return;
    const type = message.type;
    const payload = message.payload || {};

    if (type === 'AUDIT_READY') {
      state.ready = true;
      const settings = payload.settings || {};
      if (Number(settings.width)) state.width = Number(settings.width);
      state.expanded = Boolean(settings.expanded);
      applyWidth(state.width, { persist: false });
      if (settings.open && !state.open) openAudit({ persist: false });
      post('HOST_INFO', currentHostInfo());
      post('HOST_OPEN_STATE', { open: state.open, persist: false });
      return;
    }

    if (type === 'AUDIT_OPEN') return openAudit();
    if (type === 'AUDIT_CLOSE') return closeAudit();
    if (type === 'AUDIT_EXPAND') return setExpanded(Boolean(payload.expanded));
    if (type === 'AUDIT_SET_WIDTH') return applyWidth(payload.width);
    if (type === 'AUDIT_REQUEST_HOST_INFO') return post('HOST_INFO', currentHostInfo());

    if (type === 'AUDIT_FETCH_SAME_ORIGIN') {
      const requestId = String(payload.requestId || '');
      try {
        const url = new URL(String(payload.url || ''), location.href);
        if (url.origin !== location.origin) throw new Error('Same-origin fetch blocked');
        if (!['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua', 'userside.simnet.kiev.ua'].includes(url.hostname)) {
          throw new Error('Host is not allowed');
        }
        const current = new URL(location.href);
        const pp = current.searchParams.get('pp') || '';
        if (pp && !url.searchParams.has('pp') && /admin\.(?:simnet|looknet)\.kiev\.ua/i.test(url.hostname)) {
          url.searchParams.set('pp', pp);
        }
        const response = await fetch(url.toString(), { credentials: 'include', cache: 'no-store' });
        const text = await response.text();
        post('HOST_FETCH_RESULT', {
          requestId,
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          url: sanitizeUrl(response.url || url.toString()),
          data: text,
          error: response.ok ? '' : `HTTP ${response.status}`
        });
      } catch (error) {
        post('HOST_FETCH_RESULT', { requestId, ok: false, status: 0, data: '', error: error?.message || String(error) });
      }
      return;
    }

    if (type === 'AUDIT_CAPTURE_PAUSE' && state.capture) {
      state.capture.paused = true;
      return;
    }
    if (type === 'AUDIT_CAPTURE_RESUME' && state.capture) {
      state.capture.paused = false;
      return;
    }
    if (type === 'AUDIT_CAPTURE_FINISH_HERE' && state.capture) {
      state.capture.finishHere = true;
      state.capture.paused = false;
      return;
    }
    if (type === 'AUDIT_CAPTURE_STOP' && state.capture) {
      state.capture.stopped = true;
      state.capture.paused = false;
      try { state.capture.controller?.abort(); } catch {}
      return;
    }

    if (type === 'AUDIT_CAPTURE_BILLING_PAGES') {
      try {
        const result = await captureBillingPages(payload.count);
        post('SOURCE_CAPTURE_DONE', result);
      } catch (error) {
        if (/отмен/i.test(String(error?.message || ''))) post('SOURCE_CANCELLED', { message:error?.message || String(error) });
        else post('SOURCE_ERROR', { message:error?.message || String(error) });
      }
      return;
    }

    if (type === 'AUDIT_CAPTURE_CURRENT_BILLING_LIST') {
      try {
        if (!isBillingListUrl()) throw new Error('Сейчас не открыт Billing → listuser');
        const url = new URL(location.href);
        const members = parseBillingListDocument(document, location.href);
        if (!members.length) throw new Error('На текущей странице не найдено ни одного договора abon...');
        post('SOURCE_RESULT', {
          members,
          meta: {
            sourceType: 'billing-listuser-page',
            sourceUrl: sanitizeUrl(location.href),
            sourceTitle: document.title || 'Billing listuser',
            page: Number(url.searchParams.get('start') || 1) || 1,
            signature: pageSignature(location.href),
            pages: 1,
            requests: 0,
            capturedAt: new Date().toISOString(),
            partial: true,
            manualPage: true
          }
        });
      } catch (error) {
        post('SOURCE_ERROR', { message: error?.message || String(error) });
      }
    }
  });

  window.addEventListener('resize', () => {
    applyWidth(state.width, { persist: false });
    post('HOST_INFO', currentHostInfo());
  });

  window.addEventListener('pageshow', () => post('HOST_INFO', currentHostInfo()));

  function mount() {
    if (!document.body) return setTimeout(mount, 50);
    buildUi();
  }

  WB.auditLauncher = {
    open: openAudit,
    close: closeAudit,
    state
  };

  mount();
})();
