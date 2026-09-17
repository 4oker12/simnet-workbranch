function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function isSubscriberLogin(value) {
  return /^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(text(value, 80).replace(/\s+/g, ''));
}

export function canonicalLabContract(value) {
  const compact = text(value, 80).replace(/\s+/g, '');
  const abon = compact.match(/^abon(\d{3,12})$/i);
  if (abon) return abon[1];
  return /^\d{3,12}$/.test(compact) ? compact : '';
}

export function normalizeLabLookupDecision(decision = {}) {
  const next = clone(decision) || {};
  if (String(next.tool || '') !== 'customer.lookup') return next;

  const args = next.toolArgs && typeof next.toolArgs === 'object' && !Array.isArray(next.toolArgs)
    ? { ...next.toolArgs }
    : {};

  const contract = canonicalLabContract(args.contract)
    || canonicalLabContract(args.login)
    || canonicalLabContract(args.query);

  if (contract) {
    args.contract = contract;
    if (canonicalLabContract(args.login)) delete args.login;
    if (canonicalLabContract(args.query)) delete args.query;
  } else {
    const explicitLogin = text(args.login, 80).replace(/\s+/g, '');
    const queryLogin = text(args.query, 80).replace(/\s+/g, '');
    if (isSubscriberLogin(explicitLogin)) {
      args.login = explicitLogin;
      delete args.query;
    } else if (isSubscriberLogin(queryLogin)) {
      args.login = queryLogin;
      delete args.query;
    }
  }

  next.toolArgs = args;
  return next;
}

export function publicPendingCandidate(candidate = null) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  return {
    contract: text(candidate.contract, 80),
    login: text(candidate.login, 80),
    address: text(candidate.address, 240),
    ip: text(candidate.ip, 80)
  };
}

export function sanitizeLookupToolResultData(data = {}) {
  const copy = clone(data && typeof data === 'object' && !Array.isArray(data) ? data : {}) || {};
  if (copy.candidate) copy.candidate = publicPendingCandidate(copy.candidate);
  if (Array.isArray(copy.candidates)) copy.candidates = copy.candidates.map(publicPendingCandidate).filter(Boolean);
  return copy;
}
