(() => {
  'use strict';

  const API_VERSION = '2.0.0';

  const compact = (value, max = 600) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const oneLine = (value, max = 600) => compact(value, max)
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeMac = value => {
    const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
  };

  const normalizeSerial = value => String(value || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

  const validIp = value => {
    const candidate = String(value || '').match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
    if (!candidate) return '';
    return candidate.split('.').every(part => Number(part) >= 0 && Number(part) <= 255)
      ? candidate
      : '';
  };

  const textOf = element => compact(
    element?.innerText || element?.textContent || '',
    6000
  );

  function inventoryScope(root = document) {
    if (!root?.querySelector) {
      return { status: 'document_missing', anchor: null, header: null, block: null };
    }
    const anchor = root.querySelector('#ref_inventory');
    if (!anchor) return { status: 'inventory_missing', anchor: null, header: null, block: null };

    const header = anchor.closest?.('.label_h3_hr') || null;
    if (!header) return { status: 'header_missing', anchor, header: null, block: null };

    const sibling = header.nextElementSibling || null;
    const block = sibling?.matches?.('.slider_content_double')
      ? sibling
      : sibling?.querySelector?.('.slider_content_double') || null;
    if (!block) return { status: 'tmc_block_missing', anchor, header, block: null };

    return { status: 'ready', anchor, header, block };
  }

  function ponRows(root = document) {
    const scope = inventoryScope(root);
    if (!scope.block?.querySelectorAll) return { ...scope, rows: [] };
    const rows = [...scope.block.querySelectorAll('tbody tr.table_item')]
      .filter(row => oneLine(row?.cells?.[2]?.innerText || row?.cells?.[2]?.textContent || '', 80).toUpperCase() === 'PON');
    return {
      ...scope,
      status: rows.length ? 'pon_rows_found' : 'pon_row_missing',
      rows
    };
  }

  function firstEquipmentLine(cell) {
    const lines = textOf(cell)
      .split(/\n+/)
      .map(line => oneLine(line, 260))
      .filter(Boolean);
    return lines.find(line => !/^(?:s\/?n|sn|serial|серийн|серійн|mac|ip|interface|onu\s+(?:rx|tx)|olt\s+rx)\b/i.test(line))
      || lines[0]
      || '';
  }

  function valueAfter(text, labelPattern, valuePattern) {
    return String(text || '').match(
      new RegExp(`(?:^|\\s)(?:${labelPattern})\\s*[:#№-]?\\s*(${valuePattern})`, 'i')
    )?.[1] || '';
  }

  function opticalValue(text, owner, direction) {
    const value = String(text || '').match(
      new RegExp(`\\b${owner}\\s*${direction}(?:\\s*(?:power|signal))?\\s*(?:\\(dBm\\))?\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)`, 'i')
    )?.[1] || '';
    return value ? value.replace(',', '.') : '';
  }

  function parsePonRow(row) {
    const cells = row?.cells || [];
    if (!row || cells.length < 5) return null;
    const category = oneLine(cells[2]?.innerText || cells[2]?.textContent || '', 80);
    if (category.toUpperCase() !== 'PON') return null;

    const equipmentCell = cells[3];
    const detailsCell = cells[4];
    const equipmentText = textOf(equipmentCell);
    const detailsText = textOf(detailsCell);
    const combined = `${equipmentText}\n${detailsText}`;

    const serialRaw = valueAfter(
      combined,
      's\\/?n|sn|serial(?:\\s+number)?|серийн(?:ый|ого)?(?:\\s+номер)?|серійн(?:ий|ого)?(?:\\s+номер)?',
      '[A-Z0-9][A-Z0-9:._-]{5,63}'
    );
    const serial = normalizeSerial(serialRaw);

    const mac = normalizeMac(
      valueAfter(
        combined,
        'onu\\s+mac|mac(?:[-\\s]?адрес)?',
        '(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}|[0-9A-F]{4}(?:\\.[0-9A-F]{4}){2}|[0-9A-F]{12}'
      )
      || combined.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)?.[0]
      || ''
    );

    const deviceLinks = [...(detailsCell?.querySelectorAll?.('a[href*="/device/"]') || [])];
    const oltLink = deviceLinks.find(link => !/история|історія|history/i.test(oneLine(link.textContent || '', 240)))
      || deviceLinks[0]
      || null;
    const oltDeviceId = String(oltLink?.getAttribute?.('href') || oltLink?.href || '')
      .match(/\/device\/(\d+)/i)?.[1] || '';
    const linkedOltName = oneLine(oltLink?.innerText || oltLink?.textContent || '', 260);
    const foundOnOlt = /(?:найдено|знайдено)\s+на\s+olt/i.test(detailsText)
      || Boolean(oltLink && (linkedOltName || oltDeviceId));
    const oltName = linkedOltName || oneLine(
      detailsText.match(
        /(?:найдено|знайдено)\s+на\s+OLT\s*:?\s*(?:\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}\s*)?(.+?)(?=\s+IP\s*:|\s+Interface\s*:|\s+ONU\s+Rx|\s+ONU\s+Tx|\s+OLT\s+Rx|$)/i
      )?.[1] || '',
      260
    );

    const oltIp = validIp(
      valueAfter(detailsText, 'olt\\s+ip|ip', '(?:\\d{1,3}\\.){3}\\d{1,3}')
      || detailsText
    );
    const iface = oneLine(
      detailsText.match(
        /\bInterface\s*:\s*(.+?)(?=\s+(?:Расстояние|Distance|ONU\s+Rx|ONU\s+Tx|OLT\s+Rx|MAC|S\/?N|Serial)\s*[:=]?|$)/i
      )?.[1] || '',
      160
    );

    return {
      element: row,
      category,
      equipmentName: firstEquipmentLine(equipmentCell),
      serial: serial || null,
      serialKey: serial,
      mac,
      foundOnOlt,
      oltName,
      oltIp,
      oltDeviceId,
      deviceId: oltDeviceId,
      interface: iface,
      onuRx: opticalValue(detailsText, 'ONU', 'Rx'),
      onuTx: opticalValue(detailsText, 'ONU', 'Tx'),
      oltRx: opticalValue(detailsText, 'OLT', 'Rx'),
      text: oneLine(combined, 6000),
      phraseFound: foundOnOlt,
      deviceLinkFound: Boolean(oltLink)
    };
  }

  function findBlocks(root = document) {
    return ponRows(root).rows;
  }

  function parseBlock(row) {
    return parsePonRow(row);
  }

  function parseDocument(root = document) {
    const scope = ponRows(root);
    const items = scope.rows.map(parsePonRow).filter(Boolean);
    const item = items[0] || null;
    return {
      parserVersion: API_VERSION,
      status: item ? 'parsed' : scope.status,
      result: item ? 'found' : 'missing',
      tmcFound: Boolean(scope.anchor && scope.header && scope.block),
      ponFound: items.length > 0,
      headerText: oneLine(scope.header?.innerText || scope.header?.textContent || '', 160),
      containerClass: oneLine(scope.block?.className || '', 160),
      item,
      items,
      rows: scope.rows,
      candidateCount: items.length,
      blockFound: items.length > 0,
      deviceLinkFound: items.some(entry => entry.deviceLinkFound),
      anchor: scope.anchor,
      header: scope.header,
      block: scope.block
    };
  }

  const api = Object.freeze({
    version: API_VERSION,
    inventoryScope,
    ponRows,
    findBlocks,
    parseBlock,
    parsePonRow,
    parseDocument,
    normalizeMac,
    normalizeSerial,
    validIp,
    compact
  });

  const WB = globalThis.SIMNET_WB;
  if (WB) {
    WB.parsers ||= {};
    WB.parsers.userside ||= {};
    WB.parsers.userside.tmc = api;
    WB.tmcParser = api;
  }
  globalThis.SIMNET_TMC_PARSER = api;
})();
