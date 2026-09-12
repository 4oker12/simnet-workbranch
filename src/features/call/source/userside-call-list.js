'use strict';

import { parseUsersideCallListHtml } from '../userside-call-list-bridge.js';

export const USERSIDE_CALL_LIST_PATH = '/message/call_list';

const LIVE_CLOCK_TOLERANCE_MS = 15_000;
const LIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function looksLikeRunningUsersideCall(row = {}, observedAtMs = Date.now()) {
  const startedAtMs = Number(row?.startedAtMs || 0);
  const durationSeconds = Math.max(0, Number(row?.durationSeconds || 0));
  const now = Number(observedAtMs || Date.now());
  if (!startedAtMs || !Number.isFinite(now) || now < startedAtMs) return false;
  const age = now - startedAtMs;
  if (age > LIVE_MAX_AGE_MS) return false;

  // While a UserSide call is in progress its duration cell already counts up.
  // Therefore "duration > 0" does NOT mean completed. A running row satisfies:
  // start + displayed duration ~= now. Completed rows quickly stop satisfying it.
  const displayedEndMs = startedAtMs + durationSeconds * 1000;
  return Math.abs(now - displayedEndMs) <= LIVE_CLOCK_TOLERANCE_MS;
}

export function parseOwnUsersideCalls(html, operatorExtension = '6047', limit = 240, observedAtMs = Date.now()) {
  const rows = parseUsersideCallListHtml(html, {
    operatorExtension,
    completedOnly: false,
    limit,
    allowIdless: true
  });
  const ongoing = rows.filter(row => looksLikeRunningUsersideCall(row, observedAtMs));
  const ongoingSet = new Set(ongoing);
  return {
    completed: rows.filter(row => !ongoingSet.has(row) && Number(row.durationSeconds || 0) > 0 && row.usersideCallId),
    unresolved: rows.filter(row => ongoingSet.has(row) || Number(row.durationSeconds || 0) <= 0),
    ongoing
  };
}

export function latestUnresolvedPreview(rows = [], observedAtMs = Date.now()) {
  const latest = [...rows].sort((a, b) => Number(b.startedAtMs || 0) - Number(a.startedAtMs || 0))[0] || null;
  if (!latest?.startedAtMs) return null;
  const age = Number(observedAtMs) - Number(latest.startedAtMs);
  if (age < 0 || age > 90 * 60 * 1000) return null;
  const usersideCallId = String(latest.usersideCallId || '').replace(/\D+/g, '');
  return {
    ...latest,
    usersideCallId,
    callKey: usersideCallId ? `call:${usersideCallId}` : '',
    status: 'ongoing',
    ongoing: true,
    bindable: Boolean(usersideCallId),
    liveUntilMs: Number(observedAtMs)
  };
}
