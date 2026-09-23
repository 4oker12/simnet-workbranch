'use strict';

import {
  CANONICAL_FACT_CATALOG,
  CANONICAL_SOURCE_CATALOG,
  canonicalFactPath,
  normalizeCanonicalFacts
} from './canonical-fact-catalog.js';

const FINANCE_BUNDLE_FACTS = Object.freeze([
  'subscriber.finance.balance.account',
  'subscriber.finance.balance.afterTariff',
  'subscriber.finance.balance.withoutTemporary',
  'subscriber.finance.temporaryPayment',
  'subscriber.finance.discount',
  'subscriber.finance.totalDue',
  'subscriber.finance.recurringTotal',
  'subscriber.finance.payments',
  'subscriber.tariff.current.name',
  'subscriber.tariff.current.price',
  'subscriber.service.accessState',
  'subscriber.service.serviceState'
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 320) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function hasOwn(object, key) {
  return Boolean(object && typeof object === 'object' && Object.hasOwn(object, key));
}

function readPath(object, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let value = object;
  for (const part of parts) {
    if (!hasOwn(value, part)) return { observed: false, value: undefined };
    value = value[part];
  }
  return { observed: true, value };
}

function normalizeFieldKey(value) {
  return clean(value, 120).toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeAddressKey(value) {
  return clean(value, 320).toLowerCase().replace(/[\s,.;]+/g, ' ').trim();
}

function readBuildingField(data = {}, field = '') {
  const wanted = normalizeFieldKey(field);
  for (const [key, value] of Object.entries(data?.fields || {})) {
    if (normalizeFieldKey(key) === wanted) return { observed: true, value: Array.isArray(value) ? value[0] : value };
  }
  for (const item of Array.isArray(data?.fieldList) ? data.fieldList : []) {
    if (normalizeFieldKey(item?.key || item?.label) === wanted) return { observed: true, value: item?.text ?? item?.value };
  }
  return { observed: false, value: undefined };
}

function readRaw(data, spec) {
  if (spec.field) return readBuildingField(data, spec.field);
  for (const path of spec.paths || []) {
    const result = readPath(data, path);
    if (result.observed) return { ...result, rawPath: path };
  }
  return { observed: false, value: undefined, rawPath: spec.paths?.[0] || '' };
}

function money(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
  const normalized = String(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  return /^-?\d+(?:\.\d{1,2})?$/.test(normalized) ? Number(normalized) : null;
}

function normalizedValue(value, type) {
  if (type === 'observed') return true;
  if (type === 'presence') return !(value === '' || value === null || value === undefined);
  if (type === 'money') return money(value);
  if (type === 'number') return value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const text = clean(value, 40).toLowerCase();
    if (/^(?:1|true|yes|да|так|є|есть)$/u.test(text)) return true;
    if (/^(?:0|false|no|нет|ні|немає|отсутствует|відсутній)$/u.test(text)) return false;
    return null;
  }
  if (type === 'array') return Array.isArray(value) ? clone(value) : null;
  if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : null;
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' || text === null || text === undefined ? null : text;
}

function expandFinanceBundleFacts(paths = []) {
  const normalized = normalizeCanonicalFacts(paths);
  if (!normalized.some(path => path.startsWith('subscriber.finance.'))) return normalized;
  return normalizeCanonicalFacts([...normalized, ...FINANCE_BUNDLE_FACTS]);
}

function sourceSemanticFacts(source, requestedFacts = []) {
  return requestedFacts.filter(path => CANONICAL_FACT_CATALOG[path]?.source === source);
}

function entityKey(source, context = {}, request = {}) {
  const sourceSpec = CANONICAL_SOURCE_CATALOG[source] || {};
  if (sourceSpec.scope === 'building') {
    // An explicit address is a new entity request and must outrank stale activeBuildingId.
    // Otherwise Building A could be returned from cache while the user explicitly asks for Building B.
    const explicitAddress = normalizeAddressKey(request.address);
    if (explicitAddress) return `building-address:${explicitAddress}`;
    const buildingId = clean(context?.domainContext?.activeBuildingId, 120);
    if (buildingId) return `building:${buildingId}`;
    const address = normalizeAddressKey(context?.domainContext?.activeBuildingAddress || context?.domainContext?.activeServiceAddress?.fullAddress);
    return `building-address:${address || 'unbound'}`;
  }
  const subscriber = context?.confirmedSubscriber || {};
  const id = clean(context?.confirmedCaseId || subscriber.billingId || subscriber.login || subscriber.contract, 160).toLowerCase();
  return `subscriber:${id || 'unbound'}`;
}

function cacheKey(source, context, request) {
  return `${source}:${entityKey(source, context, request)}`;
}

function adapterArgs(source, context = {}, request = {}, ttlMs = 120000, requiredFacts = []) {
  if (source === 'userside.building') {
    const address = clean(request.address || context?.domainContext?.activeBuildingAddress || context?.domainContext?.activeServiceAddress?.fullAddress, 320);
    return address ? { address } : {};
  }
  const args = { refresh: Boolean(request.refresh), maxAgeMs: ttlMs };
  if (source === 'billing.mainSummary' && Array.isArray(requiredFacts) && requiredFacts.length) {
    args.requiredCanonicalFacts = [...requiredFacts];
  }
  return args;
}

function updateDomainContext(domainContext = {}, source, data = {}, context = {}) {
  const next = clone(domainContext || {}) || {};
  const subscriber = context?.confirmedSubscriber || {};
  if (context?.confirmedCaseId) next.activeSubscriberId = clean(context.confirmedCaseId, 180);
  if (subscriber.contract) next.activeContractId = `contract:${clean(subscriber.contract, 80)}`;

  if (source === 'billing.customer') {
    const identity = data?.identity || {};
    const address = data?.address || {};
    if (identity.billingId) next.activeSubscriberId = `billing:${clean(identity.billingId, 80)}`;
    if (identity.contract) next.activeContractId = `contract:${clean(identity.contract, 80)}`;
    if (address.full || address.street || address.building) {
      next.activeServiceAddress = {
        street: clean(address.street, 180),
        buildingNumber: clean(address.building, 80),
        block: clean(address.block, 80),
        apartment: clean(address.apartment, 80),
        fullAddress: clean(address.full, 320)
      };
    }
  }
  if (source === 'userside.subscriber') {
    const family = clean(data?.network?.connectionFamily, 80);
    if (family) next.activeConnection = { family };
    if (data?.identity?.customerId) next.activeUserSideCustomerId = clean(data.identity.customerId, 80);
  }
  if (source === 'userside.building') {
    if (data?.buildingId) next.activeBuildingId = `userside-building:${clean(data.buildingId, 80)}`;
    if (data?.address) next.activeBuildingAddress = clean(data.address, 320);
  }
  if (requestTopicForSource(source)) next.currentTopic = requestTopicForSource(source);
  return next;
}

function requestTopicForSource(source) {
  if (source === 'userside.building') return 'building.connectivity';
  if (source === 'network.session') return 'network.session';
  if (source === 'userside.subscriber') return 'access.connection';
  if (source === 'billing.mainSummary') return 'subscriber.account';
  return '';
}

function factEvidence(path, spec, raw, meta = {}) {
  if (!raw.observed) {
    return { path, status: 'unknown', observed: false, value: null, source: spec.source, provenance: meta.provenance || '', code: 'FIELD_NOT_OBSERVED' };
  }
  const fieldTimestamp = meta.fieldObservedAt?.[raw.rawPath] || meta.observedAt || '';
  const fieldObservedAt = Date.parse(fieldTimestamp);
  if (Number.isFinite(fieldObservedAt) && (
    fieldObservedAt > meta.now + 5000
    || meta.now - fieldObservedAt >= spec.ttlMs
    || fieldObservedAt < meta.invalidatedAt
  )) {
    return {
      path,
      status: 'unknown',
      observed: false,
      value: null,
      source: spec.source,
      rawPath: raw.rawPath || spec.paths?.[0] || '',
      provenance: meta.provenance || '',
      observedAt: fieldTimestamp,
      code: 'STALE_FIELD'
    };
  }
  const value = normalizedValue(raw.value, spec.type);
  const absent = value === null && !['observed', 'presence'].includes(spec.type);
  return {
    path,
    status: absent ? 'absent' : 'known',
    observed: true,
    value,
    source: spec.source,
    rawPath: raw.rawPath || spec.paths?.[0] || '',
    provenance: meta.provenance || '',
    observedAt: fieldTimestamp,
    catalogStatus: spec.status || 'confirmed'
  };
}

function failedFact(path, spec, result = {}) {
  return {
    path,
    status: 'unknown',
    observed: false,
    value: null,
    source: spec.source,
    provenance: clean(result?.data?.source || result?.source || '', 160),
    observedAt: clean(result?.observedAt, 100),
    code: clean(result?.code || 'SOURCE_UNAVAILABLE', 100)
  };
}

function projectionChars(facts = []) {
  return JSON.stringify(facts).length;
}

function pruneSourceCache(cache = {}, maxEntries = 24) {
  const entries = Object.entries(cache).sort(([, left], [, right]) => Number(right?.cachedAt || 0) - Number(left?.cachedAt || 0));
  return Object.fromEntries(entries.slice(0, maxEntries));
}

export function createCanonicalDomainContext(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...source,
    domainContext: clone(source.domainContext || {}),
    factSourceCache: clone(source.factSourceCache || {})
  };
}

export async function resolveFacts({ context: inputContext = {}, facts = [], execute, now = Date.now(), request = {} } = {}) {
  if (typeof execute !== 'function') throw new Error('Canonical Fact Resolver requires execute(tool)');
  const requestedFacts = normalizeCanonicalFacts(facts);
  const resolvedFacts = expandFinanceBundleFacts(requestedFacts);
  const rawRequested = (Array.isArray(facts) ? facts : []).map(item => String(typeof item === 'string' ? item : item?.path || '').trim()).filter(Boolean);
  const unsupportedFacts = rawRequested.filter(path => !canonicalFactPath(path));
  const context = createCanonicalDomainContext(inputContext);
  const groups = new Map();
  for (const path of resolvedFacts) {
    const spec = CANONICAL_FACT_CATALOG[path];
    if (!groups.has(spec.source)) groups.set(spec.source, []);
    groups.get(spec.source).push(path);
  }

  const returned = [];
  const sourceTrace = [];
  const sourceReads = [];
  const cacheHits = [];
  let broadPayloadChars = 0;

  for (const [source, paths] of groups) {
    const sourceSpec = CANONICAL_SOURCE_CATALOG[source];
    const ttlMs = Math.min(...paths.map(path => CANONICAL_FACT_CATALOG[path].ttlMs || sourceSpec.ttlMs));
    const key = cacheKey(source, context, request);
    const cached = context.factSourceCache[key];
    const cachedAt = Number(cached?.cachedAt || 0);
    const fresh = !request.refresh && cached?.ok && cachedAt > 0 && now - cachedAt < ttlMs && cachedAt >= Number(context.invalidatedAt || 0);
    const semanticFactsForSource = sourceSemanticFacts(source, requestedFacts);
    const adapterFacts = source === 'billing.mainSummary' && semanticFactsForSource.length ? semanticFactsForSource : paths;
    let result;
    let fromCache = false;

    if (fresh) {
      result = clone(cached.result);
      fromCache = true;
      cacheHits.push(source);
    } else {
      const toolArgs = adapterArgs(source, context, request, ttlMs, adapterFacts);
      try {
        result = await execute({ tool: sourceSpec.tool, toolArgs, labState: context });
      } catch (error) {
        result = { ok: false, tool: sourceSpec.tool, code: 'SOURCE_UNAVAILABLE', observedAt: new Date(now).toISOString(), data: { message: clean(error?.message || error, 500) }, warnings: [] };
      }
      sourceReads.push(source);
      context.factSourceCache[key] = { ok: Boolean(result?.ok), cachedAt: now, result: clone(result) };
      if (result?.statePatch && typeof result.statePatch === 'object') Object.assign(context, clone(result.statePatch));
    }

    const data = result?.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : {};
    broadPayloadChars += JSON.stringify(data).length;
    const provenance = clean(data.source || data?.evidence?.source || result?.source || sourceSpec.tool, 160);
    const observedAt = clean(result?.observedAt || data?.observedAt || data?.evidence?.observedAt, 100);
    const groupFacts = result?.ok
      ? paths.map(path => factEvidence(path, CANONICAL_FACT_CATALOG[path], readRaw(data, CANONICAL_FACT_CATALOG[path]), {
        provenance,
        observedAt,
        fieldObservedAt: data?.evidence?.fieldObservedAt || data?.fieldObservedAt || {},
        now,
        invalidatedAt: Number(context.invalidatedAt || 0)
      }))
      : paths.map(path => failedFact(path, CANONICAL_FACT_CATALOG[path], result));
    returned.push(...groupFacts);
    context.domainContext = updateDomainContext(context.domainContext, source, data, context);
    if (!fromCache && result?.ok && sourceSpec.scope === 'building') {
      // Keep both the explicit-address key used for this read and a stable resolved-id alias.
      // A follow-up "там" can then reuse Building B without another read.
      const resolvedKey = cacheKey(source, context, {});
      context.factSourceCache[resolvedKey] = { ok: true, cachedAt: now, result: clone(result) };
    }

    sourceTrace.push({
      tool: sourceSpec.tool,
      source,
      requestedFacts: [...paths],
      semanticRequestedFacts: [...semanticFactsForSource],
      args: adapterArgs(source, context, request, ttlMs, adapterFacts),
      ok: Boolean(result?.ok),
      code: clean(result?.code || (result?.ok ? 'OK' : 'ERROR'), 100),
      observedAt,
      provenance,
      cache: fromCache ? 'hit' : 'miss',
      warnings: (Array.isArray(result?.warnings) ? result.warnings : []).map(item => clean(item, 360)).filter(Boolean).slice(0, 5)
    });
  }

  const compactFacts = returned.map(item => ({
    path: item.path,
    status: item.status,
    observed: item.observed,
    value: clone(item.value),
    source: item.source,
    provenance: item.provenance,
    observedAt: item.observedAt || '',
    ...(item.code ? { code: item.code } : {})
  }));
  context.factSourceCache = pruneSourceCache(context.factSourceCache);
  const evidenceChars = projectionChars(compactFacts);
  return {
    requestedFacts,
    resolvedFacts,
    unsupportedFacts,
    facts: returned,
    evidence: compactFacts,
    sourceTrace,
    context,
    diagnostics: {
      requestedFacts,
      resolvedFacts,
      sourceReads,
      cacheHits,
      returnedFacts: returned.filter(item => item.status !== 'unknown').map(item => item.path),
      unknownFacts: returned.filter(item => item.status === 'unknown').map(item => item.path),
      sourceCalls: sourceReads.length,
      broadPayloadChars,
      evidenceChars,
      savedChars: Math.max(0, broadPayloadChars - evidenceChars),
      reductionRatio: broadPayloadChars > 0 ? Number((1 - evidenceChars / broadPayloadChars).toFixed(4)) : 0
    }
  };
}

export const CANONICAL_FACT_RESOLVER_VERSION = 4;
