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
 * identity candidates. Named login requires literal textual evidence; LLM hints
 * cannot invent a generic login and rebind the active subscriber.
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
const GENERIC_ADDRESS_WORDS = new Set([
  'ул', 'улица', 'вул', 'вулиця', 'просп', 'проспект', 'пров', 'провулок', 'переулок',
  'бул', 'б-р', 'бульвар', 'узвіз', 'спуск', 'пл', 'площа', 'площадь', 'київ', 'киев',
  'дом', 'буд', 'будинок', 'д', 'кв', 'квартира', 'apt', 'apartment',
  'адрес', 'адреса', 'город', 'місто', 'г', 'м'
]);
const CONTRACT_WORD = '(?:договор(?:а|у|ом|е)?|договір(?:у|ом|і)?|лицев(?:ой|ого|ому|ым|ий)?\\s*сч[её]т|особов(?:ий|ого|ому|им)?\\s*рахунок)';
const LOGIN_WORD = '(?:login|логин(?:а|у|ом|е)?|логін(?:у|ом|і)?)';
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

  const leadingWithIdentityContext = normalized.match(new RegExp(`^([A-Za-z][A-Za-z0-9._-]{2,63})(?=\\s+(?:номер\\s+)?${IDENTITY_WORD}${IDENTITY_BOUNDARY})`, 'i'))?.[1];
  const leading = genericLogin(leadingWithIdentityContext || '');
  if (leading) return leading;

  return '';
}

function literalIp(transcript = [], candidate = '') {
  const ip = String(candidate || '').trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return '';
  return customerMessages(transcript).some(item => oneLine(item?.text, 1200).includes(ip)) ? ip : '';
}

function literalAddress(transcript = [], candidate = '') {
  const address = oneLine(candidate, 260);
  if (!address) return '';
  const tokens = (address.toLowerCase().match(/[\p{L}\p{N}.-]+/gu) || [])
    .map(token => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(Boolean);
  const street = tokens.find(token => /\p{L}/u.test(token) && token.length >= 3 && !GENERIC_ADDRESS_WORDS.has(token));
  const house = tokens.find(token => /\d/u.test(token));
  if (!street || !house) return '';
  return customerMessages(transcript).some(item => {
    const tokens = oneLine(item?.text, 1200).toLowerCase().match(/[\p{L}\p{N}.-]+/gu) || [];
    const literal = tokens.map(token => token.replace(/^[.-]+|[.-]+$/g, ''));
    return literal.includes(street) && literal.includes(house);
  }) ? address : '';
}

function containsLiteralLogin(messages = [], login = '') {
  const value = genericLogin(login);
  if (!value) return false;
  const escaped = value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9._-])${escaped}(?=$|[^A-Za-z0-9._-])`, 'i');
  return messages.some(item => pattern.test(oneLine(item?.text, 1200)));
}

function containsLiteralContract(messages = [], contract = '') {
  const value = String(contract || '').replace(/\D+/g, '');
  if (!/^\d{3,12}$/.test(value)) return false;
  const pattern = new RegExp(`(?:^|\\D)${value}(?=$|\\D)`);
  return messages.some(item => pattern.test(oneLine(item?.text, 1200)));
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
    const containsEmbeddedAbon = /abon\d/i.test(wholeLogin) && !/^abon\d{3,12}$/i.test(wholeLogin);
    if (wholeLogin && !containsEmbeddedAbon && !/\s/.test(source)) {
      return { login: wholeLogin, sourceTurn: index, confidence: 'standalone-login' };
    }

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

function addressWithClarification(address, laterTurns = []) {
  address = String(address).replace(/\s+(?:(?:шо|что|сколько|скільки|чому|почему)\s|(?:проверь|перевір|посмотри)\b).*$/iu, '').trim();
  // Only literal locality clarification; never take a place from model prose.
  const places = /(?:софиевская(?:\s+борщаговка)?|софіївська(?:\s+борщагівка)?|святопетровское|святопетрівське|киев|київ)/giu;
  const clarification = laterTurns.map(turn => oneLine(turn?.text, 500))
    .filter(text => !/\d/.test(text)).join(' ');
  const locality = [...clarification.matchAll(places)].at(-1)?.[0];
  return locality ? `${address}, ${locality}` : address;
}

export function resolveSubscriberIdentityHints(transcript = [], analysis = {}, secondary = null) {
  const messages = customerMessages(transcript);
  const hinted = identityToolArgs(identityFromAnalysisHints(analysis));
  const semanticIds = analysis?.probe?.ids || analysis?.ids || {};
  // Resolve all identifier types within each turn before going back in history.
  // An older exact login must not outrank a later address after a failed rebind.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const turn = [messages[index]];
    const fromText = identityToolArgs(extractStandaloneSubscriberIdentity(turn));
    if (Object.keys(fromText).length) return fromText;

    if (secondary && typeof secondary === 'object' && !Array.isArray(secondary)) {
      const ip = literalIp(turn, secondary.ip);
      if (ip) return { ip };
      const address = literalAddress(turn, secondary.address);
      if (address) return { address: addressWithClarification(address, messages.slice(index + 1)) };
    }

    // Semantic understanding can recognize unlabelled or renamed addresses
    // without another phrase parser; require literal evidence in this turn.
    const semanticIp = literalIp(turn, semanticIds.ip);
    if (semanticIp) return { ip: semanticIp };
    const semanticAddress = literalAddress(turn, semanticIds.address);
    if (semanticAddress) return { address: addressWithClarification(semanticAddress, messages.slice(index + 1)) };

    if (hinted.login && containsLiteralLogin(turn, hinted.login)) return hinted;
    if (hinted.contract && containsLiteralContract(turn, hinted.contract)) return hinted;
  }
  return {};
}
