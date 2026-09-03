(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.usersideCallList) return;

  const OPERATOR_EXTENSION = '6047';
  const CALL_LIST_PATH = '/message/call_list';

  const normalizeExtension = value => {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    const digits = raw.replace(/\D+/g, '');
    if (!digits) return '';
    if (digits === OPERATOR_EXTENSION) return digits;
    // "6047 " / "вн. 6047" / trailing noise
    if (digits.endsWith(OPERATOR_EXTENSION) && digits.length <= OPERATOR_EXTENSION.length + 2) {
      return OPERATOR_EXTENSION;
    }
    const match = raw.match(/\b(\d{3,6})\b/);
    return match ? match[1] : digits.slice(0, 6);
  };

  const compact = (value, max = 200) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const cellBySuffix = (row, suffix) => {
    if (!row) return null;
    const nodes = row.querySelectorAll?.('[id]') || [];
    for (const node of nodes) {
      const id = String(node.id || '');
      if (id.endsWith(suffix)) return node;
    }
    return null;
  };

  const textOf = node => compact(node?.textContent || node?.innerText || '');

  function parseCustomer(cell) {
    const result = { customerId: '', fio: '', login: '', raw: '' };
    if (!cell) return result;
    result.raw = compact(cell.textContent || '', 240);
    const link = cell.querySelector?.('a[href*="/customer/"]') || null;
    const href = String(link?.getAttribute?.('href') || link?.href || '');
    const idMatch = href.match(/\/customer\/(\d+)/i);
    if (idMatch) result.customerId = idMatch[1];
    const text = result.raw;
    // "ФИО - abonXXXXXX" or similar
    const pair = text.match(/^(.+?)\s*[-–—]\s*(abon\w+|\S+)$/i);
    if (pair) {
      result.fio = compact(pair[1], 120);
      result.login = compact(pair[2], 40);
    } else if (text) {
      result.fio = text;
    }
    return result;
  }

  function parseRecordId(cell) {
    if (!cell) return { audioRecordId: '', recordUrl: '' };
    const candidates = [
      ...Array.from(cell.querySelectorAll?.('[id],a[href],a[onclick],audio,source') || []).flatMap(node => [
        node.getAttribute?.('id') || '',
        node.getAttribute?.('href') || '',
        node.getAttribute?.('onclick') || '',
        node.getAttribute?.('src') || ''
      ]),
      cell.getAttribute?.('id') || '',
      cell.innerHTML || '',
      cell.textContent || ''
    ];
    for (const candidate of candidates) {
      const match = String(candidate).match(/(?:textid-|getrec\.php\?id=|record[_-]?id=|audioRecordId=)?(\d{9,12}\.\d{1,12})/i)
        || String(candidate).match(/(\d{6,})/);
      if (match && match[1] && match[1].length >= 6) {
        return {
          audioRecordId: match[1],
          recordUrl: String(candidate).includes('http') ? compact(candidate, 300) : ''
        };
      }
    }
    return { audioRecordId: '', recordUrl: '' };
  }

  function parseDuration(value) {
    const raw = compact(value, 40);
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw) || 0;
    const parts = raw.split(':').map(Number);
    if (parts.some(p => !Number.isFinite(p))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  /**
   * Parse a UserSide /message/call_list document or table fragment.
   * Prefer suffix selectors over fixed row indices.
   */
  function parseDocument(doc, { operatorExtension = OPERATOR_EXTENSION } = {}) {
    const root = doc?.documentElement ? doc : null;
    if (!root && !doc?.querySelectorAll) return { ok: false, calls: [], error: 'no-document' };

    const rows = Array.from(
      (doc.querySelectorAll?.('tr') || [])
    ).filter(tr => cellBySuffix(tr, '_ANSWERPHONE_Id') || cellBySuffix(tr, '_DATEADD_Id'));

    const calls = [];
    for (const row of rows) {
      const answerPhone = textOf(cellBySuffix(row, '_ANSWERPHONE_Id'));
      const oper = textOf(cellBySuffix(row, '_OPER_Id'));
      const dateAdd = textOf(cellBySuffix(row, '_DATEADD_Id'));
      const durationRaw = textOf(cellBySuffix(row, '_callIntervalInt_Id'));
      const customerCell = cellBySuffix(row, '_CUSTOMER_Id');
      const customer = parseCustomer(customerCell);
      const recordCell = cellBySuffix(row, '_audioRecordId_Id')
        || row.querySelector?.('[id*="audioRecord"],[id*="record"]');
      const record = parseRecordId(recordCell);

      const durationSec = parseDuration(durationRaw);
      const answerExt = normalizeExtension(answerPhone);
      const targetExt = normalizeExtension(operatorExtension || OPERATOR_EXTENSION);
      // Primary criterion: ANSWERPHONE extension. OPER is stored only for display.
      // Require talk duration > 0 so ring-only / unanswered rows are not "own accepted".
      const own = Boolean(targetExt) && answerExt === targetExt && durationSec > 0;
      calls.push({
        source: 'userside-call-list',
        answerPhone: answerExt || answerPhone,
        answerPhoneRaw: answerPhone,
        oper,
        dateAdd,
        durationSec,
        durationRaw,
        customerId: customer.customerId,
        fio: customer.fio,
        login: customer.login,
        customerRaw: customer.raw,
        audioRecordId: record.audioRecordId,
        recordUrl: record.recordUrl,
        ownOperator: own
      });
    }

    return {
      ok: true,
      schema: 'simnet-userside-call-list-v1',
      path: CALL_LIST_PATH,
      operatorExtension: String(operatorExtension || OPERATOR_EXTENSION),
      total: calls.length,
      own: calls.filter(c => c.ownOperator),
      calls
    };
  }

  function parseHtml(html, options) {
    if (typeof DOMParser === 'undefined') {
      return { ok: false, calls: [], error: 'no-dom-parser' };
    }
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return parseDocument(doc, options);
  }

  /**
   * Read-only fetch of the native UserSide call list page.
   * No invented API — only the confirmed GET /message/call_list page.
   */
  async function fetchOwnCalls({ operatorExtension = OPERATOR_EXTENSION, signal } = {}) {
    const url = new URL(CALL_LIST_PATH, location.origin).href;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal
    });
    if (!response.ok) {
      return { ok: false, calls: [], error: `http-${response.status}`, url };
    }
    const html = await response.text();
    const parsed = parseHtml(html, { operatorExtension });
    return {
      ...parsed,
      url,
      fetchedAt: new Date().toISOString()
    };
  }

  WB.usersideCallList = Object.freeze({
    OPERATOR_EXTENSION,
    CALL_LIST_PATH,
    parseDocument,
    parseHtml,
    fetchOwnCalls,
    filterOwn: (calls, extension = OPERATOR_EXTENSION) => {
      const target = normalizeExtension(extension);
      return (Array.isArray(calls) ? calls : []).filter(c => {
        const answer = normalizeExtension(c?.answerPhone || c?.answerPhoneRaw);
        const duration = Number(c?.durationSec || c?.durationSeconds || 0);
        return Boolean(target) && answer === target && duration > 0;
      });
    }
  });
})();
