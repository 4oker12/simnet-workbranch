(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.crmConstraints) return;

  const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
  const INDEX_KEY = 'simnet_crm_building_constraints_v1';
  const SCHEMA = 'simnet-crm-building-constraints-v1';
  const VERSION = 1;
  const MAX_PER_BUILDING = 14;
  const MAX_PER_TYPE = 3;

  const STRUCTURAL_FIELDS = new Set([
    'building_id', 'subscriber_count', 'activity', 'building_type', 'entrances', 'floors',
    'apartments', 'penetration', 'coordinates', 'manager', 'owner', 'management', 'ktv', 'gpon',
    'можем_подключать_абонентов'
  ]);

  const TYPE_META = Object.freeze({
    connection_block: {
      label: 'Подключение может быть невозможно', severity: 'blocker',
      action: 'Проверь техническую возможность до обещания абоненту и назначения выезда.',
      appliesTo: ['connection', 'preconnection'], requireAck: true
    },
    infrastructure_capacity: {
      label: 'Ограничение инфраструктуры', severity: 'blocker',
      action: 'Проверь свободную инфраструктуру/маршрут до создания подключения.',
      appliesTo: ['connection', 'preconnection'], requireAck: true
    },
    entrance_scope: {
      label: 'Ограничение по подъезду/секции', severity: 'warning',
      action: 'Сверь подъезд/секцию абонента с разрешённой зоной подключения.',
      appliesTo: ['connection', 'repair', 'preconnection'], requireAck: true
    },
    speed_limit: {
      label: 'Ограничение скорости/тарифа', severity: 'warning',
      action: 'Не обещай тариф выше указанного ограничения без дополнительной проверки.',
      appliesTo: ['connection', 'preconnection'], requireAck: true
    },
    technology_restriction: {
      label: 'Ограничение технологии', severity: 'warning',
      action: 'Проверь, что заявка оформляется на разрешённую технологию.',
      appliesTo: ['connection', 'preconnection'], requireAck: true
    },
    service_restriction: {
      label: 'Ограничение услуги/условий', severity: 'warning',
      action: 'Учти ограничение при согласовании услуги с абонентом.',
      appliesTo: ['connection', 'preconnection'], requireAck: true
    },
    access_window: {
      label: 'Ограничение по времени доступа', severity: 'warning',
      action: 'Согласуй дату/время так, чтобы мастер реально получил доступ.',
      appliesTo: ['connection', 'repair', 'preconnection'], requireAck: true
    },
    access_coordination: {
      label: 'Нужно заранее согласовать доступ', severity: 'warning',
      action: 'Предупреди/созвонись с ответственным лицом до выезда, если это ещё не сделано.',
      appliesTo: ['connection', 'repair', 'preconnection'], requireAck: true
    },
    access_route: {
      label: 'Особый маршрут доступа', severity: 'info',
      action: 'Передай мастеру, откуда/через что заходить к оборудованию.',
      appliesTo: ['connection', 'repair'], requireAck: false
    },
    special_instruction: {
      label: 'Специальная инструкция', severity: 'warning',
      action: 'Учти инструкцию из карточки дома при оформлении/передаче заявки.',
      appliesTo: ['connection', 'repair', 'preconnection'], requireAck: true
    }
  });

  const RULES = Object.freeze([
    {
      type: 'entrance_scope',
      re: /(?:(?:только|лише|тільки)[^.!?]{0,90}(?:подъезд\w*|під.?їзд\w*|парадн\w*|секц\w*)|(?:подъезд\w*|під.?їзд\w*|парадн\w*|секц\w*)[^.!?]{0,90}(?:не\s+подключ\w*|не\s+підключ\w*|не\s+можно|не\s+можна))/giu
    },
    {
      type: 'speed_limit',
      re: /(?:не\s+(?:больше|більше)|не\s+(?:выше|вище)|максимум|до)\s*\d{2,5}\s*(?:мбит(?:\/с)?|мбіт(?:\/с)?|мегабит\w*)/giu
    },
    {
      type: 'technology_restriction',
      re: /(?:(?:только|лише|тільки)\s+(?:по\s+)?(?:gpon|epon|pon|пону|оптик\w*|ethernet|езернет|вит(?:ой|а)\s+пар\w*)|(?:по\s+)?(?:вит(?:ой|а)\s+пар\w*|ethernet|езернет|gpon|epon|pon|пону|оптик\w*)[^.!?]{0,55}(?:не\s+подключ\w*|не\s+підключ\w*))/giu
    },
    {
      type: 'infrastructure_capacity',
      re: /(?:(?:трубк\w*|канал\w*|порт\w*)[^.!?]{0,35}(?:забит\w*|занят\w*|зайнят\w*)|(?:нет|нема(?:є)?)\s+(?:свободн\w*|вільн\w*)[^.!?]{0,45}(?:труб\w*|порт\w*|мест\w*|місц\w*))/giu
    },
    {
      type: 'connection_block',
      re: /(?:(?:нет|нема(?:є)?)\s+(?:техническ\w*\s+)?(?:возможност\w*|можливост\w*)[^.!?]{0,55}(?:подключ\w*|підключ\w*)|(?:подключ\w*|підключ\w*)[^.!?]{0,35}(?:невозмож\w*|неможлив\w*)|(?:не\s+подключаем\w*|не\s+підключаємо\w*|не\s+подключать|не\s+підключати))/giu
    },
    {
      type: 'access_window',
      re: /(?:(?:ключ\w*|доступ\w*|жек\w*|жэк\w*|диспетчер\w*)[^.!?]{0,95}(?:до\s*\d{1,2}(?::\d{2})?|обед\w*\s*[:\-]?\s*с?\s*\d{1,2}(?::\d{2})?)|(?:на|в)\s+(?:выходн\w*|вихідн\w*)[^.!?]{0,90}(?:не\s+ставить|не\s+дают\w*|не\s+видають\w*|нема(?:є)?\s+нік|ключ\w*|закрыт\w*))/giu
    },
    {
      type: 'access_coordination',
      re: /(?:(?:звон\w*|дзвон\w*|телефонув\w*)[^.!?]{0,65}(?:заранее|завчасно|наперед)|(?:предупрежд\w*|попередж\w*)[^.!?]{0,75}|(?:договор\w*|домов\w*|согласов\w*|узгод\w*)[^.!?]{0,75}(?:доступ\w*|ключ\w*|подключ\w*|підключ\w*|ремонт\w*|выезд\w*|виїзд\w*))/giu
    },
    {
      type: 'access_route',
      re: /(?:(?:доступ\w*|вход\w*|вхід\w*)[^.!?]{0,85}(?:через|зі\s+сторони|со\s+стороны|з\s+боку))/giu
    },
    {
      type: 'service_restriction',
      re: /(?:(?:акци\w*|акці\w*)[^.!?]{0,45}(?:недоступ\w*|не\s+действ\w*|не\s+діють)|(?:ктв|кабельн\w*\s+тв)[^.!?]{0,45}(?:не\s+подключ\w*|не\s+підключ\w*|нет|нема(?:є)?))/giu
    },
    {
      type: 'special_instruction',
      re: /(?:(?:не\s+трогать|не\s+чіпати|не\s+трогайте|не\s+чіпайте)[^.!?]{0,100}|(?:обязательно|обов'язково|обовязково)[^.!?]{0,100})/giu
    }
  ]);

  let cachedIndex = null;
  let ensurePromise = null;

  const compact = (value, max = 420) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 4000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9]+/giu, ' ').trim();

  function hashText(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function evidenceWindow(text, start, length) {
    const raw = compact(text, 5000);
    const leftLimit = Math.max(0, Number(start || 0) - 95);
    const rightLimit = Math.min(raw.length, Number(start || 0) + Number(length || 0) + 145);
    let left = leftLimit;
    let right = rightLimit;
    for (let i = Number(start || 0) - 1; i >= leftLimit; i -= 1) {
      if (/[.!?;]/.test(raw[i])) { left = i + 1; break; }
    }
    for (let i = Number(start || 0) + Number(length || 0); i < rightLimit; i += 1) {
      if (/[.!?;]/.test(raw[i])) { right = i + 1; break; }
    }
    return compact(raw.slice(left, right), 280);
  }

  function tokenOverlap(a, b) {
    const aa = new Set(fold(a).split(/\s+/).filter(token => token.length > 2));
    const bb = new Set(fold(b).split(/\s+/).filter(token => token.length > 2));
    if (!aa.size || !bb.size) return 0;
    let common = 0;
    for (const token of aa) if (bb.has(token)) common += 1;
    return common / Math.min(aa.size, bb.size);
  }

  function sourceFields(building) {
    return (Array.isArray(building?.fields) ? building.fields : [])
      .filter(field => {
        const key = String(field?.key || '').toLowerCase();
        const text = compact(field?.text, 5000);
        return text.length >= 5 && !STRUCTURAL_FIELDS.has(key);
      });
  }

  function normalizedConstraint(type, building, field, evidence, confidence = 0.88) {
    const meta = TYPE_META[type] || TYPE_META.special_instruction;
    const sourceField = String(field?.key || 'unknown');
    const sourceLabel = compact(field?.label || sourceField, 100);
    const cleanEvidence = compact(evidence, 280);
    return {
      id: `${String(building?.id || 'unknown')}:${type}:${hashText(`${sourceField}|${fold(cleanEvidence)}`)}`,
      type,
      label: meta.label,
      severity: meta.severity,
      address: compact(building?.address, 320),
      buildingId: String(building?.id || ''),
      url: String(building?.url || ''),
      sourceField,
      sourceLabel,
      evidence: cleanEvidence,
      action: meta.action,
      appliesTo: [...meta.appliesTo],
      requireAck: Boolean(meta.requireAck),
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0))
    };
  }

  function extractBuildingConstraints(building) {
    if (!building || typeof building !== 'object') return [];
    const found = [];
    const perType = new Map();

    const add = constraint => {
      if (!constraint?.evidence) return;
      const sameType = found.filter(item => item.type === constraint.type);
      if (sameType.some(item => tokenOverlap(item.evidence, constraint.evidence) >= 0.72)) return;
      const count = perType.get(constraint.type) || 0;
      if (count >= MAX_PER_TYPE || found.length >= MAX_PER_BUILDING) return;
      perType.set(constraint.type, count + 1);
      found.push(constraint);
    };

    for (const field of sourceFields(building)) {
      const text = compact(field.text, 5000);
      for (const rule of RULES) {
        const re = new RegExp(rule.re.source, rule.re.flags);
        for (const match of text.matchAll(re)) {
          const evidence = evidenceWindow(text, match.index || 0, String(match[0] || '').length);
          let type = rule.type;
          if (type === 'connection_block' && /(?:подъезд|під.?їзд|парадн|секц)/iu.test(evidence)) {
            type = 'entrance_scope';
          }
          add(normalizedConstraint(type, building, field, evidence));
        }
      }
    }

    const rank = { blocker: 0, warning: 1, info: 2 };
    return found.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.confidence - a.confidence);
  }

  function buildFromSnapshot(snapshot) {
    const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
    const indexed = {};
    const byType = {};
    let totalConstraints = 0;
    let blockers = 0;
    let warnings = 0;
    let infos = 0;

    for (const building of buildings) {
      const constraints = extractBuildingConstraints(building);
      if (!constraints.length) continue;
      const id = String(building?.id || '');
      if (!id) continue;
      indexed[id] = {
        id,
        address: compact(building?.address, 320),
        url: String(building?.url || ''),
        constraints
      };
      for (const item of constraints) {
        totalConstraints += 1;
        byType[item.type] = (byType[item.type] || 0) + 1;
        if (item.severity === 'blocker') blockers += 1;
        else if (item.severity === 'warning') warnings += 1;
        else infos += 1;
      }
    }

    return {
      schema: SCHEMA,
      version: VERSION,
      generatedAt: new Date().toISOString(),
      source: {
        snapshotSchema: String(snapshot?.schema || ''),
        snapshotGeneratedAt: String(snapshot?.generatedAt || ''),
        snapshotComplete: Boolean(snapshot?.stats?.complete),
        snapshotBuildings: buildings.length
      },
      stats: {
        scannedBuildings: buildings.length,
        buildingsWithConstraints: Object.keys(indexed).length,
        constraints: totalConstraints,
        blockers,
        warnings,
        infos,
        byType
      },
      buildings: indexed
    };
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, value => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve(value || {});
        });
      } catch (error) { reject(error); }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(value, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message || String(error)));
          else resolve();
        });
      } catch (error) { reject(error); }
    });
  }

  function indexMatchesSnapshot(index, snapshot) {
    return Boolean(
      index?.schema === SCHEMA
      && Number(index?.version) === VERSION
      && String(index?.source?.snapshotGeneratedAt || '') === String(snapshot?.generatedAt || '')
      && Number(index?.source?.snapshotBuildings || 0) === Number(snapshot?.buildings?.length || 0)
    );
  }

  async function ensureIndex({ force = false } = {}) {
    if (ensurePromise && !force) return ensurePromise;
    ensurePromise = (async () => {
      const stored = await storageGet([SNAPSHOT_KEY, INDEX_KEY]);
      const snapshot = stored[SNAPSHOT_KEY];
      const existing = stored[INDEX_KEY];
      if (!snapshot || !Array.isArray(snapshot.buildings)) {
        cachedIndex = null;
        return null;
      }
      if (!force && indexMatchesSnapshot(existing, snapshot)) {
        cachedIndex = existing;
        return existing;
      }
      const next = buildFromSnapshot(snapshot);
      await storageSet({ [INDEX_KEY]: next });
      cachedIndex = next;
      WB.log?.info?.('CRM', 'Operational constraints index rebuilt', next.stats);
      return next;
    })().finally(() => { ensurePromise = null; });
    return ensurePromise;
  }

  async function getByBuildingId(buildingId) {
    const id = String(buildingId || '').replace(/\D+/g, '');
    if (!id) return null;
    const index = cachedIndex || await ensureIndex();
    return index?.buildings?.[id] || null;
  }

  async function stats() {
    const index = cachedIndex || await ensureIndex();
    return index?.stats || null;
  }

  function peekByBuildingId(buildingId) {
    const id = String(buildingId || '').replace(/\D+/g, '');
    return id ? cachedIndex?.buildings?.[id] || null : null;
  }

  WB.crmConstraints = Object.freeze({
    schema: SCHEMA,
    snapshotKey: SNAPSHOT_KEY,
    storageKey: INDEX_KEY,
    ensure: ensureIndex,
    rebuild: () => ensureIndex({ force: true }),
    getByBuildingId,
    peekByBuildingId,
    stats,
    buildFromSnapshot,
    extractBuildingConstraints
  });

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes?.[SNAPSHOT_KEY]?.newValue) return;
      cachedIndex = null;
      void ensureIndex({ force: true }).catch(error => {
        WB.log?.warn?.('CRM', 'Constraint index rebuild failed after snapshot change', { message: error?.message || String(error) });
      });
    });
  } catch {}

  setTimeout(() => {
    void ensureIndex().catch(error => {
      WB.log?.warn?.('CRM', 'Constraint index warmup failed', { message: error?.message || String(error) });
    });
  }, 0);
})();
