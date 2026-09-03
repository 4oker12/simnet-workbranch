(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const valueOf = fact => (
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact
  );

  const normalizeMac = value => {
    const hex = String(value || '')
      .replace(/[^0-9a-f]/gi, '')
      .toUpperCase();
    return hex.length === 12 ? hex : '';
  };

  const normalizeSerial = value => String(value || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

  const displayMac = value => {
    const hex = normalizeMac(value);
    return hex ? hex.match(/.{2}/g).join(':') : '';
  };

  function firstMacNear(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const mac = displayMac(match?.[1] || '');
      if (mac) return mac;
    }
    return '';
  }

  function firstInterface(text) {
    // Prefer the most specific F/S/P[:ONT] representation. The old order
    // truncated Huawei GPON0/1/10:19 to GPON0/1 and weakened identity evidence.
    const patterns = [
      /\b((?:gpon|epon)\d+\/\d+\/\d+(?::\d+)?)\b/i,
      /\b((?:E|G)PON\d+\/\d+(?:\/\d+)?(?::\d+)?)\b/i,
      /\b(epon\d+\/\d+(?::\d+)?)\b/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].toUpperCase();
    }
    return '';
  }

  function serialAliases(text) {
    const source = String(text || '');
    const values = [];
    const push = value => {
      const normalized = normalizeSerial(value);
      if (normalized && !values.includes(normalized)) values.push(normalized);
    };

    // Command arguments identify what was requested; they are not observed serial evidence.
    push(source.match(/\bSN\s*:\s*[0-9A-F]{8,32}\s*\(([^)]+)\)/i)?.[1] || '');
    push(source.match(/(?:SN\s*ONU|serial|серийн\w*|серійн\w*)\s*[:#=]?\s*([A-Z0-9]{4,16}:[A-Z0-9]{4,32}|[A-Z0-9]{8,64})/i)?.[1] || '');
    return values;
  }

  function classifyPollText(text, activeCase = {}, options = {}) {
    const sourceText = String(text || '')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/<br\s*\/?>(?=.)/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ');
    const compact = sourceText.replace(/\s+/g, ' ').trim();
    const expectedOnuMac = displayMac(valueOf(activeCase?.pon?.onuMac) || '');
    const expectedSerial = normalizeSerial(valueOf(activeCase?.pon?.onuSerial) || '');
    const expectedSubscriberMac = displayMac(valueOf(activeCase?.network?.mac) || '');
    const expectedInterface = String(
      valueOf(activeCase?.pon?.locatedInterface)
      || valueOf(activeCase?.pon?.port)
      || ''
    ).toUpperCase();

    const notFound = /ONU\s+(?:не\s+найдена|не\s+знайдена)\s+на\s+OLT|ONU\s+not\s+found|ONT\s+not\s+found|no\s+such\s+(?:ONU|ONT)|(?:ONU|ONT).{0,50}(?:does\s+not\s+exist|not\s+exist)/i.test(sourceText);
    const pending = /(?:данные\s+посланы|ждите|wait\.\.\.|очікуйте|выполняется\s+опрос|загрузка)/i.test(sourceText)
      && !notFound;
    const timeout = /request\s+timed\s+out|timed?\s*out|таймаут|час\s+очікування\s+вичерпано/i.test(sourceText);
    const oltUnreachable = /(?:OLT|SNMP|telnet|ssh).{0,80}(?:недоступ|не\s+доступ|connection\s+refused|no\s+route|failed\s+to\s+connect|host\s+unreachable)/i.test(sourceText);
    const parserError = /fatal\s+error|uncaught\s+(?:error|exception)|undefined\s+(?:index|offset)|ошибка\s+(?:парс|разбор)/i.test(sourceText);
    const commandError = /invalid\s+input|unknown\s+command|unrecognized\s+command|syntax\s+error|parameter\s+error|wrong\s+parameter|not\s+supported|failed\s+to\s+execute/i.test(sourceText);

    const observedOnuMac = firstMacNear(sourceText, [
      /ONU\s+ID\s*:\s*([0-9a-f.:-]{12,20})/i,
      /IntfName[\s\S]{0,700}?\b(?:EPON|GPON)\d+(?:\/\d+){1,2}(?::\d+)?\s+([0-9a-f]{4}(?:\.[0-9a-f]{4}){2})\s+(?:auto-configured|ctc-oam-oper|online|registered)/i,
      /active\s+ONUs?\s*:[\s\S]{0,500}?\b(?:EPON|GPON)\d+(?:\/\d+){1,2}(?::\d+)?\s+([0-9a-f]{4}(?:\.[0-9a-f]{4}){2})\s+(?:auto-configured|ctc-oam-oper|online|registered)/i,
      /(?:ONU|ONT).{0,40}(?:MAC|мак)\s*[:=]?\s*([0-9a-f.:-]{12,20})/i
    ]);

    const observedSubscriberMac = firstMacNear(sourceText, [
      /display\s+mac-address[\s\S]{0,900}?\b([0-9a-f]{4}(?:[-.]?[0-9a-f]{4}){2})\s+(?:dynamic|static)\b/i,
      /Mac\s+Address\s+Table[\s\S]{0,600}?([0-9a-f]{4}(?:\.[0-9a-f]{4}){2})\s+(?:STATIC|DYNAMIC)/i
    ]);

    const observedSerialAliases = serialAliases(sourceText);
    const observedSerial = observedSerialAliases[0] || '';
    const interfaceName = firstInterface(sourceText);

    // `pollResponded` answers one question only: did the OLT/ONU actually return
    // technical output for the poll?  It is intentionally independent from identity
    // matching.  A different client MAC, different Serial or other conflict is still
    // a successful poll; those differences belong to Terminal Interpretation.
    //
    // Keep these markers terminal-specific.  A generic word such as `online` may occur
    // elsewhere on the Billing page (for example IPTV copy) and must not finish a poll.
    const pollResponded = Boolean(
      /ONU\s+(?:gpon|epon)[^\n\r]{0,120}\s+is\s*-\s*(?:online|offline)/i.test(sourceText)
      || /has\s+bound\s+\d+\s+active\s+ONUs?/i.test(sourceText)
      || /\bONU\s+ID\s*:/i.test(sourceText)
      || /\bONT-ID\s*:\s*\d+/i.test(sourceText)
      || /\bF\/S\/P\s*:\s*\d+\/\d+\/\d+/i.test(sourceText)
      || /received\s+power\s*\(dBm\)/i.test(sourceText)
      || /RxPower\s*\(dBm\)/i.test(sourceText)
      || /\bRun\s+state\s*:\s*(?:online|offline)\b/i.test(sourceText)
      || /\bConfig\s+state\s*:/i.test(sourceText)
      || /\bMatch\s+state\s*:/i.test(sourceText)
      || /ctc-oam-oper|auto-configured/i.test(sourceText)
      || /Hardware\s+state\s+is\s+Link[-\s]?(?:Up|Down)/i.test(sourceText)
      || /Port\s+status\s+is\s+(?:Enable|Disable)/i.test(sourceText)
      || /pon_port_by_onu\s*=\s*\d+/i.test(sourceText)
      || /ontid_by_onu\s*=\s*\d+/i.test(sourceText)
      || /onu_by_onu\s*=\s*(?:gpon|epon)[^\s]+/i.test(sourceText)
    );
    const strongEvidence = pollResponded;

    // Match only values actually parsed from terminal output. The Billing profile row
    // and command arguments (for example `| exclude <expected MAC>`) are context, not
    // observed network evidence.  Matching enriches the result, but no longer decides
    // whether the poll itself succeeded.
    const matchedBy = [];

    if (
      expectedOnuMac
      && observedOnuMac
      && normalizeMac(expectedOnuMac) === normalizeMac(observedOnuMac)
    ) {
      matchedBy.push('onuMac');
    }
    if (
      expectedSerial
      && observedSerialAliases.includes(expectedSerial)
    ) {
      matchedBy.push('onuSerial');
    }
    if (
      expectedSubscriberMac
      && observedSubscriberMac
      && normalizeMac(expectedSubscriberMac) === normalizeMac(observedSubscriberMac)
    ) {
      matchedBy.push('subscriberMac');
    }
    if (expectedInterface && interfaceName && expectedInterface === interfaceName) {
      matchedBy.push('interface');
    }

    const identityConflicts = [];
    if (
      expectedOnuMac
      && observedOnuMac
      && normalizeMac(expectedOnuMac) !== normalizeMac(observedOnuMac)
    ) identityConflicts.push('onuMac');
    if (
      expectedSerial
      && observedSerial
      && expectedSerial !== observedSerial
    ) identityConflicts.push('onuSerial');
    if (
      expectedSubscriberMac
      && observedSubscriberMac
      && normalizeMac(expectedSubscriberMac) !== normalizeMac(observedSubscriberMac)
    ) identityConflicts.push('subscriberMac');

    const identityAssessment = identityConflicts.length
      ? 'mismatch'
      : matchedBy.length
        ? 'matched'
        : 'unverified';

    let result = 'unknown';
    if (notFound) result = 'not_found';
    else if ((parserError || commandError) && !pollResponded) result = 'parser_error';
    else if (oltUnreachable && !pollResponded) result = 'olt_unreachable';
    else if (timeout && !pollResponded) result = 'timeout';
    else if (pollResponded) result = 'confirmed';
    else if (pending) result = 'pending';

    return {
      result,
      ready: result !== 'pending' && result !== 'unknown',
      pending: result === 'pending',
      strongEvidence,
      pollResponded,
      identityAssessment,
      identityConflicts,
      matchedBy,
      observedOnuMac,
      observedSubscriberMac,
      observedSerial,
      observedSerialAliases,
      interface: interfaceName,
      summary: compact.slice(0, 1200),
      expected: {
        onuMac: expectedOnuMac,
        onuSerial: expectedSerial,
        subscriberMac: expectedSubscriberMac,
        interface: expectedInterface
      },
      options
    };
  }

  WB.parsers ||= {};
  WB.parsers.billing ||= {};
  WB.parsers.billing.pollResult = {
    normalizeMac,
    normalizeSerial,
    displayMac,
    classifyPollText,
    serialAliases
  };
})();
