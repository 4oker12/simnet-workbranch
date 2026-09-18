'use strict';

const USERSIDE_TAB_URLS = Object.freeze(['https://userside.simnet.kiev.ua/*']);

function clean(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function normalizeIp(value) {
  const match = clean(value, 120).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (!match) return '';
  const parts = match[0].split('.').map(Number);
  return parts.every(part => part >= 0 && part <= 255) ? match[0] : '';
}

function normalizeCustomerId(value) {
  const source = String(value == null ? '' : value).trim();
  return /^\d{1,12}$/.test(source) ? source : '';
}

export function classifyUserSideLookup(toolArgs = {}) {
  const customerId = normalizeCustomerId(toolArgs.customerId);
  const login = clean(toolArgs.login, 80).replace(/\s+/g, '').toLowerCase();
  const contract = clean(toolArgs.contract, 80).replace(/\D/g, '');
  const ip = normalizeIp(toolArgs.ip);
  const address = clean(toolArgs.address, 320);
  const query = clean(toolArgs.query, 320);

  if (customerId) return { mode: 'customerId', value: customerId };
  if (/^abon\d{3,12}$/i.test(login)) return { mode: 'login', value: login };
  if (contract) return { mode: 'contract', value: contract };
  if (ip) return { mode: 'ip', value: ip };
  if (address) return { mode: 'address', value: address };

  const compactQuery = query.replace(/\s+/g, '');
  if (/^abon\d{3,12}$/i.test(compactQuery)) return { mode: 'login', value: compactQuery.toLowerCase() };
  if (/^\d{3,12}$/.test(compactQuery)) return { mode: 'contract', value: compactQuery };
  const queryIp = normalizeIp(query);
  if (queryIp) return { mode: 'ip', value: queryIp };
  if (query) return { mode: 'query', value: query };
  return null;
}

function rankUserSideTabs(tabs = []) {
  return [...tabs].sort((a, b) => {
    const activeDelta = Number(Boolean(b?.active)) - Number(Boolean(a?.active));
    if (activeDelta) return activeDelta;
    return Number(b?.lastAccessed || 0) - Number(a?.lastAccessed || 0);
  });
}

async function userSideTabs() {
  if (!globalThis.chrome?.tabs?.query) return [];
  return rankUserSideTabs(await chrome.tabs.query({ url: [...USERSIDE_TAB_URLS] }));
}

async function executeSearch(tabId, request) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [request],
    func: async lookupRequest => {
      if (location.hostname !== 'userside.simnet.kiev.ua') return { ok: false, code: 'USERSIDE_TAB_INVALID' };

      const compact = (value, max = 500) => {
        const normalized = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
      };
      const normalize = value => compact(value, 500)
        .toLowerCase()
        .replace(/[.,;:()№#'"`]/g, ' ')
        .replace(/\b(?:м\.?|місто|город|с\.?|село|вул\.?|улица|ул\.?|просп\.?|проспект|пров\.?|переулок|буд\.?|будинок|дом|д\.?|кв\.?|квартира)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const validIp = value => {
        const candidate = String(value || '').match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
        if (!candidate) return '';
        return candidate.split('.').every(part => Number(part) >= 0 && Number(part) <= 255) ? candidate : '';
      };
      const normalizeMac = value => {
        const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
        return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
      };
      const normalizeSerial = value => String(value || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
      const parseUrl = raw => { try { return new URL(raw, location.origin); } catch { return null; } };
      const authPage = doc => Boolean(doc.querySelector('input[type="password"], form[action*="login" i]'));
      const fetchDoc = async url => {
        const response = await fetch(url.href, { method: 'GET', credentials: 'include', cache: 'no-store' });
        const html = await response.text();
        return { ok: response.ok, status: response.status, url: new URL(response.url || url.href), doc: new DOMParser().parseFromString(html, 'text/html') };
      };
      const labeledValue = (doc, patterns) => {
        for (const row of doc.querySelectorAll('tr,.item,.erp-object-props__row,.erp_object_props__row')) {
          const labelNode = row.querySelector('.erp-object-props__label-main,.left_data,th,td:first-child,.label');
          const label = compact(labelNode?.textContent || '', 220).toLowerCase();
          if (!label || !patterns.some(pattern => pattern.test(label))) continue;
          const valueNode = row.querySelector('.erp-object-props__value,.right_data,td:last-child,.value');
          const value = compact(valueNode?.textContent || '', 500);
          if (value) return value;
        }
        return '';
      };
      const customerIdFromHref = href => String(parseUrl(href)?.pathname || '').match(/^\/customer\/(\d+)(?:\/|$)/i)?.[1] || '';
      const customerLinks = doc => {
        const map = new Map();
        for (const anchor of doc.querySelectorAll('a[href*="/customer/"]')) {
          const id = customerIdFromHref(anchor.getAttribute('href') || anchor.href || '');
          if (!id) continue;
          const scope = anchor.closest('tr,.item,.search-result,.autocomplete-suggestion,li,div') || anchor;
          const rowText = compact(scope.innerText || scope.textContent || anchor.textContent || '', 1600);
          if (!map.has(id) || rowText.length > map.get(id).text.length) map.set(id, { customerId: id, text: rowText });
        }
        return [...map.values()];
      };
      const scoreCandidate = candidate => {
        const sought = String(lookupRequest.value || '');
        const text = String(candidate.text || '');
        const normalizedText = normalize(text);
        if (lookupRequest.mode === 'login') return new RegExp(`\\b${sought.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text) ? 200 : 0;
        if (lookupRequest.mode === 'contract') return new RegExp(`(?:^|\\D)${sought}(?:\\D|$)`).test(text) ? 180 : 0;
        if (lookupRequest.mode === 'ip') return text.includes(sought) ? 190 : 0;
        if (lookupRequest.mode === 'address' || lookupRequest.mode === 'query') {
          const wanted = normalize(sought);
          if (!wanted) return 0;
          if (normalizedText.includes(wanted)) return 150;
          const tokens = wanted.split(' ').filter(token => token.length >= 2);
          const matched = tokens.filter(token => normalizedText.includes(token)).length;
          return tokens.length && matched / tokens.length >= 0.7 ? 80 + matched : 0;
        }
        return 0;
      };
      const valueAfter = (text, labelPattern, valuePattern) => String(text || '').match(new RegExp(`(?:^|\\s)(?:${labelPattern})\\s*[:#№-]?\\s*(${valuePattern})`, 'i'))?.[1] || '';
      const opticalValue = (text, owner, direction) => {
        const value = String(text || '').match(new RegExp(`\\b${owner}\\s*${direction}(?:\\s*(?:power|signal))?\\s*(?:\\(dBm\\))?\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)`, 'i'))?.[1] || '';
        return value ? value.replace(',', '.') : '';
      };
      const parseTmc = doc => {
        const anchor = doc.querySelector('#ref_inventory');
        const headerSelector = '.label_h3_hr,.erp_object_subtitle,.erp_object_subtitle--rule';
        const header = anchor?.closest?.(headerSelector) || anchor?.parentElement || null;
        let block = null;
        let sibling = header?.nextElementSibling || null;
        let steps = 0;
        while (sibling && steps < 8) {
          if (steps > 0 && sibling.matches?.(headerSelector)) break;
          if (sibling.matches?.('.slider_content_double') || sibling.querySelector?.('tbody tr')) { block = sibling.matches?.('.slider_content_double') ? sibling : (sibling.querySelector?.('.slider_content_double') || sibling); break; }
          sibling = sibling.nextElementSibling;
          steps += 1;
        }
        const rows = block ? [...block.querySelectorAll('tbody tr')] : [];
        const row = rows.find(item => [...(item.cells || [])].some(cell => compact(cell.textContent, 80).toUpperCase() === 'PON')) || null;
        if (!row) return { checked: Boolean(anchor && header && block), found: false };
        const cells = [...row.cells];
        const categoryIndex = cells.findIndex(cell => compact(cell.textContent, 80).toUpperCase() === 'PON');
        const equipmentCell = cells[categoryIndex + 1] || null;
        const detailsCell = cells.slice(categoryIndex + 2).find(cell => /(?:S\/?N|Serial|MAC\s*:|найдено|знайдено|Interface|ONU\s+Rx|OLT\s+Rx)/i.test(cell.textContent || '') || cell.querySelector('a[href*="/device/"]')) || cells[categoryIndex + 2] || null;
        const equipmentText = compact(equipmentCell?.innerText || equipmentCell?.textContent || '', 3000);
        const detailsText = compact(detailsCell?.innerText || detailsCell?.textContent || '', 6000);
        const combined = `${equipmentText} ${detailsText}`;
        const serial = normalizeSerial(valueAfter(combined, 's\\/?n|sn|serial(?:\\s+number)?|серийн(?:ый|ого)?(?:\\s+номер)?|серійн(?:ий|ого)?(?:\\s+номер)?', '[A-Z0-9][A-Z0-9:._-]{5,63}'));
        const mac = normalizeMac(valueAfter(combined, 'onu\\s+mac|mac(?:[-\\s]?адрес)?', '(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}|[0-9A-F]{4}(?:\\.[0-9A-F]{4}){2}|[0-9A-F]{12}') || combined.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)?.[0] || '');
        const links = [...(detailsCell?.querySelectorAll('a[href*="/device/"]') || [])];
        const oltLink = links.find(link => /\/device\/\d+\/?(?:$|[?#])/i.test(String(link.getAttribute('href') || link.href || '')) && !/история|історія|history/i.test(link.textContent || '')) || null;
        const oltDeviceId = String(oltLink?.getAttribute('href') || oltLink?.href || '').match(/\/device\/(\d+)/i)?.[1] || '';
        const phraseFound = /(?:найдено|знайдено)\s+на\s+OLT\s*:/i.test(detailsText);
        const oltName = compact(oltLink?.textContent || detailsText.match(/(?:найдено|знайдено)\s+на\s+OLT\s*:?\s*(?:\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*)?(.+?)(?=\s+IP\s*:|\s+Interface\s*:|\s+ONU\s+Rx|\s+ONU\s+Tx|\s+OLT\s+Rx|$)/i)?.[1] || '', 260);
        const oltIp = validIp(valueAfter(detailsText, 'olt\\s+ip|ip', '(?:\\d{1,3}\\.){3}\\d{1,3}') || detailsText);
        const iface = compact(detailsText.match(/\bInterface\s*:\s*(.+?)(?=\s+(?:Расстояние|Distance|ONU\s+Rx|ONU\s+Tx|OLT\s+Rx|MAC|S\/?N|Serial)\s*[:=]?|$)/i)?.[1] || '', 160);
        const equipmentName = compact((equipmentText.split(/\n+/).map(item => compact(item, 260)).filter(Boolean).find(item => !/^(?:s\/?n|sn|serial|mac|ip|interface|onu\s+(?:rx|tx)|olt\s+rx)\b/i.test(item))) || '', 260);
        return { checked: true, found: true, equipmentName, onuSerial: serial, onuMac: mac, foundOnOlt: Boolean(phraseFound && (oltName || oltDeviceId || oltIp)), oltName, oltIp, oltDeviceId, port: iface, interface: iface, onuRx: opticalValue(detailsText, 'ONU', 'Rx'), onuTx: opticalValue(detailsText, 'ONU', 'Tx'), oltRx: opticalValue(detailsText, 'OLT', 'Rx') };
      };
      const parseConnectionPoint = doc => {
        const block = [...doc.querySelectorAll('.item')].find(item => /^(?:точка\s+подключения|точка\s+підключення)\s*:?$/i.test(compact(item.querySelector('.left_data')?.textContent || '', 120))) || null;
        if (!block) return {};
        const deviceLink = [...block.querySelectorAll('a[href*="/device/"]')].find(anchor => /\/device\/\d+\/?$/i.test(parseUrl(anchor.href)?.pathname || '')) || null;
        const deviceId = parseUrl(deviceLink?.href || '')?.pathname.match(/\/device\/(\d+)/i)?.[1] || '';
        const text = compact(block.innerText || block.textContent || '', 3000);
        const portMatch = text.match(/(?:порт|port)\s*:\s*(\d+)(?:\s*\(([^)]+)\))?/i);
        const port = String(portMatch?.[1] || '');
        const portRow = (deviceId && port ? block.querySelector(`#divIfaceRow${deviceId}_${port}`) : null) || block.querySelector('.ifaceRow-ethernetCsmacd') || null;
        const portText = compact(portRow?.innerText || portRow?.textContent || '', 1800);
        const interfaceName = compact(portMatch?.[2] || portText.match(/(?:Name|Имя|Назва)\s*:\s*([^\s]+)/i)?.[1] || '', 120);
        const deviceName = compact(text.match(/(?:Оборудование|Обладнання)\s+(.+?)\s+IP\s*:/i)?.[1] || deviceLink?.textContent || '', 240);
        const deviceIp = validIp(text.match(/\bIP\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i)?.[1] || '');
        const linkState = portText.match(/\b(up|down)\b/i)?.[1]?.toLowerCase() || '';
        const speedMbps = portText.match(/\b(?:up|down)\s+(\d{2,5})\b/i)?.[1] || '';
        const ponIdentity = /(?:\bolt\b|\bonu\b|\bont\b|\bepon\b|\bgpon\b|\bxpon\b|huawei\s+ma\d{3,5}|\bgcom\b)/i.test(`${deviceName} ${interfaceName}`);
        const ethernetPort = /ethernetCsmacd/i.test(String(portRow?.className || '')) || /^(?:slot\d+\/)?\d+$/i.test(interfaceName) || /^(?:eth|ethernet|fa|gi|ge)\S*/i.test(interfaceName);
        return { deviceId, deviceName, deviceIp, port, interface: interfaceName, linkState, speedMbps, isEthernet: Boolean(deviceId && port && ethernetPort && !ponIdentity) };
      };
      const parseCustomer = (doc, customerId, pageUrl) => {
        const bodyText = compact(doc.body?.innerText || doc.body?.textContent || '', 16000);
        const login = bodyText.match(/\b(abon\d{3,12})\b/i)?.[1]?.toLowerCase() || '';
        const contractText = labeledValue(doc, [/договор/i, /договір/i, /лицев.*счет/i, /особов.*рах/i]);
        const contract = contractText.match(/\b(\d{3,12})\b/)?.[1] || '';
        const fullName = labeledValue(doc, [/фио/i, /піб/i, /ф\.и\.о/i, /абонент/i]);
        const address = labeledValue(doc, [/адрес/i, /адреса/i, /точк.*подключ/i, /точк.*підключ/i]);
        let ip = '';
        for (const anchor of doc.querySelectorAll('a[href*="reload_ping_data"][href*="ip="]')) {
          const candidate = validIp(parseUrl(anchor.href)?.searchParams.get('ip') || '');
          if (candidate) { ip = candidate; break; }
        }
        const macs = [];
        for (const anchor of doc.querySelectorAll('a[href*="find_typer=machistory"][href*="search="]')) {
          const mac = normalizeMac(parseUrl(anchor.href)?.searchParams.get('search') || '');
          if (mac && !macs.includes(mac)) macs.push(mac);
        }
        const connection = parseConnectionPoint(doc);
        const tmc = parseTmc(doc);
        return {
          customerId: String(customerId || ''),
          identity: { customerId: String(customerId || ''), contract, login, fullName },
          address: { full: address },
          network: {
            ip,
            macs,
            connectionFamily: connection.isEthernet ? 'Ethernet' : (tmc.found ? 'PON' : ''),
            accessDeviceId: connection.isEthernet ? connection.deviceId : '',
            accessDeviceName: connection.isEthernet ? connection.deviceName : '',
            accessDeviceIp: connection.isEthernet ? connection.deviceIp : '',
            accessPort: connection.isEthernet ? connection.port : '',
            accessInterface: connection.isEthernet ? connection.interface : '',
            accessLinkState: connection.isEthernet ? connection.linkState : '',
            accessSpeedMbps: connection.isEthernet ? connection.speedMbps : ''
          },
          pon: {
            onuDeviceId: !connection.isEthernet ? connection.deviceId || '' : '',
            onuDeviceName: !connection.isEthernet ? connection.deviceName || '' : '',
            onuDeviceIp: !connection.isEthernet ? connection.deviceIp || '' : '',
            onuLanPort: !connection.isEthernet ? connection.port || '' : '',
            onuLanInterface: !connection.isEthernet ? connection.interface || '' : '',
            onuLanLinkState: !connection.isEthernet ? connection.linkState || '' : '',
            onuLanSpeedMbps: !connection.isEthernet ? connection.speedMbps || '' : '',
            tmcChecked: Boolean(tmc.checked),
            tmcFound: Boolean(tmc.found),
            onuSerial: tmc.onuSerial || '',
            onuMac: tmc.onuMac || '',
            foundOnOlt: tmc.foundOnOlt === true,
            oltName: tmc.oltName || '',
            oltIp: tmc.oltIp || '',
            oltDeviceId: tmc.oltDeviceId || '',
            port: tmc.port || '',
            interface: tmc.interface || '',
            equipmentName: tmc.equipmentName || '',
            rx: tmc.onuRx || '',
            tx: tmc.onuTx || '',
            oltRx: tmc.oltRx || ''
          },
          observedAt: new Date().toISOString(),
          source: 'userside-live-read-only',
          pageUrl: String(pageUrl || '')
        };
      };

      let customerId = lookupRequest.mode === 'customerId' ? String(lookupRequest.value || '') : '';
      let candidates = [];
      if (!customerId) {
        const searchUrl = new URL('/customer_list', location.origin);
        searchUrl.searchParams.set('search', String(lookupRequest.value || ''));
        const searchPage = await fetchDoc(searchUrl);
        if (!searchPage.ok || authPage(searchPage.doc)) return { ok: false, code: authPage(searchPage.doc) ? 'USERSIDE_AUTH_REQUIRED' : 'USERSIDE_SEARCH_FAILED', status: searchPage.status };
        candidates = customerLinks(searchPage.doc).map(item => ({ ...item, score: scoreCandidate(item) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
        if (!candidates.length) return { ok: false, code: 'NOT_FOUND', candidates: [] };
        const bestScore = candidates[0].score;
        const best = candidates.filter(item => item.score === bestScore);
        if (best.length !== 1) return { ok: false, code: 'USERSIDE_AMBIGUOUS_IDENTITY', candidates: best.slice(0, 8).map(item => ({ customerId: item.customerId, text: item.text })) };
        customerId = best[0].customerId;
      }

      const customerUrl = new URL(`/customer/${customerId}`, location.origin);
      const customerPage = await fetchDoc(customerUrl);
      if (!customerPage.ok || authPage(customerPage.doc)) return { ok: false, code: authPage(customerPage.doc) ? 'USERSIDE_AUTH_REQUIRED' : 'USERSIDE_CUSTOMER_FETCH_FAILED', status: customerPage.status };
      const snapshot = parseCustomer(customerPage.doc, customerId, customerPage.url.href);
      if (!snapshot.identity.login && !snapshot.identity.contract && !snapshot.network.ip && !snapshot.address.full) return { ok: false, code: 'USERSIDE_CUSTOMER_PARSE_FAILED', customerId };
      return { ok: true, code: 'OK', snapshot, candidates: candidates.slice(0, 8).map(item => ({ customerId: item.customerId, text: item.text })) };
    }
  });
  return execution?.result || { ok: false, code: 'USERSIDE_SEARCH_EXECUTION_FAILED' };
}

export async function searchUserSideLive(toolArgs = {}) {
  const request = classifyUserSideLookup(toolArgs);
  if (!request) return { ok: false, code: 'IDENTITY_QUERY_REQUIRED' };
  if (!globalThis.chrome?.scripting?.executeScript) return { ok: false, code: 'USERSIDE_RUNTIME_UNAVAILABLE' };
  const tabs = await userSideTabs();
  if (!tabs.length) return { ok: false, code: 'USERSIDE_TAB_REQUIRED' };

  const failures = [];
  for (const tab of tabs.slice(0, 3)) {
    try {
      const result = await executeSearch(tab.id, request);
      if (result?.ok) return { ...result, request, tabId: tab.id };
      failures.push(result || { ok: false, code: 'USERSIDE_SEARCH_FAILED' });
      if (!['USERSIDE_AUTH_REQUIRED', 'USERSIDE_TAB_INVALID'].includes(String(result?.code || ''))) break;
    } catch (error) {
      failures.push({ ok: false, code: 'USERSIDE_SEARCH_EXECUTION_FAILED', message: clean(error?.message || error, 500) });
    }
  }
  return { ...(failures.at(-1) || { ok: false, code: 'USERSIDE_SEARCH_FAILED' }), request };
}
