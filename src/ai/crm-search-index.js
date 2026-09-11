export * from './crm-search-index-base.js';
import * as base from './crm-search-index-base.js';

export const CRM_SEARCH_INDEX_REVISION = 'crm-search-building-core-v7-compound-address-live-context';
export const CRM_SPECIAL_NOTES_STORAGE_KEY = 'simnet_crm_filtered_special_notes_v1';
export const CRM_LIVE_CONTEXT_STORAGE_KEY = 'simnet_crm_live_building_context_v1';

const CRM_RESPONSE_PRESENTATION_POLICY = `RESPONSE_PRESENTATION_POLICY:
- Отвечай как опытный коллега, а не как выгрузка полей CRM. Сначала осмысли факты и дай цельный прямой ответ на вопрос оператора.
- Не перечисляй сырые куски заметок один за другим. Повторы и одинаковый смысл объединяй в одну нормальную формулировку.
- Каждый новый смысловой блок начинай с нового абзаца. Если фактов несколько, группируй только по реально нужным темам: подключение/ограничения, технология и услуги, доступ/ключи/время, стоимость/условия, контакты. Не создавай пустые или формальные заголовки.
- Перечисление используй только когда действительно есть несколько однотипных пунктов, домов, подъездов, условий или действий. Один факт оформляй обычным предложением.
- Самое важное условие, запрет или риск ставь первым и при необходимости выделяй **жирным**. Справочную информацию давай после него.
- Если оператор спросил конкретно про GPON, доступ, ключи, возможность подключения, дом или улицу — отвечай прежде всего на этот вопрос, без лишнего полного пересказа карточки.
- Строка [ВАЖНЫЕ УСЛОВИЯ ИЗ ФИЛЬТРА] означает, что заметка уже прошла локальный high-signal фильтр Workbench. Учитывай её в первую очередь, но не расширяй смысл: запрет конкретного подъезда не становится запретом всего дома; доступ через ЖЭК не равен технической невозможности; ограничение услуги не равно запрету технологии.
- Строка [ТЕКУЩАЯ КАРТОЧКА USERSIDE] означает данные непосредственно из открытой сейчас формы/карточки UserSide. Для этого точного адреса они приоритетнее старого снимка. Если такая строка есть, нельзя отвечать, что дом отсутствует в индексе.
- Формулировка «только GPON/EPON/PON» означает ограничение технологии. Не превращай её в слабое «GPON — да»: скажи прямо «подключение только по GPON».
- Не делай вывод из отсутствующего поля. Если источники реально противоречат друг другу, прямо скажи, что данные требуют проверки, а не выбирай удобную трактовку.
- Пиши нормальными законченными предложениями, с пунктуацией и естественными переносами. Не выдавай служебные названия полей, JSON или внутреннюю механику индекса.`;

function compact(value, max = 1100) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function fold(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9/]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function storageLocalGet(key) {
  const api = globalThis.chrome?.storage?.local;
  if (!api?.get) return Promise.resolve({});
  return new Promise(resolve => api.get(key, value => resolve(value || {})));
}

async function loadSpecialNotesIndex() {
  const stored = await storageLocalGet(CRM_SPECIAL_NOTES_STORAGE_KEY);
  const value = stored?.[CRM_SPECIAL_NOTES_STORAGE_KEY];
  return value && typeof value === 'object' ? value : null;
}

async function loadLiveContext() {
  const stored = await storageLocalGet(CRM_LIVE_CONTEXT_STORAGE_KEY);
  const value = stored?.[CRM_LIVE_CONTEXT_STORAGE_KEY];
  return value && value.schema === 'simnet-crm-live-building-context-v1' ? value : null;
}

function specialRecordsByBuildingId(index) {
  const out = new Map();
  const buildings = index?.buildings && typeof index.buildings === 'object'
    ? Object.values(index.buildings)
    : [];
  for (const record of buildings) {
    const id = String(record?.buildingId || '').trim();
    if (!id || out.has(id)) continue;
    out.set(id, record);
  }
  return out;
}

function specialEvidence(record) {
  const rows = Array.isArray(record?.rows) ? record.rows : [];
  const parts = [];
  const seen = new Set();
  for (const row of rows) {
    const text = compact(row?.text, 700);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const label = compact(row?.label || row?.key || '', 90);
    parts.push(label ? `${label}: ${text}` : text);
    if (parts.length >= 6) break;
  }
  if (!parts.length) return '';
  return compact(`[ВАЖНЫЕ УСЛОВИЯ ИЗ ФИЛЬТРА] ${parts.join(' | ')}`, 1300);
}

function enrichOutcomeWithSpecialNotes(outcome, index) {
  if (!outcome || !Array.isArray(outcome.results) || !outcome.results.length || !index) {
    return {
      ...(outcome || {}),
      specialNotesIndex: {
        available: Boolean(index),
        version: Number(index?.version || 0),
        buildingsWithRelevantNotes: Number(index?.stats?.buildingsWithRelevantNotes || 0)
      }
    };
  }

  const byId = specialRecordsByBuildingId(index);
  if (!byId.size) return outcome;

  const next = [];
  const injected = new Set();
  let specialRows = 0;
  for (const item of outcome.results) {
    const entityId = String(item?.entityId || '').trim();
    if (entityId && !injected.has(entityId)) {
      injected.add(entityId);
      const record = byId.get(entityId);
      const text = specialEvidence(record);
      if (record && text) {
        next.push({
          id: `building:${entityId}:special_condition`,
          entityType: 'building',
          entityId,
          section: 'special_condition',
          title: `${record.address || item?.address || item?.title || ''} · Важные условия`,
          address: String(record.address || item?.address || ''),
          url: String(record.url || item?.url || `/building/${entityId}`),
          text,
          score: 2,
          matched: [],
          source: 'filtered-special-notes'
        });
        specialRows += 1;
      }
    }
    next.push(item);
  }

  return {
    ...outcome,
    results: next,
    summary: {
      ...(outcome.summary || {}),
      resultCount: next.length,
      specialConditionRows: specialRows
    },
    specialNotesIndex: {
      available: true,
      version: Number(index?.version || 0),
      buildingsWithRelevantNotes: Number(index?.stats?.buildingsWithRelevantNotes || 0),
      injectedRows: specialRows
    }
  };
}

function explicitHouseToken(value) {
  const source = String(value || '');
  const matches = [...source.matchAll(/(?:^|[\s,→])(?<house>\d{1,4}\s*(?:(?:[/\\-]\s*\d{1,4})|(?:[/\\-]?\s*[а-яa-z]{1,4}))?)(?=$|[\s,→?.!;:)\]])/giu)];
  for (const match of matches) {
    const token = String(match.groups?.house || '').replace(/\s+/g, '').toLowerCase();
    if (!token || /^20\d{2}$/.test(token) || /^(?:17|1700)$/.test(token)) continue;
    return token;
  }
  return '';
}

function addressHouse(address) {
  const source = String(address || '').trim();
  const tail = source.includes('→') ? source.split('→').pop() : source.split(',').pop();
  const raw = String(tail || '').replace(/\[[^\]]+\]/g, ' ').trim();
  const match = raw.match(/\b\d{1,4}\s*(?:(?:[/\\-]\s*\d{1,4})|(?:[/\\-]?\s*[а-яa-z]{1,4}))?/iu);
  return String(match?.[0] || '').replace(/\s+/g, '').toLowerCase();
}

function streetIntentTokens(value) {
  const stop = new Set(['просп','проспект','вул','улица','вулиця','ул','street','city','district','province','район','область','софиевская','софиивська','борщаговка','борщагивка','киев','київ']);
  return fold(value)
    .split(/\s+/)
    .filter(token => token.length >= 4 && !/^\d/.test(token) && !stop.has(token));
}

function streetAffinity(query, activeContext, address) {
  const addressFold = fold(address);
  const activeStreet = String(activeContext?.street || '').trim();
  const sourceTokens = [...new Set([
    ...streetIntentTokens(query),
    ...streetIntentTokens(activeStreet)
  ])];
  if (!sourceTokens.length) return 0;
  let hits = 0;
  for (const token of sourceTokens) if (addressFold.includes(token)) hits += 1;
  return hits / sourceTokens.length;
}

function buildingRows(building) {
  const entityId = String(building?.id || '').trim();
  const address = String(building?.address || '').trim();
  const url = String(building?.url || `/building/${entityId}`);
  const rows = [];
  for (const field of Array.isArray(building?.fields) ? building.fields : []) {
    const text = compact(field?.text, 900);
    if (!text) continue;
    const label = compact(field?.label || field?.key || 'Поле', 100);
    rows.push({
      id: `building:${entityId}:${String(field?.key || label).replace(/[^a-z0-9_]+/gi, '_')}`,
      entityType: 'building', entityId, section: String(field?.key || 'field'),
      title: `${address} · ${label}`, address, url, text, score: 2, matched: [], source: 'exact-address-rescue'
    });
  }
  return rows.slice(0, 30);
}

function liveRows(live) {
  const entityId = String(live?.buildingUuid || live?.addressUnitUuid || 'live').trim();
  const address = String(live?.address || '').trim();
  return (Array.isArray(live?.noteRows) ? live.noteRows : [])
    .map((row, index) => {
      const text = compact(row?.text, 1000);
      if (!text) return null;
      const label = compact(row?.label || row?.key || 'Информация по дому', 100);
      return {
        id: `building:${entityId}:live:${index}`,
        entityType: 'building', entityId, section: String(row?.key || 'live'),
        title: `${address} · ${label}`, address, url: String(live?.sourceUrl || ''),
        text: `[ТЕКУЩАЯ КАРТОЧКА USERSIDE] ${text}`, score: 3, matched: [], source: 'userside-live-context'
      };
    })
    .filter(Boolean);
}

function rescueExactAddress(query, activeContext, snapshot, live) {
  const house = explicitHouseToken(query);
  if (!house) return null;

  const liveHouse = addressHouse(live?.address || '');
  const liveAffinity = live ? streetAffinity(query, activeContext, live.address) : 0;
  const liveResults = liveHouse === house && liveAffinity >= 0.45 ? liveRows(live) : [];
  if (liveResults.length) {
    return {
      plan: { mode: 'crm', scope: 'building', aggregate: false, street: activeContext?.street || '', house, query, rescue: 'userside-live-context' },
      results: liveResults,
      nextActiveContext: { scope: 'building', entityType: 'building', entityId: String(live.buildingUuid || live.addressUnitUuid || 'live'), address: live.address, url: live.sourceUrl || '', street: activeContext?.street || '' },
      summary: { resultCount: liveResults.length, buildingCount: 1, totalMatches: liveResults.length, truncated: false, exactAddressRescue: true },
      snapshot: {
        complete: Boolean(snapshot?.stats?.complete),
        buildings: Number(snapshot?.buildings?.length || 0),
        generatedAt: String(snapshot?.generatedAt || snapshot?.stats?.generatedAt || ''),
        source: 'userside-live-context'
      }
    };
  }

  const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
  const candidates = buildings
    .filter(building => addressHouse(building?.address) === house)
    .map(building => ({ building, affinity: streetAffinity(query, activeContext, building?.address || '') }))
    .sort((a, b) => b.affinity - a.affinity);
  if (!candidates.length || candidates[0].affinity < 0.45) return null;
  if (candidates[1] && candidates[1].affinity === candidates[0].affinity && candidates[0].affinity < 0.8) return null;

  const building = candidates[0].building;
  const results = buildingRows(building);
  if (!results.length) return null;
  return {
    plan: { mode: 'crm', scope: 'building', aggregate: false, street: activeContext?.street || '', house, query, rescue: 'compound-house' },
    results,
    nextActiveContext: { scope: 'building', entityType: 'building', entityId: String(building.id || ''), address: String(building.address || ''), url: String(building.url || `/building/${building.id}`), street: activeContext?.street || '' },
    summary: { resultCount: results.length, buildingCount: 1, totalMatches: results.length, truncated: false, exactAddressRescue: true },
    snapshot: {
      complete: Boolean(snapshot?.stats?.complete),
      buildings: Number(snapshot?.buildings?.length || 0),
      generatedAt: String(snapshot?.generatedAt || snapshot?.stats?.generatedAt || ''),
      source: 'snapshot'
    }
  };
}

export async function queryCrmIndex(query, options = {}) {
  const [snapshot, liveContext, specialIndex] = await Promise.all([
    base.loadCrmSnapshot().catch(() => null),
    loadLiveContext().catch(() => null),
    loadSpecialNotesIndex().catch(() => null)
  ]);

  const rescued = rescueExactAddress(query, options?.activeContext || null, snapshot, liveContext);
  const outcome = rescued || await base.queryCrmIndex(query, options);
  return enrichOutcomeWithSpecialNotes(outcome, specialIndex);
}

export function crmSearchPrompt(input) {
  const evidence = base.crmSearchPrompt(input);
  if (!evidence) return '';
  return `${CRM_RESPONSE_PRESENTATION_POLICY}\n\nCRM_DATA:\n${evidence}`;
}

export async function crmSearchStats() {
  const [baseStats, specialIndex, liveContext] = await Promise.all([
    base.crmSearchStats(),
    loadSpecialNotesIndex().catch(() => null),
    loadLiveContext().catch(() => null)
  ]);
  return {
    ...baseStats,
    revision: CRM_SEARCH_INDEX_REVISION,
    specialNotesIndex: {
      available: Boolean(specialIndex),
      version: Number(specialIndex?.version || 0),
      buildingsWithRelevantNotes: Number(specialIndex?.stats?.buildingsWithRelevantNotes || 0),
      relevantRows: Number(specialIndex?.stats?.relevantRows || 0)
    },
    liveContext: {
      available: Boolean(liveContext?.address),
      address: String(liveContext?.address || ''),
      updatedAt: String(liveContext?.updatedAt || '')
    }
  };
}
