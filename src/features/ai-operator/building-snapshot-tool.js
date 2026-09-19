'use strict';

const SNAPSHOT_KEY = 'simnet_crm_building_snapshot_v1';
const LAB_KEY = 'simnet_ai_operator_lab_v1';
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

function normalizeHouseSuffix(value) {
  const suffix = String(value || '').toLowerCase();
  // A common operator input is Latin "a" while UserSide stores Cyrillic "А".
  if (suffix === 'a') return 'а';
  return suffix;
}

function canonicalHouseKey(value) {
  const normalized = normalizeHouse(value);
  if (!normalized) return '';
  const letterSuffix = normalized.match(/^(\d+)[\/-]?([\p{L}])$/u);
  if (letterSuffix) return `${letterSuffix[1]}/${normalizeHouseSuffix(letterSuffix[2])}`;
  return normalized;
}

function houseEquivalent(left = '', right = '') {
  const leftKey = canonicalHouseKey(left);
  const rightKey = canonicalHouseKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function houseVariantsFromAddress(addressValue = '', houseValue = '') {
  const base = normalizeHouse(houseValue);
  if (!base) return [];
  const source = text(addressValue, 500);
  const variants = [];
  const block = source.match(/(?:^|[,;\s])(?:блок|block|корпус|корп\.?|корп|літера|литера)\s*[:№#-]?\s*([\p{L}\d]+)/iu)?.[1] || '';
  const normalizedBlock = normalizeHouse(block);
  if (normalizedBlock && !base.includes('/')) variants.push(`${base}/${normalizedBlock}`);
  variants.push(base);
  const canonicalBase = canonicalHouseKey(base);
  if (canonicalBase && canonicalBase !== base) variants.push(canonicalBase);
  return [...new Set(variants.filter(Boolean))];
}

function normalizeStreetPart(value) {
  return text(value, 260)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’'`]/g, '')
    .replace(/[().,;:№#]/g, ' ')
    .replace(/(?:^|\s)(?:м|місто|город|київ|киев|вул|вулиця|улица|ул|просп|проспект|проспекту|пров|провулок|переулок|бул|бульвар|пл|площа|площадь)(?=\s|$)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADMINISTRATIVE_STREET_ANNOTATION_RE = /^(?:голосіївський|дарницький|деснянський|дніпровський|оболонський|печерський|подільський|святошинський|соломянський|шевченківський|голосеевский|дарницкий|деснянский|днепровский|оболонский|печерский|подольский|святошинский|соломенский|шевченковский)(?:\s+(?:район|р-н))?$/iu;

function isAdministrativeStreetAnnotation(value = '') {
  const normalized = normalizeStreetPart(value);
  return Boolean(normalized && ADMINISTRATIVE_STREET_ANNOTATION_RE.test(normalized));
}

function streetVariants(value) {
  const source = text(value, 500);
  if (!source) return [];
  const aliases = [source.replace(/\([^)]*\)/g, ' ')];
  for (const match of source.matchAll(/\(([^)]*)\)/g)) {
    const alias = match[1];
    if (!isAdministrativeStreetAnnotation(alias)) aliases.push(alias);
  }
  const normalized = aliases
    .flatMap(item => String(item || '').split(/\s*(?:\||;)\s*/))
    .map(normalizeStreetPart)
    .filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeStreet(value) {
  return streetVariants(value)[0] || '';
}

function parsedStreet(streetValue = '', houseValue = '', rawAddress = '') {
  const streetAliases = streetVariants(streetValue);
  const baseHouse = normalizeHouse(houseValue);
  const houseAliases = houseVariantsFromAddress(rawAddress, houseValue);
  return {
    street: streetAliases[0] || '',
    streetAliases,
    house: baseHouse || houseAliases[0] || '',
    houseAliases: houseAliases.length ? houseAliases : [baseHouse].filter(Boolean)
  };
}

function parseStreetHouse(addressValue) {
  const address = text(addressValue, 500);
  if (!address) return { street: '', streetAliases: [], house: '', houseAliases: [] };
  const clean = address.replace(/\u00a0/g, ' ');

  const marker = clean.match(/^(.*?)(?:\s*,?\s*(?:буд\.?|будинок|дом|д\.?|house)(?=\s|[:№#-])\s*[:№#-]?\s*)(\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?)/iu);
  if (marker) return parsedStreet(marker[1], marker[2], clean);

  const beforeUnit = clean.split(/(?:^|\s)(?:під'?їзд|подъезд|поверх|этаж|кв\.?|квартира|офіс|офис)(?=\s|[.,:№#-]|$)/iu)[0];
  const simple = beforeUnit.match(/^(.*?)[,\s]+(\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?)\s*[,;]?\s*$/u);
  if (simple) return parsedStreet(simple[1], simple[2], beforeUnit);

  const streetAliases = streetVariants(beforeUnit);
  return { street: streetAliases[0] || '', streetAliases, house: '', houseAliases: [] };
}

function queryFromArgs(toolArgs = {}, labState = {}) {
  const explicitStreet = normalizeStreet(toolArgs.street);
  const explicitHouse = normalizeHouse(toolArgs.house);
  const explicitAddress = text(toolArgs.address, 500);
  if (explicitStreet && explicitHouse) {
    const houseAliases = houseVariantsFromAddress(explicitAddress, explicitHouse);
    return {
      street: explicitStreet,
      streetAliases: streetVariants(toolArgs.street),
      house: explicitHouse,
      houseAliases: houseAliases.length ? houseAliases : [explicitHouse],
      rawAddress: explicitAddress || `${toolArgs.street} ${toolArgs.house}`
    };
  }

  if (explicitAddress) {
    const parsed = parseStreetHouse(explicitAddress);
    if (parsed.street && parsed.house) return { ...parsed, rawAddress: explicitAddress };
  }

  const subscriberAddress = text(labState?.confirmedSubscriber?.address, 500);
  if (subscriberAddress) {
    const parsed = parseStreetHouse(subscriberAddress);
    if (parsed.street && parsed.house) return { ...parsed, rawAddress: subscriberAddress };
  }

  return {
    street: explicitStreet,
    streetAliases: streetVariants(toolArgs.street),
    house: explicitHouse,
    houseAliases: explicitHouse ? houseVariantsFromAddress(explicitAddress, explicitHouse) : [],
    rawAddress: explicitAddress || subscriberAddress
  };
}

function latestCustomerTextFromLab(lab = {}) {
  const messages = Array.isArray(lab?.messages) ? lab.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role !== 'customer') continue;
    const value = text(item?.text, 1200);
    if (value) return value;
  }
  return '';
}

function houseTokens(value) {
  return (String(value || '').match(/\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?/gu) || [])
    .map(canonicalHouseKey)
    .filter(Boolean);
}

function streetTokens(value) {
  return normalizeStreetPart(value)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !/^\d/.test(token));
}

export function inferBuildingQueryFromText(snapshot = {}, sourceText = '') {
  const source = text(sourceText, 1200);
  const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
  if (!source || !buildings.length) return { street: '', streetAliases: [], house: '', houseAliases: [], rawAddress: source };

  const sourceStreetTokens = new Set(streetTokens(source));
  const sourceHouses = new Set(houseTokens(source));
  if (!sourceHouses.size) return { street: '', streetAliases: [], house: '', houseAliases: [], rawAddress: source };

  const matches = [];
  for (const building of buildings) {
    const parsed = parseStreetHouse(building?.address);
    const buildingHouses = parsed.houseAliases?.length ? parsed.houseAliases : [parsed.house];
    const buildingHouseKeys = buildingHouses.map(canonicalHouseKey).filter(Boolean);
    if (!parsed.street || !buildingHouseKeys.some(house => sourceHouses.has(house))) continue;
    const aliases = parsed.streetAliases.length ? parsed.streetAliases : [parsed.street];
    const aliasMatches = aliases.some(alias => {
      const tokens = streetTokens(alias);
      return tokens.length > 0 && tokens.every(token => sourceStreetTokens.has(token));
    });
    if (!aliasMatches) continue;
    matches.push({ ...parsed, rawAddress: text(building?.address, 500) });
  }

  if (matches.length !== 1) return { street: '', streetAliases: [], house: '', houseAliases: [], rawAddress: source };
  return matches[0];
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

function normalizedQueryStreets(query = {}) {
  const variants = [
    ...(Array.isArray(query.streetAliases) ? query.streetAliases : []),
    query.street
  ].map(normalizeStreetPart).filter(Boolean);
  if (query.rawAddress) {
    const parsed = parseStreetHouse(query.rawAddress);
    variants.push(...(parsed.streetAliases || []));
  }
  return [...new Set(variants)];
}

function normalizedQueryHouses(query = {}) {
  const variants = [
    ...(Array.isArray(query.houseAliases) ? query.houseAliases : []),
    query.house
  ].map(normalizeHouse).filter(Boolean);
  if (query.rawAddress) {
    const parsed = parseStreetHouse(query.rawAddress);
    variants.push(...(parsed.houseAliases || []), parsed.house);
  }
  const expanded = [];
  for (const variant of variants) {
    const normalized = normalizeHouse(variant);
    const canonical = canonicalHouseKey(variant);
    if (normalized) expanded.push(normalized);
    if (canonical) expanded.push(canonical);
  }
  return [...new Set(expanded)];
}

function streetsFuzzyMatch(left = '', right = '') {
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function collectMatches(buildings = [], streets = [], house = '') {
  const primaryExact = [];
  const aliasExact = [];
  const fuzzy = [];
  const queryPrimary = streets[0] || '';
  for (const building of buildings) {
    const parsed = parseStreetHouse(building?.address);
    const buildingHouses = parsed.houseAliases?.length ? parsed.houseAliases : [parsed.house];
    if (!parsed.street || !buildingHouses.some(candidate => houseEquivalent(candidate, house))) continue;

    const buildingPrimary = normalizeStreetPart(parsed.street);
    const buildingStreets = (parsed.streetAliases.length ? parsed.streetAliases : [parsed.street])
      .map(normalizeStreetPart)
      .filter(Boolean);

    if (queryPrimary && buildingPrimary === queryPrimary) {
      primaryExact.push(building);
      continue;
    }

    const exactAliasMatch = buildingStreets.some(candidate => streets.includes(candidate));
    if (exactAliasMatch) {
      aliasExact.push(building);
      continue;
    }

    const fuzzyMatch = buildingStreets.some(candidate => streets.some(queryStreet => streetsFuzzyMatch(candidate, queryStreet)));
    if (fuzzyMatch) fuzzy.push(building);
  }
  if (primaryExact.length) return primaryExact;
  if (aliasExact.length) return aliasExact;
  return fuzzy;
}

export function findBuildingInSnapshot(snapshot = {}, query = {}) {
  const buildings = Array.isArray(snapshot?.buildings) ? snapshot.buildings : [];
  const streets = normalizedQueryStreets(query);
  const houses = normalizedQueryHouses(query);
  if (!streets.length || !houses.length) return { code: 'BUILDING_ADDRESS_REQUIRED', matches: [] };

  // More-specific Billing address variants (for example "буд. 5, блок В" => 5/в)
  // must win over the bare house number so that we do not silently bind to 5 instead of 5/В.
  for (const house of houses) {
    const matches = collectMatches(buildings, streets, house);
    if (!matches.length) continue;
    if (matches.length > 1) return { code: 'AMBIGUOUS_BUILDING', matches };
    return { code: 'OK', matches };
  }
  return { code: 'NOT_FOUND', matches: [] };
}

export async function readBuildingSnapshot({ toolArgs = {}, labState = {} } = {}) {
  const stored = await chrome.storage.local.get([SNAPSHOT_KEY, LAB_KEY]);
  const snapshot = stored?.[SNAPSHOT_KEY];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    const query = queryFromArgs(toolArgs, labState);
    return result(false, 'BUILDING_SNAPSHOT_MISSING', {
      message: 'Локальный индекс карточек зданий UserSide ещё не загружен.',
      source: SOURCE,
      snapshotKey: SNAPSHOT_KEY,
      query
    }, ['Не трактовать отсутствие snapshot как отсутствие покрытия или дома.']);
  }

  // Address priority matters. A building-level question may happen while another
  // subscriber is already bound in Lab. In that case the address explicitly
  // mentioned in the CURRENT customer turn must win over confirmedSubscriber.address.
  const explicitQuery = queryFromArgs(toolArgs, {});
  const labText = latestCustomerTextFromLab(stored?.[LAB_KEY]);
  const currentTurnQuery = inferBuildingQueryFromText(snapshot, labText);
  const subscriberQuery = queryFromArgs({}, labState);
  let query = explicitQuery.street && explicitQuery.house
    ? explicitQuery
    : currentTurnQuery.street && currentTurnQuery.house
      ? currentTurnQuery
      : subscriberQuery;

  if (!query.street || !query.house) {
    return result(false, 'BUILDING_ADDRESS_REQUIRED', {
      message: 'Для карточки здания нужны улица и номер дома.',
      query
    }, ['Передай адрес напрямую в toolArgs.address, явно укажи улицу и дом в текущем вопросе AI Lab или используй адрес подтверждённого абонента.']);
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
    snapshotComplete: Boolean(snapshot?.stats?.complete ?? snapshot?.complete),
    query
  });
}

export const BUILDING_SNAPSHOT_TOOL = Object.freeze({
  name: TOOL_NAME,
  snapshotKey: SNAPSHOT_KEY,
  source: SOURCE
});
