(() => {
  'use strict';

  if (window.top !== window.self) return;
  if (location.pathname !== '/address/building_list') return;

  const wb = globalThis.SIMNET_WB;
  if (!wb) return;

  function compactText(value, max = 500) {
    const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  }

  async function mount(attempt = 0) {
    if (document.getElementById('simnet-wb-crm-building-indexer')) return;

    const parser = wb.crmBuildingParser;
    const importer = wb.crmBuildingImport;
    if (!parser || !importer) {
      if (attempt < 10) setTimeout(() => mount(attempt + 1), 100);
      return;
    }

    const header = document.querySelector('#main_content .erp_page_header');
    const content = document.querySelector('#div_contentplace');
    if (!header && !content) {
      if (attempt < 10) setTimeout(() => mount(attempt + 1), 100);
      return;
    }

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
        <button type="button" data-action="import-json">Импорт JSON</button>
        <input type="file" accept=".json,application/json" hidden data-action="import-json-file">
      </div>
      <div class="wb-crm-status">Проверяю локальный snapshot…</div>
      <div class="wb-crm-note">Локальный индекс карточек домов UserSide. Можно импортировать готовый JSON без повторного обхода всех домов.</div>
    `;

    if (header?.parentElement) header.insertAdjacentElement('afterend', box);
    else content.prepend(box);

    const startBtn = box.querySelector('[data-action="start"]');
    const stopBtn = box.querySelector('[data-action="stop"]');
    const exportBtn = box.querySelector('[data-action="export"]');
    const importBtn = box.querySelector('[data-action="import-json"]');
    const fileInput = box.querySelector('[data-action="import-json-file"]');
    const statusEl = box.querySelector('.wb-crm-status');

    const setRunning = value => {
      startBtn.disabled = value;
      stopBtn.disabled = !value;
      exportBtn.disabled = value;
      importBtn.disabled = value;
    };

    const refreshStatus = async () => {
      const stats = await parser.snapshotStats();
      if (!stats.buildings) statusEl.textContent = 'Snapshot ещё не загружен.';
      else statusEl.textContent = `Локально: ${stats.buildings}${stats.discovered ? ` / ${stats.discovered}` : ''} зданий${stats.complete ? ' · готово' : ' · незавершённо'}${stats.failed ? ` · ошибок: ${stats.failed}` : ''}.`;
    };

    startBtn.addEventListener('click', async () => {
      setRunning(true);
      statusEl.textContent = 'Начинаю сбор списка зданий…';
      try {
        await parser.crawlAllBuildings(info => {
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
      parser.stopCrawl();
      statusEl.textContent = 'Останавливаю после текущих запросов…';
      stopBtn.disabled = true;
    });

    exportBtn.addEventListener('click', async () => {
      try { await parser.exportSnapshot(); }
      catch (error) { statusEl.textContent = compactText(error?.message || error); }
    });

    importBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      importBtn.disabled = true;
      statusEl.textContent = `Импортирую ${compactText(file.name, 120)}…`;
      try {
        const stats = await importer.importSnapshotFile(file);
        statusEl.textContent = `Импортировано: ${stats.buildings}${stats.discovered ? ` / ${stats.discovered}` : ''} зданий${stats.complete ? ' · готово' : ' · snapshot незавершённый'}${stats.failed ? ` · ошибок в исходном snapshot: ${stats.failed}` : ''}.`;
      } catch (error) {
        statusEl.textContent = `Ошибка импорта: ${compactText(error?.message || error)}`;
      } finally {
        importBtn.disabled = false;
      }
    });

    refreshStatus().catch(() => { statusEl.textContent = 'Не удалось прочитать локальный snapshot.'; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  else mount();
})();
