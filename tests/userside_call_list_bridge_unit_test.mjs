import assert from 'node:assert/strict';
import { parseUsersideCallListHtml } from '../src/features/call/userside-call-list-bridge.js';

const html = `
<table>
<tr class="table_item table_item_white">
  <td id="td_0_direction_Id">IN</td>
  <td id="td_0_DATEADD_Id">27.08.2026 20:32</td>
  <td id="td_0_doing_Id"><span id="audioRecordId2474131"><a href="javascript:loadRecordFile(2474131, 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=1787851920.210831')">play</a></span></td>
  <td id="td_0_PHONE_Id">0672749062</td>
  <td id="td_0_CUSTOMER_Id"><a href="/customer/59369">Гриценюк Юлія Валеріївна - abon509274</a></td>
  <td id="td_0_ANSWERPHONE_Id">6047</td>
  <td id="td_0_OPER_Id"><a href="/employee/243">Зятьєв А.</a></td>
  <td id="td_0_callIntervalInt_Id">0:00:19</td>
  <td id="td_0_comment_Id"><a id="callCommentAdd2474131Id" href="javascript:ajaxWindow('/message/2474131/call_comment_add')">c</a></td>
</tr>
<tr class="table_item table_item_gray">
  <td id="td_0_DATEADD_Id">27.08.2026 20:31</td>
  <td id="td_0_PHONE_Id">0991112233</td>
  <td id="td_0_CUSTOMER_Id"></td>
  <td id="td_0_ANSWERPHONE_Id">6007</td>
  <td id="td_0_callIntervalInt_Id">0:02:00</td>
</tr>
<tr class="table_item table_item_white">
  <td id="td_0_DATEADD_Id">27.08.2026 20:30</td>
  <td id="td_0_PHONE_Id">+380680703646</td>
  <td id="td_0_CUSTOMER_Id"></td>
  <td id="td_0_ANSWERPHONE_Id">6047</td>
  <td id="td_0_OPER_Id"><a href="/employee/243">Зятьєв А.</a></td>
  <td id="td_0_callIntervalInt_Id"></td>
  <td id="td_0_comment_Id"><a href="javascript:ajaxWindow('/message/2474130/call_comment_add')">c</a></td>
</tr>
</table>`;

const rows = parseUsersideCallListHtml(html, { operatorExtension: '6047', completedOnly: true });
assert.equal(rows.length, 1, 'only own completed 6047 call should be returned');
const call = rows[0];
assert.equal(call.recordId, '1787851920.210831');
assert.equal(call.usersideCallId, '2474131');
assert.equal(call.callerId, '0672749062');
assert.equal(call.customerId, '59369');
assert.equal(call.login, 'abon509274');
assert.equal(call.contract, 'abon509274');
assert.equal(call.agentExtension, '6047');
assert.equal(call.employeeId, '243');
assert.equal(call.durationSeconds, 19);
assert.equal(call.timeSemantics, 'start');
assert.equal(call.source, 'userside:call_list');
console.log('userside_call_list_bridge_unit_test: ok');
