(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.taskSpecialIndexedNotes || !WB.taskSpecialPolicyV3?.interpretRows) return;

  const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
  const INDEX_KEY = 'simnet_crm_filtered_special_notes_v1';
  const SCHEMA = 'simnet-crm-filtered-special-notes-v1';
  const VERSION = 2;
  const NOTE_KEYS = new Set(['notes', 'working_note', 'можем_подключать_абонентов']);
  const originalPolicy = WB.taskSpecialPolicyV3;

  let cache = null;
  let ensurePromise = null;

  const compact = (value, max = 6000) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 6000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9/]+/giu, ' ')
    .trim();

  function addressKey(value) {
    let raw = compact(value, 800);
    if (!raw) return '';
    raw = raw
      .replace(/\([^)]{1,120}\)/g, ' ')
      .replace(/[→>]+/g, ' ');
    let normalized = fold(raw)
      .replace(/\b(?:м|місто|город|киев|київ|с|село|смт|район|р-н)\b/giu, ' ')
      .replace(/\b(?:вул|улица|вулиця|ул|проспект|просп|пр-т|провулок|переулок|пров|пл|площа|бульвар|бул)\b/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    normalized = normalized.replace(/\b(\d{1,4})\s+([а-яa-z])\b/giu, '$1$2');
    return normalized;
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, result => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve(result || {});
        });
      } catch (error) { reject(error); }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(value, () => {
          const error = chrome.runtime?.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve();
        });
      } catch (error) { reject(error); }
    });
  }

  function rowsFromBuilding(building) {
    const rows = [];
    for (const field of Array.isArray(building?.fields) ? building.fields : []) {
      const key = String(field?.key || '').toLowerCase();
      if (!NOTE_KEYS.has(key)) continue;
      const text = compact(field?.text, 6000);
      if (!text) continue;
      if (key === 'можем_подключать_абонентов') {
        const folded = fold(text);
        if (/^(?:нет|не|ні|нема|немае|false|0)$/iu.test(folded)) {
          rows.push({
            key,
            label: compact(field?.label || 'Можем подключать абонентов', 120),
            text: `Нет возможности подключать абонентов. Исходное поле: ${text}`
          });
        }
        continue;
      }
      rows.push({
        key,
        label: compact(field?.label || key, 120),
        text
      });
    }
    return rows;
  }

  function normalizeRowsForPolicy(rows) {
    const out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== 'object') continue;
      const text = compact(row.text, 6000);
      if (!text) continue;
      out.push({ ...row, text });

      // Some CRM notes express the same hard block in reverse word order, e.g.
      // "подключать нет возможности". The base policy recognizes the canonical
      // "нет возможности подключать" form, so add a semantic hint without
      // replacing or hiding the original evidence.
      if (/(?:подключ\w*|підключ\w*)[^.!?]{0,55}(?:нет|нема(?:є)?|немае)\s+(?:техническ\w*\s+)?(?:возможност\w*|можливост\w*)/iu.test(text)) {
        out.push({
          ...row,
          key: `${String(row.key || 'note')}:connection_block_hint`,
          label: compact(row.label || row.key || 'Заметка', 120),
          text: `Нет возможности подключать абонентов. Исходная заметка: ${text}`
        });
      }
    }
    return out;
  }

  function hasActionableRows(rows, address) {
    if (!rows.length) return false;
    const prepared = normalizeRowsForPolicy(rows);
    const normal = originalPolicy.interpretRows(prepared, { address });
    if (normal.length) return true;
    const domophone = originalPolicy.interpretRows(prepared, { address, taskTypeLabel: 'Домофон' });
    return domophone.length > 0;
  }

  function buildIndex(snapshot) {
    const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
    const indexed = {};
    const collisions = new Set();
    let relevantRows = 0;

    for (const building of buildings) {
      const address = compact(building?.address, 500);
      const key = addressKey(address);
      if (!key) continue;
      const rows = rowsFromBuilding(building);
      if (!hasActionableRows(rows, address)) continue;

      const record = {
        buildingId: String(building?.id || ''),
        address,
        url: String(building?.url || ''),
        rows
      };
      relevantRows += rows.length;

      if (indexed[key] && indexed[key].buildingId !== record.buildingId) {
        collisions.add(key);
        delete indexed[key];
        continue;
      }
      if (!collisions.has(key)) indexed[key] = record;
    }

    return {
      schema: SCHEMA,
      version: VERSION,
      generatedAt: new Date().toISOString(),
      source: {
        snapshotGeneratedAt: String(snapshot?.generatedAt || ''),
        snapshotBuildings: buildings.length,
        snapshotComplete: Boolean(snapshot?.stats?.complete)
      },
      stats: {
        scannedBuildings: buildings.length,
        buildingsWithRelevantNotes: Object.keys(indexed).length,
        relevantRows,
        ambiguousAddressKeys: collisions.size
      },
      buildings: indexed
    };
  }

  function matchesSnapshot(index, snapshot) {
    return Boolean(
      index?.schema === SCHEMA
      && Number(index?.version) === VERSION
      && String(index?.source?.snapshotGeneratedAt || '') === String(snapshot?.generatedAt || '')
      && Number(index?.source?.snapshotBuildings || 0) === Number(snapshot?.buildings?.length || 0)
    );
  }

  async function ensure({ force = false } = {}) {
    if (ensurePromise && !force) return ensurePromise;
    ensurePromise = (async () => {
      const stored = await storageGet([SNAPSHOT_KEY, INDEX_KEY]);
      const snapshot = stored[SNAPSHOT_KEY];
      const existing = stored[INDEX_KEY];
      if (!snapshot || !Array.isArray(snapshot.buildings)) {
        cache = existing?.schema === SCHEMA ? existing : null;
        return cache;
      }
      if (!force && matchesSnapshot(existing, snapshot)) {
        cache = existing;
        return cache;
      }
      const next = buildIndex(snapshot);
      await storageSet({ [INDEX_KEY]: next });
      cache = next;
      WB.log?.info?.('CRM', 'Filtered special-note index rebuilt', next.stats);
      return next;
    })().finally(() => { ensurePromise = null; });
    return ensurePromise;
  }

  function indexedRowsForAddress(address) {
    const key = addressKey(address);
    if (!key || !cache?.buildings?.[key]) return [];
    return Array.isArray(cache.buildings[key].rows) ? cache.buildings[key].rows : [];
  }

  function mergeRows(liveRows, indexedRows) {
    const out = [];
    const seen = new Set();
    for (const row of [...(Array.isArray(liveRows) ? liveRows : []), ...(Array.isArray(indexedRows) ? indexedRows : [])]) {
      const text = compact(row?.text, 6000);
      const key = fold(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...row, text });
    }
    return out;
  }

  function dedupeItems(items) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const scope = item?.scope && typeof item.scope === 'object' ? item.scope : {};
      const key = `${item?.type || ''}|${fold(item?.summary || '')}|${(scope.entrances || []).join(',')}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function interpretRows(rows, context = {}) {
    const liveRows = normalizeRowsForPolicy(rows);
    const indexedRows = normalizeRowsForPolicy(indexedRowsForAddress(context?.address || ''));
    if (!indexedRows.length) return originalPolicy.interpretRows(liveRows, context);

    const livePositive = liveRows.some(row => /(?:можно|можна)\s+(?:полностью\s+)?(?:подключ|підключ)|(?:подключ|підключ)[\p{L}]*\s+(?:можно|можна)/iu.test(String(row?.text || '')));
    const liveItems = originalPolicy.interpretRows(liveRows, context);
    let indexedItems = originalPolicy.interpretRows(indexedRows, context);

    if (livePositive) {
      indexedItems = indexedItems.filter(item => item?.type !== 'connection_block');
    }

    return dedupeItems([...liveItems, ...indexedItems]);
  }

  const wrappedPolicy = Object.freeze({
    ...originalPolicy,
    interpretRows,
    indexedNotesVersion: VERSION
  });

  try { WB.taskSpecialPolicyV3 = wrappedPolicy; } catch {}

  WB.taskSpecialIndexedNotes = Object.freeze({
    schema: SCHEMA,
    version: VERSION,
    storageKey: INDEX_KEY,
    ensure,
    rebuild: () => ensure({ force: true }),
    addressKey,
    rowsForAddress: indexedRowsForAddress,
    stats: () => cache?.stats || null
  });

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[SNAPSHOT_KEY]?.newValue) return;
      cache = null;
      void ensure({ force: true }).catch(error => {
        WB.log?.warn?.('CRM', 'Filtered special-note index rebuild failed', { message: error?.message || String(error) });
      });
    });
  } catch {}

  void ensure().catch(error => {
    WB.log?.warn?.('CRM', 'Filtered special-note index warmup failed', { message: error?.message || String(error) });
  });
})();
