'use strict';

// Canonical domain ownership lives here. Source names describe read/cache groups,
// not domain entities and not a promise of one HTTP request per field.
const fact = (source, paths, type = 'text', ttlMs = 120000, extra = {}) => Object.freeze({
  source,
  paths: Object.freeze(Array.isArray(paths) ? paths : [paths]),
  type,
  ttlMs,
  status: 'confirmed',
  ...extra
});

const billingMain = (paths, type = 'text', extra = {}) => fact('billing.mainSummary', paths, type, 120000, extra);
const billingCustomer = (paths, type = 'text', extra = {}) => fact('billing.customer', paths, type, 120000, extra);
const userside = (paths, type = 'text', extra = {}) => fact('userside.subscriber', paths, type, 120000, extra);
const network = (paths, type = 'text', extra = {}) => fact('network.session', paths, type, 45000, extra);
const building = (field, type = 'text') => fact('userside.building', [`fields.${field}`, `fieldList.${field}`], type, 300000, { field });

export const CANONICAL_SOURCE_CATALOG = Object.freeze({
  'billing.mainSummary': Object.freeze({ tool: 'billing.main_summary', ttlMs: 120000, scope: 'subscriber' }),
  'billing.customer': Object.freeze({ tool: 'customer.snapshot', ttlMs: 120000, scope: 'subscriber' }),
  // Kept for legacy callers. Canonical finance/payment/service facts that are present
  // on a=user are intentionally grouped under billing.mainSummary to avoid fetching dopdata.
  'billing.payments': Object.freeze({ tool: 'billing.payments', ttlMs: 120000, scope: 'subscriber' }),
  'userside.subscriber': Object.freeze({ tool: 'userside.snapshot', ttlMs: 120000, scope: 'subscriber' }),
  'network.session': Object.freeze({ tool: 'network.session', ttlMs: 45000, scope: 'subscriber' }),
  'userside.building': Object.freeze({ tool: 'building.snapshot', ttlMs: 300000, scope: 'building' })
});

export const CANONICAL_FACT_CATALOG = Object.freeze({
  'subscriber.billingId': billingCustomer('identity.billingId'),
  'subscriber.userSideCustomerId': userside('identity.customerId'),
  'subscriber.login': billingCustomer('identity.login'),
  'subscriber.fullName': billingCustomer('identity.fullName'),
  'subscriber.contacts.phone': billingCustomer('contacts.phone'),
  'subscriber.contacts.extraPhone': billingCustomer('contacts.extraPhone'),
  'subscriber.contacts.email': billingCustomer('contacts.email'),

  'subscriber.contract.number': billingCustomer('identity.contract'),
  'subscriber.contract.date': billingCustomer('identity.contractDate'),
  'subscriber.contract.subscriberType': billingCustomer('customer.subscriberType'),
  'subscriber.contract.contractedWith': billingCustomer('customer.contractedWith'),

  'subscriber.serviceAddress.street': billingCustomer('address.street'),
  'subscriber.serviceAddress.buildingNumber': billingCustomer('address.building'),
  'subscriber.serviceAddress.block': billingCustomer('address.block'),
  'subscriber.serviceAddress.entrance': billingCustomer('address.entrance'),
  'subscriber.serviceAddress.floor': billingCustomer('address.floor'),
  'subscriber.serviceAddress.apartment': billingCustomer('address.apartment'),
  'subscriber.serviceAddress.fullAddress': billingCustomer(['address.full', 'address.fullAddress']),

  'subscriber.tariff.current.id': billingMain(['service.tariffId', 'service.current.tariffId']),
  'subscriber.tariff.current.name': billingMain(['service.currentTariffDisplay', 'service.current.name', 'service.currentTariff']),
  'subscriber.tariff.current.rawName': billingMain(['service.currentTariffRaw', 'service.current.rawName', 'service.currentTariff']),
  'subscriber.tariff.current.price': billingMain(['finance.price', 'service.current.priceUAH', 'service.currentTariffPriceUAH'], 'money'),
  'subscriber.tariff.current.speed': billingMain(['service.current.speedMbps', 'service.currentTariffSpeedMbps', 'service.speed'], 'number'),
  'subscriber.tariff.current.isTemporary': billingMain('service.currentTariffTemporary', 'boolean'),
  'subscriber.tariff.scheduledChange.observed': billingMain('service.hasScheduledTariffChange', 'observed'),
  'subscriber.tariff.scheduledChange.hasChange': billingMain('service.hasScheduledTariffChange', 'boolean'),
  'subscriber.tariff.scheduledChange.nextTariff': billingMain(['service.nextTariffDisplay', 'service.scheduledChange.name'], 'optionalText'),
  'subscriber.tariff.scheduledChange.rawName': billingMain(['service.nextTariffRaw', 'service.scheduledChange.rawName'], 'optionalText'),
  'subscriber.tariff.scheduledChange.price': billingMain('service.scheduledChange.priceUAH', 'money'),
  'subscriber.tariff.scheduledChange.speed': billingMain('service.scheduledChange.speedMbps', 'number'),
  'subscriber.tariff.scheduledChange.effectivePeriod': billingMain(['service.scheduledChange.effective.raw', 'service.nextTariffDelay'], 'optionalText'),
  'subscriber.tariff.scheduledChange.effectiveMonth': billingMain('service.scheduledChange.effective.month', 'optionalText'),

  'subscriber.finance.balance.account': billingMain('finance.accountBalance', 'money'),
  'subscriber.finance.totalDue': billingMain('finance.totalDue', 'money'),
  'subscriber.finance.recurringTotal': billingMain('finance.recurringTotal', 'money'),
  'subscriber.finance.balance.afterTariff': billingMain('finance.balanceAfterTariff', 'money'),
  'subscriber.finance.balance.withoutTemporary': billingMain('finance.balanceWithoutTemporary', 'money'),
  'subscriber.finance.temporaryPayment': billingMain('finance.temporaryPayment', 'money'),
  'subscriber.finance.payments': billingMain('payments', 'array'),

  'subscriber.service.accessState': billingMain('service.accessState'),
  'subscriber.service.serviceState': billingMain('service.serviceState'),
  'subscriber.services': billingMain('service.activeServices', 'array'),

  // IP is canonically owned by NetworkAccess even when it is used as a lookup key.
  'subscriber.network.currentIp': billingCustomer(['network.ip', 'network.currentIp']),
  'subscriber.network.subscriberMac': billingCustomer(['technical.subscriberMac', 'network.subscriberMac']),
  'subscriber.network.authorization': billingCustomer('network.authorization', 'object'),
  'subscriber.network.session.status': network('status'),
  'subscriber.network.session.bras': network('bras'),
  'subscriber.network.session.brasIp': network('brasIp'),
  'subscriber.network.session.id': network('sessionId'),
  'subscriber.network.session.authorizationType': network('authorizationType'),
  'subscriber.network.session.startTime': network('startTime'),
  'subscriber.network.session.lastEvent': network('lastEvent'),
  'subscriber.network.session.lastEventTime': network('lastEventTime'),
  'subscriber.network.session.router': network('router'),
  'subscriber.network.session.vendor': network('vendor'),
  'subscriber.network.session.vlan': network('vlan'),

  'subscriber.access.connectionFamily': userside('network.connectionFamily'),
  'subscriber.access.ethernet.deviceId': userside('network.accessDeviceId'),
  'subscriber.access.ethernet.deviceName': userside('network.accessDeviceName'),
  'subscriber.access.ethernet.deviceIp': userside('network.accessDeviceIp'),
  'subscriber.access.ethernet.port': userside(['network.accessPort', 'network.accessInterface']),
  'subscriber.access.ethernet.linkState': userside('network.accessLinkState'),
  'subscriber.access.ethernet.speedMbps': userside('network.accessSpeedMbps', 'number'),
  'subscriber.access.pon.onu.serial': userside('pon.onuSerial'),
  'subscriber.access.pon.onu.mac': userside('pon.onuMac'),
  'subscriber.access.pon.onu.deviceId': userside('pon.onuDeviceId'),
  'subscriber.access.pon.onu.deviceName': userside('pon.onuDeviceName'),
  'subscriber.access.pon.onu.rx': userside(['pon.onuRx', 'pon.rx']),
  'subscriber.access.pon.onu.tx': userside(['pon.onuTx', 'pon.tx']),
  'subscriber.access.pon.olt.name': userside('pon.oltName'),
  'subscriber.access.pon.olt.ip': userside('pon.oltIp'),
  'subscriber.access.pon.olt.deviceId': userside('pon.oltDeviceId'),
  'subscriber.access.pon.olt.rx': userside('pon.oltRx'),
  'subscriber.access.pon.port': userside(['pon.port', 'pon.interface']),
  'subscriber.access.pon.foundOnOlt': userside('pon.foundOnOlt', 'boolean'),

  'building.id': fact('userside.building', 'buildingId', 'text', 300000),
  'building.address': fact('userside.building', 'address', 'text', 300000),
  'building.gpon': building('gpon'),
  'building.ktv': building('ktv'),
  'building.owner': building('owner'),
  'building.keys': building('keys'),
  'building.notes': building('notes'),
  'building.workingNote': building('working_note'),
  'building.management': building('management'),
  'building.canConnectSubscribers': building('можем_подключать_абонентов')
});

export const LEGACY_FACT_ALIASES = Object.freeze({
  accountBalance: 'subscriber.finance.balance.account',
  monthlyTotal: 'subscriber.finance.totalDue',
  balanceAfterCurrentPeriod: 'subscriber.finance.balance.afterTariff',
  currentTariff: 'subscriber.tariff.current.name',
  nextTariff: 'subscriber.tariff.scheduledChange.nextTariff',
  accessTechnology: 'subscriber.access.connectionFamily',
  sessionStatus: 'subscriber.network.session.status',
  onuStatus: 'subscriber.access.pon.foundOnOlt'
});

export const CANONICAL_FACT_PATHS = Object.freeze(Object.keys(CANONICAL_FACT_CATALOG));

export function canonicalFactPath(value) {
  const path = String(value || '').trim();
  if (Object.hasOwn(CANONICAL_FACT_CATALOG, path)) return path;
  return LEGACY_FACT_ALIASES[path] || '';
}

export function normalizeCanonicalFacts(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const path = canonicalFactPath(typeof value === 'string' ? value : value?.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result.slice(0, 16);
}
