'use strict';

import { parseUsersideCallListHtml } from '../userside-call-list-bridge.js';

export const USERSIDE_CALL_LIST_PATH = '/message/call_list';

export function parseOwnUsersideCalls(html, operatorExtension = '6047', limit = 240) {
  const rows = parseUsersideCallListHtml(html, {
    operatorExtension,
    completedOnly: false,
    limit
  });
  return {
    completed: rows.filter(row => Number(row.durationSeconds || 0) > 0),
    unresolved: rows.filter(row => Number(row.durationSeconds || 0) <= 0)
  };
}

export function latestUnresolvedPreview(rows = [], observedAtMs = Date.now()) {
  const latest = [...rows].sort((a, b) => Number(b.startedAtMs || 0) - Number(a.startedAtMs || 0))[0] || null;
  if (!latest?.usersideCallId || !latest?.startedAtMs) return null;
  const age = Number(observedAtMs) - Number(latest.startedAtMs);
  if (age < 0 || age > 90 * 60 * 1000) return null;
  return {
    ...latest,
    callKey: `call:${String(latest.usersideCallId).replace(/\D+/g, '')}`,
    status: 'unknown',
    ongoing: true,
    bindable: false,
    liveUntilMs: Number(observedAtMs)
  };
}
