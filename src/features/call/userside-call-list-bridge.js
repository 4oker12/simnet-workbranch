'use strict';

const compact = (value, max = 240) => {
  const text = String(value == null ? '' : value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ''; }
    });
}

function textFromHtml(value = '') {
  return compact(decodeEntities(
    String(value)
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  ));
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cellHtml(rowHtml, suffix) {
  const re = new RegExp(
    `<td\\b[^>]*id=["'][^"']*${escapeRegExp(suffix)}["'][^>]*>([\\s\\S]*?)<\\/td>`,
    'i'
  );
  return String(rowHtml || '').match(re)?.[1] || '';
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
    const fio = login
      ? compact(raw.replace(new RegExp(`\\s*[-–—]?\\s*${escapeRegExp(login)}\\s*$`, 'i'), ''), 120)
      : raw;
    out.push({ customerId, login, fio, raw });
  }
  return out;
}

/**
 * Parse server-rendered UserSide /message/call_list HTML in an MV3 service worker.
 * DOMParser is unavailable there, so this parser intentionally targets only the
 * stable table row/cell shapes confirmed in UserSide 3.20.24.
 */
export function parseUsersideCallListHtml(html, {
  operatorExtension = '6047',
  completedOnly = true,
  limit = 80
} = {}) {
  const source = String(html || '');
  const rows = [];
  const rowRe = /<tr\b[^>]*class=["'][^"']*\btable_item\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(source)) && rows.length < Math.max(1, Number(limit) || 80)) {
    const rowHtml = rowMatch[1] || '';
    const answerPhoneRaw = textFromHtml(cellHtml(rowHtml, '_ANSWERPHONE_Id'));
    const agentExtension = normalizeExtension(answerPhoneRaw);
    if (!agentExtension || agentExtension !== String(operatorExtension)) continue;

    const duration = textFromHtml(cellHtml(rowHtml, '_callIntervalInt_Id'));
    const durationSeconds = parseDurationSeconds(duration);
    if (completedOnly && durationSeconds <= 0) continue;

    const recordId = rowHtml.match(/getrec\.php\?id=([0-9]{9,12}\.[0-9]{1,12})/i)?.[1] || '';
    const usersideCallId = rowHtml.match(/\/message\/(\d+)\/call_comment_add/i)?.[1]
      || rowHtml.match(/callCommentAdd(\d+)Id/i)?.[1]
      || '';
    // UserSide call id is the canonical identity. A completed row remains valid
    // even when the optional PBX recording/recordId is absent.
    if (!usersideCallId) continue;
    const dateAdd = textFromHtml(cellHtml(rowHtml, '_DATEADD_Id'));
    const dateParts = parseDateAdd(dateAdd);
    const phone = normalizePhone(textFromHtml(cellHtml(rowHtml, '_PHONE_Id')));
    const operHtml = cellHtml(rowHtml, '_OPER_Id');
    const oper = textFromHtml(operHtml);
    const employeeId = operHtml.match(/\/employee\/(\d+)/i)?.[1] || '';
    const customers = customerCandidates(cellHtml(rowHtml, '_CUSTOMER_Id'));
    const primary = customers.length === 1 ? customers[0] : null;

    rows.push({
      source: 'userside:call_list',
      recordId,
      usersideCallId,
      callerId: phone,
      date: dateParts.date,
      time: dateParts.time,
      startedAtMs: dateParts.startedAtMs,
      timeSemantics: 'start',
      duration,
      durationSeconds,
      agentExtension,
      agent: [agentExtension, oper].filter(Boolean).join(' '),
      oper,
      employeeId,
      customerId: primary?.customerId || '',
      fio: primary?.fio || '',
      login: primary?.login || '',
      contract: primary?.login || '',
      customerCandidates: customers,
      direction: textFromHtml(cellHtml(rowHtml, '_direction_Id')),
      observedAt: new Date().toISOString()
    });
  }
  return rows;
}

export const __test = Object.freeze({
  textFromHtml,
  parseDurationSeconds,
  normalizeExtension,
  normalizePhone,
  parseDateAdd,
  customerCandidates
});
