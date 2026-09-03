'use strict';

export const CALL_MODULE_SCHEMA = 'simnet-call-module-v1';
export const CALL_SCHEMA_VERSION = 1;
export const SNAPSHOT_SCHEMA = 'simnet-call-evidence-snapshot';
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SCORING_VERSION = 1;

export const CALL_WINDOW_GRACE_MS = 15_000;
export const EVIDENCE_RETENTION_MS = 48 * 60 * 60 * 1000;
export const SNAPSHOT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const CALL_RETENTION_MS = SNAPSHOT_RETENTION_MS;
export const BINDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PBX_HINT_RETENTION_MS = 2 * 60 * 60 * 1000;

export const MAX_CALLS = 240;
export const MAX_EVIDENCE_EVENTS = 800;
export const MAX_SNAPSHOTS = 240;
export const MAX_BINDINGS = 240;
export const MAX_ASSIGNMENT_LOG = 120;
export const MAX_PBX_HINTS = 80;

export const DEFAULT_CALL_CONFIG = Object.freeze({
  enabled: true,
  usersideCallListEnabled: true,
  pbxRealtimeEnabled: false
});

export const EVIDENCE_TYPES = Object.freeze({
  SEARCH_SUBMIT: 'SEARCH_SUBMIT',
  SEARCH_RESOLVED: 'SEARCH_RESOLVED',
  SEARCH_RESULT_OPEN: 'SEARCH_RESULT_OPEN',
  SUBSCRIBER_VISIT: 'SUBSCRIBER_VISIT',
  HANDOFF: 'HANDOFF'
});

export const EVIDENCE_TYPE_SET = new Set(Object.values(EVIDENCE_TYPES));
