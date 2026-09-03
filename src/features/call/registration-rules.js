'use strict';

const factValue = fact => (
  fact && typeof fact === 'object' && Object.prototype.hasOwnProperty.call(fact, 'value')
    ? fact.value
    : fact
);
const rawFactValue = fact => String(factValue(fact) ?? '');
const comparable = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function callCustomerId(raw) {
  const value = String(raw ?? '').trim();
  return /^\d{1,12}$/.test(value) ? value : '';
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
  if (!customerId) throw new Error('Некорректный customerId');
  if (!Array.isArray(payload.fields) || !payload.fields.length || payload.fields.length > 32) {
    throw new Error('Некорректный набор полей формы');
  }

  const params = new URLSearchParams();
  let totalLength = 0;
  for (const field of payload.fields) {
    const name = String(field?.name || '');
    const value = String(field?.value ?? '');
    if (!/^[a-z_][a-z0-9_]*(?:\[\])?$/i.test(name) || name.length > 64) {
      throw new Error('UserSide вернул неизвестное имя поля');
    }
    totalLength += name.length + value.length;
    if (totalLength > 50000) throw new Error('Форма слишком большая');
    params.append(name, value);
  }

  params.delete('customer_id');
  params.set('customer_id', customerId);
  const csrf = String(params.get('_csrf') || '');
  const phone = String(params.get('dopf_13') || '').trim();
  const standardComment = String(params.get('standart_comment') || '');
  if (!csrf || csrf.length > 512) throw new Error('В форме отсутствует актуальный _csrf');
  if (!phone || phone.length > 35) throw new Error('Укажите корректный телефон');
  if (!/^\d+$/.test(standardComment)) throw new Error('Некорректный типовой комментарий');
  if (!params.getAll('additional_fields[]').includes('13')) {
    throw new Error('В форме отсутствует служебное поле телефона');
  }
  return params;
}
