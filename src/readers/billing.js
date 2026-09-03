(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const ACTION_NAMES = Object.freeze({
    '310': 'EPON',
    '311': 'GPON',
    '312': 'GCOM',
    '313': 'Huawei'
  });

  function normalizeLabel(value, compact) {
    return compact(value, 180)
      .toLowerCase()
      .replace(/[:：]\s*$/, '')
      .replace(/\s+/g, ' ');
  }

  function safeSerial(value, compact) {
    const text = compact(value, 180)
      .replace(/^[-—:№#\s]+/, '')
      .replace(/\s+/g, '')
      .toUpperCase();

    if (!text || text === '[PROTECTED]') return '';
    if (!/[A-Z0-9]/.test(text)) return '';
    return text.length >= 6 && text.length <= 64 ? text : '';
  }

  function extractMac(value, normalizeMac) {
    const match = String(value || '').match(
      /(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}|[0-9a-f]{12}/i
    );
    return normalizeMac(match?.[0] || '');
  }

  function collectRows({ compact, controlValue }) {
    const rows = [];

    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
      if (cells.length < 2) continue;

      const label = compact(
        cells[0].innerText || cells[0].textContent || '',
        180
      );
      if (!label || label.length > 180) continue;

      const valueCell = cells[cells.length - 1];
      const control = valueCell.querySelector('input,select,textarea')
        || row.querySelector('input,select,textarea');

      const value = compact(
        control
          ? controlValue(control)
          : (valueCell.innerText || valueCell.textContent || ''),
        320
      );

      rows.push({
        row,
        label,
        labelKey: normalizeLabel(label, compact),
        value,
        control,
        rawText: compact(row.innerText || row.textContent || '', 600)
      });
    }

    return rows;
  }

  function firstRow(rows, patterns) {
    return rows.find(item =>
      patterns.some(pattern => pattern.test(item.labelKey))
    ) || null;
  }

  function rowValue(rows, patterns) {
    return firstRow(rows, patterns)?.value || '';
  }

  function exactLogin(text, compact) {
    const selectors = 'input[value],a[href],td,span,b,strong,div';

    for (const element of document.querySelectorAll(selectors)) {
      const value = compact(
        element.value || element.textContent || '',
        80
      );
      if (/^abon\d{3,12}$/i.test(value)) return value.toLowerCase();
    }

    return text.match(/\b(abon\d{3,12})\b/i)?.[1]?.toLowerCase() || '';
  }

  function gotouserIp(validIp) {
    const links = document.querySelectorAll(
      'a[href*="userside.simnet.kiev.ua/script/gotouser.php"],' +
      'a[href*="/script/gotouser.php"]'
    );

    for (const link of links) {
      try {
        const ip = validIp(
          new URL(link.href, location.href).searchParams.get('ip') || ''
        );
        if (ip) return ip;
      } catch {}
    }

    return '';
  }

  function normalizeConnectionFamily(value) {
    const text = String(value || '').trim();

    if (/\bpon\b|\bgpon\b|\bepon\b|\bg[\s_-]*com\b|huawei/i.test(text)) {
      return 'PON';
    }
    if (
      /ethernet|коммутатор|switch|порт\s+коммутатора|utp|витая\s+пара/i.test(text)
    ) {
      return 'Ethernet';
    }

    return '';
  }

  function parseOlt(rows, { compact, validIp }) {
    const directSelect = document.querySelector('select[name="dopfield_29"]');

    const oltRow = firstRow(rows, [
      /^olt$/i,
      /\bolt\b/i,
      /головн.*станц/i,
      /голов.*станц/i
    ]);

    const select = directSelect
      || (oltRow?.control?.tagName === 'SELECT' ? oltRow.control : null);

    const option = select?.options?.[select.selectedIndex] || null;
    const display = compact(
      option?.textContent || oltRow?.value || '',
      260
    );

    // Значения-заглушки не считаются выбранной OLT.
    const usefulDisplay = /выбер|оберіть|не\s+указ|нет\s+данн/i.test(display)
      ? ''
      : display;

    const rawValue = compact(select?.value || '', 120);
    const ip = validIp(usefulDisplay);
    const id = /^\d+$/.test(rawValue) && rawValue !== '0'
      ? rawValue
      : '';

    let name = usefulDisplay;
    if (ip) name = name.replace(ip, ' ');

    name = name
      .replace(/[()]/g, ' ')
      .replace(/\s*[-–—|]\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      name,
      id,
      ip,
      display: usefulDisplay
    };
  }

  function pollCandidates(compact) {
    const candidates = [];

    for (const link of document.querySelectorAll('a[href*="stat.pl"]')) {
      try {
        const url = new URL(link.href, location.href);
        const action = url.searchParams.get('a') || '';
        if (!ACTION_NAMES[action]) continue;

        candidates.push({
          action,
          type: ACTION_NAMES[action],
          label: compact(
            link.innerText || link.textContent || ACTION_NAMES[action],
            100
          )
        });
      } catch {}
    }

    // Это только доступные вкладки, а не доказательство технологии.
    return candidates;
  }

  function strictOltIpFromPoll({ text, validIp }) {
    const params = new URLSearchParams(location.search);
    const fromQuery = validIp(params.get('olt_ip') || '');
    if (fromQuery) return fromQuery;

    const selected = document.querySelector(
      'select[name*="olt"] option:checked,' +
      'select[id*="olt"] option:checked'
    );

    const selectedIp = validIp(selected?.textContent || '');
    if (selectedIp) return selectedIp;

    const labeledPatterns = [
      /(?:^|\s)OLT\s*(?:IP)?\s*[:=]\s*((?:\d{1,3}\.){3}\d{1,3})/i,
      /(?:выбор|обрано|selected).{0,80}OLT.{0,80}\(((?:\d{1,3}\.){3}\d{1,3})\)/i,
      /(?:Sim|Look)[^\n]{0,100}-OLT[^\n]{0,100}\(((?:\d{1,3}\.){3}\d{1,3})\)/i
    ];

    for (const pattern of labeledPatterns) {
      const match = text.match(pattern);
      const ip = validIp(match?.[1] || '');
      if (ip) return ip;
    }

    return '';
  }

  function durableEvidenceBlocks(commandBlocks = [], compact) {
    return (Array.isArray(commandBlocks) ? commandBlocks : [])
      .filter(block => block && typeof block === 'object')
      .slice(0, 18)
      .map(block => ({
        parserKey: compact(block.parserKey || '', 40),
        family: compact(block.family || '', 60),
        label: compact(block.label || '', 120),
        state: compact(block.state || 'neutral', 24),
        relation: compact(block.relation || 'context', 24),
        visualPriority: compact(block.visualPriority || '', 24),
        summary: compact(block.summary || '', 420),
        diagnosticNote: compact(block.diagnosticNote || '', 520),
        facts: block.facts && typeof block.facts === 'object'
          ? JSON.parse(JSON.stringify(block.facts))
          : {}
      }));
  }

  function blockByFamily(blocks = [], family = '') {
    return blocks.find(block => block?.family === family) || null;
  }

  function parsePollResult({
    pageInfo,
    text,
    fact,
    validIp,
    compact,
    activeCase
  }) {
    const action = new URLSearchParams(location.search).get('a') || '';
    const openedTab = ACTION_NAMES[action] || '';
    const pollResultParser = WB.parsers?.billing?.pollResult;
    const classified = pollResultParser?.classifyPollText
      ? pollResultParser.classifyPollText(text, activeCase, { action })
      : {
          result: 'unknown',
          ready: false,
          pending: false,
          pollResponded: false,
          identityAssessment: 'unverified',
          identityConflicts: [],
          matchedBy: [],
          observedOnuMac: '',
          observedSerial: '',
          interface: '',
          summary: compact(text, 1200),
          expected: {}
        };

    const commandBlocks = WB.pollTerminal?.snapshot?.() || [];
    const terminalResponded = commandBlocks.some(block => block?.responseEvidence === true);
    const rawPollResponded = Boolean(classified.pollResponded || terminalResponded);

    const activeExpectedPollAction = String(
      activeCase?.diagnostic?.pollAction
      || ''
    );
    const recentAttempt = WB.interactionGuards?.recentPollRequest?.() || null;
    const attemptExpectedPollAction = String(
      recentAttempt?.action
      && (!recentAttempt?.billingId || String(recentAttempt.billingId) === String(new URLSearchParams(location.search).get('id') || ''))
        ? recentAttempt.action
        : ''
    );
    const attemptCanonicalPollAction = String(
      recentAttempt?.expectedAction
      && (!recentAttempt?.billingId || String(recentAttempt.billingId) === String(new URLSearchParams(location.search).get('id') || ''))
        ? recentAttempt.expectedAction
        : ''
    );
    // The operator may deliberately click another native technology after a
    // warning. That request is allowed, but it must not redefine the canonical
    // Billing-derived poll type or turn a wrong-tech response into completion.
    const expectedPollAction = attemptCanonicalPollAction || activeExpectedPollAction || attemptExpectedPollAction || '';
    const wrongPollTab = Boolean(
      expectedPollAction
      && action
      && expectedPollAction !== action
    );

    const params = new URLSearchParams(location.search);
    const billingId = String(params.get('id') || '');
    const pollMatch = {
      action,
      billingId,
      oltIp: String(params.get('olt_ip') || ''),
      maxAgeMs: 180000,
      responseEvidence: rawPollResponded
    };
    // Billing does not guarantee that `act=askolt` / `olt_ip` survive until
    // the response is rendered. In real sessions the native page can return to
    // plain `a=310..313&id=...` while the same request is still active. The
    // durable attempt (action + Billing id + optional OLT) is therefore the
    // correlation authority; the query flag is only one possible transport
    // detail and must not decide whether a real response belongs to the poll.
    const requestObserved = Boolean(
      WB.interactionGuards?.pollRequestMatches
        ? WB.interactionGuards.pollRequestMatches(pollMatch)
        : params.get('act') === 'askolt'
    );
    const lateResponseRecovery = Boolean(
      WB.interactionGuards?.isRecoverableLatePollResponse?.(pollMatch)
    );
    const uiStable = WB.interactionGuards?.isUiReady
      ? WB.interactionGuards.isUiReady({ quietMs: 90 })
      : document.readyState === 'complete';

    // Guard Rails: opening a tab, clicking the request link or merely rendering
    // command blocks can never finish a poll. We require a real askolt document,
    // the expected poll type, stable DOM, and positive parsed response evidence.
    const pollResponded = Boolean(
      rawPollResponded
      && requestObserved
      && !wrongPollTab
      && uiStable
    );
    const pollOutcome = wrongPollTab
      ? !requestObserved
        ? 'unknown'
        : !uiStable
          ? 'pending'
          : rawPollResponded || ['not_found', 'timeout', 'olt_unreachable', 'parser_error'].includes(String(classified.result || ''))
            ? 'conflict'
            : classified.result === 'pending'
              ? 'pending'
              : 'unknown'
      : !requestObserved
        ? rawPollResponded && !wrongPollTab
          ? 'observed'
          : 'unknown'
        : !uiStable
          ? 'pending'
          : pollResponded && classified.result !== 'not_found'
            ? 'confirmed'
            : classified.result;

    if (
      requestObserved
      && uiStable
      && !['unknown', 'pending', 'partial'].includes(pollOutcome)
    ) {
      WB.interactionGuards?.resolvePollRequest?.({
        action,
        billingId,
        outcome: pollOutcome
      });
    }

    const rxMatch = text.match(
      /(?:received\s+power|rx(?:\s*power)?|прием|прийом|уровень\s*(?:rx|приема|прийому))\s*(?:\(dBm\))?\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i
    );

    const txMatch = text.match(
      /(?:transmitted\s+power|tx(?:\s*power)?|передач[аи]|рівень\s*tx)\s*(?:\(dBm\))?\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i
    );

    const distanceMatch = text.match(
      /(?:distance|расстояни[ея]|відстань)\s*(?:\(m\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(m|км|km|метр\w*)?/i
    );

    const oltIp = strictOltIpFromPoll({ text, validIp });
    const expectedOltName = String(
      activeCase?.pon?.oltName?.value
      || activeCase?.pon?.oltName
      || ''
    );
    const expectedOnuMac = String(
      activeCase?.pon?.onuMac?.value
      || activeCase?.pon?.onuMac
      || ''
    );
    const expectedOnuSerial = String(
      activeCase?.pon?.onuSerial?.value
      || activeCase?.pon?.onuSerial
      || ''
    );
    const subscriberMac = String(
      activeCase?.network?.mac?.value
      || activeCase?.network?.mac
      || ''
    );
    const expectedTechnology = String(
      ACTION_NAMES[activeExpectedPollAction]
      || ''
    );

    const status = pollOutcome === 'confirmed'
      ? (
          text.match(/ONU\s+(?:gpon|epon)[^\n\r]{0,120}\s+is\s*-\s*(online|offline)/i)?.[1]
          || text.match(/\bRun\s+state\s*:\s*(online|offline)\b/i)?.[1]
          || text.match(/\b(?:registered|link-up|auto-configured|ctc-oam-oper)\b/i)?.[0]
          || 'responded'
        )
      : '';

    const rx = rxMatch
      ? `${rxMatch[1].replace(',', '.')} dBm`
      : '';
    const tx = txMatch
      ? `${txMatch[1].replace(',', '.')} dBm`
      : '';
    const distance = distanceMatch
      ? `${distanceMatch[1].replace(',', '.')} ${distanceMatch[2] || 'm'}`
      : '';

    const durableBlocks = durableEvidenceBlocks(commandBlocks, compact);
    const onuInfoBlock = blockByFamily(durableBlocks, 'ont_info');
    const ethernetBlock = blockByFamily(durableBlocks, 'ont_port_state');
    const macBlock = blockByFamily(durableBlocks, 'mac_address');
    const opticalBlock = blockByFamily(durableBlocks, 'optical');
    const historyBlock = blockByFamily(durableBlocks, 'history')
      || durableBlocks.find(block => ['diagnostic', 'history'].includes(block.visualPriority))
      || null;
    const learnedMacs = Array.isArray(macBlock?.facts?.macs)
      ? macBlock.facts.macs.filter(Boolean)
      : [macBlock?.facts?.subscriberMac].filter(Boolean);
    const resolvedStatus = status === 'responded'
      ? String(onuInfoBlock?.facts?.runState || status)
      : status;
    const resolvedRx = rx || (Number.isFinite(opticalBlock?.facts?.onuRxDbm)
      ? `${opticalBlock.facts.onuRxDbm} dBm`
      : '');
    const resolvedTx = tx || (Number.isFinite(opticalBlock?.facts?.onuTxDbm)
      ? `${opticalBlock.facts.onuTxDbm} dBm`
      : '');
    const resolvedDistance = distance || (Number.isFinite(onuInfoBlock?.facts?.distanceM)
      ? `${onuInfoBlock.facts.distanceM} m`
      : '');
    const actualTechnology = openedTab || expectedTechnology;

    const durableSnapshot = {
      schemaVersion: 1,
      outcome: pollOutcome,
      pollAction: action,
      pollType: actualTechnology,
      parserKey: durableBlocks.find(block => block.parserKey)?.parserKey || actualTechnology,
      oltName: expectedOltName,
      oltIp,
      onuStatus: resolvedStatus,
      onuMac: expectedOnuMac,
      onuSerial: expectedOnuSerial,
      observedOnuMac: classified.observedOnuMac || '',
      observedOnuSerial: classified.observedSerial || '',
      subscriberMac,
      observedSubscriberMac: classified.observedSubscriberMac || learnedMacs[0] || '',
      learnedMacs,
      interface: classified.interface || '',
      rx: resolvedRx,
      tx: resolvedTx,
      distance: resolvedDistance,
      oltRx: Number.isFinite(opticalBlock?.facts?.oltRxDbm)
        ? `${opticalBlock.facts.oltRxDbm} dBm`
        : '',
      linkState: String(ethernetBlock?.facts?.linkState || ''),
      speedMbps: Number.isFinite(ethernetBlock?.facts?.speedMbps)
        ? ethernetBlock.facts.speedMbps
        : null,
      duplex: String(ethernetBlock?.facts?.duplex || ''),
      vlan: Number.isFinite(macBlock?.facts?.vlan) ? macBlock.facts.vlan : null,
      identityAssessment: classified.identityAssessment || 'unverified',
      identityConflicts: classified.identityConflicts || [],
      matchedBy: classified.matchedBy || [],
      responseSummary: compact(classified.summary || '', 1200),
      historySummary: compact(historyBlock?.summary || historyBlock?.diagnosticNote || '', 520),
      offlineSince: compact(historyBlock?.facts?.currentOfflineSince || '', 80),
      offlineDuration: compact(historyBlock?.facts?.currentOfflineDuration || '', 80),
      offlineDurationMs: Number.isFinite(historyBlock?.facts?.currentOfflineDurationMs)
        ? Number(historyBlock.facts.currentOfflineDurationMs)
        : null,
      evidence: durableBlocks
    };

    const observationDetails = {
      source: 'billing-poll',
      oltName: expectedOltName,
      oltIp,
      onuMac: expectedOnuMac,
      onuSerial: expectedOnuSerial,
      subscriberMac,
      observedOnuMac: classified.observedOnuMac || '',
      observedOnuSerial: classified.observedSerial || '',
      interface: classified.interface || '',
      pollAction: action,
      technology: actualTechnology,
      pollCompleted: pollOutcome === 'confirmed',
      pollResponded,
      terminalResponded,
      terminalBlockCount: commandBlocks.length,
      requestObserved,
      uiStable,
      expectedPollAction,
      attemptExpectedPollAction,
      activeExpectedPollAction,
      wrongPollTab,
      rawPollResponded,
      responseEvidence: rawPollResponded,
      lateResponseRecovery,
      identityAssessment: classified.identityAssessment || 'unverified',
      identityConflicts: classified.identityConflicts || [],
      matchedBy: classified.matchedBy || [],
      expected: classified.expected || {},
      observed: {
        onuMac: classified.observedOnuMac || '',
        onuSerial: classified.observedSerial || '',
        subscriberMac: classified.observedSubscriberMac || '',
        interface: classified.interface || ''
      }
    };

    return {
      facts: {
        identity: {
          billingId: fact(
            pageInfo?.entityId || billingId || '',
            'billing:poll-url-id',
            (pageInfo?.entityId || billingId) ? 0.99 : 0
          )
        },
        network: {},
        pon: {
          status: fact(
            status,
            'billing:direct-olt-poll-status',
            status ? 0.99 : 0
          ),
          rx: fact(
            pollOutcome === 'confirmed' ? rx : '',
            'billing:direct-olt-poll-rx',
            rx ? 0.98 : 0
          ),
          tx: fact(
            pollOutcome === 'confirmed' ? tx : '',
            'billing:direct-olt-poll-tx',
            tx ? 0.96 : 0
          ),
          distance: fact(
            pollOutcome === 'confirmed' ? distance : '',
            'billing:direct-olt-poll-distance',
            distance ? 0.96 : 0
          ),
          locatedInterface: fact(
            pollOutcome === 'confirmed' ? classified.interface : '',
            'billing:direct-olt-poll-interface',
            classified.interface ? 0.99 : 0
          ),
          pollType: fact(
            pollOutcome === 'confirmed' && !wrongPollTab ? actualTechnology : '',
            'billing:confirmed-poll-type',
            pollOutcome === 'confirmed' && actualTechnology ? 0.995 : 0
          ),
          pollAction: fact(
            pollOutcome === 'confirmed' && !wrongPollTab ? action : '',
            'billing:confirmed-poll-action',
            pollOutcome === 'confirmed' && action ? 0.995 : 0
          )
        },
        profile: {}
      },
      meta: {
        reader: 'billing',
        poll: {
          openedTab,
          openedAction: action,
          tabIsEvidence: false,
          outcome: pollOutcome,
          ready: Boolean(requestObserved && !['pending', 'unknown'].includes(pollOutcome)),
          pending: Boolean(requestObserved && pollOutcome === 'pending'),
          requestObserved,
          uiStable,
          expectedPollAction,
          attemptAction: attemptExpectedPollAction,
          wrongPollTab,
          terminalResponded,
          responseEvidence: rawPollResponded,
          lateResponseRecovery,
          snapshot: durableSnapshot,
          matchedBy: classified.matchedBy || [],
          interface: classified.interface || '',
          commandBlocks,
          evidence: classified.summary || compact(text, 1200)
        },
        locatorObservations: requestObserved ? [
          {
            type: 'POLL_RESULT',
            result: pollOutcome,
            method: 'direct_olt_poll',
            source: 'billing',
            passive: wrongPollTab,
            passiveReason: wrongPollTab ? 'wrong-poll-type' : '',
            matchedBy: classified.matchedBy || [],
            details: observationDetails,
            summary: wrongPollTab
              ? 'Опрос запущен на вкладке другой технологии; результат сохранён только как пассивный контекст.'
              : pollOutcome === 'not_found'
                ? 'ONU не найдена на указанной связке OLT + ONU.'
                : pollOutcome === 'confirmed'
                  ? 'Штатный опрос OLT/ONU выполнен: оборудование вернуло технический ответ.'
                  : classified.summary || ''
          }
        ] : []
      },
      quality: {
        trustedPage: true,
        parser: 'billing-onu-poll-v3'
      }
    };
  }


  function parseJuniperResult(context) {
    const { pageInfo, fact } = context;
    const parsed = WB.juniperParser?.parseDocument?.(document) || {
      parserVersion: '',
      result: 'error',
      sessions: [],
      session: null,
      summary: 'Juniper: parser недоступен. Основной маршрут не блокируется.'
    };
    const session = parsed.session || null;
    const details = session ? {
      subscriberIp: session.subscriberIp || '',
      subscriberMac: session.subscriberMac || '',
      brasName: session.brasName || '',
      brasIp: session.brasIp || '',
      source: session.source || '',
      sessionId: session.sessionId || '',
      status: session.status || '',
      statusRaw: session.statusRaw || '',
      username: session.username || '',
      authType: session.authType || '',
      startTime: session.startTime || '',
      bytesRaw: session.bytesRaw || '',
      speedRaw: session.speedRaw || '',
      rxBps: session.rxBps,
      txBps: session.txBps,
      hasTraffic: session.hasTraffic,
      lastEventTime: session.lastEventTime || '',
      lastEvent: session.lastEvent || '',
      router: session.router || '',
      vendor: session.vendor || '',
      vlan: session.vlan || '',
      staleRadius: Boolean(session.staleRadius),
      parserVersion: parsed.parserVersion || WB.juniperParser?.version || '',
      readOnly: true,
      sessionCount: Number(parsed.sessions?.length || 0)
    } : {
      parserVersion: parsed.parserVersion || WB.juniperParser?.version || '',
      readOnly: true,
      sessionCount: Number(parsed.sessions?.length || 0)
    };

    return {
      facts: {
        identity: {
          billingId: fact(
            pageInfo.entityId || '',
            'billing:juniper-url-id',
            pageInfo.entityId ? 0.99 : 0
          )
        },
        network: {},
        pon: {},
        profile: {}
      },
      meta: {
        reader: 'billing',
        juniper: {
          ...details,
          result: parsed.result || 'error',
          summary: parsed.summary || ''
        },
        locatorObservations: [
          {
            type: 'JUNIPER_SESSION',
            result: parsed.result || 'error',
            method: 'billing-juniper-page',
            source: 'billing-juniper',
            details,
            summary: parsed.summary || 'Juniper: данные сессии прочитаны.'
          }
        ]
      },
      quality: {
        trustedPage: true,
        parser: 'billing-juniper-v1'
      }
    };
  }

  function collect(context) {
    const {
      pageInfo,
      text,
      fact,
      normalizeMac,
      validIp,
      compact,
      controlValue,
      activeCase
    } = context;

    if (![
      'billing_user',
      'billing_technical',
      'billing_onu_poll',
      'billing_juniper'
    ].includes(pageInfo.kind)) {
      return {
        facts: {
          identity: {},
          network: {},
          pon: {},
          profile: {}
        },
        meta: {
          reader: 'billing',
          ignoredPage: pageInfo.kind
        },
        quality: {
          trustedPage: false
        }
      };
    }

    if (pageInfo.kind === 'billing_onu_poll') {
      return parsePollResult(context);
    }

    if (pageInfo.kind === 'billing_juniper') {
      return parseJuniperResult(context);
    }

    const rows = collectRows({ compact, controlValue });
    const login = exactLogin(text, compact);
    const contract = login ? login.replace(/^abon/i, '') : '';

    const handoffIp = gotouserIp(validIp);
    const labeledIp = validIp(
      rowValue(rows, [
        /^ip$/i,
        /^ip адрес/i,
        /^ip-адрес/i
      ])
    );
    const ip = handoffIp || labeledIp;

    const subscriberMacRaw = rowValue(rows, [
      /мак-?адрес абонента/i,
      /mac-?адрес абонента/i,
      /mac.{0,20}клиент/i,
      /мак.{0,20}клієнт/i
    ]);

    const routerMacRaw = rowValue(rows, [
      /mac.{0,20}роут/i,
      /мак.{0,20}роут/i,
      /router.{0,20}mac/i
    ]);

    const onuMacRaw = rowValue(rows, [
      /epon.*(?:мак|mac)/i,
      /(?:мак|mac).*epon/i,
      /onu.*(?:мак|mac)/i,
      /(?:мак|mac).*onu/i
    ]);

    const serialRaw = rowValue(rows, [
      /gpon.*(?:серийн|серійн|serial|sn)/i,
      /ont.*(?:серийн|серійн|serial|sn)/i,
      /onu.*(?:серийн|серійн|serial|sn)/i,
      /(?:серийн|серійн).*onu/i
    ]);

    const portRaw = rowValue(rows, [
      /^pon.{0,10}порт/i,
      /^порт.{0,10}pon/i,
      /^интерфейс/i,
      /^interface/i
    ]);

    const connectionRaw = rowValue(rows, [
      /^тип\s+подключ/i,
      /^тип\s+підключ/i,
      /^технолог/i,
      /технологи.{0,35}подключ/i
    ]);

    const connectionFamily = normalizeConnectionFamily(connectionRaw);
    const technical = pageInfo.kind === 'billing_technical'
      ? WB.parsers?.billing?.technical?.parseDocument?.(document)
      : null;
    const oltFromRows = parseOlt(rows, { compact, validIp });
    const olt = technical
      ? {
          ...oltFromRows,
          name: technical.values.oltName,
          id: technical.values.oltId,
          ip: technical.values.oltIp,
          display: technical.values.oltName
        }
      : oltFromRows;
    const candidates = pollCandidates(compact);

    const subscriberMac = extractMac(
      subscriberMacRaw,
      normalizeMac
    ) || extractMac(
      routerMacRaw,
      normalizeMac
    );
    const onuMac = technical
      ? technical.values.onuMac
      : extractMac(onuMacRaw, normalizeMac);
    const onuSerial = technical
      ? safeSerial(technical.values.onuSerial, compact)
      : safeSerial(serialRaw, compact);

    const fullName = rowValue(rows, [
      /^фио$/i,
      /^піб$/i,
      /^абонент$/i,
      /^клиент$/i,
      /^клієнт$/i,
      /наименование клиента/i
    ]);

    const address = rowValue(rows, [
      /^адрес$/i,
      /^адреса$/i,
      /адрес подключ/i,
      /адрес підключ/i
    ]);

    const tariff = rowValue(rows, [/^тариф/i]);
    const balance = rowValue(rows, [/^баланс/i, /^сальдо/i]);

    const hasSubscriberIdentity = Boolean(login || pageInfo.entityId);
    const hasOnuIdentity = Boolean(onuMac || onuSerial);
    const hasOlt = Boolean(olt.name);
    const isPon = connectionFamily === 'PON';

    return {
      facts: {
        identity: {
          login: fact(
            login,
            'billing:exact-login',
            login ? 0.98 : 0
          ),
          contract: fact(
            contract,
            'derived:billing-login',
            contract ? 0.96 : 0
          ),
          billingId: fact(
            pageInfo.entityId || '',
            'billing:url-id',
            pageInfo.entityId ? 0.99 : 0
          )
        },
        network: {
          ip: fact(
            ip,
            handoffIp
              ? 'billing:userside-handoff-ip'
              : 'billing:labeled-ip',
            ip ? 0.96 : 0
          ),
          mac: fact(
            subscriberMac,
            'billing:subscriber-mac',
            subscriberMac ? 0.94 : 0
          ),
          connectionFamily: fact(
            connectionFamily,
            'billing:connection-type',
            connectionFamily ? 0.96 : 0
          ),
          connectionRaw: fact(
            connectionRaw,
            'billing:connection-type-raw',
            connectionRaw ? 0.92 : 0
          )
        },
        pon: {
          onuMac: fact(
            onuMac,
            'billing:onu-mac',
            onuMac ? 0.96 : 0
          ),
          onuSerial: fact(
            onuSerial,
            'billing:onu-serial',
            onuSerial ? 0.96 : 0
          ),
          oltName: fact(
            olt.name,
            'billing:olt-selected-option',
            olt.name ? 0.97 : 0
          ),
          oltId: fact(
            olt.id,
            'billing:olt-select-value',
            olt.id ? 0.9 : 0
          ),
          oltIp: fact(
            olt.ip,
            'billing:olt-selected-option-ip',
            olt.ip ? 0.97 : 0
          ),
          port: fact(
            portRaw,
            'billing:labeled-pon-port',
            portRaw ? 0.82 : 0
          )
        },
        profile: {
          fullName: fact(
            fullName,
            'billing:labeled-name',
            fullName ? 0.84 : 0
          ),
          address: fact(
            address,
            'billing:labeled-address',
            address ? 0.86 : 0
          ),
          tariff: fact(
            tariff,
            'billing:labeled-tariff',
            tariff ? 0.84 : 0
          ),
          balance: fact(
            balance,
            'billing:labeled-balance',
            balance ? 0.8 : 0
          )
        }
      },
      meta: {
        reader: 'billing',
        technical: {
          rowCount: rows.length,
          hasSubscriberIdentity,
          hasOnuIdentity,
          hasOlt,
          isPon,
          // Вкладки — только доступные действия интерфейса.
          pollCandidates: candidates,
          // Это только факты страницы. Poll readiness вычисляет PON workflow.
          sufficientIdentityForPoll: isPon && hasOnuIdentity && hasOlt
        }
      },
      quality: {
        trustedPage: true,
        parser: pageInfo.kind === 'billing_technical'
          ? 'billing-technical-v3'
          : 'billing-user-v2.1'
      }
    };
  }

  WB.readers ||= {};
  WB.readers.billing = {
    read: collect,
    ACTION_NAMES,
    __test: {
      normalizeConnectionFamily,
      strictOltIpFromPoll,
      parseJuniperResult
    }
  };
})();
