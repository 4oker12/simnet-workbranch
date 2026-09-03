'use strict';

const factValue = fact => (
  fact && typeof fact === 'object' && Object.prototype.hasOwnProperty.call(fact, 'value')
    ? fact.value
    : fact
);
const rawFactValue = fact => String(factValue(fact) ?? '');
const compact = (value, max = 240) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export function callIpv4(raw) {
  const value = String(raw ?? '').trim();
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? value
    : '';
}

export function pbxRecordId(raw) {
  const value = String(raw ?? '').trim().replace(/^pbx:/, '');
  return /^\d{9,12}\.\d{1,12}$/.test(value) ? value : '';
}

export function pbxCallKey(raw) {
  const canonical = String(raw ?? '').trim().match(/^call:(\d{1,24})$/);
  if (canonical) return `call:${canonical[1]}`;
  const recordId = pbxRecordId(raw);
  return recordId ? `pbx:${recordId}` : '';
}

export function normalizedPhone(raw) {
  const digits = String(raw ?? '').replace(/\D+/g, '');
  if (digits.length < 6 || digits.length > 15) return '';
  if (/^380\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^80\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}

export function maskedPhone(raw) {
  const phone = normalizedPhone(raw);
  if (phone.length < 7) return phone ? '***' : '';
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

export function normalizedContract(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^abon/, '')
    .replace(/\D+/g, '');
  return /^\d{3,14}$/.test(value) && !/^0+$/.test(value) ? value : '';
}

export function pbxCallIdentitySignature(call = {}) {
  const customerId = String(call.customerId || '').replace(/\D+/g, '');
  const candidateIds = Array.isArray(call.customerCandidates)
    ? call.customerCandidates
        .map(item => String(item?.customerId || '').replace(/\D+/g, ''))
        .filter(Boolean)
        .sort()
        .join(',')
    : '';
  return [
    pbxCallKey(call.callKey || call.recordId),
    pbxRecordId(call.recordId || call.callKey),
    normalizedPhone(call.callerId),
    normalizedContract(call.contract),
    customerId,
    candidateIds,
    callIpv4(call.subscriberIp),
    compact(call.date || '', 16),
    compact(call.time || '', 16),
    compact(call.agentExtension || '', 12)
  ].join('|');
}

export function pbxCallMatch(call = {}, caseData = {}) {
  const providerCode = compact(call.providerCode || '', 12);
  const contract = normalizedContract(call.contract);
  const caseContracts = [
    rawFactValue(caseData.identity?.contract),
    rawFactValue(caseData.identity?.login)
  ].map(normalizedContract).filter(Boolean);
  const subscriberIp = callIpv4(call.subscriberIp);
  const caseIp = callIpv4(rawFactValue(caseData.network?.ip));
  const callCustomerId = String(call.customerId || '').replace(/\D+/g, '');
  const caseCustomerId = String(rawFactValue(caseData.identity?.customerId) || '').replace(/\D+/g, '');
  const matchedBy = [];
  const conflicts = [];

  // PBX provider namespace `prov=1` is not directly comparable with the
  // canonical SIMNET contract. It can support a match but cannot contradict it.
  const contractComparable = providerCode !== '1';

  // A unique UserSide /message/call_list CUSTOMER is the strongest identity
  // evidence available for the completed call. Ambiguous rows have no customerId.
  if (callCustomerId && caseCustomerId) {
    if (callCustomerId === caseCustomerId) matchedBy.push('customer');
    else conflicts.push('customer');
  }
  if (contract && caseContracts.length) {
    if (caseContracts.includes(contract)) matchedBy.push('contract');
    else if (contractComparable) conflicts.push('contract');
  }
  if (subscriberIp && caseIp) {
    if (subscriberIp === caseIp) matchedBy.push('ip');
    else conflicts.push('ip');
  }
  if (conflicts.length) {
    return { level: 'conflict', matchedBy, conflicts, providerCode, contractComparable, confidence: 0 };
  }
  if (matchedBy.length) {
    return {
      level: 'strong', matchedBy, conflicts: [], providerCode, contractComparable,
      confidence: (matchedBy.includes('customer') || matchedBy.includes('contract')) ? 1 : 0.99
    };
  }

  const callerId = normalizedPhone(call.callerId);
  const casePhones = [
    caseData.profile?.phone,
    caseData.profile?.mobile,
    caseData.identity?.phone,
    caseData.contact?.phone
  ].map(rawFactValue).map(normalizedPhone).filter(Boolean);
  if (callerId && casePhones.includes(callerId)) {
    return {
      level: 'supporting', matchedBy: ['phone'], conflicts: [], providerCode,
      contractComparable, confidence: 0.93
    };
  }

  return { level: 'none', matchedBy: [], conflicts: [], providerCode, contractComparable, confidence: 0 };
}
