const SECRET_KEY_RE = /(^|_)(pp|password|passwd|pass|token|secret|csrf|cookie|authorization|auth|session|sessionid|sid)(_|$)/i;
const MAC_RE = /(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i;
const FRESH_POLL_MS = 10 * 60 * 1000;

const scalar = value => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
  ? value.value
  : value;

const text = (value, max = 180) => {
  const raw = String(scalar(value) ?? '').replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
};

const numberValue = value => {
  const n = Number(scalar(value));
  return Number.isFinite(n) ? n : null;
};

const observedAt = value => text(value && typeof value === 'object' ? value.observedAt : '', 48);

const compactObject = value => {
  if (Array.isArray(value)) {
    const rows = value.map(compactObject).filter(item => item !== undefined && item !== null && item !== '');
    return rows.length ? rows : undefined;
  }
  if (!value || typeof value !== 'object') return value === '' || value == null ? undefined : value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    const compacted = compactObject(item);
    if (compacted !== undefined && !(typeof compacted === 'object' && !Array.isArray(compacted) && !Object.keys(compacted).length)) out[key] = compacted;
  }
  return Object.keys(out).length ? out : undefined;
};

const normalizeMac = value => String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();

function tariffSpeedMbps(caseData) {
  const raw = caseData?.profile?.tariff;
  const value = String(scalar(raw) || '');
  if (!value) return null;
  const patterns = [
    /(?:швидк(?:ість)?|скорост(?:ь)?)\s*[-:–—]?\s*(\d{2,5})\s*(?:мбіт|мбит|mbit|mbps|мб\/с)/i,
    /\((\d{2,5})\s*(?:мбіт|мбит|mbit|mbps|mb|m)\b/i,
    /\b(\d{2,5})\s*(?:мбіт\/с|мбит\/с|mbit\/s|mbps)\b/i
  ];
  for (const re of patterns) {
    const match = value.match(re);
    const speed = Number(match?.[1]);
    if (Number.isFinite(speed) && speed > 0 && speed <= 100000) return speed;
  }
  return null;
}

function evidenceRows(caseData, family) {
  const rows = Array.isArray(caseData?.live?.oltSnapshot?.evidence) ? caseData.live.oltSnapshot.evidence : [];
  return rows.filter(item => String(item?.family || '') === family);
}

function mergedEvidenceFacts(caseData, families = []) {
  const out = {};
  for (const family of families) {
    for (const row of evidenceRows(caseData, family)) {
      for (const [key, value] of Object.entries(row?.facts || {})) {
        if (value !== undefined && value !== null && value !== '') out[key] = value;
      }
    }
  }
  return out;
}

function pollCapturedAt(caseData) {
  const live = caseData?.live?.oltSnapshot || {};
  return text(live.capturedAt || live.updatedAt || caseData?.pon?.status?.observedAt || '', 48);
}

function freshness(at, nowMs = Date.now()) {
  const parsed = Date.parse(String(at || ''));
  if (!Number.isFinite(parsed)) return { state: 'unknown' };
  const ageMs = Math.max(0, nowMs - parsed);
  return {
    state: ageMs <= FRESH_POLL_MS ? 'recent' : 'stale',
    ageMinutes: Math.round(ageMs / 60000)
  };
}

function currentOnu(caseData) {
  const live = caseData?.live?.oltSnapshot || {};
  const info = mergedEvidenceFacts(caseData, ['ont_info']);
  const state = text(live.onuStatus || info.runState || caseData?.pon?.status, 30).toLowerCase() || 'unknown';
  return compactObject({
    status: state,
    lastDownCause: text(info.lastDownCause, 60),
    onlineDuration: text(info.onlineDuration, 80)
  });
}

function ethernetState(caseData, tariffSpeed) {
  const live = caseData?.live?.oltSnapshot || {};
  const facts = mergedEvidenceFacts(caseData, ['ont_port_state']);
  const link = text(facts.linkState || live.linkState, 20).toLowerCase() || 'unknown';
  const speedMbps = Number.isFinite(Number(facts.speedMbps)) ? Number(facts.speedMbps)
    : Number.isFinite(Number(live.speedMbps)) ? Number(live.speedMbps) : null;
  const duplex = text(facts.duplex || live.duplex, 20).toLowerCase() || 'unknown';
  let capacityVsTariff = 'unknown';
  if (Number.isFinite(speedMbps) && Number.isFinite(tariffSpeed) && tariffSpeed > 0) {
    capacityVsTariff = speedMbps >= tariffSpeed ? 'sufficient' : 'insufficient';
  }
  return compactObject({ link, speedMbps, duplex, capacityVsTariff });
}

function historyState(caseData) {
  const facts = mergedEvidenceFacts(caseData, ['history', 'ont_info']);
  const events24h = Number(facts.events24h || 0);
  const events7d = Number(facts.events7d || 0);
  const optical7d = Number(facts.optical7d || 0);
  const power7d = Number(facts.power7d || 0);
  const reset7d = Number(facts.reset7d || 0);
  const abnormal = optical7d > 0 || events24h >= 2 || events7d >= 3;
  if (!events24h && !events7d && !optical7d && !power7d && !reset7d) return { state: 'no_anomaly_observed' };
  return compactObject({
    state: abnormal ? 'abnormal' : 'observed_not_frequent',
    events24h: events24h || undefined,
    events7d: events7d || undefined,
    dyingGasp7d: power7d || undefined,
    optical7d: optical7d || undefined,
    resets7d: reset7d || undefined,
    latestReason: text(facts.latestReason, 60),
    latestAt: text(facts.latestAt, 64)
  });
}

function learnedMacState(caseData, includeValues = false) {
  const live = caseData?.live?.oltSnapshot || {};
  const expected = normalizeMac(scalar(caseData?.network?.mac) || '');
  const onuMac = normalizeMac(scalar(caseData?.pon?.onuMac) || live.onuMac || '');
  const set = new Set();
  const add = value => {
    const mac = normalizeMac(value);
    if (mac && mac.length === 12 && mac !== onuMac) set.add(mac);
  };
  for (const value of Array.isArray(live.learnedMacs) ? live.learnedMacs : []) add(typeof value === 'object' ? value.mac || value.value : value);
  for (const row of evidenceRows(caseData, 'mac_address')) {
    const facts = row?.facts || {};
    for (const mac of Array.isArray(facts.macs) ? facts.macs : []) add(mac);
    add(facts.subscriberMac);
  }
  add(live.observedSubscriberMac);
  const learned = [...set];
  let match = 'unknown';
  if (expected && learned.length) match = learned.includes(expected) ? 'match' : 'mismatch';
  else if (evidenceRows(caseData, 'mac_address').some(row => /соответствует|совпадает/i.test(String(row?.diagnosticNote || row?.summary || '')))) match = 'match';
  const result = {
    learnedCount: learned.length,
    learnedState: learned.length <= 1 ? (learned.length === 1 ? 'normal' : 'none_observed') : 'multiple',
    subscriberMacMatch: match
  };
  if (includeValues) {
    result.learnedMacs = learned.map(mac => mac.match(/.{1,2}/g).join(':'));
    if (expected) result.expectedSubscriberMac = expected.match(/.{1,2}/g).join(':');
  }
  return result;
}

function sessionState(caseData) {
  const juniper = caseData?.juniper || {};
  const state = text(juniper.result || juniper.details?.status || juniper.dataStatus, 40).toLowerCase() || 'unknown';
  const at = text(juniper.lastReadAt || juniper.readAt || juniper.updatedAt, 48);
  return compactObject({ state, freshness: freshness(at) });
}

function tmcState(caseData) {
  const progress = caseData?.progress?.tmcChecked || {};
  const checked = Boolean(progress.done || caseData?.diagnostic?.hasTmcOnu || caseData?.diagnostic?.usersideVisited);
  const found = caseData?.diagnostic?.hasTmcOnu === true || progress?.details?.result === 'found';
  return { checked, found: checked ? Boolean(found) : undefined };
}

function detailIntent(message = '') {
  const q = String(message || '').toLowerCase();
  return {
    mac: /\bmac\b|мак[-\s]?адрес|\bмак\b/i.test(q),
    optical: /\brx\b|\btx\b|оптик|сигнал|dbm|дбм/i.test(q),
    olt: /\bolt\b|\bолт\b|gpon\s*\d|epon\s*\d|интерфейс onu|порт onu/i.test(q),
    serial: /serial|серийн|\bsn\b/i.test(q),
    vlan: /\bvlan\b|service[-\s]?port/i.test(q)
  };
}

function requestedDetails(caseData, message) {
  const intent = detailIntent(message);
  const live = caseData?.live?.oltSnapshot || {};
  const out = {};
  if (intent.mac) out.mac = learnedMacState(caseData, true);
  if (intent.optical) {
    const optical = mergedEvidenceFacts(caseData, ['optical']);
    out.optical = compactObject({ onuRxDbm: optical.onuRxDbm, oltRxDbm: optical.oltRxDbm, onuTxDbm: optical.onuTxDbm });
  }
  if (intent.olt) out.olt = compactObject({ name: text(live.oltName || caseData?.pon?.oltName, 80), interface: text(live.interface || caseData?.pon?.locatedInterface, 60) });
  if (intent.serial) out.onuSerial = text(live.observedOnuSerial || live.onuSerial || caseData?.pon?.onuSerial, 80);
  if (intent.vlan) {
    const service = mergedEvidenceFacts(caseData, ['service_port']);
    out.servicePort = compactObject({ state: text(service.state, 30), vlan: numberValue(service.vlan) });
  }
  return compactObject(out);
}

function anomalyList({ onu, ethernet, stability, identity, tariffSpeed }) {
  const rows = [];
  if (onu?.status && !['online', 'unknown'].includes(onu.status)) rows.push({ id: 'onu_not_online', state: onu.status });
  if (ethernet?.link === 'down') rows.push({ id: 'ethernet_link_down' });
  if (ethernet?.duplex === 'half') rows.push({ id: 'ethernet_half_duplex' });
  if (ethernet?.capacityVsTariff === 'insufficient') rows.push({ id: 'ethernet_below_tariff', linkMbps: ethernet.speedMbps, tariffMbps: tariffSpeed });
  if (identity?.subscriberMacMatch === 'mismatch') rows.push({ id: 'subscriber_mac_mismatch' });
  if (identity?.learnedState === 'multiple') rows.push({ id: 'multiple_learned_macs', count: identity.learnedCount });
  if (stability?.state === 'abnormal') rows.push({ id: 'frequent_onu_events', events24h: stability.events24h, events7d: stability.events7d, dyingGasp7d: stability.dyingGasp7d, optical7d: stability.optical7d });
  return rows;
}

export function buildAiCaseSnapshot(caseData, options = {}) {
  if (!caseData || typeof caseData !== 'object') return null;
  const tariffSpeed = tariffSpeedMbps(caseData);
  const onu = currentOnu(caseData);
  const ethernet = ethernetState(caseData, tariffSpeed);
  const stability = historyState(caseData);
  const identity = learnedMacState(caseData, false);
  const pollAt = pollCapturedAt(caseData);
  const accessFamily = text(caseData?.network?.connectionFamily || caseData?.diagnostic?.family, 30) || 'unknown';
  const pollFreshness = freshness(pollAt);
  const snapshot = {
    schema: 'simnet-ai-diagnostic-snapshot-v2',
    case: compactObject({
      complaint: text(caseData?.complaint?.text, 220),
      updatedAt: text(caseData?.updatedAt, 48)
    }),
    access: compactObject({ family: accessFamily }),
    tariff: compactObject({ speedMbps: tariffSpeed || undefined }),
    onu: compactObject({ ...onu, poll: pollFreshness }),
    ethernet,
    stability,
    identity,
    bras: sessionState(caseData),
    tmc: tmcState(caseData),
    anomalies: anomalyList({ onu, ethernet, stability, identity, tariffSpeed }),
    details: requestedDetails(caseData, options.message || '')
  };
  return compactObject(snapshot) || null;
}

export function aiSnapshotExcludedByDefault() {
  return [
    'temperature', 'raw OLT output', 'RX/TX frame counters', 'distance', 'OLT IP/device id',
    'ONU serial/MAC values', 'VLAN/service-port', 'TMC device ids', 'journal', 'contexts', 'full poll evidence'
  ];
}
