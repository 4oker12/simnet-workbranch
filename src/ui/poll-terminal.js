(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__pollTerminalLoaded) return;
  WB.__pollTerminalLoaded = true;

  const STYLE_ID = 'simnet-wb-poll-terminal-style';
  const BLOCK_CLASS = 'simnet-wb-poll-command-block';
  const TERMINAL_SELECTOR = 'bbs-config, epon-config, gpon-config, pre, font[face*="Lucida" i]';
  // IMPORTANT: these are OUTPUT markers, not command-name markers.
  // A wrong Billing tab may still render a terminal-looking block containing commands
  // and error text. Command presence alone must never count as an ONU response.
  const RESULT_MARKERS = [
    /\bONT-ID\s*:\s*\d+/i,
    /\bF\/S\/P\s*:\s*\d+\/\d+\/\d+/i,
    /\bRun\s+state\s*:\s*(?:online|offline)\b/i,
    /ONU\s+(?:gpon|epon)[^\n\r]{0,120}\s+is\s*-\s*(?:online|offline)/i,
    /Interface\s+(?:GPON|EPON)[^\n\r]{0,80}has\s+bound\s+[1-9]\d*\s+active\s+ONUs?/i,
    /\b(?:GPON|EPON)\d+(?:\/\d+){1,2}:\d+\s+[0-9A-Z:.\-]+/i,
    /\bONU\s+ID\s*:\s*[0-9A-F:.\-]+/i,
    /received\s+power\s*\(dBm\)\s*:\s*-?\d/i,
    /RX\s+Optical\s+Power\s*\(dBm\)\s*:\s*-?\d/i,
    /Hardware\s+state\s+is\s+Link[-\s]?(?:Up|Down)/i,
    /Port\s+status\s+is\s+(?:Enable|Disable)/i,
    /\b[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}\s+(?:DYNAMIC|STATIC)\b/i,
    /pon_port_by_onu\s*=\s*\d+/i,
    /ontid_by_onu\s*=\s*\d+/i,
    /onu_by_onu\s*=\s*(?:gpon|epon)[^\s]+/i,
    /Error:\s*The required ONT is offline/i
  ];

  const ACTION_PARSERS = Object.freeze({
    '310': 'bdcom-epon',
    '311': 'bdcom-gpon',
    '312': 'gcom',
    '313': 'huawei'
  });


  const normalizeSpace = value => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeMac = value => {
    const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
  };

  const normalizeSerial = value => String(value || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

  const textOfNodes = nodes => (nodes || []).map(node => {
    if (node?.nodeType === Node.ELEMENT_NODE && String(node.nodeName).toUpperCase() === 'BR') return '\n';
    if (node?.nodeType === Node.ELEMENT_NODE && typeof node.innerText === 'string') return node.innerText;
    return node?.textContent || '';
  }).join('');

  const outputAfterCommand = raw => {
    const value = String(raw || '').replace(/\r/g, '');
    const newline = value.indexOf('\n');
    if (newline >= 0) return value.slice(newline + 1);
    return value;
  };

  const simpleHash = value => {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };

  function commandTextFromNode(node) {
    return normalizeSpace(node?.textContent || '');
  }

  function looksLikeCommand(text) {
    return /^(?:display|show|ping|traceroute|trace|debug|ont|onu)\b/i.test(
      normalizeSpace(text)
    );
  }

  function parseOntInfo(text) {
    const result = {};
    const match = (pattern, key, transform = value => normalizeSpace(value)) => {
      const found = String(text || '').match(pattern);
      if (found?.[1]) result[key] = transform(found[1]);
    };

    match(/\bF\/S\/P\s*:\s*([^\s]+)/i, 'fsp');
    match(/\bONT-ID\s*:\s*(\d+)/i, 'ontId');
    match(/\bRun\s+state\s*:\s*([^\s]+)/i, 'runState', value => value.toLowerCase());
    match(/\bConfig\s+state\s*:\s*([^\s]+)/i, 'configState', value => value.toLowerCase());
    match(/\bMatch\s+state\s*:\s*([^\s]+)/i, 'matchState', value => value.toLowerCase());
    match(/\bONT(?:\s+last)?\s+distance\(m\)\s*:\s*(\d+(?:\.\d+)?)/i, 'distanceM', Number);
    match(/\bLast\s+down\s+cause\s*:\s*([^\n\r]+?)(?=\s+Last\s+up\s+time\s*:|$)/i, 'lastDownCause');
    match(/\bLast\s+up\s+time\s*:\s*([^\n\r]+?)(?=\s+Last\s+down\s+time\s*:|$)/i, 'lastUpTime');
    match(/\bLast\s+down\s+time\s*:\s*([^\n\r]+?)(?=\s+Last\s+dying\s+gasp\s+time\s*:|$)/i, 'lastDownTime');
    match(/\bONT\s+actual\s+NNI\s+type\s*:\s*([^\s]+)/i, 'actualNni');
    match(/\bONT\s+online\s+duration\s*:\s*([^\n\r]+?)(?=\s+ONT\s+system\s+up\s+duration\s*:|$)/i, 'onlineDuration');

    const serialAlias = String(text || '').match(
      /\bSN\s*:\s*[0-9A-F]{8,32}\s*\(([^)]+)\)/i
    )?.[1]
      || String(text || '').match(/display\s+ont\s+info\s+by-sn\s+([^\s(]+)/i)?.[1]
      || '';
    if (serialAlias) result.onuSerial = normalizeSerial(serialAlias);

    return result;
  }

  function parsePortState(text) {
    const result = {};
    const row = String(text || '').match(
      /\b(?:GE|FE)\s+(\d+)\s+(full|half|-)?\s*(up|down)\b/i
    );
    if (row) {
      result.speedMbps = Number(row[1]);
      result.duplex = String(row[2] || '').toLowerCase();
      result.linkState = String(row[3] || '').toLowerCase();
    }
    return result;
  }

  function parseMacAddress(text) {
    const result = {};
    const macRow = String(text || '').match(
      /\b([0-9a-f]{4}(?:[-.]?[0-9a-f]{4}){2})\s+(dynamic|static)\b/i
    );
    if (macRow) {
      result.subscriberMac = normalizeMac(macRow[1]);
      result.macType = String(macRow[2] || '').toLowerCase();
    }
    const vlan = String(text || '').match(/\b(?:dynamic|static)\b[^\n\r]{0,120}?\b(\d{2,4})\s*(?:Total\s*:|$)/i);
    if (vlan?.[1]) result.vlan = Number(vlan[1]);
    return result;
  }

  function parseServicePort(text) {
    const result = {};
    const row = String(text || '').match(
      /\b(\d+)\s+(\d+)\s+(QinQ|common|smart|stacking)\b[\s\S]{0,220}?\b(up|down)\b/i
    );
    if (row) {
      result.index = Number(row[1]);
      result.vlan = Number(row[2]);
      result.vlanAttr = row[3];
      result.state = String(row[4] || '').toLowerCase();
    }
    return result;
  }

  function parseTraffic(text) {
    const result = {};
    const pick = (pattern, key) => {
      const value = String(text || '').match(pattern)?.[1];
      if (value != null && value !== '') result[key] = Number(value);
    };
    pick(/\bUp\s+traffic\s*\(kbps\)\s*:\s*(\d+(?:\.\d+)?)/i, 'upKbps');
    pick(/\bDown\s+traffic\s*\(kbps\)\s*:\s*(\d+(?:\.\d+)?)/i, 'downKbps');
    return result;
  }

  function parseEthStatistics(text) {
    const result = {};
    const valueText = String(text || '');
    if (/Error:\s*The required ONT is offline/i.test(valueText)) {
      result.unavailable = true;
      result.unavailableReason = 'onu_offline';
      return result;
    }
    const pick = (pattern, key) => {
      const value = valueText.match(pattern)?.[1];
      if (value != null && value !== '') result[key] = Number(value);
    };
    pick(/\bReceived\s+frames\s*:\s*(\d+)/i, 'receivedFrames');
    pick(/\bSent\s+frames\s*:\s*(\d+)/i, 'sentFrames');
    pick(/\bReceived\s+FCS\s+error\s+frames\s*:\s*(\d+)/i, 'rxFcsErrors');
    pick(/\bReceived\s+alignment\s+error\s+frames\s*:\s*(\d+)/i, 'rxAlignmentErrors');
    pick(/\bReceived\s+oversize(?:\s+discarded)?\s+frames\s*:\s*(\d+)/i, 'rxOversizeDiscards');
    pick(/\bReceived\s+undersize(?:\s+discarded)?\s+frames\s*:\s*(\d+)/i, 'rxUndersizeDiscards');
    pick(/\bDiscard\s+frames\s*:\s*(\d+)/i, 'rxDiscards');
    pick(/\bSent\s+excessive\s+collision\s+frames\s*:\s*(\d+)/i, 'txExcessiveCollisions');
    return result;
  }

  function parseOptical(text) {
    const result = {};
    const pick = (pattern, key) => {
      const value = String(text || '').match(pattern)?.[1];
      if (value != null && value !== '') result[key] = Number(value);
    };
    pick(/Rx\s+optical\s+power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'onuRxDbm');
    pick(/Tx\s+optical\s+power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'onuTxDbm');
    pick(/OLT\s+RX\s+ONT\s+optical\s+power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'oltRxDbm');
    pick(/Temperature\(C\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'temperatureC');
    return result;
  }


  function parserKeyFromAction(action) {
    return ACTION_PARSERS[String(action || '')] || 'unknown';
  }

  function parserKeyFromLocation() {
    try {
      return parserKeyFromAction(new URLSearchParams(location.search).get('a'));
    } catch (_) {
      return 'unknown';
    }
  }

  function inferParserKeyFromCommand(command) {
    const value = normalizeSpace(command).toLowerCase();
    if (/^display\s+/.test(value)) return 'huawei';
    if (/^show\s+ont\s+/.test(value)) return 'gcom';
    if (/^show\s+gpon\s+/.test(value) || /^show\s+mac\s+address-table\s+interface\s+gpon/.test(value)) return 'bdcom-gpon';
    if (/^show\s+epon\s+/.test(value) || /^show\s+mac\s+address-table\s+interface\s+epon/.test(value)) return 'bdcom-epon';
    return 'unknown';
  }

  function currentParserKey(explicit = '') {
    return explicit || parserKeyFromLocation();
  }

  function parseGcomPortState(text) {
    const result = {};
    const value = String(text || '');
    if (/Error:\s*The required ONT is offline/i.test(value)) {
      result.unavailable = true;
      result.unavailableReason = 'onu_offline';
      return result;
    }
    if (/Port\s+status\s+is\s+Enable\s*,?\s*Linkdown/i.test(value) || /\bLinkdown\b/i.test(value)) {
      result.linkState = 'down';
      return result;
    }
    const row = value.match(/Port\s+status\s+is\s+(?:Enable|Disable)\s*,?\s*(\d+)(?:BaseT|M(?:bps)?)?\s+(full|half)\s+duplex/i);
    if (row) {
      result.speedMbps = Number(row[1]);
      result.duplex = String(row[2]).toLowerCase();
      result.linkState = 'up';
      return result;
    }
    if (/Gigabit\s+Ethernet\s+(full|half)\s+duplex/i.test(value)) {
      result.speedMbps = 1000;
      result.duplex = String(value.match(/Gigabit\s+Ethernet\s+(full|half)\s+duplex/i)?.[1] || '').toLowerCase();
      result.linkState = 'up';
      return result;
    }
    if (/Port\s+status\s+is\s+Enable/i.test(value) && !/Linkdown/i.test(value)) result.linkState = 'up';
    return result;
  }

  function parseBdcomPortState(text) {
    const result = {};
    const value = String(text || '');
    if (/Error:\s*The required ONT is offline/i.test(value)) {
      result.unavailable = true;
      result.unavailableReason = 'onu_offline';
      return result;
    }
    const state = value.match(/Hardware\s+state\s+is\s+Link[-\s]?(Up|Down)/i)?.[1]
      || value.match(/\buni-port\s+\d+\s+(up|down)\b/i)?.[1];
    if (state) result.linkState = String(state).toLowerCase();
    let speed = '';
    if (/\((?:1Gbps|1000Mbps)\s+(?:Full|Half)-Duplex\)/i.test(value)) speed = '1000';
    else if (/\((?:100Mbps)\s+(?:Full|Half)-Duplex\)/i.test(value)) speed = '100';
    else speed = value.match(/\b(2500|1000|100|10)\s*(?:M|Mbps|BaseT)?\b/i)?.[1] || '';
    if (speed) result.speedMbps = Number(speed);
    const duplex = value.match(/\b(full|half)[-\s]?duplex\b/i)?.[1];
    if (duplex) result.duplex = String(duplex).toLowerCase();
    return result;
  }

  function parseGcomMacAddress(text) {
    const result = {};
    const value = outputAfterCommand(text);
    const matches = [...value.matchAll(/\b([0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{4}(?:[.-][0-9a-f]{4}){2})\b/gi)]
      .map(match => normalizeMac(match[1]))
      .filter(Boolean);
    result.macs = [...new Set(matches)];
    if (result.macs[0]) result.subscriberMac = result.macs[0];
    const vlan = value.match(/(?:MAC-Address\s+VID[\s\S]{0,200}?\n?\s*[0-9a-f:.-]+\s+)(\d{1,4})\b/i)?.[1];
    if (vlan) result.vlan = Number(vlan);
    const serial = value.match(/\b(?:SN\s*:|\s)([A-Z0-9]{3,8}[-:]?[0-9A-F]{6,16})\b/i)?.[1];
    if (serial) result.onuSerial = normalizeSerial(serial);
    result.empty = /Total\s+entries\s*:\s*0|Total\s*:\s*0/i.test(value) || !result.macs.length;
    return result;
  }

  /** EPON system VLANs: ONU self-MAC typically sits on 4093/4094 — not a client device. */
  function isSystemPonVlan(vlan) {
    const n = Number(vlan);
    return n === 4093 || n === 4094;
  }

  function parseBdcomMacAddress(text) {
    const result = {};
    const value = outputAfterCommand(text);
    const entries = [];
    const rowRe = /\b(\d{1,4})\s+([0-9a-f]{4}(?:\.[0-9a-f]{4}){2}|[0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(DYNAMIC|STATIC)\b/gi;
    let row;
    while ((row = rowRe.exec(value))) {
      const vlan = Number(row[1]);
      const mac = normalizeMac(row[2]);
      if (!mac) continue;
      entries.push({ vlan, mac, type: String(row[3] || '').toUpperCase() });
    }
    // Fallback: bare MAC list without VLAN columns.
    if (!entries.length) {
      const matches = [...value.matchAll(/\b([0-9a-f]{4}(?:\.[0-9a-f]{4}){2}|[0-9a-f]{2}(?::[0-9a-f]{2}){5})\b/gi)]
        .map(match => normalizeMac(match[1]))
        .filter(Boolean);
      for (const mac of matches) entries.push({ vlan: null, mac, type: '' });
    }
    result.macEntries = entries;
    const clientEntries = entries.filter(item => !isSystemPonVlan(item.vlan));
    const clientMacs = [...new Set(clientEntries.map(item => item.mac).filter(Boolean))];
    const allMacs = [...new Set(entries.map(item => item.mac).filter(Boolean))];
    // Prefer client (non-system-VLAN) MACs for subscriber identity.
    result.macs = clientMacs.length ? clientMacs : allMacs;
    result.systemMacs = [...new Set(
      entries.filter(item => isSystemPonVlan(item.vlan)).map(item => item.mac).filter(Boolean)
    )];
    if (result.macs[0]) result.subscriberMac = result.macs[0];
    const clientVlan = clientEntries.find(item => Number.isFinite(item.vlan))?.vlan;
    const anyVlan = entries.find(item => Number.isFinite(item.vlan))?.vlan;
    if (Number.isFinite(clientVlan)) result.vlan = clientVlan;
    else if (Number.isFinite(anyVlan)) result.vlan = anyVlan;
    result.empty = /Total\s*\(?\s*0\s*\)?|Total\s+entries\s*:\s*0/i.test(value) || !result.macs.length;
    return result;
  }

  function parseGcomOptical(text) {
    const result = {};
    const value = String(text || '');
    if (/Error:\s*The required ONT is offline/i.test(value)) {
      result.unavailable = true;
      result.unavailableReason = 'onu_offline';
      return result;
    }
    const num = (pattern, key) => {
      const found = value.match(pattern)?.[1];
      if (found != null && found !== '') result[key] = Number(found);
    };
    num(/RX\s+Optical\s+Power\s*\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'onuRxDbm');
    num(/TX\s+Optical\s+Power\s*\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'onuTxDbm');
    num(/TX\s+Optical\s+Power\s*\(dBm\)[^\n\r]*\(OLT\s+RX\s*:\s*(-?\d+(?:\.\d+)?)\)/i, 'oltRxDbm');
    num(/Temperature\s*\(C\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'temperatureC');
    if (result.oltRxDbm === 0) delete result.oltRxDbm;
    return result;
  }

  function parseBdcomOptical(text) {
    const result = {};
    const value = String(text || '');
    const num = (pattern, key) => {
      const found = value.match(pattern)?.[1];
      if (found != null && found !== '') result[key] = Number(found);
    };
    num(/received\s+power\s*\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'onuRxDbm');
    num(/transmitted\s+power\s*\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'onuTxDbm');
    num(/operating\s+temperature\s*\(degree\)\s*:\s*(-?\d+(?:\.\d+)?)/i, 'temperatureC');
    if (!Number.isFinite(result.onuRxDbm) || !Number.isFinite(result.onuTxDbm)) {
      const row = value.match(/\b(?:gpon|epon)\d*\/\d+:\d+\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);
      if (row) {
        if (!Number.isFinite(result.temperatureC)) result.temperatureC = Number(row[1]);
        if (!Number.isFinite(result.onuRxDbm)) result.onuRxDbm = Number(row[4]);
        if (!Number.isFinite(result.onuTxDbm)) result.onuTxDbm = Number(row[5]);
      }
    }
    return result;
  }

  function parseGcomOntInfo(text) {
    const result = {};
    const value = String(text || '');
    const status = value.match(/\bStatus\s*:\s*(online|offline|working|inactive|active)/i)?.[1]
      || value.match(/\b(online|offline)\b/i)?.[1];
    if (status) result.runState = /online|active|working/i.test(status) ? 'online' : 'offline';
    const distance = value.match(/\bDistance\s*\(m\)\s*:\s*(\d+(?:\.\d+)?)/i)?.[1];
    if (distance) result.distanceM = Number(distance);
    const serial = value.match(/\bSN\s*:\s*([^\s]+)/i)?.[1]
      || value.match(/\b[A-Z0-9]{3,8}[-:][0-9A-F]{6,16}\b/i)?.[0];
    if (serial) result.onuSerial = normalizeSerial(serial);
    const uptime = value.match(/\b(\d+d\d+h\d+m)\s+(?:online|offline)\b/i)?.[1]
      || value.match(/\bUp\/Down-time\s*[:=]\s*([^\s]+)/i)?.[1];
    if (uptime) result.onlineDuration = normalizeSpace(uptime);
    const reason = value.match(/\b(?:LastDeregReason|Last\s+down\s+cause)\s*[:=]\s*([^\n\r]+)/i)?.[1]
      || value.match(/\b(POWER[_ -]?OFF|Dying\s+Gasp|wire-down|LOS\w*)\b/i)?.[1];
    if (reason) result.lastDownCause = normalizeSpace(reason);
    return result;
  }

  function parseBdcomLifecycle(text) {
    const result = {};
    const value = String(text || '');
    const inactive = /inactive-onu/i.test(value);
    const active = /active-onu/i.test(value) && !inactive;
    const boundActive = /has\s+bound\s+[1-9]\d*\s+active\s+ONUs?/i.test(value);
    const positionRow = value.match(/\b((?:GPON|EPON)\d*\/\d+:\d+)\b/i)?.[1];
    if (inactive && positionRow) result.runState = 'offline';
    else if (active && boundActive) result.runState = 'online';
    else if (active && !boundActive && !positionRow) {
      result.runState = 'offline';
      result.inferredFrom = 'active-onu-empty';
    }
    if (positionRow) result.interface = positionRow.toUpperCase();
    const serial = value.match(/\b(?:GPON\d*\/\d+:\d+)\s+([A-Z0-9]{3,8}[:\-][0-9A-F]{6,16})\b/i)?.[1];
    if (serial) result.onuSerial = normalizeSerial(serial);
    const gponRow = value.match(/\bGPON\d*\/\d+:\d+\s+[A-Z0-9:\-]+[\s\S]{0,180}?\b(\d{3,5}(?:\.\d+)?)\s*(?:\r?\n|$)/i);
    const eponRow = value.match(/\bEPON\d*\/\d+:\d+\s+[0-9A-Fa-f.:-]+\s+\S+\s+\S+\s+(\d+(?:\.\d+)?)\s+\d+/i);
    const distance = gponRow?.[1]
      || eponRow?.[1]
      || value.match(/\bDistance\s*\(m\)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)?.[1];
    if (distance) result.distanceM = Number(distance);
    const duration = value.match(/\b(\d{4}d:\d{2}:\d{2}:\d{2})\b/i)?.[1]
      || value.match(/\b(\d+\s*\.\d{1,2}:\d{2}:\d{2})\b/i)?.[1]
      || value.match(/\bAlivetime\b[\s\S]{0,220}?\b(\d+\s*\.\d{1,2}:\d{2}:\d{2})\b/i)?.[1];
    if (duration) result.onlineDuration = normalizeSpace(duration);
    const reason = value.match(/\b(wire-down|Dying\s+Gasp|POWER[_ -]?OFF|LOS\w*|Admin\s+ctrol)\b/i)?.[1];
    if (reason) result.lastDownCause = normalizeSpace(reason);
    return result;
  }

  function parseBdcomBasicInfo(text) {
    const result = {};
    const value = String(text || '');
    const onuId = value.match(/\bONU\s+ID\s*:\s*([^\s]+)/i)?.[1];
    if (onuId) {
      const mac = normalizeMac(onuId);
      if (mac) result.onuMac = mac;
    }
    const model = value.match(/\bONU\s+MODEL\s+ID\s*:\s*([^\n\r]+)/i)?.[1];
    if (model) result.model = normalizeSpace(model);
    return result;
  }


  function reasonCategory(reason) {
    const value = normalizeSpace(reason).toLowerCase();
    if (/\blos(?:i)?\b|wire[-\s]?down/.test(value)) return 'optical';
    if (/dying[-\s]?gasp|power[_ -]?off/.test(value)) return 'power';
    if (/reset|reboot|admin/.test(value)) return 'reset';
    return value ? 'other' : 'unknown';
  }

  function parseDateish(value) {
    const text = normalizeSpace(value).replace(/\//g, '-').trim();
    const m = text.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\s*(Z|[+-]\d{2}:?\d{2}))?/i);
    if (!m) return null;
    const offset = String(m[7] || '').toUpperCase();
    const normalizedOffset = offset && offset !== 'Z' && !offset.includes(':')
      ? `${offset.slice(0, 3)}:${offset.slice(3)}`
      : offset;
    const stamp = normalizedOffset
      ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${normalizedOffset}`)
      : Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return Number.isFinite(stamp) ? stamp : null;
  }

  function formatElapsed(ms) {
    const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days) return `${days} д ${hours} ч`;
    if (hours) return `${hours} ч ${minutes} мин`;
    return `${minutes} мин`;
  }

  function formatEventTime(value) {
    const atMs = parseDateish(value);
    if (!Number.isFinite(atMs)) return normalizeSpace(value);
    const date = new Date(atMs);
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date).replace(',', '');
  }

  function historyFacts(events = []) {
    const clean = events.filter(event => event?.reason).map(event => ({
      ...event,
      reason: normalizeSpace(event.reason),
      category: reasonCategory(event.reason),
      atMs: event.atMs ?? parseDateish(event.at || '')
    }));
    const times = clean.map(event => event.atMs).filter(Number.isFinite);
    const latestMs = times.length ? Math.max(...times) : null;
    const latest = latestMs == null
      ? clean[0] || null
      : clean.find(event => event.atMs === latestMs) || clean[0] || null;
    const nowMs = Date.now();
    const within = (event, ms) => Number.isFinite(event.atMs)
      && event.atMs <= nowMs + 21600000
      && nowMs - event.atMs <= ms;
    const count = category => clean.filter(event => event.category === category).length;
    const countRecent = (category, days) => clean.filter(event => event.category === category && within(event, days * 86400000)).length;
    return {
      eventCount: clean.length,
      latestReason: latest?.reason || '',
      latestCategory: latest?.category || '',
      latestAt: latest?.at || '',
      latestAtMs: Number.isFinite(latest?.atMs) ? latest.atMs : null,
      opticalCount: count('optical'),
      powerCount: count('power'),
      resetCount: count('reset'),
      optical7d: countRecent('optical', 7),
      power7d: countRecent('power', 7),
      reset7d: countRecent('reset', 7),
      events24h: clean.filter(event => within(event, 86400000)).length,
      events7d: clean.filter(event => within(event, 7 * 86400000)).length,
      events: clean.slice(0, 64)
    };
  }

  function parseHuaweiRegisterInfo(text) {
    const value = String(text || '');
    const events = [];
    const rows = [...value.matchAll(/DownTime\s*:\s*([^\n\r]+?)\s+DownCause\s*:\s*([^\n\r]+?)(?=\s*-{5,}|\s+Index\s*:|\s+Total\s*:|$)/gi)];
    for (const row of rows) events.push({ at: normalizeSpace(row[1]), reason: normalizeSpace(row[2]) });
    const facts = historyFacts(events);
    const serial = value.match(/\bSN\s*:\s*[0-9A-F]{8,32}\s*\(([^)]+)\)/i)?.[1];
    if (serial) facts.onuSerial = normalizeSerial(serial);
    return facts;
  }

  function parseGcomHistory(text) {
    const value = String(text || '');
    const events = [];
    for (const row of value.matchAll(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})[^\n\r]*?offline,\s*reason:\s*([A-Z0-9_-]+)/gi)) {
      events.push({ at: row[1], reason: row[2] });
    }
    return historyFacts(events);
  }

  function parseGcomOpticalOverview(text) {
    const value = String(text || '');
    const result = {};
    const total = value.match(/Total\s+entries\s*:\s*(\d+)/i)?.[1];
    if (total) result.entryCount = Number(total);
    return result;
  }

  function parseBdcomGponBasicInfo(text) {
    const value = String(text || '');
    const result = {};
    const serial = value.match(/Serial\s+number\s+([^\s]+)(?:\s+\([^)]+\))?/i)?.[1];
    if (serial) result.onuSerial = normalizeSerial(serial);
    const distance = value.match(/\bDistance\s+(\d+(?:\.\d+)?)\s*m\b/i)?.[1];
    if (distance) result.distanceM = Number(distance);
    const duration = value.match(/\bOnline\s+Duration\s+([^\n\r-]+)/i)?.[1];
    if (duration) {
      result.onlineDuration = normalizeSpace(duration);
      result.runState = 'online';
    }
    const events = [];
    for (const row of value.matchAll(/(?:^|\s)(\d{2})\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+([A-Za-z][A-Za-z _-]+?)(?=\s+\d{2}\s+\d{4}-|$)/g)) {
      events.push({ at: row[3], reason: normalizeSpace(row[4]) });
    }
    Object.assign(result, historyFacts(events));
    return result;
  }

  const SEMANTIC_META = Object.freeze({
    ont_info: {
      label: 'Состояние ONU', shortLabel: 'ONU · состояние', importance: 'critical', importanceRank: 4,
      reason: 'Текущее состояние ONU, идентификация, позиция, расстояние и история регистрации.',
      focus: ['status', 'identity', 'distance', 'last down reason']
    },
    ont_port_state: {
      label: 'Ethernet-порт ONU', shortLabel: 'ETH · линк', importance: 'critical', importanceRank: 4,
      reason: 'Физический Ethernet-линк к клиентскому устройству: link, speed и duplex.',
      focus: ['LinkState', 'Speed', 'Duplex']
    },
    mac_address: {
      label: 'MAC клиентского устройства', shortLabel: 'MAC · устройство', importance: 'critical', importanceRank: 4,
      reason: 'Какие MAC реально изучены за ONU. Сверяется с MAC устройства из технических данных.',
      focus: ['MAC', 'match/mismatch', 'VLAN']
    },
    service_port: {
      label: 'Service-port / VLAN', shortLabel: 'SERVICE · VLAN', importance: 'medium', importanceRank: 2,
      reason: 'Сервисная привязка и состояние VLAN/service-port.',
      focus: ['VLAN', 'State']
    },
    optical: {
      label: 'Оптические уровни', shortLabel: 'PON · оптика', importance: 'medium', importanceRank: 2,
      reason: 'Физическое состояние PON-линии: уровни приёма/передачи и температура ONU.',
      focus: ['ONU Rx', 'ONU Tx', 'OLT Rx', 'temperature']
    },
    ont_traffic: {
      label: 'Текущий трафик ONU', shortLabel: 'TRAFFIC · сейчас', importance: 'high', importanceRank: 3,
      reason: 'Снимок текущего обмена трафиком ONU.',
      focus: ['Up traffic', 'Down traffic']
    },
    eth_statistics: {
      label: 'Статистика Ethernet-порта', shortLabel: 'ETH · статистика', importance: 'medium', importanceRank: 2,
      reason: 'Счётчики кадров и ошибок Ethernet-порта.',
      focus: ['frames', 'errors', 'discards', 'collisions']
    },
    ont_config: {
      label: 'Конфигурация ONU', shortLabel: 'ONU · конфигурация', importance: 'reference', importanceRank: 1,
      reason: 'Справочная конфигурация ONU. Нужна для углублённого разбора.',
      focus: ['profiles', 'mapping', 'configuration']
    },
    history: {
      label: 'История ONU', shortLabel: 'ONU · история', importance: 'high', importanceRank: 3,
      reason: 'Причины и время предыдущих отключений/регистраций ONU.',
      focus: ['Last dereg reason', 'Dying Gasp', 'wire-down', 'LOS']
    },
    optical_overview: {
      label: 'Оптика PON-порта', shortLabel: 'PON · обзор', importance: 'reference', importanceRank: 1,
      reason: 'Сводная таблица всего PON-порта. Для текущей ONU это справочный контекст, а не отдельный диагноз.',
      focus: ['target ONU row', 'outliers only']
    },
    other: {
      label: 'Команда оборудования', shortLabel: 'Оборудование', importance: 'reference', importanceRank: 1,
      reason: 'Справочный вывод команды.', focus: []
    }
  });

  function commandRule(parserKey, command) {
    const rules = {
      huawei: [
        [/display\s+ont\s+register-info\b/i, 'history', parseHuaweiRegisterInfo],
        [/display\s+ont\s+info\b/i, 'ont_info', parseOntInfo],
        [/display\s+ont\s+port\s+state\b/i, 'ont_port_state', parsePortState],
        [/display\s+(?:ont-learned-mac|mac-address)\b/i, 'mac_address', parseMacAddress],
        [/display\s+service-port\b/i, 'service_port', parseServicePort],
        [/display\s+current-configuration\s+ont\b/i, 'ont_config', () => ({})],
        [/display\s+ont\s+traffic\b/i, 'ont_traffic', parseTraffic],
        [/display\s+statistics\s+ont-eth\b/i, 'eth_statistics', parseEthStatistics],
        [/display\s+ont\s+optical|optical-info/i, 'optical', parseOptical]
      ],
      gcom: [
        [/show\s+ont\s+mac-address-table\b/i, 'mac_address', parseGcomMacAddress],
        [/show\s+ont\s+optical-info\s+interface\s+gpon\b/i, 'optical_overview', parseGcomOpticalOverview],
        [/show\s+ont\s+optical-info\b/i, 'optical', parseGcomOptical],
        [/show\s+ont\s+port-status\b/i, 'ont_port_state', parseGcomPortState],
        [/show\s+ont\s+(?:info|brief)\b/i, 'ont_info', parseGcomOntInfo],
        [/show\s+ont\s+profile\b/i, 'ont_config', () => ({})],
        [/show\s+ont\s+statistics\b/i, 'eth_statistics', parseEthStatistics],
        [/show\s+ont-logging\s+buffer\b/i, 'history', parseGcomHistory]
      ],
      'bdcom-gpon': [
        [/show\s+mac\s+address-table\s+interface\s+GPON/i, 'mac_address', parseBdcomMacAddress],
        [/show\s+gpon\s+(?:active-onu|inactive-onu)\b/i, 'ont_info', parseBdcomLifecycle],
        [/show\s+gpon\s+int\b[\s\S]*?onu\s+optical-transceiver-diagnosis/i, 'optical', parseBdcomOptical],
        [/show\s+gpon\s+int\b[\s\S]*?onu\s+port\b[\s\S]*?state/i, 'ont_port_state', parseBdcomPortState],
        [/show\s+gpon\s+interface\b[\s\S]*?onu\s+basic-info/i, 'ont_info', parseBdcomGponBasicInfo],
        [/show\s+run\s+interface\s+GPON/i, 'ont_config', () => ({})],
        [/show\s+gpon\b[\s\S]*?(?:history|dereg|register)/i, 'history', parseBdcomLifecycle]
      ],
      'bdcom-epon': [
        [/show\s+mac\s+address-table\s+interface\s+EPON/i, 'mac_address', parseBdcomMacAddress],
        [/show\s+epon\s+(?:active-onu|inactive-onu)\b/i, 'ont_info', parseBdcomLifecycle],
        [/show\s+epon\s+int\b[\s\S]*?onu\s+ctc\s+opt\b/i, 'optical', parseBdcomOptical],
        [/show\s+epon\s+int\b[\s\S]*?onu\s+port\b[\s\S]*?state/i, 'ont_port_state', parseBdcomPortState],
        [/show\s+epon\s+interface\b[\s\S]*?onu\s+ctc\s+basic-info/i, 'ont_info', parseBdcomBasicInfo],
        [/show\s+epon\b[\s\S]*?(?:history|dereg|register)/i, 'history', parseBdcomLifecycle]
      ]
    };
    const order = [parserKey, inferParserKeyFromCommand(command), 'huawei', 'gcom', 'bdcom-gpon', 'bdcom-epon']
      .filter((item, index, arr) => item && item !== 'unknown' && arr.indexOf(item) === index);
    for (const name of order) {
      for (const [pattern, family, parser] of rules[name] || []) {
        if (pattern.test(command)) return { parserKey: name, family, parser };
      }
    }
    return { parserKey: parserKey === 'unknown' ? inferParserKeyFromCommand(command) : parserKey, family: 'other', parser: () => ({}) };
  }

  function analyzeCommandBlockText(rawText, explicitCommand = '', options = {}) {
    const raw = String(rawText || '');
    const text = normalizeSpace(raw);
    const command = normalizeSpace(explicitCommand)
      || normalizeSpace(String(rawText || '').split(/\r?\n/)[0]);
    const requestedParserKey = currentParserKey(options.parserKey || '');
    const rule = commandRule(requestedParserKey, command);
    const meta = SEMANTIC_META[rule.family] || SEMANTIC_META.other;
    const facts = rule.parser(raw, command) || {};

    return {
      command,
      parserKey: rule.parserKey || requestedParserKey || 'unknown',
      family: rule.family,
      label: meta.label,
      shortLabel: meta.shortLabel,
      importance: meta.importance,
      importanceRank: meta.importanceRank,
      reason: meta.reason,
      focus: [...meta.focus],
      facts,
      text,
      state: 'neutral',
      relation: 'context',
      diagnosticNote: ''
    };
  }

  function formatLinkSpeed(speedMbps) {
    if (!Number.isFinite(speedMbps)) return '';
    if (speedMbps >= 1000 && speedMbps % 1000 === 0) return `${speedMbps / 1000} Гбит/с`;
    return `${speedMbps} Мбит/с`;
  }

  function recentHistoryIsFrequent(facts = {}) {
    return Number(facts.events24h || 0) >= 2 || Number(facts.events7d || 0) >= 3;
  }

  function appendSummaryUnique(base = '', addition = '') {
    const parts = [];
    const seen = new Set();
    for (const raw of [base, addition]) {
      for (const part of String(raw || '').split(/\s*·\s*/)) {
        const value = normalizeSpace(part);
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(value);
      }
    }
    return parts.join(' · ');
  }

  function historySummary(facts = {}) {
    const parts = [];
    if (facts.currentOfflineDuration) parts.push(`OFFLINE ${facts.currentOfflineDuration}`);
    if (facts.currentOfflineSince) parts.push(`с ${formatEventTime(facts.currentOfflineSince)}`);
    if (Number(facts.events7d || 0) > 0) parts.push(`событий за 7 дней: ${facts.events7d}`);
    if (Number(facts.optical7d || 0) > 0) parts.push(`LOS/wire ×${facts.optical7d}`);
    if (Number(facts.power7d || 0) > 0) parts.push(`питание ×${facts.power7d}`);
    if (Number(facts.reset7d || 0) > 0) parts.push(`reboot ×${facts.reset7d}`);
    if (!parts.length && Number(facts.eventCount || 0) > 0) parts.push(`всего событий: ${facts.eventCount}`);
    return parts.join(' · ');
  }

  function summaryForAnalysis(analysis) {
    const facts = analysis?.facts || {};
    if (facts.unavailable && facts.unavailableReason === 'onu_offline') return 'недоступно · ONU offline';
    if (analysis?.family === 'ont_port_state') {
      const parts = [];
      if (facts.linkState) parts.push(`LINK ${facts.linkState.toUpperCase()}`);
      if (Number.isFinite(facts.speedMbps)) parts.push(formatLinkSpeed(facts.speedMbps));
      if (facts.duplex) parts.push(`${facts.duplex[0].toUpperCase()}${facts.duplex.slice(1)}-Duplex`);
      if (facts.linkState === 'up' && Number.isFinite(facts.speedMbps) && facts.speedMbps > 0 && facts.speedMbps <= 10) {
        parts.push('медленно');
      }
      return parts.join(' · ');
    }
    if (analysis?.family === 'ont_info') {
      const parts = [];
      if (facts.runState) parts.push(facts.runState.toUpperCase());
      if (facts.configState) parts.push(facts.configState);
      if (Number.isFinite(facts.distanceM)) parts.push(`${facts.distanceM} м`);
      if (facts.lastDownCause) parts.push(`last: ${facts.lastDownCause}`);
      if (facts.onlineDuration) parts.push(`up: ${facts.onlineDuration}`);
      if (Number(facts.optical7d || 0) > 0) parts.push(`LOS/wire ×${facts.optical7d}`);
      else if (Number(facts.events7d || 0) > 0) parts.push(`события 7д ×${facts.events7d}`);
      return parts.slice(0, 5).join(' · ');
    }
    if (analysis?.family === 'mac_address') {
      const macs = facts.macs?.length ? facts.macs : [facts.subscriberMac].filter(Boolean);
      const parts = [];
      if (macs.length === 1) parts.push('MAC ИЗУЧЕН', macs[0]);
      else if (macs.length > 1) parts.push(`ИЗУЧЕНО MAC ×${macs.length}`);
      if (Number.isFinite(facts.vlan)) parts.push(`VLAN ${facts.vlan}`);
      if (facts.macType) parts.push(facts.macType);
      if (!macs.length && facts.empty) parts.push('MAC НЕ ИЗУЧЕН');
      return parts.join(' · ');
    }
    if (analysis?.family === 'service_port') {
      return [Number.isFinite(facts.vlan) ? `VLAN ${facts.vlan}` : '', facts.state?.toUpperCase?.() || facts.state]
        .filter(Boolean).join(' · ');
    }
    if (analysis?.family === 'ont_traffic') {
      const parts = [];
      if (Number.isFinite(facts.upKbps)) parts.push(`↑ ${facts.upKbps} kbps`);
      if (Number.isFinite(facts.downKbps)) parts.push(`↓ ${facts.downKbps} kbps`);
      return parts.join(' · ');
    }
    if (analysis?.family === 'eth_statistics') {
      const errors = [facts.rxFcsErrors, facts.rxAlignmentErrors, facts.rxOversizeDiscards, facts.rxUndersizeDiscards, facts.txExcessiveCollisions]
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0);
      const parts = [];
      if (Number.isFinite(facts.receivedFrames)) parts.push(`RX ${facts.receivedFrames}`);
      if (Number.isFinite(facts.sentFrames)) parts.push(`TX ${facts.sentFrames}`);
      if (errors) parts.push(`ошибки ${errors}`);
      else if ([facts.rxFcsErrors, facts.rxAlignmentErrors].some(Number.isFinite)) parts.push('ошибки 0');
      return parts.join(' · ');
    }
    if (analysis?.family === 'optical') {
      const parts = [];
      if (Number.isFinite(facts.onuRxDbm)) parts.push(`ONU Rx ${facts.onuRxDbm} dBm`);
      if (Number.isFinite(facts.oltRxDbm)) parts.push(`OLT Rx ${facts.oltRxDbm} dBm`);
      if (Number.isFinite(facts.onuTxDbm)) parts.push(`Tx ${facts.onuTxDbm} dBm`);
      if (Number.isFinite(facts.temperatureC)) parts.push(`${facts.temperatureC}°C`);
      return parts.join(' · ');
    }
    if (analysis?.family === 'history') {
      const recent = historySummary(facts);
      return [recent, facts.latestReason ? `посл.: ${facts.latestReason}` : '']
        .filter(Boolean).join(' · ');
    }
    if (analysis?.family === 'optical_overview') {
      return Number.isFinite(facts.entryCount) ? `ONU на порту: ${facts.entryCount}` : 'сводка PON-порта';
    }
    return '';
  }

  function attentionForAnalysis(analysis) {
    const facts = analysis?.facts || {};
    if (facts.unavailable) return false;
    if (analysis?.family === 'ont_port_state') {
      // 10 Mbps on a live ONU UNI is abnormal (negotiation/cable/port issue).
      const slowLink = Number.isFinite(facts.speedMbps) && facts.speedMbps > 0 && facts.speedMbps <= 10;
      return facts.linkState === 'down' || facts.duplex === 'half' || (facts.linkState === 'up' && slowLink);
    }
    if (analysis?.family === 'ont_info') {
      return (facts.runState && facts.runState !== 'online')
        || (facts.configState && facts.configState !== 'normal')
        || (facts.matchState && facts.matchState !== 'match');
    }
    if (analysis?.family === 'service_port') return facts.state === 'down';
    if (analysis?.family === 'eth_statistics') {
      return [facts.rxFcsErrors, facts.rxAlignmentErrors, facts.rxOversizeDiscards, facts.rxUndersizeDiscards, facts.rxDiscards, facts.txExcessiveCollisions]
        .filter(Number.isFinite)
        .some(value => value > 0);
    }
    if (analysis?.family === 'history') {
      return Number(facts.optical7d || 0) > 0 || recentHistoryIsFrequent(facts);
    }
    return false;
  }


  function valueOfFact(node) {
    if (node === null || node === undefined) return '';
    if (typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, 'value')) return node.value;
    return node;
  }

  function terminalExpectations(caseData = WB.store?.activeCase?.() || {}) {
    return {
      subscriberMac: normalizeMac(
        valueOfFact(caseData?.network?.mac)
        || valueOfFact(caseData?.network?.routerMac)
        || ''
      ),
      onuMac: normalizeMac(valueOfFact(caseData?.pon?.onuMac) || ''),
      onuSerial: normalizeSerial(valueOfFact(caseData?.pon?.onuSerial) || ''),
      technology: String(valueOfFact(caseData?.pon?.pollType) || '').toLowerCase()
    };
  }

  function baseStateForAnalysis(analysis) {
    const facts = analysis?.facts || {};
    if (facts.unavailable && facts.unavailableReason === 'onu_offline') return 'neutral';
    if (attentionForAnalysis(analysis)) return 'attention';
    if (analysis?.family === 'ont_port_state' && facts.linkState === 'up') return 'normal';
    if (analysis?.family === 'ont_info' && facts.runState === 'online') return 'normal';
    if (analysis?.family === 'service_port' && facts.state === 'up') return 'normal';
    if (analysis?.family === 'eth_statistics') {
      const known = [facts.rxFcsErrors, facts.rxAlignmentErrors].some(Number.isFinite);
      if (known) return 'normal';
    }
    if (analysis?.family === 'optical' && [facts.onuRxDbm, facts.onuTxDbm, facts.oltRxDbm].some(Number.isFinite)) return 'normal';
    return 'neutral';
  }

  function baseRelationForAnalysis(analysis) {
    if (['ont_info', 'ont_port_state', 'mac_address', 'optical'].includes(analysis?.family)) {
      return 'primary';
    }
    return 'context';
  }

  function interpretAnalyses(input = [], expectations = {}) {
    const analyses = input.map(item => ({
      ...item,
      facts: { ...(item.facts || {}) },
      state: baseStateForAnalysis(item),
      relation: baseRelationForAnalysis(item),
      diagnosticNote: '',
      displaySummary: summaryForAnalysis(item)
    }));

    const expectedMac = normalizeMac(expectations.subscriberMac || '');
    const onuMac = normalizeMac(expectations.onuMac || '');
    const macBlocks = analyses.filter(item => item.family === 'mac_address');
    const ethBlocks = analyses.filter(item => item.family === 'ont_port_state');
    const currentStateBlocks = analyses.filter(item => item.family === 'ont_info' && item.facts?.runState);
    const currentOffline = currentStateBlocks.some(item => item.facts?.runState === 'offline')
      && !currentStateBlocks.some(item => item.facts?.runState === 'online');
    const currentOnline = currentStateBlocks.some(item => item.facts?.runState === 'online');
    // Client MACs only: drop ONU self-MAC and EPON system-VLAN (4093/4094) entries.
    const observedMacs = [...new Set(macBlocks.flatMap(item => {
      const system = new Set(
        (Array.isArray(item.facts?.systemMacs) ? item.facts.systemMacs : [])
          .map(normalizeMac)
          .filter(Boolean)
      );
      const raw = item.facts?.macs?.length
        ? item.facts.macs
        : [item.facts?.subscriberMac];
      return raw
        .map(normalizeMac)
        .filter(mac => mac && !system.has(mac) && !(onuMac && mac === onuMac));
    }).filter(Boolean))];
    const anyEthUp = ethBlocks.some(item => item.facts?.linkState === 'up');
    const anyEthDown = ethBlocks.some(item => item.facts?.linkState === 'down');
    // Flag slow UNI speed explicitly so LIVE does not show a green check on 10 Mbps.
    for (const item of ethBlocks) {
      const speed = Number(item.facts?.speedMbps);
      if (item.facts?.linkState === 'up' && Number.isFinite(speed) && speed > 0 && speed <= 10) {
        item.state = 'attention';
        item.relation = 'primary';
        item.diagnosticNote = `Ethernet UP, но скорость ${formatLinkSpeed(speed)} — это ненормально для рабочего порта.`;
        item.displaySummary = summaryForAnalysis(item);
      }
    }

    if (currentOffline) {
      const historyBlocks = analyses.filter(entry => Number(entry.facts?.eventCount || 0) > 0);
      const latestHistory = historyBlocks
        .filter(item => item.facts?.latestAtMs != null && Number.isFinite(Number(item.facts.latestAtMs)))
        .sort((left, right) => Number(right.facts.latestAtMs) - Number(left.facts.latestAtMs))[0] || null;
      const offlineSinceMs = Number(latestHistory?.facts?.latestAtMs);
      const offlineDuration = Number.isFinite(offlineSinceMs) && offlineSinceMs <= Date.now()
        ? formatElapsed(Date.now() - offlineSinceMs)
        : '';
      if (latestHistory && offlineDuration) {
        latestHistory.facts.currentOfflineSince = latestHistory.facts.latestAt;
        latestHistory.facts.currentOfflineDuration = offlineDuration;
        latestHistory.facts.currentOfflineDurationMs = Date.now() - offlineSinceMs;
        latestHistory.displaySummary = historySummary(latestHistory.facts);
        latestHistory.diagnosticNote = `ONU сейчас offline ${offlineDuration}. DownTime — время начала отключения, не длительность.`;
      }
      for (const item of currentStateBlocks.filter(entry => entry.facts?.runState === 'offline')) {
        item.state = 'attention';
        item.relation = 'primary';
        const reason = item.facts?.lastDownCause ? ` · ${item.facts.lastDownCause}` : '';
        item.diagnosticNote = `ONU offline${offlineDuration ? ` ${offlineDuration}` : ''}${reason}`;
        if (offlineDuration) {
          item.facts.currentOfflineDuration = offlineDuration;
          item.facts.currentOfflineSince = latestHistory?.facts?.latestAt || '';
          item.displaySummary = `OFFLINE ${offlineDuration}${reason}`;
        }
      }
      for (const item of analyses.filter(entry => ['optical', 'ont_port_state', 'eth_statistics', 'ont_traffic'].includes(entry.family))) {
        const hasCurrentFact = item.family === 'optical'
          ? [item.facts?.onuRxDbm, item.facts?.onuTxDbm, item.facts?.oltRxDbm].some(Number.isFinite)
          : item.family === 'ont_port_state'
            ? Boolean(item.facts?.linkState)
            : item.family === 'eth_statistics'
              ? [item.facts?.receivedFrames, item.facts?.sentFrames].some(Number.isFinite)
              : [item.facts?.upKbps, item.facts?.downKbps].some(Number.isFinite);
        if (item.facts?.unavailable || !hasCurrentFact) {
          item.state = 'neutral';
          item.relation = 'dependent';
          item.diagnosticNote = 'Команда зависит от online-состояния ONU; сейчас ONU offline.';
          item.displaySummary = 'недоступно · ONU offline';
        }
      }
      for (const item of macBlocks) {
        item.state = 'neutral';
        item.relation = 'context';
        item.diagnosticNote = observedMacs.length
          ? 'MAC есть в таблице, но ONU сейчас OFFLINE: это не подтверждение текущего Ethernet-линка.'
          : 'ONU сейчас OFFLINE; отсутствие MAC нельзя трактовать отдельно от статуса ONU.';
        if (observedMacs.length) item.displaySummary = `${observedMacs.length > 1 ? `MAC ×${observedMacs.length}` : observedMacs[0]} · сохранённый контекст`;
      }
    } else if (macBlocks.length && expectedMac) {
      if (!observedMacs.length) {
        const relation = anyEthDown
          ? 'MAC не найден · Ethernet DOWN'
          : anyEthUp
            ? 'Ethernet UP, но MAC не изучен'
            : 'ожидаемый MAC не найден';
        for (const item of macBlocks) {
          item.state = 'attention';
          item.relation = 'primary';
          item.diagnosticNote = relation;
          item.displaySummary = 'MAC НЕ ИЗУЧЕН';
        }
        for (const item of ethBlocks) {
          if (item.facts?.linkState === 'up' || item.facts?.linkState === 'down') {
            item.state = 'attention';
            item.relation = 'primary';
            item.diagnosticNote = relation;
          }
        }
      } else if (observedMacs.includes(expectedMac)) {
        for (const item of macBlocks) {
          item.state = item.state === 'attention' ? item.state : 'normal';
          item.relation = 'primary';
          item.diagnosticNote = 'MAC соответствует техническим данным';
          item.displaySummary = `${item.displaySummary || `MAC ИЗУЧЕН · ${expectedMac}`} · СОВПАДАЕТ`;
        }
      } else {
        const actual = observedMacs.join(', ');
        for (const item of macBlocks) {
          item.state = 'attention';
          item.relation = 'conflict';
          item.diagnosticNote = `ожидался ${expectedMac} · получен ${actual}`;
          item.displaySummary = `ДРУГОЙ MAC · ${actual}`;
        }
      }
    } else if (macBlocks.length) {
      for (const item of macBlocks) {
        item.relation = 'primary';
        if (!observedMacs.length) {
          item.state = 'attention';
          item.diagnosticNote = anyEthUp
            ? 'Ethernet LINK UP, но клиентский MAC не изучен.'
            : anyEthDown
              ? 'Ethernet LINK DOWN, клиентский MAC не изучен.'
              : 'Клиентский MAC не изучен; состояние Ethernet-порта нужно проверить рядом.';
          item.displaySummary = 'MAC НЕ ИЗУЧЕН';
        } else if (observedMacs.length === 1) {
          item.state = 'normal';
          item.diagnosticNote = 'Клиентский MAC изучен на ONU; MAC из технических данных не задан для автоматической сверки.';
        } else {
          item.state = 'attention';
          item.diagnosticNote = `за ONU видно несколько MAC: ${observedMacs.length}`;
        }
      }
    }

    if (!currentOffline) {
      for (const item of analyses.filter(entry => entry.family === 'ont_info')) {
        const state = item.facts?.runState;
        if (state && state !== 'online') {
          item.state = 'attention';
          item.relation = 'primary';
          const reason = item.facts?.lastDownCause ? ` · ${item.facts.lastDownCause}` : '';
          item.diagnosticNote = `ONU ${state}${reason}`;
        } else if (state === 'online' && item.state !== 'attention') {
          item.state = 'normal';
          item.relation = 'primary';
        }
      }
    }

    for (const item of analyses.filter(entry => entry.family === 'history')) {
      item.relation = 'context';
      if (item.facts?.currentOfflineDuration) {
        item.state = 'attention';
      } else if (Number(item.facts?.optical7d || 0) > 0) {
        item.state = 'attention';
        item.diagnosticNote = `За последние 7 дней есть оптические отключения: ${item.facts.optical7d}.`;
      } else if (recentHistoryIsFrequent(item.facts)) {
        item.state = 'attention';
        item.diagnosticNote = `Частые отключения/перезапуски: ${item.facts.events7d || item.facts.events24h} за последние 7 дней.`;
      } else if (Number(item.facts?.events7d || 0) > 0) {
        item.state = 'neutral';
        item.diagnosticNote = `За последние 7 дней событий: ${item.facts.events7d}. Это контекст, не текущая авария.`;
      }
    }

    for (const item of analyses.filter(entry => entry.family !== 'history' && Number(entry.facts?.eventCount || 0) > 0)) {
      if (Number(item.facts?.optical7d || 0) > 0) {
        item.state = 'attention';
        item.diagnosticNote = `В истории этого блока есть оптические отключения за 7 дней: ${item.facts.optical7d}.`;
      } else if (recentHistoryIsFrequent(item.facts)) {
        item.state = 'attention';
        item.diagnosticNote = `Частые отключения/перезапуски: ${item.facts.events7d || item.facts.events24h} за последние 7 дней.`;
      } else if (Number(item.facts?.events7d || 0) > 0 && !item.diagnosticNote) {
        item.diagnosticNote = `За последние 7 дней событий: ${item.facts.events7d}. Учитываем как историю, не как текущую аварию.`;
      }
      const recent = historySummary(item.facts);
      if (recent) {
        item.displaySummary = appendSummaryUnique(item.displaySummary, recent);
      }
    }

    for (const item of analyses.filter(entry => entry.family === 'service_port')) {
      item.relation = 'context';
      if (item.facts?.state === 'down') {
        item.state = 'attention';
        item.diagnosticNote = 'service-port DOWN';
      }
    }

    if (currentOnline) {
      for (const item of analyses.filter(entry => entry.family === 'optical' && entry.state === 'neutral')) {
        if ([item.facts?.onuRxDbm, item.facts?.onuTxDbm, item.facts?.oltRxDbm].some(Number.isFinite)) item.state = 'normal';
      }
    }

    return analyses;
  }

  function importanceCaption(importance) {
    if (importance === 'critical') return 'КЛЮЧЕВОЕ';
    if (importance === 'high') return 'ВАЖНО';
    if (importance === 'medium') return 'ДОП.';
    return 'СПРАВОЧНО';
  }

  function stateForAnalysis(analysis) {
    return analysis?.state || baseStateForAnalysis(analysis);
  }

  function relationForAnalysis(analysis) {
    return analysis?.relation || baseRelationForAnalysis(analysis);
  }

  function relationCaption(relation) {
    if (relation === 'primary') return 'ОСНОВНОЕ';
    if (relation === 'dependent') return 'ЗАВИСИТ ОТ ONU';
    if (relation === 'conflict') return 'КОНФЛИКТ';
    return 'КОНТЕКСТ';
  }

  function visualPriorityForAnalysis(analysis) {
    if (['mac_address', 'ont_port_state'].includes(analysis?.family)) return 'decisive';
    if (analysis?.family === 'history' || Number(analysis?.facts?.eventCount || 0) > 0) {
      return recentHistoryIsFrequent(analysis.facts) || Number(analysis.facts?.optical7d || 0) > 0
        ? 'diagnostic'
        : 'history';
    }
    if (['ont_info', 'optical'].includes(analysis?.family)) return 'support';
    return 'context';
  }

  function visualCaptionForAnalysis(analysis) {
    if (analysis?.family === 'mac_address') return 'КЛЮЧЕВОЕ 1/2 · MAC УСТРОЙСТВА';
    if (analysis?.family === 'ont_port_state') return 'КЛЮЧЕВОЕ 2/2 · ETHERNET-ПОРТ';
    if (analysis?.family === 'history') return 'ИСТОРИЯ ОТКЛЮЧЕНИЙ ONU';
    if (Number(analysis?.facts?.eventCount || 0) > 0) {
      return `${relationCaption(relationForAnalysis(analysis))} · СОСТОЯНИЕ И ИСТОРИЯ ONU`;
    }
    return `${relationCaption(relationForAnalysis(analysis))} · ${analysis.shortLabel || analysis.label}`;
  }

  function isPollPage() {
    const params = new URLSearchParams(location.search);
    return /\/stat\.pl$/i.test(location.pathname)
      && ['310', '311', '312', '313'].includes(params.get('a') || '');
  }

  function isBillingPollSurface() {
    if (isPollPage()) return true;
    return /(?:^|\.)admin\.(?:simnet|looknet)\.kiev\.ua$/i.test(location.hostname)
      && /\/stat\.pl$/i.test(location.pathname);
  }

  function analysisHasSubscriberResponse(analysis, rawText = '') {
    if (!analysis) return false;
    const facts = analysis.facts || {};
    const output = outputAfterCommand(String(rawText || ''));

    // A specific offline reply is still a valid response from the target ONU.
    if (facts.unavailableReason === 'onu_offline' || /Error:\s*The required ONT is offline/i.test(output)) {
      return true;
    }

    // Generic CLI/parser errors prove only that a command ran, not that this ONU answered.
    if (/(?:invalid\s+input|unknown\s+command|unrecognized\s+command|syntax\s+error|parameter\s+error|wrong\s+parameter|not\s+supported|failed\s+to\s+execute|no\s+such\s+(?:onu|ont)|onu\s+not\s+found|ont\s+not\s+found)/i.test(output)) {
      return false;
    }

    if (analysis.family === 'ont_info') {
      return Boolean(
        facts.runState
        || facts.onuMac
        || facts.onuSerial
        || facts.ontId
        || facts.fsp
        || Number.isFinite(facts.distanceM)
        || Number.isFinite(facts.eventCount) && facts.eventCount > 0
      );
    }
    if (analysis.family === 'ont_port_state') return Boolean(facts.linkState);
    if (analysis.family === 'mac_address') {
      return Boolean(
        facts.subscriberMac
        || (Array.isArray(facts.macs) && facts.macs.length > 0)
      );
    }
    if (analysis.family === 'optical') {
      return [facts.onuRxDbm, facts.onuTxDbm, facts.oltRxDbm, facts.temperatureC]
        .some(Number.isFinite);
    }
    if (analysis.family === 'service_port') {
      return Boolean(facts.state || Number.isFinite(facts.index) || Number.isFinite(facts.vlan));
    }
    if (analysis.family === 'ont_traffic') {
      return [facts.upKbps, facts.downKbps].some(Number.isFinite);
    }
    if (analysis.family === 'eth_statistics') {
      return [facts.receivedFrames, facts.sentFrames, facts.rxFcsErrors, facts.rxDiscards]
        .some(Number.isFinite);
    }
    if (analysis.family === 'history') {
      return Boolean(Number(facts.eventCount || 0) > 0 || facts.latestReason);
    }

    return RESULT_MARKERS.some(pattern => pattern.test(output));
  }

  function terminalResultPresent(root = document) {
    if (!isBillingPollSurface() || !root) return false;

    // Wrapped command blocks are not evidence by themselves. Inspect their parsed
    // OUTPUT facts so a page full of CLI errors cannot terminate the diagnostic route.
    const blocks = [...(root.querySelectorAll?.(`.${BLOCK_CLASS}`) || [])];
    if (blocks.some(block => {
      const commandNode = block.querySelector?.(':scope > b:first-child,:scope > strong:first-child');
      const raw = block.innerText || block.textContent || '';
      const analysis = analyzeCommandBlockText(
        raw,
        commandTextFromNode(commandNode),
        { parserKey: block.dataset?.simnetPollParser || parserKeyFromLocation() }
      );
      return analysisHasSubscriberResponse(analysis, raw);
    })) return true;

    const containers = [...(root.querySelectorAll?.(TERMINAL_SELECTOR) || [])];
    return containers.some(container => {
      const text = String(container.innerText || container.textContent || '');
      if (text.length < 24) return false;
      const output = outputAfterCommand(text);
      return RESULT_MARKERS.some(pattern => pattern.test(output));
    });
  }

  function enterPassiveResultView(root = document) {
    if (!document?.documentElement) return false;
    document.documentElement.dataset.simnetTerminalResultView = 'true';
    // Terminal interpretation announces evidence only. The workflow decides whether that
    // evidence belongs to the expected poll type before it closes any active hint.
    // This prevents a wrong GPON/EPON tab from corrupting the current route.
    WB.bus?.emit?.('terminal:result-view', {
      active: true,
      url: location.href,
      blocks: root?.querySelectorAll?.(`.${BLOCK_CLASS}`)?.length || 0
    });
    return true;
  }

  function leavePassiveResultView() {
    if (!document?.documentElement) return;
    delete document.documentElement.dataset.simnetTerminalResultView;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BLOCK_CLASS}{
        position:relative;
        display:block;
        margin:8px 0 10px;
        padding:31px 11px 8px 13px;
        border:1px solid rgba(15,23,42,.16);
        border-left:3px solid rgba(15,23,42,.34);
        border-radius:6px;
        background:rgba(248,250,252,.74);
        box-sizing:border-box;
        transition:background .14s ease, box-shadow .14s ease, border-color .14s ease, transform .14s ease;
      }
      .${BLOCK_CLASS}::before{
        content:attr(data-simnet-caption);
        position:absolute;
        top:7px;
        left:11px;
        max-width:45%;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font:800 10px/1.25 Arial,sans-serif;
        letter-spacing:.04em;
        color:rgba(15,23,42,.68);
        pointer-events:none;
      }
      .${BLOCK_CLASS}::after{
        content:attr(data-simnet-summary);
        position:absolute;
        top:4px;
        right:7px;
        max-width:52%;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        padding:3px 7px;
        border:1px solid rgba(15,23,42,.12);
        border-radius:999px;
        background:rgba(255,255,255,.86);
        font:800 10px/1.25 Arial,sans-serif;
        color:rgba(15,23,42,.82);
        pointer-events:none;
      }
      .${BLOCK_CLASS}[data-simnet-summary=""]::after{display:none}
      .${BLOCK_CLASS}[data-simnet-importance="critical"]{border-left-width:4px}
      .${BLOCK_CLASS}[data-simnet-importance="high"]{border-left-width:3px}
      .${BLOCK_CLASS}[data-simnet-importance="reference"]{border-left-width:1px;background:rgba(248,250,252,.38)}
      .${BLOCK_CLASS}[data-simnet-state="normal"]::after{
        content:"✓ " attr(data-simnet-summary);
        border-color:rgba(5,150,105,.25);
        color:#047857;
        background:rgba(236,253,245,.96)
      }
      .${BLOCK_CLASS}[data-simnet-state="attention"]::after{
        content:"! " attr(data-simnet-summary);
        border-color:rgba(217,119,6,.32);
        color:#92400e;
        background:rgba(255,251,235,.98)
      }
      .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"]{
        margin:11px 0 12px;
        padding:35px 13px 10px 15px;
        border-width:1px;
        border-left-width:6px;
        border-color:rgba(37,99,235,.34);
        border-left-color:#2563eb;
        background:linear-gradient(100deg,rgba(219,234,254,.72),rgba(248,250,252,.92) 62%);
        box-shadow:0 2px 8px rgba(15,23,42,.10)
      }
      .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"]::before{top:8px;font-size:11px;color:#1e3a8a}
      .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"]::after{top:5px;right:8px;font-size:11px}
      .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"][data-simnet-state="normal"]{
        border-color:rgba(5,150,105,.40);
        border-left-color:#059669;
        background:linear-gradient(100deg,rgba(209,250,229,.76),rgba(248,250,252,.94) 64%);
        box-shadow:0 2px 9px rgba(5,150,105,.14)
      }
      .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"][data-simnet-state="attention"]{
        border-color:rgba(217,119,6,.50);
        border-left-color:#d97706;
        background:linear-gradient(100deg,rgba(254,243,199,.88),rgba(255,251,235,.95) 66%);
        box-shadow:0 2px 10px rgba(217,119,6,.16)
      }
      .${BLOCK_CLASS}[data-simnet-visual-priority="diagnostic"]{
        border-left-width:5px;
        border-color:rgba(217,119,6,.34);
        border-left-color:#d97706;
        background:linear-gradient(100deg,rgba(254,243,199,.68),rgba(255,255,255,.90) 68%);
        box-shadow:0 2px 8px rgba(217,119,6,.11)
      }
      .${BLOCK_CLASS}[data-simnet-visual-priority="history"]{border-left-color:#a16207;background:rgba(254,252,232,.52)}
      .${BLOCK_CLASS}[data-simnet-relation="primary"]{border-left-style:solid}
      .${BLOCK_CLASS}[data-simnet-relation="dependent"]{border-left-style:dashed;border-left-width:2px;border-left-color:rgba(0,0,0,.28);background:rgba(0,0,0,.015);opacity:.78}
      .${BLOCK_CLASS}[data-simnet-relation="context"]:not([data-simnet-visual-priority="diagnostic"]):not([data-simnet-visual-priority="history"]):not([data-simnet-visual-priority="decisive"]){border-left-width:1px;border-left-color:rgba(0,0,0,.22);background:rgba(0,0,0,.008)}
      .${BLOCK_CLASS}[data-simnet-relation="conflict"]{border-width:1px;border-left-width:6px;border-color:rgba(220,38,38,.48);border-left-color:#dc2626;background:rgba(254,226,226,.82);box-shadow:0 2px 10px rgba(220,38,38,.15)}
      .${BLOCK_CLASS}[data-simnet-relation="conflict"]::after{content:"! " attr(data-simnet-summary);border-color:rgba(220,38,38,.32);color:#991b1b;background:rgba(254,242,242,.98)}
      .${BLOCK_CLASS}:hover{background:rgba(0,0,0,.070);box-shadow:inset 0 0 0 1px rgba(0,0,0,.12),0 1px 4px rgba(0,0,0,.07)}
      .${BLOCK_CLASS} > b:first-child,.${BLOCK_CLASS} > strong:first-child{display:inline-block;padding-bottom:2px;border-bottom:1px solid rgba(0,0,0,.22)}
      @media (prefers-color-scheme: dark){
        .${BLOCK_CLASS}{border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.025)}
        .${BLOCK_CLASS}::before{color:rgba(255,255,255,.62)}
        .${BLOCK_CLASS}::after{border-color:rgba(255,255,255,.18);color:rgba(255,255,255,.88);background:rgba(15,23,42,.92)}
        .${BLOCK_CLASS}[data-simnet-state="normal"]::after{border-color:rgba(52,211,153,.35);color:#a7f3d0;background:rgba(6,78,59,.92)}
        .${BLOCK_CLASS}[data-simnet-state="attention"]::after{border-color:rgba(251,191,36,.4);color:#fde68a;background:rgba(120,53,15,.94)}
        .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"]{border-color:rgba(96,165,250,.45);border-left-color:#60a5fa;background:linear-gradient(100deg,rgba(30,64,175,.34),rgba(15,23,42,.75) 65%)}
        .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"]::before{color:#bfdbfe}
        .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"][data-simnet-state="normal"]{border-color:rgba(52,211,153,.48);border-left-color:#34d399;background:linear-gradient(100deg,rgba(6,95,70,.38),rgba(15,23,42,.78) 65%)}
        .${BLOCK_CLASS}[data-simnet-visual-priority="decisive"][data-simnet-state="attention"]{border-color:rgba(251,191,36,.52);border-left-color:#fbbf24;background:linear-gradient(100deg,rgba(120,53,15,.46),rgba(15,23,42,.80) 66%)}
        .${BLOCK_CLASS}[data-simnet-visual-priority="diagnostic"]{border-color:rgba(251,191,36,.42);border-left-color:#fbbf24;background:linear-gradient(100deg,rgba(120,53,15,.38),rgba(15,23,42,.76) 68%)}
        .${BLOCK_CLASS}[data-simnet-visual-priority="history"]{border-left-color:#facc15;background:rgba(113,63,18,.20)}
        .${BLOCK_CLASS}[data-simnet-relation="dependent"]{border-left-color:rgba(255,255,255,.34);background:rgba(255,255,255,.022)}
        .${BLOCK_CLASS}[data-simnet-relation="context"]:not([data-simnet-visual-priority="diagnostic"]):not([data-simnet-visual-priority="history"]):not([data-simnet-visual-priority="decisive"]){border-left-color:rgba(255,255,255,.28);background:rgba(255,255,255,.012)}
        .${BLOCK_CLASS}[data-simnet-relation="conflict"]{border-color:rgba(248,113,113,.56);border-left-color:#f87171;background:rgba(127,29,29,.43)}
        .${BLOCK_CLASS}[data-simnet-relation="conflict"]::after{border-color:rgba(248,113,113,.45);color:#fecaca;background:rgba(127,29,29,.96)}
        .${BLOCK_CLASS}:hover{background:rgba(255,255,255,.12)}
      }
    `;
    document.documentElement.appendChild(style);
  }

  function annotateBlock(wrapper, analysis) {
    wrapper.classList.add(BLOCK_CLASS);
    wrapper.dataset.simnetCommand = analysis.command;
    wrapper.dataset.simnetPollParser = analysis.parserKey || 'unknown';
    wrapper.dataset.simnetFamily = analysis.family;
    wrapper.dataset.simnetImportance = analysis.importance;
    wrapper.dataset.simnetRelation = relationForAnalysis(analysis);
    wrapper.dataset.simnetVisualPriority = visualPriorityForAnalysis(analysis);
    wrapper.dataset.simnetCaption = visualCaptionForAnalysis(analysis);
    wrapper.dataset.simnetSummary = analysis.displaySummary ?? summaryForAnalysis(analysis);
    wrapper.dataset.simnetAttention = ['attention', 'conflict'].includes(stateForAnalysis(analysis)) ? 'true' : 'false';
    wrapper.dataset.simnetState = stateForAnalysis(analysis);
    wrapper.dataset.simnetFocus = analysis.focus.join(' · ');
    wrapper.dataset.simnetReason = analysis.reason;
    wrapper.dataset.simnetDiagnosticNote = analysis.diagnosticNote || '';
    wrapper.title = [
      analysis.label,
      analysis.reason,
      analysis.diagnosticNote ? `Сейчас: ${analysis.diagnosticNote}` : '',
      analysis.focus.length ? `Смотри: ${analysis.focus.join(', ')}` : ''
    ].filter(Boolean).join('\n');
    if (!wrapper.id) {
      wrapper.id = `simnet-poll-${analysis.family}-${simpleHash(analysis.command).slice(0, 8)}`;
    }
  }

  function directCommandStarts(container) {
    return [...container.childNodes].filter(node => (
      node?.nodeType === 1
      && /^(B|STRONG)$/i.test(node.nodeName)
      && looksLikeCommand(commandTextFromNode(node))
    ));
  }

  function directCommandSegments(container) {
    const childSnapshot = [...container.childNodes];
    const starts = directCommandStarts(container);
    const startSet = new Set(starts);

    return starts.map(start => {
      const startIndex = childSnapshot.indexOf(start);
      const nodes = [];

      for (let index = startIndex; index < childSnapshot.length; index += 1) {
        const node = childSnapshot[index];
        if (index > startIndex && startSet.has(node)) break;
        if (index > startIndex && node?.nodeType === 1 && /^HR$/i.test(node.nodeName)) break;
        nodes.push(node);
      }

      return { commandNode: start, nodes };
    }).filter(segment => segment.nodes.length);
  }

  function wrapDirectCommands(container) {
    if (!container?.isConnected) return 0;
    const segments = directCommandSegments(container);
    if (!segments.length) return 0;

    let created = 0;

    for (const segment of segments) {
      const nodes = segment.nodes
        .filter(node => node?.parentNode === container);
      if (!nodes.length) continue;

      const commandNode = segment.commandNode;
      if (
        commandNode?.parentNode !== container
        || !commandNode.isConnected
      ) continue;
      const command = commandTextFromNode(commandNode);
      const analysis = analyzeCommandBlockText(textOfNodes(nodes), command, { parserKey: parserKeyFromLocation() });
      const wrapper = document.createElement('div');
      annotateBlock(wrapper, analysis);
      try {
        container.insertBefore(wrapper, commandNode);
        nodes.forEach(node => {
          if (node?.parentNode === container) wrapper.appendChild(node);
        });
        if (wrapper.contains(commandNode)) {
          created += 1;
        } else {
          wrapper.remove();
        }
      } catch (error) {
        wrapper.remove();
      }
    }

    return created;
  }

  function annotateExistingBlocks(root = document) {
    let count = 0;
    for (const block of root.querySelectorAll?.(`.${BLOCK_CLASS}`) || []) {
      const commandNode = block.querySelector(':scope > b:first-child,:scope > strong:first-child');
      const command = commandTextFromNode(commandNode);
      if (!command) continue;
      annotateBlock(block, analyzeCommandBlockText(block.textContent || '', command, { parserKey: block.dataset.simnetPollParser || parserKeyFromLocation() }));
      count += 1;
    }
    return count;
  }


  function applyInterpretation(root = document, caseData = WB.store?.activeCase?.() || {}) {
    const blocks = [...(root.querySelectorAll?.(`.${BLOCK_CLASS}`) || [])];
    if (!blocks.length) return [];
    const analyses = blocks.map(block => {
      const commandNode = block.querySelector(':scope > b:first-child,:scope > strong:first-child');
      return analyzeCommandBlockText(
        block.innerText || block.textContent || '',
        commandTextFromNode(commandNode),
        { parserKey: block.dataset.simnetPollParser || parserKeyFromLocation() }
      );
    });
    const interpreted = interpretAnalyses(analyses, terminalExpectations(caseData));
    interpreted.forEach((analysis, index) => annotateBlock(blocks[index], analysis));
    return interpreted;
  }

  function scan(root = document) {
    if (!root || !document?.documentElement) return { created: 0, total: 0 };
    if (!isBillingPollSurface()) {
      leavePassiveResultView();
      return { created: 0, total: 0 };
    }

    // Detect output before wrapping anything so stale presentation cannot obscure the result.
    // as the equipment response lands, even if the markup shape is unfamiliar.
    const hadResultBeforeMarkup = terminalResultPresent(root);
    if (hadResultBeforeMarkup) {
      enterPassiveResultView(root);
    }

    ensureStyle();
    annotateExistingBlocks(root);

    let created = 0;
    const containers = [...root.querySelectorAll(TERMINAL_SELECTOR)]
      .filter(container => !container.closest?.(`.${BLOCK_CLASS}`));

    for (const container of containers) {
      try {
        created += wrapDirectCommands(container);
      } catch (error) {
        // One legacy fragment must not abort the result-view handoff or prevent
        // the remaining terminal containers from being interpreted.
      }
    }

    const total = root.querySelectorAll(`.${BLOCK_CLASS}`).length;
    const interpreted = total > 0 ? applyInterpretation(root) : [];

    if (total > 0 || hadResultBeforeMarkup || terminalResultPresent(root)) {
      enterPassiveResultView(root);
      if (interpreted.length) {
        WB.bus?.emit?.('terminal:interpreted', {
          parserKey: parserKeyFromLocation(),
          blocks: interpreted.map(item => ({
            family: item.family,
            label: item.label,
            state: item.state,
            relation: item.relation,
            visualPriority: visualPriorityForAnalysis(item),
            summary: item.displaySummary || '',
            diagnosticNote: item.diagnosticNote || ''
          }))
        });
      }
    } else {
      leavePassiveResultView();
    }

    return { created, total, passive: terminalResultPresent(root), parserKey: parserKeyFromLocation(), interpreted };
  }

  function snapshot(root = document) {
    const blocks = [...(root.querySelectorAll?.(`.${BLOCK_CLASS}`) || [])];
    const analyses = blocks.map(block => {
      const commandNode = block.querySelector(':scope > b:first-child,:scope > strong:first-child');
      return analyzeCommandBlockText(
        block.innerText || block.textContent || '',
        commandTextFromNode(commandNode),
        { parserKey: block.dataset.simnetPollParser || parserKeyFromLocation() }
      );
    });
    return interpretAnalyses(analyses, terminalExpectations()).map((analysis, index) => {
      const raw = blocks[index]?.innerText || blocks[index]?.textContent || '';
      return {
        id: blocks[index]?.id || '',
        parserKey: analysis.parserKey,
        command: analysis.command,
        family: analysis.family,
        label: analysis.label,
        importance: analysis.importance,
        importanceRank: analysis.importanceRank,
        reason: analysis.reason,
        focus: analysis.focus,
        facts: analysis.facts,
        state: analysis.state,
        relation: analysis.relation,
        responseEvidence: analysisHasSubscriberResponse(analysis, raw),
        visualPriority: visualPriorityForAnalysis(analysis),
        summary: analysis.displaySummary || '',
        diagnosticNote: analysis.diagnosticNote || ''
      };
    });
  }

  WB.pollTerminal = {
    scan,
    snapshot,
    hasResult: terminalResultPresent,
    hasSuccessfulAnalysis: analysisHasSubscriberResponse,
    enterPassiveResultView,
    analyzeCommandBlockText,
    interpretAnalyses,
    terminalExpectations,
    parserKeyFromAction,
    normalizeMac,
    normalizeSerial,
    parseDateish,
    formatElapsed,
    historySummary,
    appendSummaryUnique
    };
})();
