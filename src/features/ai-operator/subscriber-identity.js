'use strict';

/**
 * Deterministic subscriber identity extraction from customer text.
 * Supports:
 *   - abonNNNN
 *   - numeric contract / personal account
 *   - explicitly labelled named login
 *   - standalone named login
 *
 * Important: arbitrary latin words inside a conversational sentence are NOT
 * identity candidates. This prevents words such as Ethernet/GPON/router from
 * switching the active subscriber.
 */

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

const GENERIC_LOGIN_RE = /^(?=.{3,64}$)(?=.*[A-Za-z])[A-Za-z][A-Za-z0-9._-]*$/;
const NON_LOGIN_WORDS = new Set([
  'internet', 'wifi', 'wi-fi', 'router', 'balance', 'tariff', 'speed', 'help', 'hello', 'privet',
  'test', 'online', 'offline', 'login', 'account', 'contract', 'address', 'admin', 'user',
  'guest', 'root', 'simnet', 'standard', 'premium', 'basic', 'support', 'operator', 'client',
  'ethernet', 'gpon', 'epon', 'pon', 'onu', 'olt', 'optical', 'fiber', 'fibre'
]);
const CONTRACT_WORD = '(?:договор|договір|лицев(?:ой|ий)?\\s*сч[её]т|особов(?:ий|ого)?\\s*рахунок)';
const LOGIN_WORD = '(?:login|логин|логін)';
const IDENTITY_WORD = `(?:${CONTRACT_WORD}|${LOGIN_WORD})`;
const IDENTITY_BOUNDARY = '(?=$|[\\s.,;:!?])';

function customerMessages(transcript = []) {
  return (Array.isArray(transcript) ? transcript : [])
    .filter(item => item?.role === 'customer' && oneLine(item?.text, 1200))
    .slice(-12);
}

function standaloneToken(source) {
  return oneLine(source, 100).replace(/[.,;:!?]+$/g, '').trim();
}

function genericLogin(value) {
  const token = standaloneToken(value).replace(/\s+/g, '');
  const lower = token.toLowerCase();
  if (!GENERIC_LOGIN_RE.test(token) || NON_LOGIN_WORDS.has(lower)) return '';
  return token;
}

function labeledTextIdentity(source) {
  const normalized = oneLine(source, 500);
  if (!normalized) return '';

  const afterLabel = normalized.match(new RegExp(`${IDENTITY_WORD}\\s*(?:[:#№=\\-—]\\s*)?([A-Za-z][A-Za-z0-9._-]{2,63})`, 'i'))?.[1];
  const after = genericLogin(afterLabel || '');
  if (after) return after;

  const beforeLabel = normalized.match(new RegExp(`\\b([A-Za-z][A-Za-z0-9._-]{2,63})\\b\\s*(?:[-—:=]\\s*)?(?:(?:это|це)\\s+)?(?:(?:и\\s+есть|і\\s+є)\\s+)?(?:(?:мой|мій)\\s+)?${IDENTITY_WORD}${IDENTITY_BOUNDARY}`, 'i'))?.[1];
  const before = genericLogin(beforeLabel || '');
  if (before) return before;

  const leadingWithIdentityContext = normalized.match(new RegExp(`^([A-Za-z][A-Za-z0-9._-]{2,63})(?=\\s+(?:номер\\s+)?${IDENTITY_WORD}\\b)`, 'i'))?.[1];
  const leading = genericLogin(leadingWithIdentityContext || '');
  if (leading) return leading;

  return '';
}

export function extractStandaloneSubscriberIdentity(transcript = []) {
  const messages = customerMessages(transcript);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = oneLine(messages[index]?.text, 500);
    if (!source) continue;

    const abon = source.match(/\b(abon\d{3,12})\b/i)?.[1];
    if (abon) return { login: abon, sourceTurn: index, confidence: 'explicit-login' };

    const explicitContract = source.match(new RegExp(`${CONTRACT_WORD}[^\\d]{0,30}(\\d{3,12})`, 'i'))?.[1];
    if (explicitContract) return { contract: explicitContract, sourceTurn: index, confidence: 'explicit-contract' };

    const labeledLogin = labeledTextIdentity(source);
    if (labeledLogin) return { login: labeledLogin, sourceTurn: index, confidence: 'labeled-text-identity' };

    const token = standaloneToken(source);
    if (/^\d{3,12}$/.test(token)) return { contract: token, sourceTurn: index, confidence: 'standalone-contract' };

    const wholeLogin = genericLogin(token);
    if (wholeLogin && !/\s/.test(source)) {
      return { login: wholeLogin, sourceTurn: index, confidence: 'standalone-login' };
    }

    // Only abonNNNN is allowed as an unlabeled identity token inside free text.
    // A generic latin token inside a sentence is semantic content, not identity.
    const embeddedAbon = source.match(/(?:^|[\s,;:/\\|])(abon\d{3,12})(?=$|[\s,;:/\\|.!?])/i)?.[1];
    if (embeddedAbon) return { login: embeddedAbon, sourceTurn: index, confidence: 'token-abon-login' };
  }
  return {};
}

export function identityFromAnalysisHints(analysis = {}) {
  const probe = analysis?.probe && typeof analysis.probe === 'object' ? analysis.probe : {};
  const ids = (probe.ids && typeof probe.ids === 'object' ? probe.ids : null)
    || (analysis.ids && typeof analysis.ids === 'object' ? analysis.ids : null)
    || {};

  const rawLogin = String(ids.login || '').trim().replace(/\s+/g, '');
  if (/^abon\d{3,12}$/i.test(rawLogin)) return { login: rawLogin };
  const login = genericLogin(rawLogin);
  if (login) return { login };

  const contract = String(ids.contract || '').replace(/\D+/g, '');
  if (/^\d{3,12}$/.test(contract)) return { contract };

  return {};
}

export function identityToolArgs(identity = {}) {
  if (identity.login) return { login: String(identity.login).replace(/\s+/g, '') };
  if (identity.contract) return { contract: String(identity.contract).replace(/\D+/g, '') };
  if (identity.ip) return { ip: String(identity.ip) };
  if (identity.address) return { address: String(identity.address) };
  return {};
}

export function resolveSubscriberIdentityHints(transcript = [], analysis = {}, secondary = null) {
  const fromText = identityToolArgs(extractStandaloneSubscriberIdentity(transcript));
  if (Object.keys(fromText).length) return fromText;

  if (secondary && typeof secondary === 'object' && !Array.isArray(secondary) && Object.keys(secondary).length) {
    return secondary;
  }

  return identityToolArgs(identityFromAnalysisHints(analysis));
}
