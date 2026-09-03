(() => {
  'use strict';

  if (window.top !== window.self) return;
  const wb = globalThis.SIMNET_WB;
  if (!wb) return;

  const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
  const CRAWL_STATE_KEY = 'simnet_crm_building_crawl_state_v1';
  const SCHEMA = 'simnet-crm-building-snapshot-v1';
  const CONCURRENCY = 2;
  const SAVE_EVERY = 20;
  const REQUEST_DELAY_MS = 120;
  const MAX_RETRIES = 2;

  let stopRequested = false;
  let running = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function compactText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\f\v]+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function fieldKey(label) {
    const clean = compactText(label).replace(/[:：]\s*$/, '').toLowerCase();
    const known = new Map([
      ['id', 'building_id'],
      ['абоненты', 'subscriber_count'],
      ['активность', 'activity'],
      ['тип здания', 'building_type'],
      ['подъездов', 'entrances'],
      ['этажей', 'floors'],
      ['квартир', 'apartments'],
      ['процент проникновения', 'penetration'],
      ['координаты', 'coordinates'],
      ['ключи', 'keys'],
      ['менеджер', 'manager'],
      ['собственник', 'owner'],
      ['заметки', 'notes'],
      ['рабочая заметка', 'working_note'],
      ['название ук/осбб', 'management'],
      ['есть ктв', 'ktv'],
      ['gpon', 'gpon']
    ]);
    if (known.has(clean)) return known.get(clean);
    return clean
      .replace(/[^a-zа-я0-9іїєґ]+/giu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'field';
  }

  function elementValueWithoutLabel(item, labelEl) {
    if (!item) return '';
    const clone = item.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg').forEach(el => el.remove());
    const clonedLabel = clone.querySelector('.left_data');
    if (clonedLabel) clonedLabel.remove();
    clone.querySelectorAll('[style*="display: none"], [hidden]').forEach(el => el.remove());
    return compactText(clone.textContent || '');
  }

  function addField(target, field) {
    const label = compactText(field?.label).replace(/[:：]\s*$/, '');
    const text = compactText(field?.text);
    if (!label || !text) return;
    if (field.key === 'keys' && /^(ключи|добавить)$/iu.test(text)) return;
    const fingerprint = `${label.toLowerCase()}\u0000${text.toLowerCase()}`;
    if (target.some(item => item._fingerprint === fingerprint)) return;
    target.push({
      key: field.key || fieldKey(label),
      label,
      text,
      source: field.source || 'main_card',
      ...(field.fieldId ? { fieldId: String(field.fieldId) } : {}),
      _fingerprint: fingerprint
    });
  }

  function parseBuildingCoreDocument(doc, sourceUrl = '') {
    if (!doc?.querySelector) return null;
    const main = doc.querySelector('#div_contentplace');
    if (!main) return null;

    const pathMatch = String(sourceUrl || '').match(/\/building\/(\d+)/i);
    const idFromDom = compactText(main.querySelector('.table_block .item .left_data')?.parentElement?.textContent || '')
      .match(/\bid\s*:\s*(\d+)/i)?.[1] || '';
    const buildingId = pathMatch?.[1] || idFromDom;
    const address = compactText(main.querySelector('.label_h2')?.textContent || doc.title?.replace(/\s*-\s*Покрытие.*$/iu, '') || '');
    if (!buildingId && !address) return null;

    const fields = [];

    // The operator only wants the building's own working/card information.
    // We deliberately stop at the tabs boundary and never inspect #slider_content / customer rows.
    const boundary = main.querySelector('#ref_start, #navigation');
    const topTableBlocks = Array.from(main.querySelectorAll('.table_block')).filter(block => {
      if (!boundary || typeof block.compareDocumentPosition !== 'function') return true;
      return Boolean(block.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING);
    });

    for (const block of topTableBlocks) {
      for (const item of block.querySelectorAll(':scope > .item, .item')) {
        if (boundary && typeof item.compareDocumentPosition === 'function') {
          const beforeBoundary = Boolean(item.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!beforeBoundary) continue;
        }
        const labelEl = item.querySelector(':scope > .left_data, .left_data');
        if (!labelEl) continue;
        const label = compactText(labelEl.textContent || '').replace(/[:：]\s*$/, '');
        const text = elementValueWithoutLabel(item, labelEl);
        addField(fields, { key: fieldKey(label), label, text, source: 'main_card' });
      }
    }

    for (const caption of main.querySelectorAll('#div_yellow_info .caption')) {
      if (boundary && typeof caption.compareDocumentPosition === 'function') {
        const beforeBoundary = Boolean(caption.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!beforeBoundary) continue;
      }
      const raw = compactText(caption.textContent || '');
      if (!raw) continue;
      const colon = raw.indexOf(':');
      if (colon > 0) {
        const label = raw.slice(0, colon).trim();
        const text = raw.slice(colon + 1).trim();
        addField(fields, { key: fieldKey(label), label, text, source: 'highlight', fieldId: caption.dataset?.fieldid || '' });
      } else {
        addField(fields, {
          key: caption.dataset?.fieldid ? `custom_${caption.dataset.fieldid}` : 'highlight',
          label: caption.dataset?.fieldid ? `Доп. поле ${caption.dataset.fieldid}` : 'Доп. информация',
          text: raw,
          source: 'highlight',
          fieldId: caption.dataset?.fieldid || ''
        });
      }
    }

    const cleanFields = fields.map(({ _fingerprint, ...item }) => item);
    const url = buildingId ? `/building/${buildingId}` : String(sourceUrl || '');
    return {
      id: String(buildingId || ''),
      address,
      url,
      fields: cleanFields
    };
  }

  function parseBuildingCoreHtml(html, sourceUrl = '') {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return parseBuildingCoreDocument(doc, sourceUrl);
  }

  function extractBuildingLinks(doc) {
    if (!doc?.querySelectorAll) return [];
    const found = new Map();
    for (const anchor of doc.querySelectorAll('#dataSearchResultId a[href^="/building/"]')) {
      const href = String(anchor.getAttribute('href') || '');
      const match = href.match(/^\/building\/(\d+)(?:[/?#]|$)/i);
      if (!match) continue;
      const id = match[1];
      if (!found.has(id)) {
        found.set(id, {
          id,
          url: `/building/${id}`,
          address: compactText(anchor.textContent || '')
        });
      }
    }
    return [...found.values()];
  }

  function listPageInfo(doc) {
    const resultRoot = doc?.querySelector?.('#dataSearchResultId');
    const total = Number(compactText(resultRoot?.querySelector('.paging b')?.textContent || '').replace(/\D+/g, '')) || 0;
    const links = extractBuildingLinks(doc);
    let maxPage = 1;
    for (const anchor of resultRoot?.querySelectorAll?.('.paging a[href*="page="]') || []) {
      try {
        const u = new URL(anchor.getAttribute('href'), location.origin);
        maxPage = Math.max(maxPage, Number(u.searchParams.get('page')) || 1);
      } catch (_) {}
    }
    const perPage = links.length || 200;
    const estimatedPages = total && perPage ? Math.ceil(total / perPage) : 1;
    return { total, perPage, pages: Math.max(maxPage, estimatedPages), links };
  }

  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => chrome.storage.local.set(value, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err); else resolve();
    }));
  }

  async function fetchText(url, attempt = 0) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-SIMNET-WB-READONLY': 'crm-building-index' }
      });
      const finalUrl = String(response.url || url);
      if (/\/sso\.php(?:[?#]|$)/i.test(finalUrl)) {
        throw new Error('UserSide redirected request to SSO; authentication/session must be refreshed');
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= MAX_RETRIES) throw error;
      await sleep(600 + attempt * 700);
      return fetchText(url, attempt + 1);
    }
  }

  function baseListUrl() {
    const url = new URL(location.href);
    url.pathname = '/address/building_list';
    url.hash = '';
    url.searchParams.delete('page');
    return url;
  }

  async function discoverBuildings(onProgress) {
    const base = baseListUrl();
    base.searchParams.set('page', '1');
    const firstHtml = await fetchText(base.toString());
    const firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');
    const info = listPageInfo(firstDoc);
    const buildings = new Map(info.links.map(item => [item.id, item]));
    onProgress?.({ phase: 'discover', page: 1, pages: info.pages, found: buildings.size, total: info.total });

    for (let page = 2; page <= info.pages; page += 1) {
      if (stopRequested) break;
      const url = new URL(base.toString());
      url.searchParams.set('page', String(page));
      const html = await fetchText(url.toString());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const item of extractBuildingLinks(doc)) buildings.set(item.id, item);
      onProgress?.({ phase: 'discover', page, pages: info.pages, found: buildings.size, total: info.total });
      await sleep(70);
    }
    return { buildings: [...buildings.values()], totalReported: info.total, pages: info.pages };
  }

  function makeSnapshot(previous = null) {
    const prior = previous && previous.schema === SCHEMA ? previous : null;
    return {
      schema: SCHEMA,
      version: 1,
      generatedAt: new Date().toISOString(),
      source: {
        origin: location.origin,
        listUrl: baseListUrl().toString(),
        scope: 'building core card only; customer/subscriber table intentionally excluded'
      },
      stats: {
        discovered: Number(prior?.stats?.discovered || 0),
        parsed: Number(prior?.stats?.parsed || 0),
        failed: Number(prior?.stats?.failed || 0),
        complete: Boolean(prior?.stats?.complete)
      },
      buildings: Array.isArray(prior?.buildings) ? prior.buildings : [],
      errors: Array.isArray(prior?.errors) ? prior.errors.slice(-100) : []
    };
  }

  async function persistSnapshot(snapshot, state = {}) {
    snapshot.generatedAt = new Date().toISOString();
    snapshot.stats.parsed = snapshot.buildings.length;
    await storageSet({
      [SNAPSHOT_KEY]: snapshot,
      [CRAWL_STATE_KEY]: {
        updatedAt: snapshot.generatedAt,
        ...state
      }
    });
  }

  async function crawlAllBuildings(onProgress) {
    if (running) return;
    running = true;
    stopRequested = false;
    try {
      const stored = await storageGet([SNAPSHOT_KEY, CRAWL_STATE_KEY]);
      const previous = stored[SNAPSHOT_KEY];
      const previousState = stored[CRAWL_STATE_KEY] || {};
      const snapshot = makeSnapshot(previous);
      const resumeMode = previousState.status === 'stopped' && !snapshot.stats.complete;
      if (!resumeMode && snapshot.stats.complete) {
        snapshot.buildings = [];
        snapshot.errors = [];
        snapshot.stats = { discovered: 0, parsed: 0, failed: 0, complete: false };
      }

      await persistSnapshot(snapshot, { status: 'discovering', processed: snapshot.buildings.length });
      const discovery = await discoverBuildings(onProgress);
      if (stopRequested) {
        snapshot.stats.discovered = discovery.buildings.length;
        snapshot.stats.complete = false;
        await persistSnapshot(snapshot, { status: 'stopped', processed: snapshot.buildings.length, total: discovery.buildings.length });
        return;
      }

      snapshot.stats.discovered = discovery.buildings.length;
      const byId = new Map(snapshot.buildings.map(item => [String(item.id), item]));
      const queue = resumeMode
        ? discovery.buildings.filter(item => !byId.has(String(item.id)))
        : discovery.buildings;
      let cursor = 0;
      let completedThisRun = 0;
      let dirty = 0;

      async function worker(workerId) {
        while (!stopRequested) {
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const item = queue[index];
          let parsed = null;
          try {
            const html = await fetchText(new URL(item.url, location.origin).toString());
            parsed = parseBuildingCoreHtml(html, item.url);
            if (!parsed) throw new Error('core card not found');
            if (!parsed.address) parsed.address = item.address;
            byId.set(String(item.id), parsed);
          } catch (error) {
            snapshot.stats.failed += 1;
            snapshot.errors.push({
              id: item.id,
              url: item.url,
              error: compactText(error?.message || error),
              at: new Date().toISOString()
            });
            snapshot.errors = snapshot.errors.slice(-100);
          }
          completedThisRun += 1;
          dirty += 1;
          snapshot.buildings = [...byId.values()].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
          snapshot.stats.parsed = snapshot.buildings.length;
          onProgress?.({
            phase: 'crawl',
            workerId,
            processed: snapshot.buildings.length,
            attempted: completedThisRun,
            remaining: Math.max(0, queue.length - completedThisRun),
            total: discovery.buildings.length,
            failed: snapshot.stats.failed,
            current: parsed?.address || item.address || item.url
          });
          if (dirty >= SAVE_EVERY) {
            dirty = 0;
            await persistSnapshot(snapshot, {
              status: 'running',
              processed: snapshot.buildings.length,
              total: discovery.buildings.length
            });
          }
          await sleep(REQUEST_DELAY_MS);
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
      snapshot.buildings = [...byId.values()].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      snapshot.stats.parsed = snapshot.buildings.length;
      snapshot.stats.complete = !stopRequested && snapshot.buildings.length + snapshot.stats.failed >= discovery.buildings.length;
      await persistSnapshot(snapshot, {
        status: stopRequested ? 'stopped' : 'complete',
        processed: snapshot.buildings.length,
        total: discovery.buildings.length,
        failed: snapshot.stats.failed
      });
      onProgress?.({ phase: stopRequested ? 'stopped' : 'complete', processed: snapshot.buildings.length, total: discovery.buildings.length, failed: snapshot.stats.failed });
    } finally {
      running = false;
    }
  }

  async function exportSnapshot() {
    const stored = await storageGet(SNAPSHOT_KEY);
    const snapshot = stored[SNAPSHOT_KEY];
    if (!snapshot?.buildings?.length) throw new Error('CRM snapshot ещё не собран');
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `simnet-crm-buildings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stopCrawl() {
    stopRequested = true;
  }

  async function snapshotStats() {
    const stored = await storageGet([SNAPSHOT_KEY, CRAWL_STATE_KEY]);
    const snapshot = stored[SNAPSHOT_KEY];
    const state = stored[CRAWL_STATE_KEY] || {};
    return {
      schema: snapshot?.schema || '',
      buildings: Number(snapshot?.buildings?.length || 0),
      discovered: Number(snapshot?.stats?.discovered || 0),
      failed: Number(snapshot?.stats?.failed || 0),
      complete: Boolean(snapshot?.stats?.complete),
      state
    };
  }

  function ensureIndexerUi() {
    if (location.pathname !== '/address/building_list') return;
    if (document.getElementById('simnet-wb-crm-building-indexer')) return;
    const heading = document.querySelector('#main_content .label_h2');
    if (!heading?.parentElement) return;

    const style = document.createElement('style');
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      #simnet-wb-crm-building-indexer{box-sizing:border-box;margin:8px 0 12px;padding:9px 11px;border:1px solid #cdb7c0;border-left:4px solid #a50046;border-radius:7px;background:#fff8fb;font:12px/1.35 Arial,sans-serif;color:#32121f;max-width:760px}
      #simnet-wb-crm-building-indexer .wb-crm-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      #simnet-wb-crm-building-indexer button{padding:5px 9px;border:1px solid #b9a0aa;border-radius:5px;background:#fff;cursor:pointer}
      #simnet-wb-crm-building-indexer button:hover{border-color:#a50046}
      #simnet-wb-crm-building-indexer button:disabled{opacity:.45;cursor:default}
      #simnet-wb-crm-building-indexer .wb-crm-status{margin-top:6px;color:#674653;white-space:normal}
      #simnet-wb-crm-building-indexer .wb-crm-note{margin-top:4px;color:#866a75;font-size:11px}
    `;
    document.documentElement.appendChild(style);

    const box = document.createElement('div');
    box.id = 'simnet-wb-crm-building-indexer';
    box.dataset.simnetWbOwned = '1';
    box.innerHTML = `
      <div class="wb-crm-row">
        <strong>CRM индекс зданий</strong>
        <button type="button" data-action="start">Собрать / обновить</button>
        <button type="button" data-action="stop" disabled>Стоп</button>
        <button type="button" data-action="export">Экспорт JSON</button>
      </div>
      <div class="wb-crm-status">Проверяю локальный snapshot…</div>
      <div class="wb-crm-note">Парсится только верхняя карточка здания: заметки, рабочая заметка, менеджер, собственник, доп.поля и прочая информация до вкладок. Список абонентов ниже не индексируется.</div>
    `;
    heading.insertAdjacentElement('afterend', box);
    const startBtn = box.querySelector('[data-action="start"]');
    const stopBtn = box.querySelector('[data-action="stop"]');
    const exportBtn = box.querySelector('[data-action="export"]');
    const statusEl = box.querySelector('.wb-crm-status');

    const setRunning = value => {
      startBtn.disabled = value;
      stopBtn.disabled = !value;
      exportBtn.disabled = value;
    };

    const refreshStatus = async () => {
      const stats = await snapshotStats();
      if (!stats.buildings) statusEl.textContent = 'Snapshot ещё не собран.';
      else statusEl.textContent = `Локально: ${stats.buildings}${stats.discovered ? ` / ${stats.discovered}` : ''} зданий${stats.complete ? ' · готово' : ' · незавершённо'}${stats.failed ? ` · ошибок: ${stats.failed}` : ''}.`;
    };

    startBtn.addEventListener('click', async () => {
      setRunning(true);
      statusEl.textContent = 'Начинаю сбор списка зданий…';
      try {
        await crawlAllBuildings(info => {
          if (info.phase === 'discover') statusEl.textContent = `Список зданий: страница ${info.page}/${info.pages} · найдено ${info.found}${info.total ? ` из ${info.total}` : ''}.`;
          else if (info.phase === 'crawl') statusEl.textContent = `Карточки: ${info.processed}/${info.total} · осталось ${info.remaining} · ошибок ${info.failed} · ${info.current || ''}`;
          else if (info.phase === 'complete') statusEl.textContent = `Готово: ${info.processed}/${info.total} зданий · ошибок ${info.failed}.`;
          else if (info.phase === 'stopped') statusEl.textContent = `Остановлено: сохранено ${info.processed}/${info.total} · можно продолжить позже.`;
        });
      } catch (error) {
        statusEl.textContent = `Ошибка индексатора: ${compactText(error?.message || error)}`;
      } finally {
        setRunning(false);
        await refreshStatus().catch(() => {});
      }
    });

    stopBtn.addEventListener('click', () => {
      stopCrawl();
      statusEl.textContent = 'Останавливаю после текущих двух запросов…';
      stopBtn.disabled = true;
    });

    exportBtn.addEventListener('click', async () => {
      try { await exportSnapshot(); }
      catch (error) { statusEl.textContent = compactText(error?.message || error); }
    });

    refreshStatus().catch(() => { statusEl.textContent = 'Не удалось прочитать локальный snapshot.'; });
  }

  wb.crmBuildingParser = {
    SNAPSHOT_KEY,
    CRAWL_STATE_KEY,
    SCHEMA,
    parseBuildingCoreDocument,
    parseBuildingCoreHtml,
    extractBuildingLinks,
    crawlAllBuildings,
    stopCrawl,
    exportSnapshot,
    snapshotStats
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureIndexerUi, { once: true });
  else ensureIndexerUi();
})();
