(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module?.exports) module.exports = api;
  const WB = root?.SIMNET_WB;
  if (WB && !WB.taskStreetOwnerRules) WB.taskStreetOwnerRules = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SOVKI_OWNER_IDS = Object.freeze(['148', '171']);
  const SOVKI_OWNER_UUIDS = Object.freeze([
    '680df433-810d-4a6e-a5f3-98748f891e6d', // owner/148 · Масив Совки
    'ba1f4e16-7d00-46c5-a535-13f22723d677'  // owner/171 · Массив Совки
  ]);
  const REQUIRED_CREW = Object.freeze({
    id: '13',
    uuid: 'c2e9fc30-f22d-4317-a039-30ea3deac875',
    name: 'Бр. 2.1 ВЛ'
  });

  const compact = (value, max = 1000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const normalize = value => compact(value, 2000)
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

  function ownerIdFromHref(href) {
    const match = String(href || '').match(/^\/owner\/(\d+)(?:[/?#]|$)/i);
    return match ? match[1] : '';
  }

  function normalizeOwner(owner = {}) {
    return {
      id: String(owner.id || '').trim(),
      uuid: String(owner.uuid || '').trim().toLowerCase(),
      name: compact(owner.name || '', 240)
    };
  }

  function dedupeOwners(owners = []) {
    const out = [];
    const seen = new Set();
    for (const raw of owners) {
      const owner = normalizeOwner(raw);
      if (!owner.id && !owner.uuid && !owner.name) continue;
      const key = owner.id || owner.uuid || normalize(owner.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(owner);
    }
    return out;
  }

  function parseOwnersDocument(doc) {
    if (!doc?.querySelectorAll) return [];
    const owners = [];

    // Read-only building card: one canonical property row named exactly "Собственник".
    for (const row of doc.querySelectorAll('.erp-object-props__row')) {
      const label = compact(row.querySelector?.('.erp-object-props__label-main')?.textContent || '', 120);
      if (normalize(label) !== 'собственник') continue;
      for (const anchor of row.querySelectorAll?.('a[href^="/owner/"]') || []) {
        const href = String(anchor.getAttribute?.('href') || '');
        owners.push({
          id: ownerIdFromHref(href),
          uuid: '',
          name: compact(anchor.textContent || '', 240)
        });
      }
    }
    if (owners.length) return dedupeOwners(owners);

    // Edit-card fallback. Current UserSide exposes owner_uuid1/2/3 selectors here.
    for (const row of doc.querySelectorAll('.erp-object-props__row')) {
      const label = compact(row.querySelector?.('.erp-object-props__label-main')?.textContent || '', 120);
      if (!/^собственник(?:\s+\d+)?$/iu.test(label)) continue;
      const select = row.querySelector?.('select[name^="owner_uuid"]');
      const uuid = String(select?.value || '').trim();
      const name = compact(select?.selectedOptions?.[0]?.textContent || '', 240);
      if (uuid || name) owners.push({ id: '', uuid, name });
    }
    return dedupeOwners(owners);
  }

  function cleanStreetName(label) {
    return compact(label, 320).replace(/\s*\[Street\]\s*$/iu, '').trim();
  }

  function resolveStreetSelection(items = []) {
    const normalized = items
      .map(item => ({
        uuid: String(item?.uuid || item?.value || '').trim(),
        label: compact(item?.label || item?.text || '', 320)
      }))
      .filter(item => UUID_RE.test(item.uuid));

    const explicit = normalized.find(item => /\[Street\]/iu.test(item.label));
    if (explicit) return { streetUuid: explicit.uuid, streetName: cleanStreetName(explicit.label), source: 'street-marker' };

    // UserSide address cascade ends with the house/building unit; the selected parent immediately
    // before it is the street when an explicit [Street] marker is absent.
    if (normalized.length >= 2) {
      const last = normalized.at(-1);
      const previous = normalized.at(-2);
      const lastLooksBuilding = /\[(?:House|Building)\]/iu.test(last.label)
        || /^\s*(?:д\.?|дом|буд\.?|будинок)?\s*\d/iu.test(last.label);
      if (lastLooksBuilding) {
        return { streetUuid: previous.uuid, streetName: cleanStreetName(previous.label), source: 'parent-before-building' };
      }
    }
    return { streetUuid: '', streetName: '', source: 'unresolved' };
  }

  function classifyTerritory(owners = []) {
    const normalizedOwners = dedupeOwners(owners);
    const ownerIds = new Set(normalizedOwners.map(owner => owner.id).filter(Boolean));
    const ownerUuids = new Set(normalizedOwners.map(owner => owner.uuid).filter(Boolean));
    const byId = SOVKI_OWNER_IDS.some(id => ownerIds.has(id));
    const byUuid = SOVKI_OWNER_UUIDS.some(uuid => ownerUuids.has(uuid));
    const byName = normalizedOwners.some(owner => normalize(owner.name).includes('совки'));
    if (byId || byUuid || byName) {
      return {
        territory: 'SOVKI',
        matchedBy: byId ? 'owner-id' : byUuid ? 'owner-uuid' : 'owner-name',
        requiredCrew: REQUIRED_CREW
      };
    }
    return { territory: '', matchedBy: '', requiredCrew: null };
  }

  function crewMatchesRequired(crewFacts = [], requiredCrew = REQUIRED_CREW) {
    const requiredId = String(requiredCrew?.id || '').trim();
    const requiredUuid = String(requiredCrew?.uuid || '').trim().toLowerCase();
    const requiredName = normalize(requiredCrew?.name || '');
    return crewFacts.some(fact => {
      const id = String(fact?.id || '').trim();
      const uuid = String(fact?.uuid || fact?.value || '').trim().toLowerCase();
      const name = normalize(fact?.name || fact?.label || '');
      return Boolean(
        (requiredId && id === requiredId)
        || (requiredUuid && uuid === requiredUuid)
        || (requiredName && name === requiredName)
      );
    });
  }

  function evaluateCrewRule(context = {}, crewFacts = []) {
    const issues = [];
    if (context.status === 'error') {
      return { applies: false, failOpen: true, matched: false, issues };
    }
    if (context.status !== 'ready' || context.territory !== 'SOVKI') {
      return { applies: false, failOpen: false, matched: false, issues };
    }

    const matched = crewMatchesRequired(crewFacts, context.requiredCrew || REQUIRED_CREW);
    if (!matched) {
      const ownerLabel = context.owners?.find(owner => normalize(owner.name).includes('совки'))?.name
        || context.owners?.find(owner => SOVKI_OWNER_IDS.includes(String(owner.id || '')))?.name
        || 'Массив Совки';
      issues.push({
        level: 'error',
        code: 'street-owner-crew-mismatch',
        message: `Для этого адреса требуется бригада ${REQUIRED_CREW.name}. Собственник улицы: ${ownerLabel}.`
      });
    }
    return { applies: true, failOpen: false, matched, issues };
  }

  function createStreetContextCache(loader) {
    if (typeof loader !== 'function') throw new TypeError('street context loader is required');
    const values = new Map();
    const pending = new Map();

    async function get(streetUuid, source = {}) {
      const key = String(streetUuid || '').trim().toLowerCase();
      if (!UUID_RE.test(key)) return { status: 'error', streetUuid: key, error: 'street uuid missing' };
      if (values.has(key)) return values.get(key);
      if (pending.has(key)) return pending.get(key);

      const promise = Promise.resolve()
        .then(() => loader(key, source))
        .then(result => {
          const context = {
            status: 'ready',
            streetUuid: key,
            streetName: compact(result?.streetName || source?.streetName || '', 320),
            owners: dedupeOwners(result?.owners || []),
            territory: result?.territory || '',
            requiredCrew: result?.requiredCrew || null,
            source: result?.source || '',
            buildingId: String(result?.buildingId || source?.buildingId || ''),
            buildingUuid: String(result?.buildingUuid || source?.buildingUuid || '')
          };
          values.set(key, context);
          return context;
        })
        .catch(error => ({
          status: 'error',
          streetUuid: key,
          streetName: compact(source?.streetName || '', 320),
          owners: [],
          territory: '',
          requiredCrew: null,
          source: 'load-error',
          buildingId: String(source?.buildingId || ''),
          buildingUuid: String(source?.buildingUuid || ''),
          error: compact(error?.message || error, 240)
        }))
        .finally(() => pending.delete(key));

      pending.set(key, promise);
      return promise;
    }

    return Object.freeze({
      get,
      has(streetUuid) { return values.has(String(streetUuid || '').trim().toLowerCase()); },
      peek(streetUuid) { return values.get(String(streetUuid || '').trim().toLowerCase()) || null; },
      clear(streetUuid = '') {
        const key = String(streetUuid || '').trim().toLowerCase();
        if (key) values.delete(key);
        else values.clear();
      },
      get size() { return values.size; }
    });
  }

  return Object.freeze({
    uuidRe: UUID_RE,
    sovkiOwnerIds: SOVKI_OWNER_IDS,
    sovkiOwnerUuids: SOVKI_OWNER_UUIDS,
    requiredCrew: REQUIRED_CREW,
    compact,
    normalize,
    ownerIdFromHref,
    dedupeOwners,
    parseOwnersDocument,
    resolveStreetSelection,
    classifyTerritory,
    crewMatchesRequired,
    evaluateCrewRule,
    createStreetContextCache
  });
});
