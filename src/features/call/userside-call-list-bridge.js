'use strict';

const compact = (value, max = 240) => {
  const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, dec) => { try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ''; } });
}

function textFromHtml(value = '') {
  return compact(decodeEntities(String(value).replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')));
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cellHtml(rowHtml, suffix) {
  const re = new RegExp(`<td\\b[^>]*id=["'][^"']*${escapeRegExp(suffix)}["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  return String(rowHtml || '').match(re)?.[1] || '';
}

function tdCells(rowHtml = '') {
  const out = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = re.exec(String(rowHtml || '')))) out.push(match[1] || '');
  return out;
}

function parseDurationSeconds(value = '') {
  const raw = compact(value, 32);
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw) || 0;
  const parts = raw.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function normalizeExtension(value = '') {
  const raw = String(value == null ? '' : value).trim();
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  const match = raw.match(/\b(\d{3,6})\b/);
  return match?.[1] || digits.slice(0, 6);
}

function normalizePhone(value = '') {
  const digits = String(value == null ? '' : value).replace(/\D+/g, '');
  if (/^380\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^80\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}

function parseDateAdd(value = '') {
  const raw = compact(value, 40);
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return { date: '', time: '', startedAtMs: 0 };
  const [, dd, mm, yyyy, hh, min, ss = '00'] = match;
  const date = `${yyyy}-${mm}-${dd}`;
  const time = `${hh}:${min}`;
  const startedAtMs = Date.parse(`${date}T${hh}:${min}:${ss}`);
  return { date, time, startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0 };
}

function customerCandidates(customerHtml = '') {
  const out = [];
  const re = /<a\b[^>]*href=["']\/customer\/(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(customerHtml || '')))) {
    const customerId = String(match[1] || '');
    const raw = textFromHtml(match[2] || '');
    const login = raw.match(/\babon\d+\b/i)?.[0] || '';
    const fio = login ? compact(raw.replace(new RegExp(`\\s*[-–—]?\\s*${escapeRegExp(login)}\\s*$`, 'i'), ''), 120) : raw;
    out.push({ customerId, login, fio, raw });
  }
  return out;
}

function callIdFromHtml(rowHtml = '') {
  const html = String(rowHtml || '');
  const uuid = html.match(new RegExp(`call_comment_add\\?uuid=(${UUID_PATTERN})`, 'i'))?.[1]
    || html.match(new RegExp(`callCommentAdd(${UUID_PATTERN})Id`, 'i'))?.[1]
    || html.match(new RegExp(`loadRecordFile\\(\\s*(?:&quot;|["'])(${UUID_PATTERN})`, 'i'))?.[1]
    || html.match(new RegExp(`audioRecordId(${UUID_PATTERN})`, 'i'))?.[1];
  if (uuid) return uuid.toLowerCase();
  return html.match(/\/message\/(\d+)\/call_comment_add/i)?.[1]
    || html.match(/callCommentAdd(\d+)Id/i)?.[1]
    || html.match(/loadRecordFile\(\s*(\d+)\s*,/i)?.[1]
    || html.match(/audioRecordId(\d+)/i)?.[1]
    || '';
}

function commonCall({ rowHtml, direction, dateAdd, duration, phone, agentExtension, operHtml, customerHtml }) {
  const durationSeconds = parseDurationSeconds(duration);
  const recordId = String(rowHtml || '').match(/getrec\.php\?id=([0-9]{9,12}\.[0-9]{1,12})/i)?.[1] || '';
  const usersideCallId = callIdFromHtml(rowHtml);
  const dateParts = parseDateAdd(dateAdd);
  const oper = textFromHtml(operHtml);
  const employeeId = String(operHtml || '').match(/\/employee\/(\d+)/i)?.[1] || '';
  const customers = customerCandidates(customerHtml);
  const primary = customers.length === 1 ? customers[0] : null;
  return {
    source: 'userside:call_list', recordId, usersideCallId,
    callerId: normalizePhone(phone), callerMasked: normalizePhone(phone),
    date: dateParts.date, time: dateParts.time, startedAtMs: dateParts.startedAtMs, timeSemantics: 'start',
    duration, durationSeconds, agentExtension,
    agent: [agentExtension, oper].filter(Boolean).join(' '), oper, employeeId,
    customerId: primary?.customerId || '', fio: primary?.fio || '', login: primary?.login || '', contract: primary?.login || '',
    customerCandidates: customers, direction: compact(direction, 20), observedAt: new Date().toISOString()
  };
}

function parseErpRow(rowHtml, operatorExtension) {
  const cells = tdCells(rowHtml);
  if (cells.length < 9) return null;
  const left = normalizeExtension(textFromHtml(cells[4]));
  const right = normalizeExtension(textFromHtml(cells[6]));
  const target = String(operatorExtension);
  if (left !== target && right !== target) return null;
  const phone = left === target ? textFromHtml(cells[6]) : textFromHtml(cells[4]);
  return commonCall({
    rowHtml,
    direction: textFromHtml(cells[1]),
    dateAdd: textFromHtml(cells[2]),
    duration: textFromHtml(cells[8]),
    phone,
    agentExtension: target,
    operHtml: cells[7],
    customerHtml: cells[5]
  });
}

function parseLegacyRow(rowHtml, operatorExtension) {
  const answerPhoneRaw = textFromHtml(cellHtml(rowHtml, '_ANSWERPHONE_Id'));
  const agentExtension = normalizeExtension(answerPhoneRaw);
  if (!agentExtension || agentExtension !== String(operatorExtension)) return null;
  return commonCall({
    rowHtml,
    direction: textFromHtml(cellHtml(rowHtml, '_direction_Id')),
    dateAdd: textFromHtml(cellHtml(rowHtml, '_DATEADD_Id')),
    duration: textFromHtml(cellHtml(rowHtml, '_callIntervalInt_Id')),
    phone: textFromHtml(cellHtml(rowHtml, '_PHONE_Id')),
    agentExtension,
    operHtml: cellHtml(rowHtml, '_OPER_Id'),
    customerHtml: cellHtml(rowHtml, '_CUSTOMER_Id')
  });
}

/** Supports legacy UserSide 3.20.x rows and current UserSide 3.21.53 erp-table rows. */
export function parseUsersideCallListHtml(html, {
  operatorExtension = '6047',
  completedOnly = true,
  limit = 80,
  allowIdless = false
} = {}) {
  const source = String(html || '');
  const rows = [];
  const maxRows = Math.max(1, Number(limit) || 80);
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(source)) && rows.length < maxRows) {
    const attrs = rowMatch[1] || '';
    const rowHtml = rowMatch[2] || '';
    const className = attrs.match(/class=["']([^"']*)["']/i)?.[1] || '';
    let call = null;
    if (/\berp-table__row\b/.test(className)) call = parseErpRow(rowHtml, operatorExtension);
    else if (/\btable_item\b/.test(className)) call = parseLegacyRow(rowHtml, operatorExtension);
    if (!call) continue;
    if (completedOnly && call.durationSeconds <= 0) continue;
    if (!call.usersideCallId && !allowIdless) continue;
    rows.push(call);
  }
  return rows;
}

export const __test = Object.freeze({
  textFromHtml, tdCells, parseDurationSeconds, normalizeExtension, normalizePhone, parseDateAdd, customerCandidates, callIdFromHtml, parseErpRow
});
