(() => {
  'use strict';

  if (window.top !== window.self) return;
  const wb = globalThis.SIMNET_WB;
  if (!wb) return;

  const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
  const CRAWL_STATE_KEY = 'simnet_crm_building_crawl_state_v1';
  const SCHEMA = 'simnet-crm-building-snapshot-v1';
  const MAX_IMPORT_BYTES = 120 * 1024 * 1024;

  function compactText(value, max = 500) {
    const normalized = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => chrome.storage.local.set(value, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(error);
      else resolve();
    }));
  }

  function normalizeField(field = {}) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
    const key = compactText(field.key, 100);
    const label = compactText(field.label, 180);
    const text = compactText(field.text, 4000);
    if (!key || !text) return null;
    return {
      key,
      label: label || key,
      text,
      source: compactText(field.source || 'main_card', 80),
      ...(field.fieldId ? { fieldId: compactText(field.fieldId, 80) } : {})
    };
  }

  function normalizeBuilding(building = {}) {
    if (!building || typeof building !== 'object' || Array.isArray(building)) return null;
    const id = compactText(building.id, 80);
    const address = compactText(building.address, 500);
    if (!id && !address) return null;
    const fields = (Array.isArray(building.fields) ? building.fields : [])
      .map(normalizeField)
      .filter(Boolean);
    return {
      id,
      address,
      url: compactText(building.url || (id ? `/building/${id}` : ''), 300),
      fields
    };
  }

  function validateSnapshot(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Файл не похож на CRM snapshot зданий.');
    }
    if (String(input.schema || '') !== SCHEMA) {
      throw new Error(`Неверная схема snapshot: ожидается ${SCHEMA}.`);
    }
    if (!Array.isArray(input.buildings) || !input.buildings.length) {
      throw new Error('В snapshot нет карточек зданий.');
    }

    const buildings = input.buildings.map(normalizeBuilding).filter(Boolean);
    if (!buildings.length) throw new Error('В snapshot нет корректных карточек зданий.');
    if (buildings.length !== input.buildings.length) {
      throw new Error(`Snapshot повреждён: корректно ${buildings.length} из ${input.buildings.length} карточек.`);
    }

    const seenIds = new Set();
    for (const building of buildings) {
      if (!building.id) continue;
      if (seenIds.has(building.id)) throw new Error(`Snapshot содержит повторяющийся building ID ${building.id}.`);
      seenIds.add(building.id);
    }

    const discovered = Number(input?.stats?.discovered || buildings.length);
    const failed = Number(input?.stats?.failed || 0);
    const generatedAt = compactText(input.generatedAt, 100);
    return {
      ...input,
      schema: SCHEMA,
      version: Number(input.version || 1),
      generatedAt: generatedAt || new Date().toISOString(),
      source: input.source && typeof input.source === 'object' && !Array.isArray(input.source) ? { ...input.source } : {},
      stats: {
        discovered: Number.isFinite(discovered) && discovered > 0 ? discovered : buildings.length,
        parsed: buildings.length,
        failed: Number.isFinite(failed) && failed >= 0 ? failed : 0,
        complete: Boolean(input?.stats?.complete)
      },
      buildings,
      errors: Array.isArray(input.errors) ? input.errors.slice(-100) : []
    };
  }

  async function importSnapshotObject(input, fileName = '') {
    const snapshot = validateSnapshot(input);
    const importedAt = new Date().toISOString();
    snapshot.importMeta = {
      importedAt,
      importedFrom: compactText(fileName, 260),
      originalGeneratedAt: snapshot.generatedAt
    };
    await storageSet({
      [SNAPSHOT_KEY]: snapshot,
      [CRAWL_STATE_KEY]: {
        status: 'imported',
        updatedAt: importedAt,
        importedAt,
        importedFrom: compactText(fileName, 260),
        processed: snapshot.buildings.length,
        total: snapshot.stats.discovered,
        failed: snapshot.stats.failed
      }
    });
    return {
      buildings: snapshot.buildings.length,
      discovered: snapshot.stats.discovered,
      failed: snapshot.stats.failed,
      complete: snapshot.stats.complete,
      generatedAt: snapshot.generatedAt,
      importedAt
    };
  }

  async function importSnapshotFile(file) {
    if (!file) throw new Error('Файл не выбран.');
    if (Number(file.size || 0) > MAX_IMPORT_BYTES) throw new Error('Файл слишком большой для импорта.');
    const raw = await file.text();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Не удалось разобрать JSON-файл.'); }
    return importSnapshotObject(parsed, file.name || '');
  }

  function ensureImportUi(attempt = 0) {
    if (location.pathname !== '/address/building_list') return;
    const box = document.getElementById('simnet-wb-crm-building-indexer');
    if (!box) {
      if (attempt < 6) setTimeout(() => ensureImportUi(attempt + 1), 120);
      return;
    }
    if (box.querySelector('[data-action="import-json"]')) return;

    const row = box.querySelector('.wb-crm-row');
    const statusEl = box.querySelector('.wb-crm-status');
    if (!row || !statusEl) return;

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.dataset.action = 'import-json';
    importBtn.textContent = 'Импорт JSON';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    fileInput.dataset.action = 'import-json-file';

    row.append(importBtn, fileInput);

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
        const stats = await importSnapshotFile(file);
        statusEl.textContent = `Импортировано: ${stats.buildings}${stats.discovered ? ` / ${stats.discovered}` : ''} зданий${stats.complete ? ' · готово' : ' · snapshot незавершённый'}${stats.failed ? ` · ошибок в исходном snapshot: ${stats.failed}` : ''}.`;
      } catch (error) {
        statusEl.textContent = `Ошибка импорта: ${compactText(error?.message || error)}`;
      } finally {
        importBtn.disabled = false;
      }
    });
  }

  wb.crmBuildingImport = {
    SNAPSHOT_KEY,
    CRAWL_STATE_KEY,
    SCHEMA,
    validateSnapshot,
    importSnapshotObject,
    importSnapshotFile
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ensureImportUi(), { once: true });
  else ensureImportUi();
})();
