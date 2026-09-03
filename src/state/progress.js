/**
 * Small, evidence-derived progress model used by LIVE and direct actions.
 */

export const CompletionKey = Object.freeze({
  TECHNICAL: 'technicalChecked',
  TMC: 'tmcChecked',
  JUNIPER: 'juniperRead',
  ETHERNET: 'ethernetConfirmed',
  ETHERNET_DEVICE: 'ethernetDeviceChecked',
  ETHERNET_FDB: 'ethernetFdbChecked',
  ETHERNET_ERRORS: 'ethernetErrorsChecked',
  POLL: 'pollCompleted'
});


function contexts(caseData) {
  const out = [];
  if (caseData?.currentContext) out.push(caseData.currentContext);
  out.push(...Object.values(caseData?.contexts || {}));
  for (const tabViews of Object.values(caseData?.viewsByTab || {})) {
    out.push(...Object.values(tabViews || {}));
  }
  return out.filter(Boolean);
}

function visited(caseData, pageKind) {
  return contexts(caseData).some(context => (
    String(context?.pageKind || '') === pageKind
    && context?.correlation?.verdict !== 'foreign'
  ));
}

function evidence(caseData, type, accepted = null) {
  return (caseData?.locator?.evidence || []).find(item => (
    item?.type === type
    && !String(item?.passiveReason || '').startsWith('correlation-')
    && (!accepted || accepted.includes(String(item?.result || '')))
  )) || null;
}

function complete(current, key, achieved, at, source, details = null) {
  if (!achieved || current[key]?.done === true) return;
  current[key] = { done: true, at, source, details };
}

export function refreshProgress(caseData, at = new Date().toISOString()) {
  const result = caseData || {};
  const current = { ...(result.progress || {}) };

  const tmc = result?.locator?.sourceStatus?.tmc
    || evidence(result, 'TMC_RESULT', ['found', 'missing', 'not_found', 'not_applicable']);
  const ethernet = result?.locator?.sourceStatus?.ethernet_access_point
    || evidence(result, 'ETHERNET_ACCESS_POINT', ['confirmed']);
  const ethernetDevice = result?.locator?.sourceStatus?.ethernet_device
    || evidence(result, 'ETHERNET_DEVICE', ['confirmed']);
  const ethernetFdb = result?.locator?.sourceStatus?.ethernet_fdb_result
    || evidence(result, 'ETHERNET_FDB_RESULT', ['confirmed', 'found', 'checked']);
  const ethernetErrors = result?.locator?.sourceStatus?.ethernet_port_errors
    || evidence(result, 'ETHERNET_PORT_ERRORS', ['confirmed', 'found', 'checked', 'clean']);
  const juniper = result?.juniper?.dataStatus === 'available'
    || Boolean(result?.locator?.sourceStatus?.juniper || result?.locator?.sourceStatus?.juniperPreview);
  const poll = result?.locator?.termination?.status === 'confirmed'
    || result?.live?.oltSnapshot?.status === 'confirmed';

  complete(current, CompletionKey.TECHNICAL, visited(result, 'billing_technical'), at, 'billing-context');
  const tmcVisited = visited(result, 'userside_customer') || Boolean(result?.visits?.usersideTmcAt);
  complete(
    current,
    CompletionKey.TMC,
    tmcVisited,
    at,
    'userside-context',
    tmc ? { result: String(tmc.result || '') } : { result: 'visited' }
  );
  complete(current, CompletionKey.JUNIPER, juniper, at, 'juniper-result');
  complete(current, CompletionKey.ETHERNET, Boolean(ethernet), at, 'ethernet-result');
  complete(current, CompletionKey.ETHERNET_DEVICE, Boolean(ethernetDevice), at, 'ethernet-device-result');
  complete(current, CompletionKey.ETHERNET_FDB, Boolean(ethernetFdb), at, 'ethernet-fdb-result');
  complete(current, CompletionKey.ETHERNET_ERRORS, Boolean(ethernetErrors), at, 'ethernet-errors-result');
  complete(current, CompletionKey.POLL, poll, at, 'poll-result');

  result.progress = current;
  return result;
}

export function progressCompleted(caseData, key) {
  return caseData?.progress?.[key]?.done === true;
}
