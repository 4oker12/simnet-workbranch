import { MessageType } from '../../../shared/messages.js';
import { parseUsersideCallListHtml } from '../userside-call-list-bridge.js';

const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
const CALL_LIST_PATH = '/message/call_list';
const OPERATOR_EXTENSION = '6047';
const TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

function internalSender(sender = {}) {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  const url = String(sender.url || sender.tab?.url || '');
  if (!url) return true;
  return /^(?:chrome-extension:\/\/|https:\/\/(?:userside\.simnet\.kiev\.ua|admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)\/)/i.test(url);
}

function normalizePhone(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  if (/^380\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^80\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits.length >= 6 && digits.length <= 15 ? digits : '';
}

function stripHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parts = raw.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0] || 0);
}

function inspectRawRows(html = '', targetPhone = '') {
  const source = String(html || '');
  const rows = [];
  const rowRe = /<tr\b[^>]*class=["'][^"']*\btable_item\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  let index = 0;
  while ((match = rowRe.exec(source)) && index < 250) {
    index += 1;
    const row = match[1] || '';
    const phone = normalizePhone(stripHtml(cellHtml(row, '_PHONE_Id')));
    const answerPhone = stripHtml(cellHtml(row, '_ANSWERPHONE_Id'));
    const duration = stripHtml(cellHtml(row, '_callIntervalInt_Id'));
    const usersideCallId = row.match(/loadRecordFile\(\s*(\d+)\s*,/i)?.[1]
      || row.match(/audioRecordId(\d+)/i)?.[1]
      || row.match(/\/message\/(\d+)\/call_comment_add/i)?.[1]
      || row.match(/callCommentAdd(\d+)Id/i)?.[1]
      || '';
    const recordId = row.match(/getrec\.php\?id=([0-9]{6,12}\.[0-9]{1,12})/i)?.[1] || '';
    const dateAdd = stripHtml(cellHtml(row, '_DATEADD_Id'));
    const operatorMatches = String(answerPhone).replace(/\D+/g, '') === OPERATOR_EXTENSION;
    const completed = parseDurationSeconds(duration) > 0;
    const target = Boolean(targetPhone && phone === targetPhone);
    const rejection = [];
    if (!operatorMatches) rejection.push(`extension=${answerPhone || 'empty'}`);
    if (!completed) rejection.push(`duration=${duration || 'empty'}`);
    if (!usersideCallId) rejection.push('no-usersideCallId');
    if (!recordId) rejection.push('no-recordId');

    rows.push({
      index,
      dateAdd,
      phone,
      answerPhone,
      duration,
      usersideCallId,
      recordId,
      operatorMatches,
      completed,
      target,
      rejection: rejection.join(', ') || 'none'
    });
  }
  return rows;
}

function countMatches(source, regex) {
  return Array.from(String(source || '').matchAll(regex)).length;
}

async function fetchCallListDebug(payload = {}) {
  const targetPhone = normalizePhone(payload.phone || '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const started = performance.now();
  const requestUrl = new URL(CALL_LIST_PATH, USERSIDE_ORIGIN).href;

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal
    });
    const html = await response.text();
    const bytes = new TextEncoder().encode(html).byteLength;
    if (bytes > MAX_HTML_BYTES) throw new Error(`call_list response too large: ${bytes} bytes`);

    const parsed = parseUsersideCallListHtml(html, {
      operatorExtension: OPERATOR_EXTENSION,
      completedOnly: false,
      limit: 200
    });
    const rawRows = inspectRawRows(html, targetPhone);
    const targetRows = targetPhone ? rawRows.filter(row => row.target) : [];
    const parsedTarget = targetPhone ? parsed.filter(row => normalizePhone(row.callerId) === targetPhone) : [];
    const latestRaw = rawRows.slice(0, 8);
    const latestParsed = parsed.slice(0, 8).map(row => ({
      date: row.date,
      time: row.time,
      phone: row.callerId,
      duration: row.duration,
      usersideCallId: row.usersideCallId,
      recordId: row.recordId,
      customerId: row.customerId,
      direction: row.direction
    }));

    const result = {
      schemaVersion: 1,
      fetchedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
      request: {
        url: requestUrl,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        finalUrl: response.url,
        redirected: response.redirected,
        contentType: response.headers.get('content-type') || '',
        bytes
      },
      targetPhone,
      raw: {
        tableItemRows: rawRows.length,
        loadRecordFileCount: countMatches(html, /loadRecordFile\s*\(/gi),
        audioRecordIdCount: countMatches(html, /audioRecordId\d+/gi),
        getrecCount: countMatches(html, /getrec\.php\?id=/gi),
        extension6047Count: countMatches(html, />\s*6047\s*</g),
        targetPhonePresent: Boolean(targetPhone && html.replace(/\D+/g, '').includes(targetPhone.replace(/\D+/g, '')))
      },
      parsed: {
        ownRows: parsed.length,
        completed: parsed.filter(row => Number(row.durationSeconds || 0) > 0).length,
        withRecordId: parsed.filter(row => row.recordId).length,
        targetRows: parsedTarget.length
      },
      targetRows,
      latestRaw,
      latestParsed
    };

    console.groupCollapsed(`[SIMNET WB][CALL_LIST DEBUG] ${targetPhone || 'no-phone'}`);
    console.log('request', result.request);
    console.log('raw counters', result.raw);
    console.log('parsed counters', result.parsed);
    if (targetRows.length) console.table(targetRows);
    console.table(latestRaw);
    console.table(latestParsed);
    console.log(result);
    console.groupEnd();

    return result;
  } catch (error) {
    const message = controller.signal.aborted
      ? `call_list debug timeout after ${TIMEOUT_MS / 1000}s`
      : (error instanceof Error ? error.message : String(error));
    console.error('[SIMNET WB][CALL_LIST DEBUG]', message);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MessageType.CALL_LIST_DEBUG) return false;
  if (!internalSender(sender)) {
    sendResponse({ success: false, error: 'CALL_LIST_DEBUG rejected: invalid sender' });
    return false;
  }

  void fetchCallListDebug(message?.payload || {})
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }));
  return true;
});
