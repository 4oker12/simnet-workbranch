function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}
function comparable(value) {
  return text(value).toLowerCase();
}
function normalizePonInterface(value) {
  return text(value).replace(/\s+/g, '').replace(/^([eg]pon)/i, m => m.toUpperCase()).toUpperCase();
}
function rawFact(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

export function canonicalFactEquivalent(groupName, key, left, right, context = {}) {
  if (comparable(left) === comparable(right)) return true;
  if (groupName === 'pon' && ['locatedInterface', 'tmcPort', 'port'].includes(key)) {
    const a = normalizePonInterface(left);
    const b = normalizePonInterface(right);
    return Boolean(a && b && (a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`)));
  }
  if (groupName === 'network' && ['accessDeviceName', 'onuDeviceName'].includes(key)) {
    const a = comparable(left);
    const b = comparable(right);
    const targetId = text(rawFact(context?.target?.accessDeviceId || context?.target?.onuDeviceId));
    const incomingId = text(rawFact(context?.incoming?.accessDeviceId || context?.incoming?.onuDeviceId));
    const sameStableId = Boolean(targetId && incomingId && targetId === incomingId);
    const sameLabelFamily = Boolean(a && b && (a.includes(b) || b.includes(a)));
    return sameStableId || sameLabelFamily;
  }
  return false;
}

export function chooseCanonicalFactValue(groupName, key, oldValue, incomingValue, context = {}) {
  if (groupName === 'network' && ['accessDeviceName', 'onuDeviceName'].includes(key)) {
    const oldText = text(oldValue);
    const incomingText = text(incomingValue);
    if (canonicalFactEquivalent(groupName, key, oldValue, incomingValue, context)) {
      // Keep the richer human label while identity remains anchored by deviceId.
      return incomingText.length > oldText.length ? incomingValue : oldValue;
    }
  }
  return incomingValue;
}
