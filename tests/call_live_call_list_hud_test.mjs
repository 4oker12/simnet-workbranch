import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseUsersideLiveRows, liveRowsNearAnchor } from '../src/features/call/source/userside-call-list.js';

const html = `
<table>
<tr class="table_item table_item_white">
  <td id="td_0_direction_Id">IN</td>
  <td id="td_0_DATEADD_Id">29.08.2026 22:27</td>
  <td id="td_0_PHONE_Id"><a href="/customer_list/search_page?search=0660079039">0660079039</a></td>
  <td id="td_0_CUSTOMER_Id"></td>
  <td id="td_0_ANSWERPHONE_Id">9030</td>
  <td id="td_0_OPER_Id"></td>
  <td id="td_0_callIntervalInt_Id"></td>
  <td id="td_0_comment_Id"><a id="callCommentAdd2475001Id" href="javascript:ajaxWindow('/message/2475001/call_comment_add')">c</a></td>
</tr>
<tr class="table_item table_item_gray">
  <td id="td_0_direction_Id">IN</td>
  <td id="td_0_DATEADD_Id">29.08.2026 22:22</td>
  <td id="td_0_PHONE_Id">0990649372</td>
  <td id="td_0_CUSTOMER_Id"></td>
  <td id="td_0_ANSWERPHONE_Id">9030</td>
  <td id="td_0_OPER_Id"></td>
  <td id="td_0_callIntervalInt_Id"></td>
  <td id="td_0_comment_Id"><a id="callCommentAdd2474999Id" href="javascript:ajaxWindow('/message/2474999/call_comment_add')">c</a></td>
</tr>
<tr class="table_item table_item_white">
  <td id="td_0_direction_Id">IN</td>
  <td id="td_0_DATEADD_Id">29.08.2026 22:20</td>
  <td id="td_0_PHONE_Id">0672749062</td>
  <td id="td_0_CUSTOMER_Id"><a href="/customer/59369">Гриценюк Юлія Валеріївна - abon509274</a></td>
  <td id="td_0_ANSWERPHONE_Id">6047</td>
  <td id="td_0_OPER_Id">Зятьєв А.</td>
  <td id="td_0_callIntervalInt_Id">0:00:19</td>
  <td id="td_0_comment_Id"><a id="callCommentAdd2474998Id" href="javascript:ajaxWindow('/message/2474998/call_comment_add')">c</a></td>
</tr>
</table>`;

const live = parseUsersideLiveRows(html);
assert.equal(live.length, 2, 'test parser must see unresolved queue rows before operator assignment');
assert.equal(live[0].callerId, '0660079039');
assert.equal(live[0].agentExtension, '9030');
assert.equal(live[0].usersideCallId, '2475001');
assert.equal(live[0].durationSeconds, 0);

const anchor = Date.parse('2026-08-29T22:27:31');
const matched = liveRowsNearAnchor(live, anchor, Date.parse('2026-08-29T22:27:40'));
assert.ok(matched.selected);
assert.equal(matched.selected.usersideCallId, '2475001');
assert.equal(matched.selected.callerId, '0660079039');
assert.equal(matched.candidates.length, 1, '22:22 row is outside the bounded TEST-start window');

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const bg = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/shared/messages.js', import.meta.url), 'utf8');

assert.match(ui, /LIVE_CALL_ROW_HOST_ID = 'simnet-workbench-call-list-live-row-host'/);
assert.match(ui, /CALL LIST · LIVE ROW/);
assert.match(ui, /left: '14px'/);
assert.match(ui, /bottom: '14px'/);
assert.match(ui, /CALL_LIVE_ROW_PREVIEW_QUERY/);
assert.match(ui, /LIVE_CALL_ROW_RETRY_DELAYS = Object\.freeze\(\[2_500, 5_000, 10_000, 20_000\]\)/);
assert.doesNotMatch(ui, /setInterval\s*\(/, 'live-row prototype must use bounded retries, not endless polling');
assert.match(bg, /queryUsersideLiveRowPreview/);
assert.match(bg, /closest-unresolved-start-to-test-anchor/);
assert.match(bg, /readOnly: true/);
assert.match(messages, /CALL_LIVE_ROW_PREVIEW_QUERY/);

console.log('PASS call_live_call_list_hud_test');
