import assert from 'node:assert/strict';
import { parseOwnUsersideCalls, latestUnresolvedPreview } from '../src/features/call/source/userside-call-list.js';
import { createCallModule } from '../src/features/call/index.js';

const observedAt = Date.parse('2026-09-13T15:01:00');
const html = `
<table>
  <tr class="table_item">
    <td id="new_direction_Id">IN</td>
    <td id="new_DATEADD_Id">13.09.2026 15:00</td>
    <td id="new_PHONE_Id">0501112233</td>
    <td id="new_CUSTOMER_Id"><a href="/customer/70001">Current - abon70001</a></td>
    <td id="new_ANSWERPHONE_Id">6047</td>
    <td id="new_OPER_Id">6047 Operator</td>
    <td id="new_callIntervalInt_Id">0:01:00</td>
    <td><a href="/message/90002/call_comment_add">comment</a></td>
  </tr>
  <tr class="table_item">
    <td id="old_direction_Id">IN</td>
    <td id="old_DATEADD_Id">13.09.2026 14:50</td>
    <td id="old_PHONE_Id">0504445566</td>
    <td id="old_CUSTOMER_Id"><a href="/customer/70002">Previous - abon70002</a></td>
    <td id="old_ANSWERPHONE_Id">6047</td>
    <td id="old_OPER_Id">6047 Operator</td>
    <td id="old_callIntervalInt_Id">0:02:00</td>
    <td><a href="/message/90001/call_comment_add">comment</a></td>
  </tr>
</table>`;

const whileActive = parseOwnUsersideCalls(html, '6047', 240, observedAt, {
  known: true,
  active: true,
  talkStartMs: Date.parse('2026-09-13T15:00:30')
});
assert.equal(whileActive.ongoing.length, 1);
assert.equal(whileActive.ongoing[0].usersideCallId, '90002', 'active phone state focuses the current 6047 row');
assert.equal(latestUnresolvedPreview(whileActive.unresolved, observedAt)?.usersideCallId, '90002');
assert.deepEqual(whileActive.completed.map(call => call.usersideCallId), ['90001']);

const afterHangup = parseOwnUsersideCalls(html, '6047', 240, observedAt, {
  known: true,
  active: false
});
assert.equal(afterHangup.ongoing.length, 0, 'native idle state suppresses the false LIVE clock heuristic');
assert.equal(afterHangup.unresolved.length, 0);
assert.equal(afterHangup.completed[0].usersideCallId, '90002', 'without an active call the newest completed row is first');

const module = createCallModule({ nowMs: () => observedAt, nowIso: () => new Date(observedAt).toISOString() });
const state = { cases: {} };
module.ingestUsersideCalls(state, afterHangup.completed, null);
const idleView = module.query(state, {
  caseId: '',
  focusCallKey: 'call:90001',
  refresh: { refreshed: true, focusCallKey: 'call:90002', focusKind: 'completed' }
});
assert.equal(idleView.focusCall.callKey, 'call:90002', 'fresh filtered response overrides a stale requested focus');
assert.equal(idleView.focusCall.ongoing, false);
assert.equal(idleView.dayCalls[0].topLinkTier.kind, 'direct');
assert.equal(idleView.dayCalls[0].topLinkTier.label, '100%');

console.log('call_focus_active_then_completed_test: ok');
