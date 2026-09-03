(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB ||= {};
  const valueOf = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
  const completed = (caseData, key) => caseData?.progress?.[key]?.done === true;

  const actionMeta = Object.freeze({
    open_technical: { completionKey: 'technicalChecked', semanticTargetId: 'billing.technical' },
    check_tmc: { completionKey: 'tmcChecked', semanticTargetId: 'userside.tmc' },
    manual_fill_billing: { completionKey: '', semanticTargetId: '' },
    switch_port: { completionKey: 'ethernetDeviceChecked', semanticTargetId: 'userside.ethernet' },
    check_ethernet_fdb: { completionKey: 'ethernetFdbChecked', semanticTargetId: 'userside.ethernet.fdb' },
    check_ethernet_errors: { completionKey: 'ethernetErrorsChecked', semanticTargetId: 'userside.ethernet.errors' },
    poll_current_binding: { completionKey: 'pollCompleted', semanticTargetId: 'billing.olt.request' },
    poll_candidate: { completionKey: 'pollCompleted', semanticTargetId: 'billing.olt.request' },
    retry_poll: { completionKey: 'pollCompleted', semanticTargetId: 'billing.olt.request' }
  });

  function actionMetaFor(action) {
    return { ...(actionMeta[String(action || '')] || {}) };
  }

  function decision(caseData) {
    if (!caseData) return { action: 'no_case', terminal: false, intent: 'NONE', reason: 'case-missing' };
    const diagnostic = caseData.diagnostic || {};
    const termination = caseData.locator?.termination || null;

    // PON routing has one authority: the workflow snapshot stored in
    // case.diagnostic. Presentation must not let a downstream poll result
    // override an unresolved Billing/TMC recommendation.
    if (diagnostic.isPon) {
      const action = String(diagnostic.locatorAction || diagnostic.nextRequiredSource || 'wait_context');
      const meta = actionMeta[action] || {};
      return {
        action,
        terminal: action === 'complete_confirmed',
        intent: action === 'complete_confirmed' ? 'NONE' : 'FIRST_PASS',
        completionKey: meta.completionKey || '',
        semanticTargetId: meta.semanticTargetId || '',
        reason: String(diagnostic.locatorReason || '')
      };
    }

    if (
      completed(caseData, 'pollCompleted')
      || termination?.status === 'confirmed'
      || caseData.live?.oltSnapshot?.status === 'confirmed'
    ) {
      return { action: 'complete_confirmed', terminal: true, intent: 'NONE', reason: 'poll-evidence-confirmed' };
    }

    if (!completed(caseData, 'technicalChecked')) {
      return {
        action: 'open_technical',
        terminal: false,
        intent: 'FIRST_PASS',
        ...actionMeta.open_technical,
        reason: 'technical-not-checked'
      };
    }

    let action = String(
      diagnostic.locatorAction
      || diagnostic.nextRequiredSource
      || caseData.locator?.recommendation?.action
      || 'wait_context'
    );

    if (action === 'open_technical' && completed(caseData, 'technicalChecked')) action = 'wait_context';
    if (action === 'check_tmc' && completed(caseData, 'tmcChecked')) action = 'wait_context';
    if (['poll_current_binding', 'poll_candidate', 'retry_poll'].includes(action) && completed(caseData, 'pollCompleted')) {
      action = 'complete_confirmed';
    }

    const meta = actionMeta[action] || {};
    return {
      action,
      terminal: action === 'complete_confirmed',
      intent: action === 'complete_confirmed' ? 'NONE' : 'FIRST_PASS',
      completionKey: meta.completionKey || '',
      semanticTargetId: meta.semanticTargetId || '',
      reason: String(diagnostic.locatorReason || caseData.locator?.recommendation?.reason || '')
    };
  }

  function nextAction(caseData) {
    const d = decision(caseData);
    if (!d || d.terminal || ['no_case', 'wait_context'].includes(d.action)) return null;
    return {
      id: d.action,
      completionKey: d.completionKey || '',
      semanticTargetId: d.semanticTargetId || '',
      intent: d.intent || 'FIRST_PASS',
      reason: d.reason || ''
    };
  }

  function live(caseData) {
    const d = decision(caseData);
    return {
      progress: caseData?.progress || {},
      decision: d,
      nextAction: nextAction(caseData),
      stage: caseData?.diagnostic?.stage || 'awaiting-complaint',
      completion: Number(caseData?.diagnostic?.completion || 0),
      locatorStage: caseData?.diagnostic?.locatorStage || 'empty',
      locatorCompletion: Number(caseData?.diagnostic?.locatorCompletion || 0),
      family: String(valueOf(caseData?.network?.connectionFamily) || '')
    };
  }

  function diagnosticSummary(caseData) {
    if (!caseData) return '';
    const parts = [];
    const complaintText = String(caseData?.complaint?.text || '').replace(/\s+/g, ' ').trim().slice(0, 480);
    if (complaintText) parts.push(`Абонент сообщает: «${complaintText}».`);
    const live = caseData?.live?.oltSnapshot || {};
    const onuStatus = String(live.onuStatus || (live.status === 'confirmed' ? live.status : '') || '').trim();
    if (onuStatus) parts.push(`ONU: ${onuStatus.slice(0, 120)}.`);
    return parts.join(' ').trim();
  }


  WB.caseView = Object.freeze({ decision, nextAction, live, diagnosticSummary, progressCompleted: completed, actionMetaFor });
})();
