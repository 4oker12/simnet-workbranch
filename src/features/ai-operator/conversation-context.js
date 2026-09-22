'use strict';

import { extractStandaloneSubscriberIdentity } from './subscriber-identity.js';

const DEFAULT_ACTIVE_TURNS = 18;
const DEFAULT_GENERAL_TURNS = 16;
const DEFAULT_TEXT_CHARS = 900;

function text(value, max = DEFAULT_TEXT_CHARS) {
  const normalized = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function normalizeRole(value) {
  return value === 'customer' || value === 'user' ? 'customer' : 'operator';
}

function normalizeTurn(item = {}, index = 0) {
  return {
    index,
    role: normalizeRole(item?.role),
    text: text(item?.text ?? item?.content ?? ''),
    id: String(item?.id || ''),
    at: String(item?.at || '')
  };
}

function identityFromCustomerText(value = '') {
  const source = text(value, 1200);
  if (!source) return null;
  const identity = extractStandaloneSubscriberIdentity([{ role: 'customer', text: source }]);
  if (identity?.login) return { type: 'login', value: String(identity.login), key: `login:${String(identity.login).toLowerCase()}` };
  if (identity?.contract) return { type: 'contract', value: String(identity.contract), key: `contract:${String(identity.contract)}` };
  return null;
}

function explicitIdentity(turn = {}) {
  return turn.role === 'customer' ? identityFromCustomerText(turn.text) : null;
}

function sameIdentity(left, right) {
  return Boolean(left?.key && right?.key && left.key === right.key);
}

function continuationHint(value = '') {
  const source = text(value, 500);
  if (!source) return false;
  if (source.length <= 90 && /^(?:а|и|но|тогда|тоді|почему|чому|как|як|что|що|это|це|он|она|они|у него|у неї|у них|а если|а якщо|ну|так)[\s,?!.-]/iu.test(`${source} `)) return true;
  return /\b(?:это|це|тогда|тоді|он|она|они|его|её|її|их|там|так же|так само|выше|ранее|до этого)\b/iu.test(source);
}

function correctionHint(value = '') {
  const source = text(value, 500);
  return /(?:^|[.!?]\s*)(?:нет|ні|не,?\s+я|точнее|точніше|я имел(?:а)? в виду|я мав(?:ла)? на увазі|я про другого|я про іншого)\b/iu.test(source);
}

function segmentTurns(turns = []) {
  let active = null;
  return turns.map(turn => {
    const found = explicitIdentity(turn);
    const previous = active;
    if (found) active = found;
    return {
      ...turn,
      explicitIdentity: found,
      entity: active,
      entityChanged: Boolean(found && previous && !sameIdentity(found, previous))
    };
  });
}

function uniqueEntities(turns = []) {
  const seen = new Map();
  for (const turn of turns) {
    if (!turn.entity?.key) continue;
    seen.set(turn.entity.key, turn.entity);
  }
  return [...seen.values()];
}

function latestExplicit(turns = []) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].explicitIdentity) return { identity: turns[index].explicitIdentity, index };
  }
  return { identity: null, index: -1 };
}

function previousExplicitBefore(turns = [], beforeIndex = turns.length) {
  for (let index = Math.min(beforeIndex - 1, turns.length - 1); index >= 0; index -= 1) {
    if (turns[index].explicitIdentity) return { identity: turns[index].explicitIdentity, index };
  }
  return { identity: null, index: -1 };
}

function threadForActiveEntity(turns, activeIdentity, latestIdentityIndex, maxTurns) {
  if (!activeIdentity?.key) return turns.slice(-maxTurns);

  const currentSegment = [];
  for (let index = latestIdentityIndex; index < turns.length; index += 1) {
    const turn = turns[index];
    if (index > latestIdentityIndex && turn.explicitIdentity && !sameIdentity(turn.explicitIdentity, activeIdentity)) break;
    if (!turn.entity || sameIdentity(turn.entity, activeIdentity)) currentSegment.push(turn);
  }

  const historical = turns
    .slice(0, Math.max(0, latestIdentityIndex))
    .filter(turn => sameIdentity(turn.entity, activeIdentity));

  const merged = [...historical, ...currentSegment];
  const seenIndexes = new Set();
  return merged
    .filter(turn => {
      if (seenIndexes.has(turn.index)) return false;
      seenIndexes.add(turn.index);
      return true;
    })
    .slice(-maxTurns);
}

function publicTurn(turn) {
  return { role: turn.role, text: turn.text };
}

/**
 * Build a stage-neutral working-context projection from the raw dialogue.
 *
 * Important: this module does not decide what the answer means and does not
 * diagnose the subscriber. It only scopes raw dialogue to the currently active
 * subscriber thread while preserving enough metadata for semantic reasoning.
 */
export function buildConversationContext(transcript = [], {
  maxActiveTurns = DEFAULT_ACTIVE_TURNS,
  maxGeneralTurns = DEFAULT_GENERAL_TURNS
} = {}) {
  const normalized = (Array.isArray(transcript) ? transcript : [])
    .map(normalizeTurn)
    .filter(turn => turn.text);
  const turns = segmentTurns(normalized);
  const latest = latestExplicit(turns);
  const previous = previousExplicitBefore(turns, latest.index);
  const entities = uniqueEntities(turns);
  const activeEntity = latest.identity;
  const parkedEntities = activeEntity
    ? entities.filter(entity => !sameIdentity(entity, activeEntity))
    : [];

  const selected = activeEntity
    ? threadForActiveEntity(turns, activeEntity, latest.index, Math.max(6, Number(maxActiveTurns) || DEFAULT_ACTIVE_TURNS))
    : turns.slice(-Math.max(6, Number(maxGeneralTurns) || DEFAULT_GENERAL_TURNS));

  const latestTurn = turns.at(-1) || null;
  const activeSeenBeforeLatest = Boolean(activeEntity && turns
    .slice(0, Math.max(0, latest.index))
    .some(turn => sameIdentity(turn.entity, activeEntity)));
  const entitySwitch = Boolean(activeEntity && previous.identity && !sameIdentity(activeEntity, previous.identity));
  const explicitReturn = Boolean(entitySwitch && activeSeenBeforeLatest);

  return {
    version: 1,
    activeEntity,
    parkedEntities,
    continuity: {
      likelyFollowUp: continuationHint(latestTurn?.text || ''),
      correctionLikely: correctionHint(latestTurn?.text || ''),
      entitySwitch,
      explicitReturn
    },
    selectedTranscript: selected.map(publicTurn),
    recentTail: turns.slice(-6).map(publicTurn),
    diagnostics: {
      sourceTurns: turns.length,
      selectedTurns: selected.length,
      entityCount: entities.length,
      latestExplicitIdentityTurn: latest.index
    }
  };
}

export function projectConversationTranscript(transcript = [], options = {}) {
  return buildConversationContext(transcript, options).selectedTranscript;
}

export function compactConversationContext(context = {}) {
  const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  return {
    version: Number(source.version || 1),
    activeEntity: source.activeEntity || null,
    parkedEntities: Array.isArray(source.parkedEntities) ? source.parkedEntities.slice(0, 8) : [],
    continuity: source.continuity && typeof source.continuity === 'object' ? { ...source.continuity } : {},
    diagnostics: source.diagnostics && typeof source.diagnostics === 'object' ? { ...source.diagnostics } : {}
  };
}
