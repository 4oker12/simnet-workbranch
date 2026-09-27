'use strict';

const MAX_EPISODES = 12;
const MAX_TOOL_RESULTS = 10;

function text(value, max = 400) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function digits(value, max = 12) {
  return String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
}

function normalizeIp(value) {
  const match = String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (!match) return '';
  const parts = match[0].split('.').map(Number);
  return parts.every(part => part >= 0 && part <= 255) ? match[0] : '';
}

export function normalizeCompanionTarget(value = {}) {
  const billingId = digits(value.billingId);
  const contract = digits(value.contract);
  const login = text(value.login, 80).replace(/\s+/g, '');
  const ip = normalizeIp(value.ip);
  const address = text(value.address, 260);
  const fullName = text(value.fullName, 180);
  const customerId = digits(value.customerId, 16);
  const connectionFamily = text(value.connectionFamily, 80);
  const source = text(value.source, 40);
  return { billingId, contract, login, ip, address, fullName, customerId, connectionFamily, source };
}

export function companionTargetKey(value = {}) {
  const target = normalizeCompanionTarget(value);
  if (target.billingId) return `billing:${target.billingId}`;
  if (target.contract) return `contract:${target.contract}`;
  if (target.login) return `login:${target.login.toLowerCase()}`;
  if (target.ip) return `ip:${target.ip}`;
  if (target.customerId) return `customer:${target.customerId}`;
  if (target.address) return `address:${target.address.toLowerCase()}`;
  return '';
}

export function companionTargetsMatch(leftValue = {}, rightValue = {}) {
  const left = normalizeCompanionTarget(leftValue);
  const right = normalizeCompanionTarget(rightValue);
  for (const key of ['billingId', 'contract', 'customerId', 'ip']) {
    if (left[key] && right[key] && left[key] === right[key]) return true;
  }
  if (left.login && right.login && left.login.toLowerCase() === right.login.toLowerCase()) return true;
  if (left.address && right.address && left.address.toLowerCase() === right.address.toLowerCase()) return true;
  return false;
}

export function companionTargetLabel(value = {}) {
  const target = normalizeCompanionTarget(value);
  return target.contract || target.login || target.billingId || target.ip || target.address || target.fullName || 'рабочий эпизод';
}

export function extractCompanionTarget(message = '') {
  const source = text(message, 1400);
  if (!source) return null;

  const abon = source.match(/\b(abon\d{3,12})\b/i)?.[1];
  if (abon) return normalizeCompanionTarget({ login: abon, contract: abon.replace(/\D+/g, ''), source: 'explicit-login' });

  const labeledContract = source.match(/(?:договор|догов[іi]р|лицев(?:ой|ий)?\s*сч[её]т|особов(?:ий|ого)?\s*рахунок|абон(?:ент)?|абон\.?|клиент|клієнт|номер|№)\s*(?:[:#№=\-—]|по)?\s*(\d{3,12})\b/i)?.[1];
  if (labeledContract) return normalizeCompanionTarget({ contract: labeledContract, source: 'labeled-contract' });

  const afterPo = source.match(/\bпо\s+(\d{3,12})\b/i)?.[1];
  if (afterPo) return normalizeCompanionTarget({ contract: afterPo, source: 'after-po' });

  const workVerbBefore = source.match(/(?:глянь|глянька|проверь|перевір|чекни|чекан[иь]|посмотри|подивись|пробей|пробий|найди|знайди|смотри\s+по)\D{0,24}(\d{3,12})\b/i)?.[1];
  if (workVerbBefore) return normalizeCompanionTarget({ contract: workVerbBefore, source: 'work-verb' });

  const workVerbAfter = source.match(/\b(\d{3,12})\b\D{0,24}(?:глянь|проверь|перевір|чекни|посмотри|подивись|пробей|пробий|найди|знайди)/i)?.[1];
  if (workVerbAfter) return normalizeCompanionTarget({ contract: workVerbAfter, source: 'work-verb' });

  const labeledIp = source.match(/(?:ip|айпи|ай-пи|адрес\s+ip)\s*(?:[:#=\-—]|по)?\s*((?:\d{1,3}\.){3}\d{1,3})/i)?.[1];
  if (labeledIp) return normalizeCompanionTarget({ ip: labeledIp, source: 'explicit-ip' });

  const standalone = source.replace(/[.,;:!?]+$/g, '').trim();
  if (/^\d{3,12}$/.test(standalone)) return normalizeCompanionTarget({ contract: standalone, source: 'standalone-contract' });

  return null;
}

export function messageClosesWorkEpisode(message = '') {
  const q = text(message, 500).toLowerCase();
  if (!q) return false;
  return /^(?:вс[её](?:\s*,?\s*(?:с\s+ним|по\s+нему))?(?:\s+(?:закончили|понятно|ясно))?|с\s+ним\s+(?:вс[её]|закончили)|(?:закрывай|закроем)\s+(?:его|этого|кейс)|забей(?:\s+на\s+(?:него|этого))?|дальше|следующий|наступний)[.!?]*$/iu.test(q);
}

export function messageReferencesPreviousEpisode(message = '') {
  return /(?:предыдущ(?:ий|его|ему|ем)|прошл(?:ый|ого|ому)|вернись\s+к\s+(?:предыдущ|прошл))/iu.test(text(message, 500));
}

function normalizeToolState(value = {}) {
  const confirmedSubscriber = value?.confirmedSubscriber && typeof value.confirmedSubscriber === 'object'
    ? normalizeCompanionTarget(value.confirmedSubscriber)
    : null;
  const pendingCandidate = value?.pendingCandidate && typeof value.pendingCandidate === 'object'
    ? normalizeCompanionTarget(value.pendingCandidate)
    : null;
  return {
    confirmedCaseId: text(value?.confirmedCaseId, 160),
    confirmedSubscriber,
    pendingCandidate
  };
}

function normalizeToolResult(value = {}) {
  return {
    tool: text(value.tool, 80),
    ok: Boolean(value.ok),
    code: text(value.code, 80),
    observedAt: text(value.observedAt, 64),
    data: value.data && typeof value.data === 'object' ? value.data : {},
    warnings: (Array.isArray(value.warnings) ? value.warnings : []).slice(0, 6).map(item => text(item, 300))
  };
}

function normalizeEpisode(value = {}) {
  const status = value.status === 'closed' ? 'closed' : 'active';
  const latestByTool = {};
  if (value.latestByTool && typeof value.latestByTool === 'object' && !Array.isArray(value.latestByTool)) {
    for (const [key, row] of Object.entries(value.latestByTool)) latestByTool[text(key, 80)] = normalizeToolResult(row);
  }
  return {
    id: text(value.id, 100),
    status,
    target: normalizeCompanionTarget(value.target || {}),
    toolState: normalizeToolState(value.toolState || {}),
    latestByTool,
    toolResults: (Array.isArray(value.toolResults) ? value.toolResults : []).slice(-MAX_TOOL_RESULTS).map(normalizeToolResult),
    createdAt: text(value.createdAt, 64),
    updatedAt: text(value.updatedAt, 64),
    closedAt: status === 'closed' ? text(value.closedAt, 64) : ''
  };
}

export function normalizeCompanionWorkState(value = {}) {
  const episodes = (Array.isArray(value.episodes) ? value.episodes : [])
    .map(normalizeEpisode)
    .filter(item => item.id && companionTargetKey(item.target))
    .slice(-MAX_EPISODES);
  let activeEpisodeId = text(value.activeEpisodeId, 100);
  if (!episodes.some(item => item.id === activeEpisodeId && item.status === 'active')) activeEpisodeId = '';
  return {
    schema: 'simnet-operator-companion-work-v1',
    activeEpisodeId,
    episodes,
    updatedAt: text(value.updatedAt, 64)
  };
}

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function nextEpisodeId(state, nowMs) {
  const stamp = Math.max(0, Number(nowMs || Date.now())).toString(36);
  let index = 1;
  let id = `work_${stamp}_${index}`;
  const used = new Set(state.episodes.map(item => item.id));
  while (used.has(id)) id = `work_${stamp}_${++index}`;
  return id;
}

function closeActive(state, at) {
  if (!state.activeEpisodeId) return false;
  const episode = state.episodes.find(item => item.id === state.activeEpisodeId);
  if (!episode || episode.status === 'closed') {
    state.activeEpisodeId = '';
    return false;
  }
  episode.status = 'closed';
  episode.closedAt = at;
  episode.updatedAt = at;
  state.activeEpisodeId = '';
  return true;
}

function reopenEpisode(state, episode, at) {
  if (!episode) return null;
  closeActive(state, at);
  episode.status = 'active';
  episode.closedAt = '';
  episode.updatedAt = at;
  state.activeEpisodeId = episode.id;
  return episode;
}

function createEpisode(state, target, at, nowMs) {
  closeActive(state, at);
  const episode = normalizeEpisode({
    id: nextEpisodeId(state, nowMs),
    status: 'active',
    target,
    toolState: {},
    latestByTool: {},
    toolResults: [],
    createdAt: at,
    updatedAt: at
  });
  state.episodes.push(episode);
  state.episodes = state.episodes.slice(-MAX_EPISODES);
  state.activeEpisodeId = episode.id;
  return episode;
}

export function activeCompanionEpisode(value = {}) {
  const state = normalizeCompanionWorkState(value);
  return state.episodes.find(item => item.id === state.activeEpisodeId && item.status === 'active') || null;
}

export function activateCompanionTarget(value = {}, targetValue = {}, options = {}) {
  const state = normalizeCompanionWorkState(value);
  const target = normalizeCompanionTarget(targetValue);
  const key = companionTargetKey(target);
  const nowMs = Number(options.nowMs || Date.now());
  const at = nowIso(nowMs);
  if (!key) return { state, activeEpisode: activeCompanionEpisode(state), switched: false, reopened: false, created: false };

  const active = state.episodes.find(item => item.id === state.activeEpisodeId && item.status === 'active') || null;
  let episode = state.episodes.find(item => companionTargetsMatch(item.target, target)) || null;
  let switched = false;
  let reopened = false;
  let created = false;

  if (active && companionTargetsMatch(active.target, target)) {
    active.target = { ...active.target, ...target };
    active.updatedAt = at;
    episode = active;
  } else if (episode) {
    switched = Boolean(active && active.id !== episode.id);
    reopened = episode.status === 'closed';
    reopenEpisode(state, episode, at);
    episode.target = { ...episode.target, ...target };
  } else {
    switched = Boolean(active);
    episode = createEpisode(state, target, at, nowMs);
    created = true;
  }
  state.updatedAt = at;
  return { state, activeEpisode: episode, switched, reopened, created };
}

export function prepareCompanionWorkTurn(value = {}, message = '', options = {}) {
  const state = normalizeCompanionWorkState(value);
  const nowMs = Number(options.nowMs || Date.now());
  const at = nowIso(nowMs);
  const explicitTarget = extractCompanionTarget(message);
  let switched = false;
  let reopened = false;
  let closed = false;

  if (explicitTarget) {
    let episode = state.episodes.find(item => companionTargetsMatch(item.target, explicitTarget)) || null;
    const active = state.episodes.find(item => item.id === state.activeEpisodeId && item.status === 'active') || null;
    if (active && companionTargetsMatch(active.target, explicitTarget)) {
      active.target = { ...active.target, ...explicitTarget };
      active.updatedAt = at;
      episode = active;
    } else if (episode) {
      switched = Boolean(active && active.id !== episode.id);
      reopened = episode.status === 'closed';
      reopenEpisode(state, episode, at);
      episode.target = { ...episode.target, ...explicitTarget };
    } else {
      switched = Boolean(active);
      episode = createEpisode(state, explicitTarget, at, nowMs);
    }
  } else if (messageReferencesPreviousEpisode(message)) {
    const candidates = state.episodes.filter(item => item.id !== state.activeEpisodeId);
    const previous = candidates[candidates.length - 1] || null;
    if (previous) {
      switched = Boolean(state.activeEpisodeId && state.activeEpisodeId !== previous.id);
      reopened = previous.status === 'closed';
      reopenEpisode(state, previous, at);
    }
  } else if (messageClosesWorkEpisode(message)) {
    closed = closeActive(state, at);
  }

  state.updatedAt = at;
  return {
    state,
    activeEpisode: state.episodes.find(item => item.id === state.activeEpisodeId && item.status === 'active') || null,
    explicitTarget,
    switched,
    reopened,
    closed
  };
}

function mergeToolState(current = {}, patch = {}) {
  const base = normalizeToolState(current);
  const next = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return normalizeToolState({
    ...base,
    ...next,
    confirmedSubscriber: next.confirmedSubscriber || base.confirmedSubscriber,
    pendingCandidate: Object.prototype.hasOwnProperty.call(next, 'pendingCandidate') ? next.pendingCandidate : base.pendingCandidate
  });
}

function candidateFromResult(result = {}) {
  const candidate = result?.data?.candidate;
  return candidate && typeof candidate === 'object' ? normalizeCompanionTarget(candidate) : null;
}

export function applyCompanionToolResult(value = {}, episodeId = '', rawResult = {}, options = {}) {
  const state = normalizeCompanionWorkState(value);
  const episode = state.episodes.find(item => item.id === episodeId) || null;
  if (!episode) return state;
  const at = text(rawResult?.observedAt, 64) || nowIso(Number(options.nowMs || Date.now()));
  const result = normalizeToolResult(rawResult);
  episode.toolState = mergeToolState(episode.toolState, rawResult?.statePatch || {});
  const candidate = candidateFromResult(rawResult);
  if (candidate) episode.target = { ...episode.target, ...candidate };
  if (result.tool) episode.latestByTool[result.tool] = result;
  episode.toolResults = [...episode.toolResults, result].slice(-MAX_TOOL_RESULTS);
  episode.updatedAt = at;
  state.updatedAt = at;
  return state;
}

export function summarizeCompanionWork(value = {}) {
  const state = normalizeCompanionWorkState(value);
  const active = state.episodes.find(item => item.id === state.activeEpisodeId && item.status === 'active') || null;
  const recent = state.episodes.slice(-5).reverse().map(item => ({
    id: item.id,
    status: item.status,
    label: companionTargetLabel(item.target),
    target: item.target,
    updatedAt: item.updatedAt
  }));
  return {
    schema: state.schema,
    activeEpisode: active ? {
      id: active.id,
      status: active.status,
      label: companionTargetLabel(active.target),
      target: active.target,
      updatedAt: active.updatedAt
    } : null,
    recentEpisodes: recent
  };
}
