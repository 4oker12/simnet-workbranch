(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.taskSpecialOperationalNotes || !WB.taskSpecialPolicyV3?.interpretRows) return;

  const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
  const INDEX_KEY = 'simnet_crm_operational_notes_v1';
  const VERSION = 1;
  const basePolicy = WB.taskSpecialPolicyV3;
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

  const addressKey = value => WB.taskSpecialIndexedNotes?.addressKey?.(value) || fold(value);

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

  function noteRows(building) {
    return (Array.isArray(building?.fields) ? building.fields : [])
      .filter(field => /^(?:notes|working_note)$/i.test(String(field?.key || '')))
      .map(field => ({
        key: String(field?.key || 'note'),
        label: compact(field?.label || field?.key || 'Заметка', 120),
        text: compact(field?.text, 6000)
      }))
      .filter(row => row.text);
  }

  function item(type, summary, evidence, options = {}) {
    return {
      type,
      severity: options.severity || 'warning',
      summary: compact(summary, 220),
      evidence: compact(evidence, 6000),
      scope: options.scope || { level: 'building', wholeBuilding: true, entrances: [] },
      certainty: options.certainty || 'explicit',
      conditional: Boolean(options.conditional),
      temporalScope: options.temporalScope || 'current_or_unspecified',
      needsReview: Boolean(options.needsReview),
      reviewReasons: options.reviewReasons || [],
      decisionMode: options.decisionMode || (options.severity === 'info' ? 'info' : 'acknowledge_if_scope_matches'),
      priority: Number.isFinite(options.priority) ? options.priority : 20,
      sourceKeys: options.sourceKeys || []
    };
  }

  function sourceTarget(text) {
    if (/диспетчер/iu.test(text)) return 'у диспетчера';
    if (/консьерж|консерж/iu.test(text)) return 'у консьержа';
    if (/охран|охорон/iu.test(text)) return 'у охраны';
    if (/жек|жэк|жед|керуюч|управляющ/iu.test(text)) return 'в ЖЭК/УК';
    if (/электрик|електрик/iu.test(text)) return 'у электрика';
    return '';
  }

  function deriveRow(row) {
    const raw = compact(row?.text, 6000);
    if (!raw) return [];
    const out = [];
    const sourceKeys = [row?.key].filter(Boolean);
    const add = (type, summary, options = {}) => {
      if (!summary) return;
      const key = `${type}|${fold(summary)}`;
      if (out.some(existing => `${existing.type}|${fold(existing.summary)}` === key)) return;
      out.push(item(type, summary, raw, { ...options, sourceKeys }));
    };

    const noPon = /(?:(?:gpon|epon|\bpon\b|пон)[^.!?]{0,32}(?:нет|нема(?:є)?|не\s+буд|неможлив|невозмож)|(?:нет|нема(?:є)?|без)[^.!?]{0,32}(?:gpon|epon|\bpon\b|пон))/iu.test(raw);
    const positiveTechContext = /(?:можно|можна|подключ|підключ|включ|переключ|по\s+gpon|по\s+epon|по\s+pon|\bpon\b\s*[,;:-]?\s*без\s+кабель)/iu.test(raw);
    if (!noPon && positiveTechContext) {
      if (/\bgpon\b/iu.test(raw)) add('technology_restriction', 'GPON — да', { severity: 'info', scope: { level: 'technology', wholeBuilding: false, entrances: [], technologies: ['GPON'] }, priority: 5 });
      else if (/\bepon\b/iu.test(raw)) add('technology_restriction', 'EPON — да', { severity: 'info', scope: { level: 'technology', wholeBuilding: false, entrances: [], technologies: ['EPON'] }, priority: 5 });
      else if (/\bpon\b|\bпон\b/iu.test(raw)) add('technology_restriction', 'PON — да', { severity: 'info', scope: { level: 'technology', wholeBuilding: false, entrances: [], technologies: ['PON'] }, priority: 5 });
    }

    const lead = raw.match(/за\s+(\d{1,2})\s*(минут\w*|хвилин\w*|час\w*|годин\w*)\s+(?:до|перед)\s+(?:заявк\w*|выезд\w*|виїзд\w*|подключ\w*|підключ\w*)/iu);
    const contactAction = /(?:набират|позвон|дзвон|зателефон|связат|зв'язат)/iu.test(raw);
    const beforeContext = /(?:перед\s+(?:заявк\w*|выезд\w*|виїзд\w*|подключ\w*|підключ\w*)|до\s+(?:заявк\w*|выезд\w*|виїзд\w*|подключ\w*|підключ\w*))/iu.test(raw);
    if (lead && contactAction) {
      const target = sourceTarget(raw);
      add('access_coordination', `За ${lead[1]} ${lead[2]} до заявки — связаться${target ? ` ${target}` : ''}`, {
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, priority: 8.5
      });
    } else if (beforeContext && contactAction) {
      const target = sourceTarget(raw);
      add('access_coordination', `Перед заявкой — связаться${target ? ` ${target}` : ' заранее'}`, {
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, priority: 8.5
      });
    }

    if (/(?:заехат|заїхат|зайти|зайти|забрат|забрати)[^.!?]{0,90}(?:отдел\s+продаж|відділ\s+продаж|жек|жэк|жед|диспетчерск|офис|офіс)/iu.test(raw)) {
      let place = 'служебную точку';
      if (/отдел\s+продаж|відділ\s+продаж/iu.test(raw)) place = 'отдел продаж';
      else if (/жек|жэк|жед/iu.test(raw)) place = 'ЖЭК';
      else if (/диспетчерск/iu.test(raw)) place = 'диспетчерскую';
      else if (/офис|офіс/iu.test(raw)) place = 'офис';
      add('access_coordination', `Перед заявкой — заехать в ${place}`, {
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, priority: 8.6
      });
    }

    const keys = /(?:взят|взяти|забрат|забрати|получит|отримат|брать|брати)[^.!?]{0,90}ключ/iu.test(raw);
    const pass = /(?:карт\w*\s*[- ]?пропуск|пропуск)/iu.test(raw);
    if (keys) {
      const target = sourceTarget(raw);
      add('access_coordination', `Доступ — взять ключи${pass ? ' и карту-пропуск' : ''}${target ? ` ${target}` : ''}`, {
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, priority: 8.7
      });
    } else if (pass && /(?:взят|взяти|забрат|получит|отримат|брать|брати)/iu.test(raw)) {
      add('access_coordination', `Доступ — взять пропуск${sourceTarget(raw) ? ` ${sourceTarget(raw)}` : ''}`, {
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, priority: 8.7
      });
    }

    if (/(?:тамбур\w*)/iu.test(raw) && /(?:договор|домов|соглас|узгод|доступ)/iu.test(raw)) {
      add('access_coordination', 'Тамбуры — заранее согласовать доступ', {
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, priority: 8.8
      });
    }

    if (/(?:на\s+выходн\w*|на\s+вихідн\w*)[^.!?]{0,32}(?:не\s+став|не\s+признач|нельзя\s+став)/iu.test(raw)) {
      add('access_window', 'На выходные — заявку не ставить', {
        scope: { level: 'time', wholeBuilding: false, entrances: [] }, priority: 8
      });
    }

    const fields = [];
    const hasMustWrite = /(?:обязательн\w*|обов.?язков\w*|треба|нужно|потрібно)[^.!?]{0,100}(?:указат|вказат|зазначит)|(?:указат|вказат|зазначит)[^.!?]{0,80}(?:обязательн\w*|обов.?язков\w*)/iu.test(raw);
    if (hasMustWrite) {
      if (/точн\w*\s+адрес|точну\s+адрес/iu.test(raw)) fields.push('точный адрес');
      if (/подъезд|парадн|під.?їзд/iu.test(raw)) fields.push('подъезд');
      if (/этаж|поверх/iu.test(raw)) fields.push('этаж');
      if (/(?:активир|активув|пауза|паузу)/iu.test(raw)) fields.push('активацию/паузу');
      if (fields.length) add('special_instruction', `В заявке — указать ${fields.join(', ')}`, {
        scope: { level: 'building', wholeBuilding: true, entrances: [] }, priority: 10.2
      });
    }

    const equipmentMap = [
      [/кассет|касет/iu, 'кассету'],
      [/колодк/iu, 'колодку'],
      [/\bсвич\b|switch/iu, 'свич'],
      [/патчкорд|патч-корд/iu, 'патчкорд'],
      [/толст\w*\s+оптик|товст\w*\s+оптик/iu, 'толстую оптику']
    ];
    if (/(?:обязательн\w*|обов.?язков\w*|нужно|надо|треба|потрібно)[^.!?]{0,70}(?:взят|взяти|брать|брати)|(?:взят|взяти|брать|брати)[^.!?]{0,70}(?:обязательн\w*|обов.?язков\w*)/iu.test(raw)) {
      const equipment = equipmentMap.filter(([re]) => re.test(raw)).map(([, label]) => label);
      if (equipment.length) add('special_instruction', `На выезд — взять ${equipment.join(', ')}`, {
        scope: { level: 'building', wholeBuilding: true, entrances: [] }, priority: 10
      });
    }

    if (/(?:не\s+трогат|не\s+чіпат|не\s+чіпати|не\s+трогать)/iu.test(raw) && /(?:кабел|коннектор|конектор|fast)/iu.test(raw)) {
      add('special_instruction', 'Кабели/коннекторы другого провайдера — не трогать', {
        scope: { level: 'building', wholeBuilding: true, entrances: [] }, priority: 10
      });
    }

    if (/(?:только|лише|тільки)[^.!?]{0,45}(?:наш\w*\s+кабел|син\w*\s+патчкорд|патчкорд)/iu.test(raw)) {
      add('special_instruction', 'Подключение — использовать только указанный кабель/патчкорд', {
        scope: { level: 'building', wholeBuilding: true, entrances: [] }, priority: 10.1
      });
    }

    const strongImperative = /(?:обязательн\w*|обов.?язков\w*|треба|потрібно|необходимо|необхідно|нужно|надо|запрещ\w*|заборон\w*)/iu.test(raw)
      && !/(?:не\s+обязательн|не\s+обов.?язков)/iu.test(raw);
    const concrete = out.some(entry => ['access_coordination','access_window','special_instruction'].includes(entry.type));
    if (strongImperative && !concrete) {
      add('manual_review', 'Есть обязательное условие — проверь исходную заметку', {
        severity: 'review', needsReview: true, certainty: 'ambiguous', decisionMode: 'manual_review',
        reviewReasons: ['unclassified_mandatory_instruction'], priority: 9.5,
        scope: { level: 'mixed', wholeBuilding: false, entrances: [] }
      });
    }

    return out;
  }

  function deriveRows(rows) {
    return (Array.isArray(rows) ? rows : []).flatMap(deriveRow);
  }

  function usefulRow(row) {
    return deriveRow(row).length > 0;
  }

  function buildIndex(snapshot) {
    const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
    const indexed = {};
    const collisions = new Set();
    let rowCount = 0;
    for (const building of buildings) {
      const address = compact(building?.address, 500);
      const key = addressKey(address);
      if (!key) continue;
      const rows = noteRows(building).filter(usefulRow);
      if (!rows.length) continue;
      const record = { buildingId: String(building?.id || ''), address, url: String(building?.url || ''), rows };
      if (indexed[key] && indexed[key].buildingId !== record.buildingId) {
        collisions.add(key);
        delete indexed[key];
        continue;
      }
      if (!collisions.has(key)) {
        indexed[key] = record;
        rowCount += rows.length;
      }
    }
    return {
      schema: 'simnet-crm-operational-notes-v1', version: VERSION, generatedAt: new Date().toISOString(),
      source: { snapshotGeneratedAt: String(snapshot?.generatedAt || ''), snapshotBuildings: buildings.length },
      stats: { scannedBuildings: buildings.length, buildingsWithOperationalNotes: Object.keys(indexed).length, operationalRows: rowCount, ambiguousAddressKeys: collisions.size },
      buildings: indexed
    };
  }

  function matches(index, snapshot) {
    return Boolean(index?.version === VERSION
      && String(index?.source?.snapshotGeneratedAt || '') === String(snapshot?.generatedAt || '')
      && Number(index?.source?.snapshotBuildings || 0) === Number(snapshot?.buildings?.length || 0));
  }

  async function ensure({ force = false } = {}) {
    if (ensurePromise && !force) return ensurePromise;
    ensurePromise = (async () => {
      const stored = await storageGet([SNAPSHOT_KEY, INDEX_KEY]);
      const snapshot = stored[SNAPSHOT_KEY];
      const existing = stored[INDEX_KEY];
      if (!snapshot || !Array.isArray(snapshot.buildings)) {
        cache = existing?.version === VERSION ? existing : null;
        return cache;
      }
      if (!force && matches(existing, snapshot)) {
        cache = existing;
        return cache;
      }
      const next = buildIndex(snapshot);
      await storageSet({ [INDEX_KEY]: next });
      cache = next;
      WB.log?.info?.('CRM', 'Operational-note index rebuilt', next.stats);
      return next;
    })().finally(() => { ensurePromise = null; });
    return ensurePromise;
  }

  function indexedRows(address) {
    const key = addressKey(address);
    return key && cache?.buildings?.[key]?.rows ? cache.buildings[key].rows : [];
  }

  function mergeRows(...groups) {
    const out = [];
    const seen = new Set();
    for (const row of groups.flat()) {
      const key = fold(row?.text || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  function dedupe(items) {
    const out = [];
    const seen = new Set();
    for (const entry of items) {
      const scope = entry?.scope || {};
      const key = `${entry?.type || ''}|${fold(entry?.summary || '')}|${(scope.entrances || []).join(',')}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
    return out.sort((a, b) => Number(a?.priority ?? 50) - Number(b?.priority ?? 50));
  }

  function interpretRows(rows, context = {}) {
    let base = basePolicy.interpretRows(rows, context);
    const allRows = mergeRows(rows || [], indexedRows(context?.address || ''));
    const operational = deriveRows(allRows);

    const concreteAccess = operational.some(entry => entry.type === 'access_coordination');
    const concreteInstruction = operational.some(entry => entry.type === 'special_instruction');
    if (concreteAccess) {
      base = base.filter(entry => !/^(?:Ключи\s*\/\s*доступ\s*—\s*особое условие|Доступ\s*—\s*особое условие|Доступ нужно согласовать заранее)$/iu.test(String(entry?.summary || '')));
    }
    if (concreteInstruction) {
      base = base.filter(entry => !/^(?:Особая инструкция|Обязательная инструкция|Дополнительное условие)/iu.test(String(entry?.summary || '')));
    }
    return dedupe([...base, ...operational]);
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({ ...basePolicy, interpretRows, operationalNotesVersion: VERSION });
  } catch {}

  WB.taskSpecialOperationalNotes = Object.freeze({
    version: VERSION,
    storageKey: INDEX_KEY,
    ensure,
    rebuild: () => ensure({ force: true }),
    rowsForAddress: indexedRows,
    deriveRows,
    stats: () => cache?.stats || null
  });

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[SNAPSHOT_KEY]?.newValue) return;
      cache = null;
      void ensure({ force: true }).catch(error => WB.log?.warn?.('CRM', 'Operational-note index rebuild failed', { message: error?.message || String(error) }));
    });
  } catch {}

  void ensure().catch(error => WB.log?.warn?.('CRM', 'Operational-note index warmup failed', { message: error?.message || String(error) }));
})();
