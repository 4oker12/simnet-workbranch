'use strict';

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

const GENERIC_LOGIN_RE = /^(?=.{3,64}$)(?=.*[A-Za-z])[A-Za-z][A-Za-z0-9._-]*$/;
const NON_LOGIN_WORDS = new Set([
  'internet', 'wifi', 'wi-fi', 'router', 'balance', 'tariff', 'speed', 'help', 'hello', 'privet', 'test', 'online', 'offline'
]);

function customerMessages(transcript = []) {
  return (Array.isArray(transcript) ? transcript : [])
    .filter(item => item?.role === 'customer' && oneLine(item?.text, 1200))
    .slice(-12);
}

function standaloneToken(source) {
  return oneLine(source, 100).replace(/[.,;:!?]+$/g, '').trim();
}

export function extractStandaloneSubscriberIdentity(transcript = []) {
  const messages = customerMessages(transcript);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = oneLine(messages[index]?.text, 500);
    if (!source) continue;

    const abon = source.match(/\b(abon\d{3,12})\b/i)?.[1];
    if (abon) return { login: abon.toLowerCase(), sourceTurn: index, confidence: 'explicit-login' };

    const explicitContract = source.match(/(?:договор|договір|лицев(?:ой|ий)?\s*сч[её]т|особов(?:ий|ого)\s*рахунок)[^\d]{0,30}(\d{3,12})/i)?.[1];
    if (explicitContract) return { contract: explicitContract, sourceTurn: index, confidence: 'explicit-contract' };

    const token = standaloneToken(source);
    if (/^\d{3,12}$/.test(token)) {
      return { contract: token, sourceTurn: index, confidence: 'standalone-contract' };
    }

    const lower = token.toLowerCase();
    if (GENERIC_LOGIN_RE.test(token) && !NON_LOGIN_WORDS.has(lower)) {
      return { login: lower, sourceTurn: index, confidence: 'standalone-login' };
    }
  }
  return {};
}

export function identityToolArgs(identity = {}) {
  if (identity.login) return { login: String(identity.login).toLowerCase() };
  if (identity.contract) return { contract: String(identity.contract).replace(/\D+/g, '') };
  if (identity.ip) return { ip: String(identity.ip) };
  if (identity.address) return { address: String(identity.address) };
  return {};
}
