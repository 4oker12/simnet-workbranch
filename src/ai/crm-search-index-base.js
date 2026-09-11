// Universal local CRM search over building-core snapshots produced by the UserSide building parser.
// Scope is intentionally limited to the building card ABOVE tabs; subscriber/customer rows are excluded.

export const CRM_SEARCH_INDEX_REVISION = 'crm-search-building-core-v5-conversation-router';
export const CRM_SNAPSHOT_STORAGE_KEY = 'simnet_crm_building_snapshot_v1';

const BASELINE_BUILDING_ENTRIES = [
  {
    id: 'building:2693:notes', entityType: 'building', entityId: '2693', section: 'notes',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · Заметки',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693',
    text: 'можно включать по пону. бокси 13,8,3 эт., 2 стояка.380972030398 Вадим мастер ПЕРЕВОДИМО НА СІМНЕТ!!!!!!!!!'
  },
  {
    id: 'building:2693:working_note', entityType: 'building', entityId: '2693', section: 'working_note',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · Рабочая заметка',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693',
    text: 'пон бокси - 13, 8, 3 поверх - 2 стояка. можно включать по пону. бокси 13,8,3 эт., 2 стояка 097-203-03-98 Вадим набирать нам, чтоб утром подготовил ключи'
  },
  {
    id: 'building:2693:manager', entityType: 'building', entityId: '2693', section: 'manager',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · Менеджер',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693', text: 'Соломенник В.'
  },
  {
    id: 'building:2693:owner', entityType: 'building', entityId: '2693', section: 'owner',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · Собственник',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693', text: 'ЖК «Замковецкий»'
  },
  {
    id: 'building:2693:management', entityType: 'building', entityId: '2693', section: 'management',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · Название УК/ОСББ',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693', text: 'ТОВ "МІСТО ДЛЯ ЛЮДЕЙ КИЇВ"'
  },
  {
    id: 'building:2693:ktv', entityType: 'building', entityId: '2693', section: 'ktv',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · Есть КТВ',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693', text: 'да'
  },
  {
    id: 'building:2693:gpon', entityType: 'building', entityId: '2693', section: 'gpon',
    title: 'Киев, вул. Сергія Данченка (Подільський), 32/А · GPON',
    address: 'Киев, вул. Сергія Данченка (Подільський), 32/А', url: '/building/2693', text: 'да'
  }
];

const QUERY_STOP = new Set([
  'что','чо','че','известно','есть','по','про','на','с','со','там','мне','найди','покажи','скажи','какой','какая','какие','кто','где','чей','этот','эта','это',
  'вся','все','всей','всий','всю','всего','везде','па','во','и','или','а','ну','давай','составь','состав','сделай','список','перечень','инфа','информация','интересует','посмотри','глянь','до','слышно','слишно','слыш','слиш'
]);

const AGGREGATE_RE = /(?:по\s+вс(?:ей|[іи]й)|(?:^|\s)вс(?:е|я|ю|ей|ех|[іи]й)(?:\s|$)|список|перечень|сколько|где\s+ещ[её]|везде|все\s+дома|по\s+улице)/iu;
const FOLLOWUP_RE = /^\s*(?:а\s+)?(?:что|чо|че|кто|где|как|какие?|ключи?|жек|жэк|пон|gpon|epon|симнет|сімнет|доступ|телефон|номер|осбб|ук|менеджер|можно|нельзя|переводят|переводимо)(?:\s|$|[?!.,:;])/iu;
const CRM_CONTEXT_ONLY_FOLLOWUP_RE = /^\s*(?:а\s+)?(?:что\s+(?:ещ[её]|там)|ещ[её]|там|ссылк\w*|открой|открыть|этот\s+дом|этого\s+дома|по\s+этому\s+дому|по\s+нему)(?:\s|$|[?!.,:;])/iu;
const EXPLICIT_MIXED_RE = /(?:текущ(?:ий|его)\s+абон|эт(?:от|ого)\s+абон|связано\s+с\s+(?:текущ|эт)|может\s+ли\s+это\s+быть\s+связано)/iu;
const MIXED_DIAGNOSTIC_RE = /(?:onu|ону(?:\s|$)|olt|bras|dhcp|dns|сессия|интернет|скорост|speed|speedtest|download|upload|загруз|выгруз|мбит|мегабит|обрыв|пропадан|фриз|пинг|ping|latency|джиттер|packet|пакет|los|оптик|rssi|phy|роутер|cpe|кабел|ethernet|lan|wan|wifi|wi[- ]?fi|вайфай|линк|дуплекс)/iu;

const QUERY_ACCESS_DENIED_RE = /(?:не\s+(?:пуст(?:ил|или|ят|ит|ять)?|пуска(?:ют|ет|є|ють)?|впуска(?:ют|ет|є|ють)?|допуска(?:ют|ет|є|ють)?)|нет\s+доступ|нема(?:є)?\s+доступ|доступ(?:у|а)?\s+(?:нет|нема(?:є)?))/iu;
const FIELD_ACCESS_DENIED_RE = /(?:не\s+(?:пуст(?:ил|или|ят|ит|ять)?|пуска(?:ют|ет|є|ють)?|впуска(?:ют|ет|є|ють)?|допуска(?:ют|ет|є|ють)?)|нет\s+доступ|нема(?:є)?\s+доступ|доступ(?:у|а)?\s+(?:нет|нема(?:є)?))/iu;
const QUERY_NO_OPTICS_RE = /(?:(?:нет|нема(?:є)?|без|відсутн\w*|отсутств\w*)[^.!?]{0,28}(?:gpon|epon|pon|пон|оптик\w*)|(?:gpon|epon|pon|пон|оптик\w*)[^.!?]{0,28}(?:нет|нема(?:є)?|не\s+буд(?:ет|е)|неможлив\w*|невозмож\w*|відсутн\w*|отсутств\w*))/iu;
const FIELD_NO_OPTICS_RE = /(?:(?:gpon|epon|pon|пона?|оптик\w*)\s*(?:[-:!,.]|\s)*(?:нет|нема(?:є)?|не\s+буд(?:ет|е)|відсутн\w*|отсутств\w*)|(?:нет|нема(?:є)?|відсутн\w*|отсутств\w*)\s+(?:gpon|epon|pon|пона?|оптик\w*)|(?:нет\s+возможности|нема(?:є)?\s+можливості)\s+(?:по\s+)?(?:gpon|epon|pon|пону|оптик\w*)|(?:gpon|epon|pon|пон|оптик\w*)[^.!?]{0,45}(?:протягнути\s+неможливо|протянуть\s+невозможно))/iu;
const CRM_PROMPT_CHAR_BUDGET = 6200;
const CRM_PROMPT_AGGREGATE_MAX_ROWS = 28;
const CRM_PROMPT_DIRECT_MAX_ROWS = 18;

const CONCEPTS = Object.freeze({
  housing_office: ['жек','жэк','жед','жкх','житлово експлуатац','житлово-експлуатац','керуюча компан','управляющая компан'],
  keys_access: ['ключ','ключи','ключі','доступ','чердак','горище','техэтаж','тех этаж','техповерх','тех поверх','тамбур','решетк','решітк','домофон'],
  pon: ['pon','пон','gpon','epon','оптик','абон бокс','абон.бокс','делител','сплиттер'],
  connection_possible: ['подключ','підключ','можливост','возможност','нет возможности','немає можливості','не подключаем','не підключаємо'],
  simnet: ['simnet','симнет','сімнет'],
  phone: ['телефон','номер','тел','контакт']
});

function fold(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/э/g, 'е')
    .replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и')
    .replace(/є/g, 'е')
    .replace(/ы/g, 'и')
    .replace(/ь/g, '')
    .replace(/[^a-zа-я0-9/+]+/giu, ' ')
    .trim();
}

function stemToken(raw) {
  let t = fold(raw).replace(/[+/]/g, '');
  if (/^\d+$/.test(t) || t.length < 5) return t;
  // Ukrainian/Russian adjective/case endings. This is intentionally light-weight:
  // it improves Бышевской ↔ Бишівська without turning search into a morphology engine.
  const endings = [
    'ского','скому','скими','ская','ской','скую','ские','ский','ское',
    'цького','цькому','цькими','цька','цькой','цьку','цьки','цький','цьке',
    'ського','ському','ськими','ська','ськой','ську','ськи','ський','ське',
    'ска','ской','скую','ски','ский','ское',
    'ого','ому','ыми','ими','ой','ей','ая','яя','ую','юю','ое','ее','ий','ый'
  ];
  for (const ending of endings) {
    if (t.length > ending.length + 3 && t.endsWith(ending)) {
      t = t.slice(0, -ending.length);
      break;
    }
  }
  return t;
}

function tokens(value) {
  return fold(value).split(/\s+/).filter(Boolean);
}

function lexicalTokens(value) {
  return tokens(value).map(token => ({ raw: token, stem: stemToken(token) || token }));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let left = i;
    let diag = i - 1;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(up + 1, left + 1, diag + cost);
      prev[j - 1] = left;
      left = next;
      diag = up;
    }
    prev[b.length] = left;
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 0;
}

function tokenSimilarity(a, b) {
  const raw = similarity(fold(a), fold(b));
  const stem = similarity(stemToken(a), stemToken(b));
  return Math.max(raw, stem);
}

function bestTokenMatch(queryToken, haystackTokens) {
  let best = 0;
  let bestToken = '';
  for (const h of haystackTokens) {
    const s = tokenSimilarity(queryToken, h);
    if (s > best) { best = s; bestToken = h; }
    if (best === 1) break;
  }
  return { similarity: best, token: bestToken };
}

function compactPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function phraseMatchScore(needle, haystack) {
  const n = fold(needle);
  const h = fold(haystack);
  if (!n || !h) return 0;
  if (h.includes(n)) return 1;
  const nt = tokens(n).filter(t => t.length >= 2);
  const ht = tokens(h);
  if (!nt.length) return 0;
  let sum = 0;
  for (const q of nt) sum += bestTokenMatch(q, ht).similarity;
  return sum / nt.length;
}

function scoreEntry(queryTokens, entry) {
  const addressRaw = String(entry.address || '');
  const coreRaw = `${entry.title || ''} ${entry.text || ''}`.split(addressRaw).join(' ');
  const coreTokens = tokens(coreRaw);
  const addressTokens = tokens(entry.address || '');
  if (!queryTokens.length || (!coreTokens.length && !addressTokens.length)) return { score: 0, matched: [] };
  const matched = [];
  let coreHits = 0;
  let addressHits = 0;
  let weighted = 0;
  for (const q of queryTokens) {
    if (q.length < 2) continue;
    const phoneQ = compactPhone(q);
    if (phoneQ.length >= 6 && compactPhone(coreRaw).includes(phoneQ)) {
      matched.push({ query: q, token: q, similarity: 1, source: 'content' });
      coreHits += 1;
      weighted += 1;
      continue;
    }
    const core = bestTokenMatch(q, coreTokens);
    const address = bestTokenMatch(q, addressTokens);
    const min = q.length <= 3 ? 0.64 : 0.58;
    if (core.similarity >= min && core.similarity >= address.similarity) {
      matched.push({ query: q, token: core.token, similarity: Number(core.similarity.toFixed(2)), source: 'content' });
      coreHits += 1;
      weighted += core.similarity;
    } else if (address.similarity >= min) {
      matched.push({ query: q, token: address.token, similarity: Number(address.similarity.toFixed(2)), source: 'address' });
      addressHits += 1;
      weighted += address.similarity * 0.35;
    }
  }
  if (!coreHits) return { score: 0, matched };
  const denom = Math.max(1, queryTokens.length);
  const coverage = (coreHits + addressHits * 0.35) / denom;
  const exactCoreBoost = matched.filter(m => m.source === 'content' && m.similarity >= 0.99).length * 0.18;
  const score = (weighted / denom) * 0.72 + coverage * 0.28 + exactCoreBoost;
  return { score: Number(Math.min(1.5, score).toFixed(3)), matched };
}

function slugSection(value) {
  return String(value || 'field').replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'field';
}

export function snapshotToCrmEntries(snapshot) {
  if (!snapshot || snapshot.schema !== 'simnet-crm-building-snapshot-v1' || !Array.isArray(snapshot.buildings)) return [];
  const entries = [];
  for (const building of snapshot.buildings) {
    const entityId = String(building?.id || '').trim();
    const address = String(building?.address || '').trim();
    if (!entityId || !address) continue;
    for (const field of Array.isArray(building?.fields) ? building.fields : []) {
      const text = String(field?.text || '').trim();
      const label = String(field?.label || field?.key || 'Поле').trim();
      if (!text || !label) continue;
      const section = slugSection(field?.key || label);
      entries.push({
        id: `building:${entityId}:${section}`,
        entityType: 'building',
        entityId,
        section,
        label,
        title: `${address} · ${label}`,
        address,
        url: String(building?.url || `/building/${entityId}`),
        text
      });
    }
  }
  return entries;
}

function entriesToBuildings(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.entityId)) map.set(entry.entityId, { id: entry.entityId, address: entry.address, url: entry.url, fields: [] });
    map.get(entry.entityId).fields.push(entry);
  }
  return [...map.values()];
}

function streetRawPart(address = '') {
  const parts = String(address).split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 2]
    .replace(/^(?:вул\.?|ул\.?|вулиця|просп\.?|проспект|пров\.?|пер\.?|бульв\.?|бул\.?|б-р\.?|пл\.?|площа)\s+/iu, '')
    .trim();
}

function streetPart(address = '') {
  return streetRawPart(address).split('(')[0].trim();
}

function streetAliases(address = '') {
  const raw = streetRawPart(address);
  const primary = raw.split('(')[0].trim();
  const prefix = String(address).split(',').slice(0, -2).join(' ');
  const aliases = [primary];
  const groups = [...raw.matchAll(/\(([^)]+)\)/g)].map(match => String(match[1] || '').trim()).filter(Boolean);
  for (const candidate of groups) {
    const f = fold(candidate);
    if (!f || /(?:ский|ський|ськии|район)$/u.test(f)) continue;
    if (/^(?:пб|сб|киев|київ)$/u.test(f)) continue;
    if (phraseMatchScore(candidate, prefix) >= 0.9) continue; // locality/settlement, not street alias
    if (!aliases.some(value => fold(value) === f)) aliases.push(candidate);
  }
  return aliases;
}

function housePart(address = '') {
  const parts = String(address).split(',').map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function streetCatalog(buildings) {
  const map = new Map();
  for (const building of buildings) {
    const street = streetPart(building.address);
    if (!street) continue;
    const key = fold(street);
    if (!map.has(key)) map.set(key, { street, aliases: [], buildings: [] });
    const row = map.get(key);
    row.buildings.push(building);
    for (const alias of streetAliases(building.address)) {
      if (!row.aliases.some(value => fold(value) === fold(alias))) row.aliases.push(alias);
    }
  }
  return [...map.values()];
}

function resolveStreet(query, buildings) {
  const qt = lexicalTokens(query).filter(t => t.raw.length >= 4 && !QUERY_STOP.has(t.raw));
  if (!qt.length) return null;
  let best = null;
  let second = null;
  for (const row of streetCatalog(buildings)) {
    let rowBest = null;
    for (const alias of (row.aliases?.length ? row.aliases : [row.street])) {
      const st = lexicalTokens(alias);
      if (!st.length) continue;
      let score = 0;
      let hits = 0;
      const matchedQuery = [];
      for (const q of qt) {
        let local = 0;
        for (const s of st) local = Math.max(local, tokenSimilarity(q.raw, s.raw));
        if (local >= 0.68) { score += local; hits += 1; matchedQuery.push(q.raw); }
      }
      if (!hits) continue;
      const avg = score / hits;
      const coverage = Math.min(1, hits / Math.max(1, st.length));
      const normalized = avg * (0.85 + coverage * 0.15);
      const candidate = { ...row, matchedAlias: alias, score: Number(normalized.toFixed(3)), matchedQuery };
      if (!rowBest || candidate.score > rowBest.score) rowBest = candidate;
    }
    if (!rowBest) continue;
    const candidate = rowBest;
    if (!best || candidate.score > best.score) { second = best; best = candidate; }
    else if (!second || candidate.score > second.score) second = candidate;
  }
  if (!best || best.score < 0.69) return null;
  const ambiguous = Boolean(second && second.score >= best.score - 0.035 && fold(second.street) !== fold(best.street));
  return { ...best, ambiguous, alternate: ambiguous ? second.street : '', alternateCandidate: ambiguous ? second : null };
}

function explicitHouseToken(query) {
  const source = String(query || '');
  const matches = [...source.matchAll(/(?:^|[\s,])(?<house>\d{1,4}(?:\s*[\/\-]?\s*[а-яa-z]{1,4})?)(?=$|[\s,?.!;:])/giu)];
  return matches
    .map(match => fold(match.groups?.house || '').replace(/\s+/g, ''))
    .find(value => value && !/^17(?:00)?$/.test(value)) || '';
}

function sameHouse(queryHouse, addressHouse) {
  const a = fold(queryHouse).replace(/\s+/g, '').replace(/\//g, '');
  const b = fold(addressHouse).replace(/\s+/g, '').replace(/\//g, '');
  return Boolean(a && b && (a === b || b.startsWith(a) || a.startsWith(b)));
}

function conceptExpansions(query) {
  const q = fold(query);
  const qTokens = tokens(q);
  const out = [];
  for (const [concept, phrases] of Object.entries(CONCEPTS)) {
    const hit = phrases.some(phrase => {
      const pt = tokens(phrase);
      if (!pt.length) return false;
      if (pt.length === 1) return bestTokenMatch(pt[0], qTokens).similarity >= 0.82;
      return phraseMatchScore(phrase, q) >= 0.82 || q.includes(fold(phrase));
    });
    if (hit) out.push({ concept, phrases });
  }
  return out;
}

function topicTokens(query, street = '', fuzzyStreetQueryTokens = []) {
  const streetTokens = new Set(tokens(street).map(stemToken));
  const fuzzyStreet = new Set((Array.isArray(fuzzyStreetQueryTokens) ? fuzzyStreetQueryTokens : []).map(fold));
  const out = [];
  for (const token of tokens(query)) {
    if (token.length < 2 || QUERY_STOP.has(token)) continue;
    const stem = stemToken(token);
    if (QUERY_STOP.has(stem)) continue;
    if (streetTokens.has(stem) || fuzzyStreet.has(fold(token))) continue;
    if (/^\d{1,4}$/.test(token) && ['17','1700','2026'].includes(token)) out.push(token);
    else if (!/^\d{1,4}$/.test(token)) out.push(token);
  }
  for (const expansion of conceptExpansions(query)) {
    for (const phrase of expansion.phrases) {
      for (const token of tokens(phrase)) if (token.length >= 2 && !QUERY_STOP.has(token)) out.push(token);
    }
  }
  return [...new Set(out)].slice(0, 18);
}

function directTopicTokens(query, street = '', fuzzyStreetQueryTokens = []) {
  const streetTokens = new Set(tokens(street).map(stemToken));
  const fuzzyStreet = new Set((Array.isArray(fuzzyStreetQueryTokens) ? fuzzyStreetQueryTokens : []).map(fold));
  const out = [];
  for (const token of tokens(query)) {
    if (token.length < 2 || QUERY_STOP.has(token)) continue;
    const stem = stemToken(token);
    if (QUERY_STOP.has(stem) || streetTokens.has(stem) || fuzzyStreet.has(fold(token))) continue;
    out.push(token);
  }
  return [...new Set(out)].slice(0, 12);
}

function mandatoryTopicTokens(direct = []) {
  const exactConcepts = new Set(['жек','жэд','жед','жкх','gpon','epon','pon','пон','simnet','симнет','сімнет','осбб']);
  return direct.filter(token => {
    const t = fold(token);
    const digits = compactPhone(t);
    if (/^\d+$/.test(t)) return true;
    if (digits.length >= 6) return true;
    return exactConcepts.has(t);
  });
}

function tokenPresentInText(token, text) {
  const t = fold(token);
  if (!t) return false;
  const digits = compactPhone(t);
  if (/^\d+$/.test(t)) return tokens(text).includes(t);
  if (digits.length >= 6 && compactPhone(text).includes(digits)) return true;
  const min = t.length <= 3 ? 0.74 : 0.62;
  return bestTokenMatch(t, tokens(text)).similarity >= min;
}

function mandatoryTermsCloseInText(terms, text, maxSpan = 42) {
  if (!Array.isArray(terms) || terms.length < 2) return true;
  const hay = fold(text);
  const positions = [];
  for (const raw of terms) {
    const token = fold(raw);
    if (!token) return false;
    let idx = -1;
    if (/^\d+$/.test(token)) {
      const re = new RegExp(`(?:^|\\s)${token}(?:\\s|$)`);
      const match = hay.match(re);
      idx = match ? match.index + match[0].indexOf(token) : -1;
    } else {
      idx = hay.indexOf(token);
      if (idx < 0) {
        const ht = tokens(hay);
        const best = bestTokenMatch(token, ht);
        if (best.similarity >= (token.length <= 3 ? 0.74 : 0.62)) idx = hay.indexOf(best.token);
      }
    }
    if (idx < 0) return false;
    positions.push(idx);
  }
  return Math.max(...positions) - Math.min(...positions) <= maxSpan;
}


function semanticFieldPredicate(query) {
  const source = String(query || '');
  if (QUERY_NO_OPTICS_RE.test(source)) {
    return { id: 'explicit_no_optics', test: text => FIELD_NO_OPTICS_RE.test(String(text || '')) };
  }
  if (QUERY_ACCESS_DENIED_RE.test(source)) {
    return { id: 'access_denied', test: text => FIELD_ACCESS_DENIED_RE.test(String(text || '')) };
  }
  return null;
}

function fieldRowsMatchingPredicate(fields, predicate) {
  if (!predicate?.test) return [];
  return (fields || []).filter(field => predicate.test(`${field.label || ''} ${field.text || ''}`));
}

function aggregateBuildingResults(buildings, queryTerms, mandatoryTerms, { limit = 40, minScore = 0.28, semanticPredicate = null } = {}) {
  const rows = [];
  for (const building of buildings) {
    const fields = building.fields || [];
    const combined = fields.map(f => `${f.label || ''} ${f.text || ''}`).join(' ');
    const semanticFields = fieldRowsMatchingPredicate(fields, semanticPredicate);
    if (semanticPredicate && !semanticFields.length) continue;
    let mandatoryFields = semanticFields.length ? semanticFields : [];
    if (mandatoryTerms.length >= 2) {
      const lexicalMandatory = fields.filter(field => {
        const fieldText = `${field.label || ''} ${field.text || ''}`;
        return mandatoryTerms.every(token => tokenPresentInText(token, fieldText)) && mandatoryTermsCloseInText(mandatoryTerms, fieldText);
      });
      if (!lexicalMandatory.length && !semanticFields.length) continue;
      if (semanticFields.length && lexicalMandatory.length) {
        const ids = new Set(lexicalMandatory.map(field => field.id));
        mandatoryFields = semanticFields.filter(field => ids.has(field.id));
        if (!mandatoryFields.length) mandatoryFields = semanticFields;
      } else mandatoryFields = semanticFields.length ? semanticFields : lexicalMandatory;
    } else if (mandatoryTerms.length === 1 && !semanticFields.length && !tokenPresentInText(mandatoryTerms[0], combined)) {
      continue;
    }
    const scored = fields
      .map(entry => ({ entry, ...scoreEntry(queryTerms, entry) }))
      .filter(row => row.score >= minScore)
      .sort((a, b) => b.score - a.score);
    if (!scored.length && !mandatoryTerms.length) continue;
    let chosen = scored.slice(0, 4);
    if (mandatoryFields.length) {
      const ids = new Set(mandatoryFields.map(entry => entry.id));
      const mustRows = mandatoryFields.slice(0, 3).map(entry => ({ entry, score: 0.8 }));
      chosen = [...mustRows, ...chosen.filter(row => !ids.has(row.entry.id))].slice(0, 4);
    } else if (!chosen.length && mandatoryTerms.length) {
      chosen = fields
        .filter(entry => mandatoryTerms.some(token => tokenPresentInText(token, `${entry.label || ''} ${entry.text || ''}`)))
        .slice(0, 4)
        .map(entry => ({ entry, score: 0.4 }));
    }
    const text = compactSnippet(chosen.map(row => `${row.entry.label || row.entry.section}: ${compactSnippet(row.entry.text, 220)}`).join(' | '), 420);
    if (!text) continue;
    rows.push({
      id: `building:${building.id}:aggregate`, entityType: 'building', entityId: building.id, section: 'aggregate',
      title: building.address, address: building.address, url: building.url, text,
      score: Number(Math.max(semanticFields.length ? 1.05 : 0, ...chosen.map(row => Number(row.score || 0.4))).toFixed(3)), matched: [],
      semantic: semanticPredicate?.id || ''
    });
  }
  rows.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return { results: rows.slice(0, limit), total: rows.length };
}

function compactSnippet(value, max = 420) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function fullBuildingResults(building, maxFields = 30) {
  return (building?.fields || []).slice(0, maxFields).map(entry => ({
    id: entry.id, entityType: entry.entityType, entityId: entry.entityId, section: entry.section,
    title: entry.title, address: entry.address, url: entry.url, text: entry.text, score: 1, matched: []
  }));
}

function searchEntries(entries, query, { limit = 8, minScore = 0.46, queryTokens = null } = {}) {
  const qt = Array.isArray(queryTokens) ? queryTokens : tokens(query).filter(t => t.length >= 2 && !QUERY_STOP.has(t));
  if (!qt.length) return [];
  return entries
    .map(entry => ({ entry, ...scoreEntry(qt, entry) }))
    .filter(row => row.score >= minScore && row.matched.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(80, limit)))
    .map(row => ({
      id: row.entry.id,
      entityType: row.entry.entityType,
      entityId: row.entry.entityId,
      section: row.entry.section,
      title: row.entry.title,
      address: row.entry.address,
      url: row.entry.url,
      text: row.entry.text,
      score: row.score,
      matched: row.matched
    }));
}

function uniqueBuildingsFromResults(results) {
  return [...new Set((results || []).map(x => x.entityId).filter(Boolean))];
}

function resultSummary(results, totalMatches = null) {
  const ids = uniqueBuildingsFromResults(results);
  return {
    resultCount: results.length,
    buildingCount: ids.length,
    totalMatches: Number.isFinite(totalMatches) ? totalMatches : results.length,
    truncated: Number.isFinite(totalMatches) ? totalMatches > results.length : false
  };
}

function normalizeActiveContext(active) {
  if (!active || typeof active !== 'object') return null;
  const scope = String(active.scope || (active.entityId ? 'building' : active.street ? 'street' : '')).trim();
  if (scope === 'street') {
    const street = String(active.street || '').trim();
    return street ? { scope: 'street', street } : null;
  }
  const entityId = String(active.entityId || '').trim();
  const address = String(active.address || '').trim();
  if (!entityId || !address) return null;
  return { scope: 'building', entityType: 'building', entityId, address, url: String(active.url || `/building/${entityId}`), street: String(active.street || streetPart(address)) };
}

export function queryCrmEntriesForTest(query, entries = BASELINE_BUILDING_ENTRIES, options = {}) {
  return queryCrmEntries(query, entries, options);
}

function queryCrmEntries(query, entries, { activeContext = null, maxResults = 32 } = {}) {
  const buildings = entriesToBuildings(entries);
  const active = normalizeActiveContext(activeContext);
  const aggregate = AGGREGATE_RE.test(String(query || ''));
  const semanticPredicate = semanticFieldPredicate(query);
  let resolvedStreet = resolveStreet(query, buildings);
  const queryHouse = explicitHouseToken(query);
  if (resolvedStreet?.ambiguous && queryHouse) {
    const candidates = [resolvedStreet, resolvedStreet.alternateCandidate].filter(Boolean);
    const matching = candidates.filter(candidate => (candidate.buildings || []).some(row => sameHouse(queryHouse, housePart(row.address))));
    if (matching.length === 1) resolvedStreet = { ...matching[0], ambiguous: false, alternate: '', alternateCandidate: null };
  }
  const newStreetExplicit = Boolean(resolvedStreet && !resolvedStreet.ambiguous);

  if (active?.scope === 'street' && !aggregate && !queryHouse && FOLLOWUP_RE.test(String(query || ''))) {
    const streetBuildings = buildings.filter(row => fold(streetPart(row.address)) === fold(active.street));
    if (streetBuildings.length) {
      const terms = topicTokens(query, active.street);
      const direct = directTopicTokens(query, active.street);
      const aggregated = aggregateBuildingResults(streetBuildings, terms, mandatoryTopicTokens(direct), { limit: maxResults, minScore: 0.28, semanticPredicate });
      // Active CRM context is a convenience, not a sticky conversation mode.  Only keep
      // the street when the new message actually matches CRM evidence, or when the
      // operator explicitly asks to continue with the same place ("а что еще?", "там?").
      if (aggregated.results.length || CRM_CONTEXT_ONLY_FOLLOWUP_RE.test(String(query || ''))) {
        const results = aggregated.results.length
          ? aggregated.results
          : streetBuildings.slice(0, Math.min(8, maxResults)).flatMap(row => fullBuildingResults(row, 2)).slice(0, maxResults);
        return {
          plan: { mode: 'crm', scope: 'active_street', aggregate: true, street: active.street, query, topicTokens: terms, directTokens: direct, semantic: semanticPredicate?.id || '' },
          results, nextActiveContext: active,
          summary: { ...resultSummary(results, aggregated.results.length ? aggregated.total : streetBuildings.length), streetBuildingCount: streetBuildings.length, matchedBuildingCount: aggregated.results.length ? aggregated.total : streetBuildings.length }
        };
      }
    }
  }

  if (active?.scope === 'building' && !aggregate && !queryHouse && FOLLOWUP_RE.test(String(query || ''))) {
    const building = buildings.find(row => row.id === active.entityId);
    if (building) {
      const terms = topicTokens(query, active.street || streetPart(active.address));
      const results = terms.length
        ? searchEntries(building.fields, query, { limit: maxResults, minScore: 0.2, queryTokens: terms })
        : [];
      // Do NOT fall back to the whole active building for an unrelated question.
      // That old fallback is what turned "что по скорости?" into another Danchenko answer.
      if (results.length || CRM_CONTEXT_ONLY_FOLLOWUP_RE.test(String(query || ''))) {
        const selected = results.length ? results : fullBuildingResults(building);
        return {
          plan: { mode: 'crm', scope: 'active_building', aggregate: false, street: active.street, query, topicTokens: terms },
          results: selected, nextActiveContext: active, summary: resultSummary(selected)
        };
      }
    }
  }

  if (resolvedStreet?.ambiguous) {
    return {
      plan: { mode: 'crm', scope: 'ambiguous_street', aggregate, street: resolvedStreet.street, alternateStreet: resolvedStreet.alternate, query },
      results: [], nextActiveContext: active, summary: resultSummary([]), ambiguity: `Неоднозначная улица: ${resolvedStreet.street} / ${resolvedStreet.alternateStreet}`
    };
  }

  if (newStreetExplicit) {
    const streetBuildings = resolvedStreet.buildings;
    if (queryHouse) {
      const building = streetBuildings.find(row => sameHouse(queryHouse, housePart(row.address)));
      if (building) {
        const results = fullBuildingResults(building);
        return {
          plan: { mode: 'crm', scope: 'building', aggregate: false, street: resolvedStreet.street, house: queryHouse, query },
          results,
          nextActiveContext: { scope: 'building', entityType: 'building', entityId: building.id, address: building.address, url: building.url, street: resolvedStreet.street },
          summary: resultSummary(results)
        };
      }
    }

    const terms = topicTokens(query, resolvedStreet.street, resolvedStreet.matchedQuery);
    const direct = directTopicTokens(query, resolvedStreet.street, resolvedStreet.matchedQuery);
    if (!terms.length) {
      const results = streetBuildings.slice(0, Math.min(25, maxResults)).flatMap(row => fullBuildingResults(row, 3));
      return {
        plan: { mode: 'crm', scope: 'street', aggregate: true, street: resolvedStreet.street, query, topicTokens: [] },
        results: results.slice(0, maxResults), nextActiveContext: { scope: 'street', street: resolvedStreet.street },
        summary: { ...resultSummary(results.slice(0, maxResults), streetBuildings.length), streetBuildingCount: streetBuildings.length }
      };
    }
    const aggregated = aggregateBuildingResults(streetBuildings, terms, mandatoryTopicTokens(direct), { limit: maxResults, minScore: 0.28, semanticPredicate });
    const results = aggregated.results;
    return {
      plan: { mode: 'crm', scope: 'street', aggregate: true, street: resolvedStreet.street, query, topicTokens: terms, directTokens: direct, semantic: semanticPredicate?.id || '' },
      results, nextActiveContext: { scope: 'street', street: resolvedStreet.street },
      summary: { ...resultSummary(results, aggregated.total), streetBuildingCount: streetBuildings.length, matchedBuildingCount: aggregated.total }
    };
  }

  // Universal global search: always attempted. No hard-coded people/streets/commands.
  const terms = topicTokens(query, '');
  const direct = directTopicTokens(query, '');
  const globalAggregate = aggregate
    ? aggregateBuildingResults(buildings, terms, mandatoryTopicTokens(direct), { limit: maxResults, minScore: 0.3, semanticPredicate })
    : null;
  const all = aggregate ? globalAggregate.results : searchEntries(entries, query, { limit: 80, minScore: 0.44, queryTokens: terms });
  const results = aggregate ? all : all.slice(0, Math.min(12, maxResults));
  const ids = uniqueBuildingsFromResults(results);
  let nextActiveContext = aggregate ? null : active;
  if (!aggregate && ids.length === 1) {
    const building = buildings.find(row => row.id === ids[0]);
    if (building) nextActiveContext = { scope: 'building', entityType: 'building', entityId: building.id, address: building.address, url: building.url, street: streetPart(building.address) };
  }
  return {
    plan: { mode: (results.length || aggregate) ? 'crm' : 'none', scope: aggregate ? 'global_aggregate' : 'global', aggregate, query, topicTokens: terms, directTokens: direct, semantic: semanticPredicate?.id || '' },
    results,
    nextActiveContext,
    summary: resultSummary(results, aggregate ? globalAggregate.total : all.length)
  };
}

function chromeStorageGet(key) {
  const api = globalThis.chrome?.storage?.local;
  if (!api?.get) return Promise.resolve({});
  return new Promise(resolve => api.get(key, value => resolve(value || {})));
}

export async function loadCrmSnapshot() {
  const stored = await chromeStorageGet(CRM_SNAPSHOT_STORAGE_KEY);
  return stored?.[CRM_SNAPSHOT_STORAGE_KEY] || null;
}

export async function queryCrmIndex(query, { activeContext = null, maxResults = 32 } = {}) {
  const snapshot = await loadCrmSnapshot();
  const dynamic = snapshotToCrmEntries(snapshot);
  // Production CRM routing must never silently fall back to the old one-building
  // Danchenko fixture.  On a PC without an imported/crawled snapshot CRM simply
  // has no evidence and the normal diagnostic assistant remains available.
  const outcome = queryCrmEntries(query, dynamic, { activeContext, maxResults });
  return {
    ...outcome,
    snapshot: {
      complete: Boolean(snapshot?.stats?.complete),
      buildings: Number(snapshot?.buildings?.length || 0),
      generatedAt: String(snapshot?.generatedAt || snapshot?.stats?.generatedAt || ''),
      source: dynamic.length ? 'snapshot' : 'missing'
    }
  };
}

// Backward-compatible direct search used by existing tests/debug UI.
export async function searchCrmIndex(query, { limit = 8, minScore = 0.46 } = {}) {
  const snapshot = await loadCrmSnapshot();
  const dynamic = snapshotToCrmEntries(snapshot);
  const source = dynamic.length ? dynamic : BASELINE_BUILDING_ENTRIES;
  return searchEntries(source, query, { limit, minScore });
}

export function searchCrmEntriesForTest(query, entries = BASELINE_BUILDING_ENTRIES, options = {}) {
  return searchEntries(entries, query, options);
}

export function crmSearchPrompt(input) {
  const outcome = Array.isArray(input) ? { results: input, plan: { scope: 'legacy' }, summary: resultSummary(input), snapshot: {} } : (input || {});
  const results = Array.isArray(outcome.results) ? outcome.results : [];
  if (!results.length && !outcome.ambiguity && outcome?.plan?.mode !== 'crm') return '';

  const aggregateScope = Boolean(outcome?.plan?.aggregate) || /(?:street|aggregate)/.test(String(outcome?.plan?.scope || ''));
  const rowLimit = aggregateScope ? CRM_PROMPT_AGGREGATE_MAX_ROWS : CRM_PROMPT_DIRECT_MAX_ROWS;
  const evidenceMax = aggregateScope ? 150 : 360;
  const rows = [];
  let used = 0;
  for (const item of results.slice(0, rowLimit)) {
    const row = [
      String(item.entityId || ''),
      compactSnippet(item.address || item.title || '', 150),
      String(item.url || ''),
      compactSnippet(item.text || '', evidenceMax)
    ];
    const encoded = JSON.stringify(row);
    if (rows.length && used + encoded.length > CRM_PROMPT_CHAR_BUDGET - 1900) break;
    rows.push(row);
    used += encoded.length;
  }
  const originalTotal = Number(outcome?.summary?.totalMatches || results.length);
  const promptTruncated = rows.length < results.length || originalTotal > rows.length;
  const payload = {
    revision: CRM_SEARCH_INDEX_REVISION,
    scopeNote: 'UserSide building core-card index only; subscriber/customer rows and tabs excluded',
    plan: outcome.plan || {},
    summary: {
      ...(outcome.summary || resultSummary(results)),
      promptRows: rows.length,
      promptTruncated,
      promptTotalMatches: originalTotal
    },
    snapshot: outcome.snapshot || {},
    ambiguity: outcome.ambiguity || '',
    active: outcome.nextActiveContext || null,
    columns: ['buildingId','address','url','evidence'],
    rows
  };
  let text = JSON.stringify(payload);
  if (text.length > CRM_PROMPT_CHAR_BUDGET) {
    while (payload.rows.length > 1 && JSON.stringify(payload).length > CRM_PROMPT_CHAR_BUDGET) payload.rows.pop();
    payload.summary.promptRows = payload.rows.length;
    payload.summary.promptTruncated = true;
    text = JSON.stringify(payload);
  }
  return text.slice(0, CRM_PROMPT_CHAR_BUDGET);
}

export function crmSearchIsPrimary(outcome, message = '') {
  if (!outcome) return false;
  if (outcome.ambiguity) return true;
  if (EXPLICIT_MIXED_RE.test(String(message || ''))) return false;
  const scope = String(outcome?.plan?.scope || '');
  if (outcome?.plan?.mode === 'crm' && ['building','active_building','street','global_aggregate','ambiguous_street'].includes(scope)) return true;
  if (!Array.isArray(outcome.results) || !outcome.results.length) return false;
  if (MIXED_DIAGNOSTIC_RE.test(String(message || ''))) return false;
  return outcome.plan?.mode === 'crm';
}

export async function crmSearchStats() {
  const snapshot = await loadCrmSnapshot();
  const dynamic = snapshotToCrmEntries(snapshot);
  return {
    revision: CRM_SEARCH_INDEX_REVISION,
    entries: dynamic.length,
    buildings: Number(snapshot?.buildings?.length || 0),
    complete: Boolean(snapshot?.stats?.complete),
    source: dynamic.length ? 'snapshot' : 'missing'
  };
}
