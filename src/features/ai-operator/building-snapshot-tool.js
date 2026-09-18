'use strict';

const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
const TOOL_NAME = 'building.snapshot';
const SOURCE = 'userside-building-snapshot-local';

function nowIso() { return new Date().toISOString(); }
function text(value, max = 600) {
  const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function compactObject(input, maxDepth = 5, depth = 0) {
  if (depth >= maxDepth) return text(input, 320);
  if (Array.isArray(input)) return input.slice(0, 120).map(item => compactObject(item, maxDepth, depth + 1));
  if (!input || typeof input !== 'object') return input;
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, 140)) {
    if (/^(?:pp|password|passwd|pass|token|secret|csrf|authorization)$/i.test(key)) continue;
    output[key] = compactObject(value, maxDepth, depth + 1);
  }
  return output;
}
function result(ok, code, data = {}, warnings = []) {
  return {
    ok: Boolean(ok),
    tool: TOOL_NAME,
    code: String(code || (ok ? 'OK' : 'ERROR')),
    observedAt: nowIso(),
    data: compactObject(data),
    warnings: (Array.isArray(warnings) ? warnings : []).map(item => text(item, 500)).filter(Boolean),
    statePatch: {}
  };
}

function normalizeHouse(value) {
  return text(value, 80)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s.]+/g, '')
    .replace(/\\/g, '/')
    .replace(/-+/g, '-');
}

function normalizeStreet(value) {
  return text(value, 260)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’'`]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,;:№#]/g, ' ')
    .replace(/(?:^|\s)(?:м|місто|город|київ|киев|вул|вулиця|улица|ул|просп|проспект|проспекту|пров|провулок|переулок|бул|бульвар|пл|площа|площадь)(?=\s|$)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStreetHouse(addressValue) {
  const address = text(addressValue, 500);
  if (!address) return { street: '', house: '' };
  const clean = address.replace(/\u00a0/g, ' ');

  const marker = clean.match(/^(.*?)(?:\s*,?\s*(?:буд\.?|будинок|дом|д\.?|house)(?=\s|[:№#-])\s*[:№#-]?\s*)(\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?)/iu);
  if (marker) return { street: normalizeStreet(marker[1]), house: normalizeHouse(marker[2]) };

  const beforeUnit = clean.split(/(?:^|\s)(?:під'?їзд|подъезд|поверх|этаж|кв\.?|квартира|офіс|офис)(?=\s|[.,:№#-]|$)/iu)[0];
  const simple = beforeUnit.match(/^(.*?)[,\s]+(\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?)\s*[,;]?\s*$/u);
  if (simple) return { street: normalizeStreet(simple[1]), house: normalizeHouse(simple[2]) };

  return { street: normalizeStreet(beforeUnit), house: '' };
}

function queryFromArgs(toolArgs = {}, labState = {}) {
  const explicitStreet = normalizeStreet(toolArgs.street);
  const explicitHouse = normalizeHouse(toolArgs.house);
  const explicitAddress = text(toolArgs.address, 500);
  if (explicitStreet && explicitHouse) return { street: explicitStreet, house: explicitHouse, rawAddress: explicitAddress || `${toolArgs.street} ${toolArgs.house}` };

  if (explicitAddress) {
    const parsed = parseStreetHouse(explicitAddress);
    if (parsed.street && parsed.house) return { ...parsed, rawAddress: explicitAddress };
  }

  const subscriberAddress = text(labState?.confirmedSubscriber?.address, 500);
  if (subscriberAddress) {
    const parsed = parseStreetHouse(subscriberAddress);
    if (parsed.street && parsed.house) return { ...parsed, rawAddress: subscriberAddress };
  }

  return { street: explicitStreet, house: explicitHouse, rawAddress: explicitAddress || subscriberAddress };
}

function fieldMap(fields = []) {
  const mapped = {};
  for (const item of Array.isArray(fields) ? fields : []) {
    const key = text(item?.key, 100);
    const value = text(item?.text, 2000);
    if (!key || !value) continue;
    if (!(key in mapped)) mapped[key] = value;
    else if (Array.isArray(mapped[key])) mapped[key].push(value);
    else mapped[key] = [mapped[key], value];
  }
  return mapped;
}

function candidateSummary(building = {}) {
  return {
    id: text(building.id, 80),
    address: text(building.address, 320),
    url: text(building.url, 240)
  };
}

export function findBuildingInSnapshot(snapshot = {}, query = {}) {
  const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
  const street = normalizeStreet(query.street);
  const house = normalizeHouse(query.house);
  if (!street || !house) return { code: 'BUILDING_ADDRESS_REQUIRED', matches: [] };

  const exact = [];
  const fuzzy = [];
  for (const building of buildings) {
    const parsed = parseStreetHouse(building?.address);
    if (!parsed.street || !parsed.house || parsed.house !== house) continue;
    if (parsed.street === street) exact.push(building);
    else if (parsed.street.includes(street) || street.includes(parsed.street)) fuzzy.push(building);
  }
  const matches = exact.length ? exact : fuzzy;
  if (!matches.length) return { code: 'NOT_FOUND', matches: [] };
  if (matches.length > 1) return { code: 'AMBIGUOUS_BUILDING', matches };
  return { code: 'OK', matches };
}

export async function readBuildingSnapshot({ toolArgs = {}, labState = {} } = {}) {
  const query = queryFromArgs(toolArgs, labState);
  if (!query.street || !query.house) {
    return result(false, 'BUILDING_ADDRESS_REQUIRED', {
      message: 'Для карточки здания нужны улица и номер дома.',
      query
    }, ['Если адрес уже известен по подтверждённому абоненту, передай его в confirmedSubscriber.address или toolArgs.address.']);
  }

  const stored = await chrome.storage.local.get(SNAPSHOT_KEY);
  const snapshot = stored?.[SNAPSHOT_KEY];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return result(false, 'BUILDING_SNAPSHOT_MISSING', {
      message: 'Локальный индекс карточек зданий UserSide ещё не загружен.',
      source: SOURCE,
      snapshotKey: SNAPSHOT_KEY,
      query
    }, ['Не трактовать отсутствие snapshot как отсутствие покрытия или дома.']);
  }

  const found = findBuildingInSnapshot(snapshot, query);
  if (found.code === 'NOT_FOUND') {
    return result(false, 'NOT_FOUND', {
      message: 'Дом не найден в текущем локальном snapshot карточек зданий.',
      source: SOURCE,
      snapshotKey: SNAPSHOT_KEY,
      generatedAt: text(snapshot.generatedAt, 100),
      query,
      indexedBuildings: Number(snapshot?.stats?.parsed || snapshot?.buildings?.length || 0)
    }, ['NOT_FOUND означает только отсутствие совпадения в этом snapshot; это не доказательство отсутствия GPON/покрытия.']);
  }
  if (found.code === 'AMBIGUOUS_BUILDING') {
    return result(false, 'AMBIGUOUS_BUILDING', {
      message: 'По улице и номеру найдено несколько карточек здания; выбирать наугад нельзя.',
      source: SOURCE,
      query,
      candidates: found.matches.slice(0, 12).map(candidateSummary)
    }, ['Нужно уточнить адрес/корпус/литеру дома.']);
  }

  const building = found.matches[0];
  return result(true, 'OK', {
    buildingId: text(building.id, 80),
    address: text(building.address, 320),
    url: text(building.url, 240),
    fields: fieldMap(building.fields),
    fieldList: Array.isArray(building.fields) ? building.fields : [],
    source: SOURCE,
    snapshotKey: SNAPSHOT_KEY,
    snapshotGeneratedAt: text(snapshot.generatedAt, 100),
    snapshotComplete: Boolean(snapshot?.stats?.complete),
    query
  });
}

export const BUILDING_SNAPSHOT_TOOL = Object.freeze({
  name: TOOL_NAME,
  snapshotKey: SNAPSHOT_KEY,
  source: SOURCE
});
