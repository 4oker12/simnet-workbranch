'use strict';

const WORKBENCH_STATE_KEYS = Object.freeze([
  'simnet_workbench_state_v5',
  'simnet_workbench_state_v4'
]);
const BILLING_SNAPSHOT_KEY = 'simnet_ai_operator_billing_snapshots_v1';

const ACCOUNT_TOOLS = new Set([
  'customer.snapshot',
  'billing.main_summary',
  'billing.balance',
  'billing.tariff',
  'billing.payments',
  'billing.next_charge',
  'network.session',
  'network.last_session',
  'pon.onu',
  'pon.signal',
  'outage.by_customer'
]);
