(() => {
  'use strict';

  const API_VERSION = '1.0.0';

  const compact = (value, max = 1000) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const normalizeMac = value => {
    const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
  };

  const validIp = value => {
    const match = String(value || '').match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
    if (!match) return '';
    const parts = match[1].split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255) ? match[1] : '';
  };

  const FIELD_PATTERNS = [
    ['bras', /\bBRAS\s*-\s*/i],
    ['source', /Джерело\s+сесії\s*-\s*/i],
    ['sessionId', /Сесія\s*-\s*/i],
    ['statusRaw', /Статус\s+сесії\s*-\s*/i],
    ['username', /\bUSERNAME\s*-\s*/i],
    ['authType', /Тип\s+авторизації(?:\s+Radius2)?\s*-\s*/i],
    ['startTime', /Час\s+старту\s*-\s*/i],
    ['bytesRaw', /Байти\s+прийнято\/передано\s*-\s*/i],
    ['speedRaw', /Швидкість\s+прийом\/передача\s+за\s+останню\s+секунду\s*-\s*/i],
    ['lastEventTime', /Час\s+останньої\s+події\s*-\s*/i],
    ['lastEvent', /Остання\s+подія\s*-\s*/i],
    ['router', /\bROUTER\s*-\s*/i],
    ['vendor', /\bVENDOR\s*-\s*/i],
    ['vlan', /\bVLAN\s*-\s*/i]
  ];

  function fieldSlices(text) {
    const hits = [];
    for (const [key, pattern] of FIELD_PATTERNS) {
      const match = pattern.exec(text);
      if (!match) continue;
      hits.push({ key, index: match.index, valueStart: match.index + match[0].length });
    }
    hits.sort((a, b) => a.index - b.index);

    const fields = {};
    hits.forEach((hit, index) => {
      const end = hits[index + 1]?.index ?? text.length;
      fields[hit.key] = compact(text.slice(hit.valueStart, end), 500);
    });
    return { fields, firstIndex: hits[0]?.index ?? text.length };
  }

  function rateToBps(value, unit) {
    const amount = Number(String(value || '').replace(',', '.'));
    if (!Number.isFinite(amount)) return null;
    const normalized = String(unit || '').toLowerCase();
    if (/gbit/.test(normalized)) return amount * 1e9;
    if (/mbit/.test(normalized)) return amount * 1e6;
    if (/kbit/.test(normalized)) return amount * 1e3;
    return amount;
  }

  function parseRatePair(raw) {
    const match = String(raw || '').match(
      /([\d.,]+)\s*(gbit\/s|mbit\/s|kbit\/s|bit\/s)\s*\/\s*([\d.,]+)\s*(gbit\/s|mbit\/s|kbit\/s|bit\/s)/i
    );
    if (!match) {
      return { rxBps: null, txBps: null, hasTraffic: null };
    }
    const rxBps = rateToBps(match[1], match[2]);
    const txBps = rateToBps(match[3], match[4]);
    return {
      rxBps,
      txBps,
      hasTraffic: Number(rxBps || 0) > 0 || Number(txBps || 0) > 0
    };
  }

  function parseSessionText(rawText) {
    const text = compact(rawText, 12000);
    const { fields, firstIndex } = fieldSlices(text);
    const header = compact(text.slice(0, firstIndex), 500);
    const subscriberIp = validIp(header);
    const subscriberMac = normalizeMac(
      header.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}|[0-9a-f]{12}/i)?.[0] || ''
    );

    const brasIp = validIp(fields.bras || '');
    const brasName = compact(
      String(fields.bras || '')
        .replace(brasIp, ' ')
        .replace(/[()]/g, ' '),
      160
    );
    const statusRaw = compact(fields.statusRaw || '', 120);
    const staleRadius = /сесія\s+є\s+в\s+Radius,?\s+але\s+на\s+BRAS\s+не\s+знайдена/i.test(text);
    const online = /\bonline\b/i.test(statusRaw) && !staleRadius;
    const offline = /\boffline\b/i.test(statusRaw) || staleRadius;
    const status = online ? 'online' : offline ? 'offline' : (statusRaw ? 'unknown' : 'no_session');
    const rate = parseRatePair(fields.speedRaw || '');

    return {
      subscriberIp,
      subscriberMac,
      brasName,
      brasIp,
      source: compact(fields.source || '', 160),
      sessionId: compact(fields.sessionId || '', 120),
      status,
      statusRaw,
      username: compact(fields.username || '', 180),
      authType: compact(fields.authType || '', 120),
      startTime: compact(fields.startTime || '', 180),
      bytesRaw: compact(fields.bytesRaw || '', 260),
      speedRaw: compact(fields.speedRaw || '', 220),
      rxBps: rate.rxBps,
      txBps: rate.txBps,
      hasTraffic: rate.hasTraffic,
      lastEventTime: compact(fields.lastEventTime || '', 180),
      lastEvent: compact(fields.lastEvent || '', 180),
      router: compact(fields.router || '', 180),
      vendor: compact(fields.vendor || '', 180),
      vlan: compact(fields.vlan || '', 100),
      staleRadius,
      rawText: text
    };
  }

  function scoreSession(session) {
    let score = 0;
    if (session.status === 'online') score += 100;
    if (!session.staleRadius) score += 20;
    if (session.brasName) score += 8;
    if (session.sessionId) score += 6;
    if (session.hasTraffic === true) score += 4;
    return score;
  }

  function educationalSummary(session, result) {
    if (result === 'online') {
      if (session.hasTraffic === true) {
        return 'Juniper: активная сессия на BRAS есть, в момент снимка идёт обмен пакетами. Это подтверждает L3-сессию, но не качество Wi‑Fi или скорость доступа.';
      }
      if (session.hasTraffic === false) {
        return 'Juniper: сессия online, но в момент снимка заметного обмена пакетами нет. Нулевая мгновенная скорость сама по себе не доказывает неисправность.';
      }
      return 'Juniper: активная сессия на BRAS есть. Это подтверждает авторизацию/L3-сессию; PON, оптика и Wi‑Fi проверяются отдельно.';
    }
    if (result === 'offline') {
      if (session.staleRadius) {
        return 'Juniper: запись сессии есть в Radius, но на BRAS активная сессия не найдена. Это полезный L3-факт, но состояние ONU нужно проверять отдельно.';
      }
      return 'Juniper: активная сессия не подтверждена. Это не является доказательством отсутствия ONU или оптического линка.';
    }
    if (result === 'no_session') {
      return 'Juniper: активная сессия не найдена. Продолжай обычную диагностику; отсутствие L3-сессии не заменяет проверку Billing/ТМЦ/ONU.';
    }
    return 'Juniper: данные сессии не удалось уверенно разобрать. Основной диагностический маршрут не блокируется.';
  }

  function parseDocument(root) {
    if (!root?.querySelectorAll) {
      return { parserVersion: API_VERSION, result: 'error', sessions: [], session: null, summary: educationalSummary({}, 'error') };
    }

    let blocks = [...root.querySelectorAll('table.table10')]
      .map(table => table.querySelector('td[valign="middle"], td[align="left"], td:nth-of-type(3)') || table)
      .filter(Boolean);

    if (!blocks.length && root.body) blocks = [root.body];

    const sessions = blocks
      .map(block => parseSessionText(block.innerText || block.textContent || ''))
      .filter(session => session.sessionId || session.statusRaw || session.staleRadius || session.brasName);

    const session = [...sessions].sort((a, b) => scoreSession(b) - scoreSession(a))[0] || null;
    const result = session?.status || 'no_session';

    return {
      parserVersion: API_VERSION,
      result,
      sessions,
      session,
      summary: educationalSummary(session || {}, result)
    };
  }

  function parseHtml(html) {
    if (typeof DOMParser === 'undefined') {
      return { parserVersion: API_VERSION, result: 'error', sessions: [], session: null, summary: educationalSummary({}, 'error') };
    }
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return parseDocument(doc);
    } catch {
      return { parserVersion: API_VERSION, result: 'error', sessions: [], session: null, summary: educationalSummary({}, 'error') };
    }
  }

  const api = {
    version: API_VERSION,
    compact,
    normalizeMac,
    validIp,
    parseRatePair,
    parseSessionText,
    parseDocument,
    parseHtml,
    educationalSummary
  };

  globalThis.SIMNET_JUNIPER_PARSER = api;
  if (globalThis.SIMNET_WB) globalThis.SIMNET_WB.juniperParser = api;
})();
