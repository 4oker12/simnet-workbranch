'use strict';

const factValue = fact => (
  fact && typeof fact === 'object' && Object.prototype.hasOwnProperty.call(fact, 'value')
    ? fact.value
    : fact
);
const rawFactValue = fact => String(factValue(fact) ?? '');
const comparable = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function callCustomerId(raw) {
  const value = String(raw ?? '').trim();
  return /^\d{1,12}$/.test(value) ? value : '';
}

export function callCustomerUuid(raw) {
  const value = String(raw ?? '').trim();
  return UUID_RE.test(value) ? value.toLowerCase() : '';
}

export function customerIdFromCallUrl(rawUrl, usersideOrigin = 'https://userside.simnet.kiev.ua') {
  try {
    return callCustomerId(
      new URL(String(rawUrl || ''), usersideOrigin).pathname.match(/^\/customer\/(\d+)\/?$/i)?.[1]
    );
  } catch {
    return '';
  }
}

export function customerUuidFromCallPage(rawHtml, rawUrl = '', usersideOrigin = 'https://userside.simnet.kiev.ua') {
  const candidates = [];
  try {
    const url = new URL(String(rawUrl || ''), usersideOrigin);
    candidates.push(url.searchParams.get('customer_uuid') || '');
    candidates.push(url.pathname.match(/^\/customer\/([^/]+)(?:\/|$)/i)?.[1] || '');
  } catch {}

  const html = String(rawHtml || '').replace(/&amp;/gi, '&');
  const patterns = [
    /\bname\s*=\s*["']customer_uuid["'][^>]*\bvalue\s*=\s*["']([^"']+)["']/i,
    /\bvalue\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']customer_uuid["']/i,
    /[?&]customer_uuid=([0-9a-f-]{36})/i,
    /\/customer\/([0-9a-f-]{36})(?:\/|[?"'])/i
  ];
  for (const pattern of patterns) candidates.push(html.match(pattern)?.[1] || '');
  for (const candidate of candidates) {
    const uuid = callCustomerUuid(candidate);
    if (uuid) return uuid;
  }
  return '';
}

export function unwrapCallSearchHtml(raw) {
  const text = String(raw ?? '');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed.data === 'string') return parsed.data;
  } catch {}
  return text;
}

export function exactCustomerIdFromSearch(raw, caseData = {}) {
  const html = unwrapCallSearchHtml(raw);
  const login = comparable(rawFactValue(caseData.identity?.login));
  const contract = rawFactValue(caseData.identity?.contract).replace(/\D+/g, '');
  const candidates = [];
  const seen = new Set();
  const linkPattern = /href\s*=\s*["'][^"']*\/customer\/(\d+)[^"']*["']/ig;
  let match;
  while ((match = linkPattern.exec(html))) {
    const id = callCustomerId(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rowStart = Math.max(
      html.lastIndexOf('<tr', match.index),
      html.lastIndexOf('<li', match.index),
      match.index - 1200
    );
    const rowEndCandidates = [
      html.indexOf('</tr>', match.index),
      html.indexOf('</li>', match.index),
      match.index + 1800
    ].filter(index => index >= 0);
    const rowEnd = Math.min(...rowEndCandidates);
    const rowText = comparable(html.slice(Math.max(0, rowStart), rowEnd));
    const loginExact = Boolean(login && new RegExp(`(^|[^a-z0-9_])${login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i').test(rowText));
    const contractExact = Boolean(
      contract
      && (rowText.match(/\b\d{3,14}\b/g) || []).some(value => value.replace(/\D+/g, '') === contract)
    );
    candidates.push({ id, exact: loginExact || contractExact });
  }
  const exact = candidates.filter(item => item.exact);
  if (exact.length === 1) return exact[0].id;
  if (!exact.length && candidates.length === 1) return candidates[0].id;
  return '';
}

export function callRegistrationParams(payload = {}) {
  const customerId = callCustomerId(payload.customerId);
  const customerUuid = callCustomerUuid(payload.customerUuid);
  if (!customerId && !customerUuid) throw new Error('Некорректный идентификатор абонента');
  if (!Array.isArray(payload.fields) || !payload.fields.length || payload.fields.length > 32) {
    throw new Error('Некорректный набор полей формы');
  }

  const params = new URLSearchParams();
  let totalLength = 0;
  for (const field of payload.fields) {
    const name = String(field?.name || '');
    const value = String(field?.value ?? '');
    if (!/^[a-z_][a-z0-9_-]*(?:\[\])?$/i.test(name) || name.length > 80) {
      throw new Error('UserSide вернул неизвестное имя поля');
    }
    totalLength += name.length + value.length;
    if (totalLength > 50000) throw new Error('Форма слишком большая');
    params.append(name, value);
  }

  params.delete('customer_id');
  params.delete('customer_uuid');
  if (customerUuid) params.set('customer_uuid', customerUuid);
  else params.set('customer_id', customerId);
  const csrf = String(params.get('_csrf') || '');
  const additionalFields = params.getAll('additional_fields[]').map(String);
  const requestedPhoneField = String(payload.phoneFieldName || '');
  const phoneCandidates = Array.from(params.keys()).filter(name => /^dopf_(?:\d+|[0-9a-f-]{36})$/i.test(name));
  const phoneFieldName = phoneCandidates.includes(requestedPhoneField)
    ? requestedPhoneField
    : phoneCandidates.find(name => additionalFields.includes(name.slice('dopf_'.length)))
      || (phoneCandidates.length === 1 ? phoneCandidates[0] : '');
  const phone = String(phoneFieldName ? params.get(phoneFieldName) || '' : '').trim();
  const standardComment = String(params.get('standart_comment') || '');
  const comment = String(params.get('comment') || '').trim();
  if (!csrf || csrf.length > 512) throw new Error('В форме отсутствует актуальный _csrf');
  if (!phone || phone.length > 35) throw new Error('Укажите корректный телефон');
  if (standardComment && !/^\d+$/.test(standardComment) && !callCustomerUuid(standardComment)) {
    throw new Error('Некорректный типовой комментарий');
  }
  if (!standardComment && !comment) throw new Error('Укажите типовой или собственный комментарий');
  const phoneAdditionalField = phoneFieldName.slice('dopf_'.length);
  if (!phoneFieldName || !additionalFields.includes(phoneAdditionalField)) {
    throw new Error('В форме отсутствует служебное поле телефона');
  }
  return params;
}
