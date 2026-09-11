export * from './crm-search-index-base.js';
import * as base from './crm-search-index-base.js';

export const CRM_SEARCH_INDEX_REVISION = 'crm-search-building-core-v6-special-notes-presentation';
export const CRM_SPECIAL_NOTES_STORAGE_KEY = 'simnet_crm_filtered_special_notes_v1';

const CRM_RESPONSE_PRESENTATION_POLICY = `RESPONSE_PRESENTATION_POLICY:
- Отвечай как опытный коллега, а не как выгрузка полей CRM. Сначала осмысли факты и дай цельный прямой ответ на вопрос оператора.
- Не перечисляй сырые куски заметок один за другим. Повторы и одинаковый смысл объединяй в одну нормальную формулировку.
- Каждый новый смысловой блок начинай с нового абзаца. Если фактов несколько, группируй только по реально нужным темам: подключение/ограничения, технология и услуги, доступ/ключи/время, стоимость/условия, контакты. Не создавай пустые или формальные заголовки.
- Перечисление используй только когда действительно есть несколько однотипных пунктов, домов, подъездов, условий или действий. Один факт оформляй обычным предложением.
- Самое важное условие, запрет или риск ставь первым и при необходимости выделяй **жирным**. Справочную информацию давай после него.
- Если оператор спросил конкретно про GPON, доступ, ключи, возможность подключения, дом или улицу — отвечай прежде всего на этот вопрос, без лишнего полного пересказа карточки.
- Строка [ВАЖНЫЕ УСЛОВИЯ ИЗ ФИЛЬТРА] означает, что заметка уже прошла локальный high-signal фильтр Workbench. Учитывай её в первую очередь, но не расширяй смысл: запрет конкретного подъезда не становится запретом всего дома; доступ через ЖЭК не равен технической невозможности; ограничение услуги не равно запрету технологии.
- Не делай вывод из отсутствующего поля. Если источники реально противоречат друг другу, прямо скажи, что данные требуют проверки, а не выбирай удобную трактовку.
- Пиши нормальными законченными предложениями, с пунктуацией и естественными переносами. Не выдавай служебные названия полей, JSON или внутреннюю механику индекса.`;

function compact(value, max = 1100) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
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

export async function queryCrmIndex(query, options = {}) {
  const [outcome, specialIndex] = await Promise.all([
    base.queryCrmIndex(query, options),
    loadSpecialNotesIndex().catch(() => null)
  ]);
  return enrichOutcomeWithSpecialNotes(outcome, specialIndex);
}

export function crmSearchPrompt(input) {
  const evidence = base.crmSearchPrompt(input);
  if (!evidence) return '';
  return `${CRM_RESPONSE_PRESENTATION_POLICY}\n\nCRM_DATA:\n${evidence}`;
}

export async function crmSearchStats() {
  const [baseStats, specialIndex] = await Promise.all([
    base.crmSearchStats(),
    loadSpecialNotesIndex().catch(() => null)
  ]);
  return {
    ...baseStats,
    revision: CRM_SEARCH_INDEX_REVISION,
    specialNotesIndex: {
      available: Boolean(specialIndex),
      version: Number(specialIndex?.version || 0),
      buildingsWithRelevantNotes: Number(specialIndex?.stats?.buildingsWithRelevantNotes || 0),
      relevantRows: Number(specialIndex?.stats?.relevantRows || 0)
    }
  };
}
