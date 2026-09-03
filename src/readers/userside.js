(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const valueOf = fact => (
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact
  );

  const normalizeSerial = value => String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();

  const compactText = (value, max = 260) => {
    const text = String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const find = (map, patterns) => {
    for (const [key, value] of map || []) {
      if (patterns.some(pattern => pattern.test(key))) {
        return value;
      }
    }
    return '';
  };

  function parseUrl(raw) {
    try {
      return new URL(raw, location.href);
    } catch {
      return null;
    }
  }

  function pageIp(validIp, activeCase = null) {
    // gotouser.php links are navigation helpers and may point at unrelated/default
    // addresses elsewhere on the UserSide page. They are not subscriber-IP evidence.
    // Only use the page's ping control, and never contradict a stronger Billing/handoff IP.
    const expected = validIp(valueOf(activeCase?.network?.ip) || '');
    const candidates = [
      ...document.querySelectorAll('a[href*="reload_ping_data"][href*="ip="]')
    ];

    for (const anchor of candidates) {
      const url = parseUrl(anchor.href);
      const ip = validIp(url?.searchParams.get('ip') || '');
      if (!ip) continue;
      if (expected && ip !== expected) continue;
      return ip;
    }

    return '';
  }

  function tmcBlocks() {
    if (WB.tmcParser?.findBlocks) return WB.tmcParser.findBlocks(document);
    return [];
  }

  function parseTmcBlock(block, helpers) {
    if (WB.tmcParser?.parseBlock) {
      return WB.tmcParser.parseBlock(block, {
        ...helpers,
        normalizeSerial
      });
    }
    return {
      element: block || null,
      text: '',
      serial: '',
      serialKey: '',
      mac: '',
      oltName: '',
      oltIp: '',
      deviceId: '',
      interface: ''
    };
  }

  function chooseTmcBlock(blocks, activeCase, helpers) {
    const items = blocks.map(block => parseTmcBlock(block, helpers)).filter(Boolean);
    // The inventory DOM contract already scopes rows to category=PON. The parser
    // reads facts; it does not rank unrelated page fragments or infer workflow.
    const item = items[0] || null;
    return {
      item,
      result: item ? 'found' : 'missing',
      comparison: item ? { isMatch: true, matchedCurrentSubscriber: true } : null,
      candidates: items.map(candidate => ({ item: candidate, comparison: null }))
    };
  }

  function customerMacs(normalizeMac) {
    const result = [];
    for (const anchor of document.querySelectorAll(
      'a[href*="find_typer=machistory"][href*="search="]'
    )) {
      const url = parseUrl(anchor.href);
      const mac = normalizeMac(url?.searchParams.get('search') || '');
      if (!mac) continue;
      const row = anchor.closest('.item,tr,.slider_content_double,div');
      const text = compactText(row?.innerText || row?.textContent || '', 600);
      const ip = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
      if (!result.some(item => item.mac === mac)) {
        result.push({
          mac,
          ip,
          href: url?.href || anchor.href,
          title: anchor.getAttribute('title') || 'Поиск по MAC-адресу'
        });
      }
    }
    return result;
  }

  function classifyEthernetAccessPoint(details = {}) {
    const deviceName = String(details.deviceName || '');
    const interfaceName = String(details.interface || '');
    const interfaceClass = String(details.interfaceClass || '');
    const ponIdentity = /(?:\bolt\b|\bonu\b|\bont\b|\bepon\b|\bgpon\b|\bxpon\b|huawei\s+ma\d{3,5}|\bgcom\b)/i
      .test(`${deviceName} ${interfaceName}`);
    const ethernetPort = /ethernetCsmacd/i.test(interfaceClass)
      || /^(?:slot\d+\/)?\d+$/i.test(interfaceName)
      || /^(?:eth|ethernet|fa|gi|ge)\S*/i.test(interfaceName);

    return Boolean(
      details.deviceId
      && details.port
      && details.ownerMatched
      && ethernetPort
      && !ponIdentity
    );
  }

  function ethernetAccessPoint(activeCase, { compact, validIp }) {
    const expectedLogin = String(valueOf(activeCase?.identity?.login) || '').toLowerCase();
    const expectedCustomerId = String(valueOf(activeCase?.identity?.customerId) || '');
    const expectedIp = String(valueOf(activeCase?.network?.ip) || '');
    const blocks = [...document.querySelectorAll('.item')];
    const block = blocks.find(item => {
      const label = compactText(
        item.querySelector?.('.left_data')?.innerText
        || item.querySelector?.('.left_data')?.textContent
        || '',
        120
      );
      return /^(?:точка\s+подключения|точка\s+підключення)\s*:?$/i.test(label);
    }) || null;
    if (!block) return null;

    const deviceLink = [...block.querySelectorAll('a[href*="/device/"]')]
      .find(anchor => /\/device\/\d+\/?$/i.test(parseUrl(anchor.href)?.pathname || ''))
      || null;
    const deviceUrl = parseUrl(deviceLink?.href || '');
    const deviceId = deviceUrl?.pathname.match(/\/device\/(\d+)/i)?.[1] || '';
    const text = compact(
      block.innerText || block.textContent || '',
      2400
    );
    const portMatch = text.match(/(?:порт|port)\s*:\s*(\d+)(?:\s*\(([^)]+)\))?/i);
    const port = String(portMatch?.[1] || '');
    const portRow = (
      deviceId && port
        ? block.querySelector(`#divIfaceRow${deviceId}_${port}`)
        : null
    ) || block.querySelector('.ifaceRow-ethernetCsmacd') || null;
    const portText = compact(
      portRow?.innerText || portRow?.textContent || '',
      1400
    );
    const ownerLink = portRow?.querySelector('a[href*="/customer/"]') || null;
    const ownerUrl = parseUrl(ownerLink?.href || '');
    const ownerCustomerId = ownerUrl?.pathname.match(/\/customer\/(\d+)/i)?.[1] || '';
    const ownerLogin = portText.match(/\b(abon\d{3,12})\b/i)?.[1]?.toLowerCase() || '';
    const ownerIp = validIp(portText);
    const ownerMatched = Boolean(
      (expectedCustomerId && ownerCustomerId === expectedCustomerId)
      || (expectedLogin && ownerLogin === expectedLogin)
      || (expectedIp && ownerIp === expectedIp)
    );
    const interfaceName = compact(
      portMatch?.[2]
      || portText.match(/(?:Name|Имя|Назва)\s*:\s*([^\s]+)/i)?.[1]
      || '',
      120
    );
    const deviceName = compact(
      text.match(/(?:Оборудование|Обладнання)\s+(.+?)\s+IP\s*:/i)?.[1]
      || deviceLink?.parentElement?.querySelector?.(':scope > i')?.textContent
      || '',
      240
    );
    const deviceIp = validIp(
      text.match(/\bIP\s*:\s*((?:\d{1,3}\.){3}\d{1,3})/i)?.[1]
      || ''
    );
    const linkState = portText.match(/\b(up|down)\b/i)?.[1]?.toLowerCase() || '';
    const speedMbps = portText.match(/\b(?:up|down)\s+(\d{2,5})\b/i)?.[1] || '';
    const errorMatch = portText.match(/(?:Error|Ошибк\w*)\s*:\s*(\d+)\s*\/\s*(\d+)/i);
    const details = {
      source: 'userside-connection-point',
      deviceId,
      deviceName,
      deviceIp,
      deviceHref: deviceUrl?.href || '',
      port,
      interface: interfaceName,
      interfaceClass: String(portRow?.className || ''),
      linkState,
      speedMbps,
      errorsIn: errorMatch?.[1] || '',
      errorsOut: errorMatch?.[2] || '',
      ownerCustomerId,
      ownerLogin,
      ownerIp,
      ownerMatched
    };

    return {
      ...details,
      isEthernet: classifyEthernetAccessPoint(details),
      element: block,
      portElement: portRow
    };
  }

  function collectCustomer(context) {
    const {
      map,
      text,
      fact,
      normalizeMac,
      validIp,
      compact,
      activeCase
    } = context;

    const contractRaw = find(map, [
      /договор/i,
      /договір/i,
      /лицев.*счет/i
    ]);
    const contractMatch = String(contractRaw || '').match(/\b(\d{5,12})\b/);
    const loginMatch = text.match(/\b(abon\d{3,12})\b/i);
    const blocks = tmcBlocks();
    const tmcSelection = chooseTmcBlock(blocks, activeCase, {
      compact,
      validIp,
      normalizeMac
    });
    const tmc = tmcSelection.item;
    const macs = customerMacs(normalizeMac);
    const accessPoint = ethernetAccessPoint(activeCase, { compact, validIp });
    const cardReady = Boolean(
      document.querySelector('#slider_content_id,#customer-card-customer-id')
      || loginMatch
    );

    const tmcResult = accessPoint?.isEthernet
      ? 'not_applicable'
      : tmc
      ? 'found'
      : (
          cardReady
            ? (blocks.length ? tmcSelection.result : 'missing')
            : 'unknown'
        );

    const observations = [];
    if (accessPoint?.isEthernet) {
      observations.push({
        type: 'ETHERNET_ACCESS_POINT',
        result: 'confirmed',
        method: 'userside_connection_point',
        source: 'userside',
        details: {
          ...accessPoint,
          element: undefined,
          portElement: undefined,
          confidence: 0.99
        },
        summary: `Подтверждён Ethernet: витая пара идёт на ${accessPoint.deviceName || 'коммутатор'}, порт ${accessPoint.interface || accessPoint.port}. ONU и OLT для этой ветки не требуются.`
      });
    }
    if (tmcResult !== 'unknown') {
      observations.push({
        type: 'TMC_RESULT',
        result: tmcResult,
        method: 'userside_tmc',
        source: 'userside',
        details: tmc ? {
          source: 'userside-tmc',
          oltName: tmc.oltName,
          oltIp: tmc.oltIp,
          deviceId: tmc.deviceId,
          interface: tmc.interface,
          onuMac: tmc.mac,
          onuSerial: tmc.serial,
          foundOnOlt: tmc.foundOnOlt === true,
          confidence: tmcSelection.comparison?.isMatch
            ? 0.99
            : tmcSelection.comparison?.matchedCount
              ? 0.96
              : 0.9,
          matchedCurrentSubscriber: true,
          identityCheck: tmcSelection.comparison
        } : {
          expected: {},
          bestObserved: tmcSelection.candidates?.[0]?.item
            ? {
                onuMac: tmcSelection.candidates[0].item.mac,
                onuSerial: tmcSelection.candidates[0].item.serial,
                oltName: tmcSelection.candidates[0].item.oltName,
                oltIp: tmcSelection.candidates[0].item.oltIp
              }
            : null,
          identityCheck: tmcSelection.comparison
        },
        summary: accessPoint?.isEthernet
          ? 'PON-ТМЦ не применяется: карточка содержит прямую Ethernet-точку подключения к порту коммутатора.'
          : tmc
          ? 'OLT найдена в ТМЦ; сохранены только реально доступные в ТМЦ поля ONU/OLT.'
          : tmcResult === 'missing'
            ? 'Карточка проверена: ТМЦ с ONU/OLT отсутствует.'
            : 'В ТМЦ не удалось извлечь имя или IP OLT.'
      });
    }

    observations.push({
      type: 'CUSTOMER_MACS',
      result: macs.length ? 'found' : 'missing',
      method: 'userside_customer_card',
      source: 'userside',
      details: { macs },
      summary: macs.length
        ? `На карточке найдено MAC для поиска: ${macs.length}.`
        : 'На карточке нет пригодных MAC-ссылок для поиска.'
    });

    const ip = pageIp(validIp, activeCase);

    return {
      facts: {
        identity: {
          login: fact(
            loginMatch?.[1]?.toLowerCase() || '',
            'userside:body-login',
            loginMatch ? 0.95 : 0
          ),
          contract: fact(
            contractMatch?.[1] || '',
            'userside:labeled-contract',
            contractMatch ? 0.92 : 0
          )
        },
        network: {
          ip: fact(ip, 'userside:page-ip', ip ? 0.9 : 0),
          connectionFamily: fact(
            accessPoint?.isEthernet ? 'Ethernet' : '',
            'userside:connection-point-family',
            accessPoint?.isEthernet ? 0.99 : 0
          ),
          connectionRaw: fact(
            accessPoint?.isEthernet ? 'Точка подключения → порт коммутатора → витая пара' : '',
            'userside:connection-point',
            accessPoint?.isEthernet ? 0.98 : 0
          ),
          accessDeviceId: fact(
            accessPoint?.isEthernet ? accessPoint.deviceId : '',
            'userside:access-device-id',
            accessPoint?.isEthernet && accessPoint.deviceId ? 0.99 : 0
          ),
          accessDeviceName: fact(
            accessPoint?.isEthernet ? accessPoint.deviceName : '',
            'userside:access-device-name',
            accessPoint?.isEthernet && accessPoint.deviceName ? 0.97 : 0
          ),
          accessDeviceIp: fact(
            accessPoint?.isEthernet ? accessPoint.deviceIp : '',
            'userside:access-device-ip',
            accessPoint?.isEthernet && accessPoint.deviceIp ? 0.98 : 0
          ),
          accessPort: fact(
            accessPoint?.isEthernet ? accessPoint.port : '',
            'userside:access-port',
            accessPoint?.isEthernet && accessPoint.port ? 0.99 : 0
          ),
          accessInterface: fact(
            accessPoint?.isEthernet ? accessPoint.interface : '',
            'userside:access-interface',
            accessPoint?.isEthernet && accessPoint.interface ? 0.99 : 0
          ),
          accessLinkState: fact(
            accessPoint?.isEthernet ? accessPoint.linkState : '',
            'userside:access-link-state',
            accessPoint?.isEthernet && accessPoint.linkState ? 0.94 : 0
          ),
          accessSpeedMbps: fact(
            accessPoint?.isEthernet ? accessPoint.speedMbps : '',
            'userside:access-link-speed',
            accessPoint?.isEthernet && accessPoint.speedMbps ? 0.92 : 0
          )
        },
        pon: {
          onuDeviceId: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.deviceId : '',
            'userside:onu-device-id',
            accessPoint && !accessPoint.isEthernet && accessPoint.deviceId ? 0.99 : 0
          ),
          onuDeviceName: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.deviceName : '',
            'userside:onu-device-name',
            accessPoint && !accessPoint.isEthernet && accessPoint.deviceName ? 0.97 : 0
          ),
          onuDeviceIp: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.deviceIp : '',
            'userside:onu-device-ip',
            accessPoint && !accessPoint.isEthernet && accessPoint.deviceIp ? 0.98 : 0
          ),
          onuLanPort: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.port : '',
            'userside:onu-lan-port',
            accessPoint && !accessPoint.isEthernet && accessPoint.port ? 0.99 : 0
          ),
          onuLanInterface: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.interface : '',
            'userside:onu-lan-interface',
            accessPoint && !accessPoint.isEthernet && accessPoint.interface ? 0.99 : 0
          ),
          onuLanLinkState: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.linkState : '',
            'userside:onu-lan-link-state',
            accessPoint && !accessPoint.isEthernet && accessPoint.linkState ? 0.94 : 0
          ),
          onuLanSpeedMbps: fact(
            accessPoint && !accessPoint.isEthernet ? accessPoint.speedMbps : '',
            'userside:onu-lan-link-speed',
            accessPoint && !accessPoint.isEthernet && accessPoint.speedMbps ? 0.92 : 0
          ),
          tmcOnuSerial: fact(
            tmc?.serial || '',
            'userside:tmc-onu-serial',
            tmc?.serial ? 0.98 : 0
          ),
          tmcOnuMac: fact(
            tmc?.mac || '',
            'userside:tmc-onu-mac',
            tmc?.mac ? 0.98 : 0
          ),
          tmcOltName: fact(
            tmc?.oltName || '',
            'userside:tmc-olt-name',
            tmc?.oltName ? 0.98 : 0
          ),
          tmcOltIp: fact(
            tmc?.oltIp || '',
            'userside:tmc-olt-ip',
            tmc?.oltIp ? 0.98 : 0
          ),
          tmcOltDeviceId: fact(
            tmc?.deviceId || '',
            'userside:tmc-olt-device-id',
            tmc?.deviceId ? 0.97 : 0
          ),
          tmcPort: fact(
            tmc?.interface || '',
            'userside:tmc-interface',
            tmc?.interface ? 0.96 : 0
          ),
          tmcEquipmentName: fact(
            tmc?.equipmentName || '',
            'userside:tmc-equipment-name',
            tmc?.equipmentName ? 0.98 : 0
          ),
          tmcFoundOnOlt: fact(
            tmc?.foundOnOlt === true ? 'true' : '',
            'userside:tmc-found-on-olt',
            tmc?.foundOnOlt === true ? 0.99 : 0
          ),
          tmcOnuRx: fact(
            tmc?.onuRx || '',
            'userside:tmc-onu-rx',
            tmc?.onuRx ? 0.98 : 0
          ),
          tmcOnuTx: fact(
            tmc?.onuTx || '',
            'userside:tmc-onu-tx',
            tmc?.onuTx ? 0.98 : 0
          ),
          tmcOltRx: fact(
            tmc?.oltRx || '',
            'userside:tmc-olt-rx',
            tmc?.oltRx ? 0.98 : 0
          )
        },
        profile: {}
      },
      meta: {
        reader: 'userside',
        tmc: {
          checked: cardReady,
          found: Boolean(tmc),
          result: tmcResult,
          oltName: tmc?.oltName || '',
          oltIp: tmc?.oltIp || '',
          identityCheck: tmcSelection.comparison || null,
          candidateCount: blocks.length
        },
        connectionPoint: accessPoint ? {
          classification: accessPoint.isEthernet ? 'ethernet_access' : 'pon_onu_lan_or_non_ethernet',
          deviceId: accessPoint.deviceId,
          deviceName: accessPoint.deviceName,
          deviceIp: accessPoint.deviceIp,
          port: accessPoint.port,
          interface: accessPoint.interface,
          linkState: accessPoint.linkState,
          speedMbps: accessPoint.speedMbps,
          ownerMatched: accessPoint.ownerMatched
        } : null,
        ethernetAccessPoint: accessPoint?.isEthernet ? {
          found: true,
          deviceId: accessPoint.deviceId,
          deviceName: accessPoint.deviceName,
          deviceIp: accessPoint.deviceIp,
          port: accessPoint.port,
          interface: accessPoint.interface,
          linkState: accessPoint.linkState,
          speedMbps: accessPoint.speedMbps,
          ownerMatched: accessPoint.ownerMatched
        } : null,
        customerMacs: macs,
        locatorObservations: observations
      },
      quality: {
        trustedPage: true,
        parser: 'userside-customer-locator-v2.1'
      }
    };
  }

  function parseSearchCandidate(row, helpers, activeCase) {
    const { normalizeMac, validIp, compact } = helpers;
    const text = compact(row.innerText || row.textContent || '', 1800);
    const interfaceLink = row.querySelector(
      'a[href*="/interface_mac_list"]'
    );
    const interfaceUrl = parseUrl(interfaceLink?.href || '');
    const deviceLink = [...row.querySelectorAll('a[href*="/device/"]')]
      .find(anchor => /\/device\/\d+\/?$/i.test(parseUrl(anchor.href)?.pathname || ''))
      || null;
    const deviceUrl = parseUrl(deviceLink?.href || interfaceLink?.href || '');
    const ownerLink = row.querySelector('a[href^="/customer/"],a[href*="/customer/"]');
    const ownerUrl = parseUrl(ownerLink?.href || '');

    const deviceId = (
      deviceUrl?.pathname.match(/\/device\/(\d+)/i)?.[1]
      || interfaceUrl?.pathname.match(/\/device\/(\d+)/i)?.[1]
      || ''
    );
    const customerId = ownerUrl?.pathname.match(/\/customer\/(\d+)/i)?.[1] || '';
    const login = text.match(/\b(abon\d{3,12})\b/i)?.[1]?.toLowerCase() || '';
    const ip = validIp(text);
    const rowMac = normalizeMac(
      row.querySelector('[id*="_mac_"]')?.textContent
      || text.match(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)?.[0]
      || ''
    );
    const interfaceName = compact(
      interfaceLink?.innerText || interfaceLink?.textContent || '',
      120
    );
    const vlan = compact(
      row.querySelector('[id*="_vid_"]')?.textContent || '',
      40
    );

    const expectedLogin = String(valueOf(activeCase?.identity?.login) || '').toLowerCase();
    const expectedCustomerId = String(valueOf(activeCase?.identity?.customerId) || '');
    const expectedIp = String(valueOf(activeCase?.network?.ip) || '');
    const matchedBy = [];
    if (expectedLogin && login === expectedLogin) matchedBy.push('login');
    if (expectedCustomerId && customerId === expectedCustomerId) matchedBy.push('customerId');
    if (expectedIp && ip === expectedIp) matchedBy.push('ip');

    return {
      source: 'mac-history',
      deviceId,
      oltName: compact(
        deviceLink?.innerText || deviceLink?.textContent || '',
        220
      ),
      interface: interfaceName,
      ifIndex: interfaceUrl?.searchParams.get('if_index') || '',
      interfaceHref: interfaceUrl?.href || '',
      deviceHref: deviceUrl?.href || '',
      customerId,
      login,
      ip,
      vlan,
      subscriberMac: rowMac,
      matchedBy,
      matchedCurrentSubscriber: matchedBy.length > 0,
      confidence: matchedBy.length ? 0.9 : 0.62
    };
  }

  function collectMacSearch(context) {
    const {
      pageInfo,
      fact,
      normalizeMac,
      validIp,
      compact,
      activeCase
    } = context;
    const params = new URLSearchParams(location.search);
    const searchedMac = normalizeMac(params.get('search') || '');
    const searchMode = params.get('uplinkport') === '1'
      ? 'uplink_downlink'
      : 'direct';

    const rows = [...document.querySelectorAll('#tableListData tbody tr')]
      .filter(row => row.querySelector('a[href*="/device/"]'));
    const candidates = rows
      .map(row => parseSearchCandidate(
        row,
        { normalizeMac, validIp, compact },
        activeCase
      ))
      .map(item => ({
        ...item,
        // The result row is already scoped by the searched MAC even when UserSide
        // does not repeat that MAC inside every row.
        subscriberMac: item.subscriberMac || searchedMac
      }))
      .filter(item => item.deviceId || item.interface);

    const matched = candidates.filter(item => item.matchedCurrentSubscriber);
    const selected = matched.length ? matched : candidates;
    const result = selected.length ? 'candidate_found' : 'not_found';
    const best = selected[0] || null;

    return {
      facts: {
        identity: {},
        network: {},
        pon: {
          locatedDeviceId: fact(
            best?.deviceId || '',
            'userside:mac-search-device-id',
            best ? best.confidence : 0
          ),
          locatedDeviceName: fact(
            best?.oltName || '',
            'userside:mac-search-device-name',
            best ? best.confidence : 0
          ),
          locatedInterface: fact(
            best?.interface || '',
            'userside:mac-search-interface',
            best ? best.confidence : 0
          ),
          locatedIfIndex: fact(
            best?.ifIndex || '',
            'userside:mac-search-if-index',
            best ? best.confidence : 0
          ),
          locatedVlan: fact(
            best?.vlan || '',
            'userside:mac-search-vlan',
            best ? best.confidence : 0
          ),
          locatedSubscriberMac: fact(
            best?.subscriberMac || searchedMac,
            'userside:mac-search-subscriber-mac',
            best ? best.confidence : (searchedMac ? 0.72 : 0)
          )
        },
        profile: {}
      },
      meta: {
        reader: 'userside',
        macSearch: {
          searchedMac,
          searchMode,
          result,
          candidateCount: selected.length
        },
        locatorObservations: [
          {
            type: 'MAC_SEARCH_RESULT',
            result,
            method: 'userside_mac_history',
            source: 'userside',
            searchMode,
            searchedMac,
            details: {
              searchedMac,
              candidates: selected
            },
            summary: result === 'candidate_found'
              ? `По MAC найдено кандидатов: ${selected.length}.`
              : `По MAC ${searchedMac || 'не указан'} совпадений нет.`
          }
        ]
      },
      quality: {
        trustedPage: true,
        parser: `userside-mac-search-${searchMode}-v1`,
        pageKind: pageInfo.kind
      }
    };
  }

  function collectInterfaceList(context) {
    const {
      pageInfo,
      fact,
      normalizeMac,
      compact,
      activeCase
    } = context;
    const params = new URLSearchParams(location.search);
    const deviceId = pageInfo.entityId || location.pathname.match(/\/device\/(\d+)/i)?.[1] || '';
    const ifIndex = params.get('if_index') || '';
    const expectedMacs = [
      valueOf(activeCase?.network?.mac),
      valueOf(activeCase?.network?.routerMac),
      valueOf(activeCase?.pon?.locatedSubscriberMac),
      ...(activeCase?.locator?.sourceStatus?.customer_macs?.macs || []).map(item => item.mac)
    ].map(normalizeMac).filter(Boolean);
    const expectedLogin = String(valueOf(activeCase?.identity?.login) || '').toLowerCase();
    const expectedCustomerId = String(valueOf(activeCase?.identity?.customerId) || '');
    const expectedIp = String(valueOf(activeCase?.network?.ip) || '');

    const rows = [...document.querySelectorAll('#tableListData tbody tr,table tbody tr')]
      .filter(row => row.querySelector('a[href*="/customer/"]') || /(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(row.textContent || ''));

    const parsed = rows.map(row => {
      const text = compact(row.innerText || row.textContent || '', 1600);
      const rowMac = normalizeMac(
        row.querySelector('[id*="_mac_"]')?.textContent
        || text.match(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)?.[0]
        || ''
      );
      const ownerLink = row.querySelector('a[href*="/customer/"]');
      const ownerUrl = parseUrl(ownerLink?.href || '');
      const customerId = ownerUrl?.pathname.match(/\/customer\/(\d+)/i)?.[1] || '';
      const login = text.match(/\b(abon\d{3,12})\b/i)?.[1]?.toLowerCase() || '';
      const ip = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
      const interfaceName = compact(
        row.querySelector('[id*="_if_name_"]')?.textContent
        || text.match(/\b(?:E|G)PON\d+\/\d+(?::\d+)?\b/i)?.[0]
        || '',
        120
      );
      const vlan = compact(row.querySelector('[id*="_vid_"]')?.textContent || '', 40);
      const matchedBy = [];
      if (rowMac && expectedMacs.includes(rowMac)) matchedBy.push('subscriberMac');
      if (expectedLogin && login === expectedLogin) matchedBy.push('login');
      if (expectedCustomerId && customerId === expectedCustomerId) matchedBy.push('customerId');
      if (expectedIp && ip === expectedIp) matchedBy.push('ip');
      return {
        row,
        rowMac,
        customerId,
        login,
        ip,
        interface: interfaceName,
        vlan,
        matchedBy
      };
    });

    const confirmed = parsed.find(item => item.matchedBy.length) || null;
    const candidate = activeCase?.locator?.candidates?.find(item => (
      item.deviceId === deviceId
      && (!ifIndex || item.ifIndex === ifIndex)
    )) || activeCase?.locator?.candidates?.[0] || null;

    const details = {
      ...(candidate || {}),
      source: 'interface-mac-list',
      deviceId,
      ifIndex,
      interface: confirmed?.interface || candidate?.interface || '',
      vlan: confirmed?.vlan || candidate?.vlan || '',
      subscriberMac: confirmed?.rowMac || candidate?.subscriberMac || '',
      customerId: confirmed?.customerId || candidate?.customerId || '',
      login: confirmed?.login || candidate?.login || '',
      matchedBy: confirmed?.matchedBy || [],
      matchedCurrentSubscriber: Boolean(confirmed),
      confidence: confirmed ? 0.97 : 0.5
    };

    return {
      facts: {
        identity: {},
        network: {},
        pon: {
          locatedDeviceId: fact(deviceId, 'userside:interface-device-id', deviceId ? 0.98 : 0),
          locatedIfIndex: fact(ifIndex, 'userside:interface-if-index', ifIndex ? 0.98 : 0),
          locatedInterface: fact(details.interface, 'userside:interface-confirmed', confirmed ? 0.98 : 0),
          locatedVlan: fact(details.vlan, 'userside:interface-vlan', confirmed ? 0.95 : 0),
          locatedSubscriberMac: fact(details.subscriberMac, 'userside:interface-subscriber-mac', confirmed ? 0.98 : 0)
        },
        profile: {}
      },
      meta: {
        reader: 'userside',
        interfaceConfirmation: {
          result: confirmed ? 'confirmed' : 'not_found',
          deviceId,
          ifIndex,
          matchedBy: details.matchedBy
        },
        locatorObservations: [
          {
            type: 'INTERFACE_CONFIRMATION',
            result: confirmed ? 'confirmed' : 'not_found',
            method: 'userside_interface_mac_list',
            source: 'userside',
            details,
            summary: confirmed
              ? 'MAC/логин/IP текущего абонента подтверждён на конкретном интерфейсе.'
              : 'На выбранном интерфейсе текущий абонент не подтверждён.'
          }
        ]
      },
      quality: {
        trustedPage: true,
        parser: 'userside-interface-confirmation-v1'
      }
    };
  }

  function collectEthernetFdb(context) {
    const {
      pageInfo,
      fact,
      normalizeMac,
      compact,
      activeCase
    } = context;
    const deviceId = pageInfo.entityId || '';
    const expectedDeviceId = String(valueOf(activeCase?.network?.accessDeviceId) || '');
    const expectedInterface = String(valueOf(activeCase?.network?.accessInterface) || '');
    const expectedPort = String(valueOf(activeCase?.network?.accessPort) || '');
    const expectedMac = normalizeMac(valueOf(activeCase?.network?.mac) || '');
    const expectedLogin = String(valueOf(activeCase?.identity?.login) || '').toLowerCase();
    const expectedCustomerId = String(valueOf(activeCase?.identity?.customerId) || '');
    const expectedIp = String(valueOf(activeCase?.network?.ip) || '');

    const rows = [...document.querySelectorAll('#tableListData tbody tr,table tbody tr')]
      .filter(row => (
        row.querySelector('[id*="_mac_"]')
        || row.querySelector('a[href*="/customer/"]')
      ));
    const parsed = rows.map(row => {
      const text = compact(row.innerText || row.textContent || '', 1600);
      const mac = normalizeMac(
        row.querySelector('[id*="_mac_"]')?.textContent
        || text.match(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)?.[0]
        || ''
      );
      const ownerLink = row.querySelector('a[href*="/customer/"]');
      const ownerUrl = parseUrl(ownerLink?.href || '');
      const customerId = ownerUrl?.pathname.match(/\/customer\/(\d+)/i)?.[1] || '';
      const login = text.match(/\b(abon\d{3,12})\b/i)?.[1]?.toLowerCase() || '';
      const ip = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/)?.[1] || '';
      const interfaceName = compact(
        row.querySelector('[id*="_interface_full_"]')?.textContent
        || row.querySelector('.spanFdbInterface')?.textContent
        || '',
        120
      );
      const vlan = compact(row.querySelector('[id*="_vid_"]')?.textContent || '', 40);
      const matchedBy = [];
      if (expectedMac && mac === expectedMac) matchedBy.push('subscriberMac');
      if (expectedLogin && login === expectedLogin) matchedBy.push('login');
      if (expectedCustomerId && customerId === expectedCustomerId) matchedBy.push('customerId');
      if (expectedIp && ip === expectedIp) matchedBy.push('ip');
      return { mac, customerId, login, ip, interface: interfaceName, vlan, matchedBy };
    });

    const subscriberRow = parsed.find(item => item.matchedBy.length > 0) || null;
    const normalizedExpectedInterface = expectedInterface.toLowerCase();
    const expectedPortPattern = expectedPort ? new RegExp(`(?:^|\\D)${expectedPort}(?:$|\\D)`) : null;
    const portMatched = Boolean(
      subscriberRow
      && (
        !expectedInterface && !expectedPort
        || (normalizedExpectedInterface && subscriberRow.interface.toLowerCase() === normalizedExpectedInterface)
        || (expectedPortPattern && expectedPortPattern.test(subscriberRow.interface))
      )
    );
    const sameDevice = !expectedDeviceId || expectedDeviceId === deviceId;
    const result = !sameDevice
      ? 'wrong_device'
      : subscriberRow
        ? (portMatched ? 'confirmed' : 'port_mismatch')
        : 'not_found';
    const details = {
      source: 'userside-fdb',
      deviceId,
      expectedDeviceId,
      expectedInterface,
      expectedPort,
      subscriberMac: subscriberRow?.mac || '',
      interface: subscriberRow?.interface || '',
      vlan: subscriberRow?.vlan || '',
      matchedBy: subscriberRow?.matchedBy || [],
      portMatched,
      rowCount: parsed.length
    };

    return {
      facts: {
        identity: {},
        network: {
          accessFdbMac: fact(details.subscriberMac, 'userside:fdb-subscriber-mac', subscriberRow ? 0.99 : 0),
          accessFdbInterface: fact(details.interface, 'userside:fdb-interface', subscriberRow ? 0.99 : 0),
          accessVlan: fact(details.vlan, 'userside:fdb-vlan', subscriberRow ? 0.98 : 0)
        },
        pon: {},
        profile: {}
      },
      meta: {
        reader: 'userside',
        ethernetFdb: { result, ...details },
        locatorObservations: [{
          type: 'ETHERNET_FDB_RESULT',
          result,
          method: 'userside_device_fdb',
          source: 'userside',
          details,
          summary: result === 'confirmed'
            ? `FDB подтверждает MAC текущего абонента на ${details.interface}${details.vlan ? `, VLAN ${details.vlan}` : ''}.`
            : result === 'port_mismatch'
              ? `MAC абонента найден, но на ${details.interface || 'другом порту'} вместо ${expectedInterface || expectedPort}.`
              : 'В FDB текущего коммутатора MAC абонента не подтверждён.'
        }]
      },
      quality: {
        trustedPage: true,
        parser: 'userside-ethernet-fdb-v1'
      }
    };
  }

  function collectEthernetErrors(context) {
    const {
      pageInfo,
      fact,
      compact,
      activeCase
    } = context;
    const deviceId = pageInfo.entityId || '';
    const expectedDeviceId = String(valueOf(activeCase?.network?.accessDeviceId) || '');
    const expectedInterface = String(valueOf(activeCase?.network?.accessInterface) || '');
    const expectedPort = String(valueOf(activeCase?.network?.accessPort) || '');
    const rows = [...document.querySelectorAll('#tableListData tbody tr,table tbody tr')];
    const parsed = rows.map(row => ({
      interface: compact(row.querySelector('[id*="_iface_name_"]')?.textContent || '', 120),
      errorsIn: compact(row.querySelector('[id*="_in_"]')?.textContent || '', 40),
      errorsOut: compact(row.querySelector('[id*="_out_"]')?.textContent || '', 40),
      deltaDay: compact(row.querySelector('[id*="_delta_day_"]')?.textContent || '', 40),
      deltaWeek: compact(row.querySelector('[id*="_delta_7day_"]')?.textContent || '', 40)
    })).filter(item => item.interface);
    const target = parsed.find(item => (
      expectedInterface
        ? item.interface.toLowerCase() === expectedInterface.toLowerCase()
        : expectedPort
          ? new RegExp(`(?:^|\\D)${expectedPort}(?:$|\\D)`).test(item.interface)
          : false
    )) || null;
    const sameDevice = !expectedDeviceId || expectedDeviceId === deviceId;
    const result = !sameDevice
      ? 'wrong_device'
      : !expectedInterface && !expectedPort
        ? 'unknown'
        : target
          ? 'errors_found'
          : 'clear';
    const details = {
      source: 'userside-interface-errors',
      deviceId,
      expectedDeviceId,
      expectedInterface,
      expectedPort,
      interface: target?.interface || expectedInterface || expectedPort,
      errorsIn: target?.errorsIn || '',
      errorsOut: target?.errorsOut || '',
      deltaDay: target?.deltaDay || '',
      deltaWeek: target?.deltaWeek || '',
      rowCount: parsed.length
    };

    return {
      facts: {
        identity: {},
        network: {
          accessErrorsStatus: fact(result, 'userside:interface-errors-status', result !== 'unknown' ? 0.96 : 0),
          accessErrorsIn: fact(details.errorsIn, 'userside:interface-errors-in', target ? 0.98 : 0),
          accessErrorsOut: fact(details.errorsOut, 'userside:interface-errors-out', target ? 0.98 : 0),
          accessErrorsDeltaDay: fact(details.deltaDay, 'userside:interface-errors-day', target ? 0.96 : 0),
          accessErrorsDeltaWeek: fact(details.deltaWeek, 'userside:interface-errors-week', target ? 0.96 : 0)
        },
        pon: {},
        profile: {}
      },
      meta: {
        reader: 'userside',
        ethernetErrors: { result, ...details },
        locatorObservations: [{
          type: 'ETHERNET_PORT_ERRORS',
          result,
          method: 'userside_interface_errors',
          source: 'userside',
          details,
          summary: result === 'errors_found'
            ? `Для ${details.interface} есть счётчики ошибок: in ${details.errorsIn || '0'}, out ${details.errorsOut || '0'}. Важно смотреть их прирост во времени.`
            : result === 'clear'
              ? `${details.interface || 'Порт абонента'} отсутствует в списке зарегистрированных интерфейсных ошибок.`
              : 'Не удалось надёжно сопоставить таблицу ошибок с портом абонента.'
        }]
      },
      quality: {
        trustedPage: true,
        parser: 'userside-ethernet-interface-errors-v1'
      }
    };
  }

  function collectDevice(context) {
    const {
      pageInfo,
      map,
      text,
      fact,
      validIp,
      compact,
      activeCase
    } = context;
    const deviceId = pageInfo.entityId || '';
    const titleName = compact(
      document.title.replace(/\s*-\s*Оборудование.*$/i, ''),
      220
    );
    const sectionName = compact(
      document.querySelector('.div_razdel')?.textContent
        ?.replace(/^Оборудование\s*\/\s*/i, '') || '',
      220
    );
    const model = find(map, [/^модель$/i, /model/i]);
    const systemName = find(map, [/системное имя/i, /system name/i])
      || text.match(/(?:Системное имя|System name)\s*:?\s*([^\n]{3,120})/i)?.[1]
      || '';
    const oltName = sectionName || titleName || compact(systemName, 220);
    const oltIp = pageIp(validIp)
      || validIp(find(map, [/^ip$/i, /ip адрес/i]));
    const existing = activeCase?.locator?.candidates?.find(item => item.deviceId === deviceId)
      || activeCase?.locator?.candidates?.[0]
      || {};
    const expectedAccessDeviceId = String(valueOf(activeCase?.network?.accessDeviceId) || '');
    const connectionFamily = String(valueOf(activeCase?.network?.connectionFamily) || '').toLowerCase();
    const isEthernetDevice = connectionFamily === 'ethernet'
      || Boolean(expectedAccessDeviceId && expectedAccessDeviceId === deviceId);

    if (isEthernetDevice) {
      const sameDevice = !expectedAccessDeviceId || expectedAccessDeviceId === deviceId;
      const details = {
        source: 'userside-access-switch',
        deviceId,
        deviceName: oltName,
        deviceIp: oltIp,
        model: compact(model, 300),
        systemName: compact(systemName, 220),
        expectedDeviceId: expectedAccessDeviceId,
        sameDevice,
        confidence: sameDevice ? 0.98 : 0.4
      };
      return {
        facts: {
          identity: {},
          network: {
            accessDeviceId: fact(deviceId, 'userside:access-switch-id', sameDevice ? 0.99 : 0),
            accessDeviceName: fact(oltName, 'userside:access-switch-name', sameDevice && oltName ? 0.96 : 0),
            accessDeviceIp: fact(oltIp, 'userside:access-switch-ip', sameDevice && oltIp ? 0.98 : 0)
          },
          pon: {},
          profile: {}
        },
        meta: {
          reader: 'userside',
          ethernetDevice: details,
          locatorObservations: [{
            type: 'ETHERNET_DEVICE',
            result: sameDevice ? 'confirmed' : 'wrong_device',
            method: 'userside_access_switch',
            source: 'userside',
            details,
            summary: sameDevice
              ? `Открыт коммутатор точки подключения: ${oltName || deviceId}${oltIp ? ` (${oltIp})` : ''}.`
              : 'Открыт другой коммутатор; Ethernet-маршрут текущего абонента не изменён.'
          }]
        },
        quality: {
          trustedPage: true,
          parser: 'userside-ethernet-device-v1'
        }
      };
    }

    const details = {
      ...existing,
      source: 'userside-device',
      deviceId,
      oltName,
      oltIp,
      model: compact(model, 300),
      systemName: compact(systemName, 220),
      confidence: oltIp && oltName ? 0.96 : 0.82
    };

    return {
      facts: {
        identity: {},
        network: {},
        pon: {
          locatedDeviceId: fact(deviceId, 'userside:device-id', deviceId ? 0.99 : 0),
          locatedOltName: fact(oltName, 'userside:device-name', oltName ? 0.94 : 0),
          locatedOltIp: fact(oltIp, 'userside:device-ip', oltIp ? 0.98 : 0),
        },
        profile: {}
      },
      meta: {
        reader: 'userside',
        deviceDetails: details,
        locatorObservations: [
          {
            type: 'DEVICE_DETAILS',
            result: oltIp || oltName ? 'found' : 'partial',
            method: 'userside_device_card',
            source: 'userside',
            details,
            summary: oltIp && oltName
              ? 'Определены фактическая OLT и IP; тип опроса вычислит PON workflow.'
              : 'Карточка оборудования прочитана частично.'
          }
        ]
      },
      quality: {
        trustedPage: true,
        parser: 'userside-device-locator-v1'
      }
    };
  }

  WB.readers ||= {};
  WB.readers.userside = {
    read(context) {
      switch (context.pageInfo.kind) {
        case 'userside_customer':
          return collectCustomer(context);
        case 'userside_customer_list':
          return collectMacSearch(context);
        case 'interface_mac_list':
          return collectInterfaceList(context);
        case 'device_poller':
          if (context.pageInfo.subview === 'fdb_table') return collectEthernetFdb(context);
          break;
        case 'device_interface_errors':
          return collectEthernetErrors(context);
        case 'userside_device':
          return collectDevice(context);
        default:
          return {
            facts: {
              identity: {},
              network: {},
              pon: {},
              profile: {}
            },
            meta: {
              reader: 'userside',
              ignoredPage: context.pageInfo.kind,
              locatorObservations: []
            },
            quality: {
              trustedPage: false,
              parser: 'userside-ignored-v1'
            }
          };
      }
    },

    __test: {
      normalizeSerial,
      classifyEthernetAccessPoint,
      ethernetAccessPoint
    }
  };
})();
