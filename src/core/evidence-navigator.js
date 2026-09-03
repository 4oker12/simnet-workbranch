(() => {
  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const factValue = value => (
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
      ? value.value
      : value
  );

  const asTime = value => {
    const text = String(value || '');
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : 0;
  };

  const latestContext = (caseData, pageKind) => {
    const contexts = Object.values(caseData?.contexts || {})
      .filter(item => String(item?.pageKind || '') === String(pageKind || ''))
      .sort((a, b) => asTime(b?.observedAt) - asTime(a?.observedAt));
    return contexts[0] || null;
  };

  const latestEvidence = (caseData, type) => {
    const evidence = Array.isArray(caseData?.locator?.evidence)
      ? caseData.locator.evidence
      : [];
    return evidence
      .filter(item => String(item?.type || '') === String(type || ''))
      .sort((a, b) => asTime(b?.at) - asTime(a?.at))[0] || null;
  };

  const technicalProgress = caseData => {
    const context = latestContext(caseData, 'billing_technical');
    const progress = caseData?.progress?.technicalChecked || null;
    if (progress?.done !== true && !context) return null;
    const verified = Boolean(caseData?.diagnostic?.billingTechnicalComplete);
    return {
      key: 'technical',
      label: 'Техданные',
      status: verified ? 'сверено' : 'просмотрено',
      level: verified ? 'verified' : 'read',
      at: progress?.at || context?.observedAt || caseData?.updatedAt || '',
      source: 'billing',
      replay: true
    };
  };

  const tmcProgress = caseData => {
    const progress = caseData?.progress?.tmcChecked || null;
    if (progress?.done !== true) return null;
    const evidence = latestEvidence(caseData, 'TMC_RESULT');
    const statusSource = caseData?.locator?.sourceStatus?.tmc || null;
    const result = String(evidence?.result || statusSource?.result || '');
    const identity = evidence?.details?.identityCheck || statusSource?.details?.identityCheck || {};
    const identityMatched = identity?.isMatch === true || evidence?.details?.matchedCurrentSubscriber === true;
    const ponDetails = caseData?.diagnostic?.ponWorkflowDetails || {};
    const prefillFields = Array.isArray(ponDetails.prefillFields) ? ponDetails.prefillFields : [];
    const conflicts = Array.isArray(ponDetails.conflicts) ? ponDetails.conflicts : [];
    const synchronizedWithBilling = Boolean(
      result === 'found'
      && identityMatched
      && prefillFields.length === 0
      && conflicts.length === 0
    );
    const needsBilling = result === 'found' && (prefillFields.length > 0 || conflicts.length > 0);
    const status = synchronizedWithBilling
      ? 'сверено с Billing'
      : needsBilling
        ? 'требует сверки с Billing'
        : result === 'found'
          ? (identityMatched ? 'данные текущего абонента' : 'данные получены')
          : ['missing','not_found'].includes(result)
            ? 'данные не найдены'
            : result === 'not_applicable'
              ? 'не применяется'
              : 'просмотрено';
    return {
      key: 'tmc',
      label: 'ТМЦ',
      status,
      level: synchronizedWithBilling ? 'verified' : needsBilling ? 'attention' : result === 'found' ? 'read' : 'observed',
      at: progress.at || evidence?.observedAt || statusSource?.updatedAt || caseData?.updatedAt || '',
      source: 'userside',
      replay: true
    };
  };

  const pollProgress = caseData => {
    const evidence = latestEvidence(caseData, 'POLL_RESULT');
    const attempt = caseData?.operations?.poll?.current || null;
    const terminalAttempt = attempt && attempt.pending === false ? attempt : null;
    const termination = caseData?.locator?.termination || null;
    const snapshot = caseData?.live?.oltSnapshot || null;
    // A running request has its own transient LIVE card. It becomes part of
    // "Что уже сделано" only after a terminal result exists.
    const attempted = Boolean(evidence || terminalAttempt || termination || snapshot);
    if (!attempted) return null;

    const rawResult = String(
      evidence?.result
      || evidence?.details?.outcome
      || snapshot?.outcome
      || termination?.status
      || terminalAttempt?.stage
      || ''
    ).toLowerCase();
    const onuStatus = String(snapshot?.onuStatus || evidence?.details?.onuStatus || '').toLowerCase();
    let status = 'выполнено';
    let level = 'observed';
    if (['confirmed', 'success', 'online', 'up'].includes(rawResult) || snapshot?.status === 'confirmed') {
      status = onuStatus ? `ONU ${onuStatus.toUpperCase()}` : 'ответ получен';
      level = 'verified';
    } else if (rawResult.includes('not_found') || rawResult.includes('not-found') || rawResult === 'not_found') {
      status = 'ONU не найдена';
      level = 'attention';
    } else if (rawResult.includes('timeout')) {
      status = 'timeout';
      level = 'attention';
    } else if (rawResult.includes('failed') || rawResult.includes('error') || rawResult.includes('blocked')) {
      status = 'ошибка';
      level = 'attention';
    }

    return {
      key: 'poll',
      label: 'Опрос ONU',
      status,
      level,
      at: evidence?.at || snapshot?.capturedAt || snapshot?.updatedAt || termination?.at || terminalAttempt?.updatedAt || terminalAttempt?.startedAt || caseData?.updatedAt || '',
      source: 'olt',
      replay: true
    };
  };

  const juniperProgress = caseData => {
    const evidence = latestEvidence(caseData, 'JUNIPER_SESSION');
    const source = caseData?.locator?.sourceStatus?.juniper
      || caseData?.locator?.sourceStatus?.juniperPreview
      || null;
    const state = caseData?.juniper || {};
    const evidenceState = state?.evidence || {};
    const openedAt = String(evidenceState?.opened?.at || state?.openedAt || '');
    const readAt = String(evidenceState?.read?.at || state?.readAt || '');
    const verifiedAt = String(evidenceState?.verified?.at || state?.verifiedAt || '');
    const successfulRead = Boolean(
      readAt
      || verifiedAt
      || (state?.dataStatus === 'available' && String(state?.result || '').toLowerCase() !== 'error')
      || (source && String(source?.result || '').toLowerCase() !== 'error')
      || (evidence && String(evidence?.result || '').toLowerCase() !== 'error')
    );

    // Juniper differs from TMC/Technical: a correlated, successfully parsed
    // background snapshot is already a diagnostic fact. Manual OPENED remains a
    // separate evidence field, but LIVE aggregates both into one history row.
    if (!successfulRead && !openedAt) return null;

    const details = state?.details || source?.details || evidence?.details || {};
    const result = String(state?.result || source?.result || evidence?.result || details?.status || '').toLowerCase();
    const status = successfulRead
      ? result === 'online'
        ? 'Online'
        : result === 'offline'
          ? 'Offline'
          : result === 'no_session'
            ? 'сессия не найдена'
            : result === 'unknown'
              ? 'состояние неизвестно'
              : 'данные получены'
      : 'открыт';
    const at = readAt || openedAt || source?.observedAt || evidence?.at || state?.updatedAt || caseData?.updatedAt || '';
    return {
      key: 'juniper',
      label: 'Juniper',
      status,
      level: successfulRead ? 'verified' : 'read',
      at,
      source: String(evidenceState?.read?.source || state?.readSource || (successfulRead ? 'automatic' : 'operator')),
      replay: true,
      opened: Boolean(openedAt),
      verified: Boolean(verifiedAt || state?.verified === true),
      result
    };
  };

  function trail(caseData) {
    if (!caseData) return [];
    return [
      technicalProgress(caseData),
      tmcProgress(caseData),
      pollProgress(caseData),
      juniperProgress(caseData)
    ]
      .filter(Boolean)
      .sort((a, b) => {
        const diff = asTime(a.at) - asTime(b.at);
        if (diff) return diff;
        return a.key.localeCompare(b.key);
      });
  }

  function achieved(caseData, key) {
    return trail(caseData).some(item => item.key === key);
  }

  function isEthernetCase(caseData) {
    return Boolean(caseData?.diagnostic?.isEthernet)
      || String(factValue(caseData?.network?.connectionFamily) || '').toLowerCase() === 'ethernet';
  }

  /** Full checklist in stable plan order: done + pending steps for progress UI. */
  function planTrail(caseData) {
    if (!caseData) return [];
    const doneByKey = Object.fromEntries(trail(caseData).map(item => [item.key, item]));
    const steps = isEthernetCase(caseData)
      ? [
          { key: 'technical', label: 'Техданные' },
          { key: 'juniper', label: 'Juniper' },
          { key: 'poll', label: 'Опрос / порт' }
        ]
      : [
          { key: 'technical', label: 'Техданные' },
          { key: 'tmc', label: 'ТМЦ' },
          { key: 'juniper', label: 'Juniper' },
          { key: 'poll', label: 'Опрос ONU' }
        ];
    return steps.map(step => {
      if (doneByKey[step.key]) return doneByKey[step.key];
      return {
        key: step.key,
        label: step.label,
        status: 'ожидает',
        level: 'pending',
        at: '',
        source: '',
        replay: false
      };
    });
  }

  function progressSummary(caseData) {
    const items = planTrail(caseData);
    const total = items.length;
    const done = items.filter(item => item.level !== 'pending').length;
    const attention = items.filter(item => item.level === 'attention').length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return { items, total, done, attention, percent };
  }

  const completionNameByKey = Object.freeze({
    technicalChecked: 'technical',
    tmcChecked: 'tmc',
    pollCompleted: 'poll',
    juniperRead: 'juniper'
  });
  const completionKeyByAction = Object.freeze({
    open_technical: 'technicalChecked',
    check_tmc: 'tmcChecked',
    poll_current_binding: 'pollCompleted',
    poll_candidate: 'pollCompleted',
    retry_poll: 'pollCompleted',
    check_juniper: 'juniperRead'
  });

  function planCompletionKey(plan = {}) {
    const explicit = String(plan?.completionKey || '');
    if (explicit) return explicit;
    const action = String(plan?.semanticAction || plan?.action || '');
    return completionKeyByAction[action] || '';
  }

  function planCompletionName(plan = {}) {
    return completionNameByKey[planCompletionKey(plan)] || '';
  }

  function recommendationAllowed(caseData, plan = {}) {
    const completionKey = planCompletionKey(plan);
    if (!completionKey) return true;
    return caseData?.progress?.[completionKey]?.done !== true;
  }


  WB.evidenceNavigator = {
    trail,
    planTrail,
    progressSummary,
    achieved,
    planCompletionKey,
    planCompletionName,
    recommendationAllowed,
    latestEvidence,
    latestContext,
    factValue
  };
})();
