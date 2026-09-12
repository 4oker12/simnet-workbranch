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

const aiCommentHtml = `
<table>
<tr class="table_item table_item_white" id="row1Id">
  <td id="td_0_direction_Id">IN</td>
  <td id="td_0_DATEADD_Id">04.09.2026 14:48</td>
  <td class="div_right" id="td_0_doing_Id"><span id="audioRecordId2480069"><a href="javascript:loadRecordFile(2480069, 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=1788522493.230916')">play</a></span></td>
  <td id="td_0_PHONE_Id">0504585603</td>
  <td id="td_0_CUSTOMER_Id"><a href="/customer/1">ТОВ ДЕТ ПРОМ Т-2 - abon361977</a></td>
  <td id="td_0_ANSWERPHONE_Id">6047</td>
  <td id="td_0_OPER_Id"><a href="/employee/243">Зятьєв А.</a></td>
  <td id="td_0_callIntervalInt_Id">0:00:51</td>
  <td id="td_0_comment_Id"><b>--- БАЗОВИЙ АНАЛІЗ ---</b><br>Статус вирішення: В процесі.</td>
</tr>
</table>`;

const aiRows = parseUsersideCallListHtml(aiCommentHtml, { operatorExtension: '6047', completedOnly: true });
assert.equal(aiRows.length, 1, 'completed call with AI comment but no call_comment_add anchor should still parse');
assert.equal(aiRows[0].usersideCallId, '2480069');
assert.equal(aiRows[0].recordId, '1788522493.230916');
assert.equal(aiRows[0].durationSeconds, 51);

const erpHtml = `
<table><tbody>
<tr class="erp-table__row">
  <td class="erp-table__cell">1</td>
  <td class="erp-table__cell">IN</td>
  <td class="erp-table__cell">12.09.2026 16:58</td>
  <td class="erp-table__cell"><span id="audioRecordId4c0feb1d-552d-4788-ac81-8a02e703ec2a"><a href="javascript:loadRecordFile(&quot;4c0feb1d-552d-4788-ac81-8a02e703ec2a&quot;, &quot;https:\/\/pbx.simnet.kiev.ua\/fop2\/getrec.php?id=1789221476.8577&quot;)">play</a></span></td>
  <td class="erp-table__cell">0501699088</td>
  <td class="erp-table__cell"><a href="/customer/54961">Зубченко Ірина Володимирівна - abon468436</a></td>
  <td class="erp-table__cell">6047</td>
  <td class="erp-table__cell"><a href="/employee/243">Зятьєв А.</a></td>
  <td class="erp-table__cell">0:06:57</td>
  <td class="erp-table__cell"></td>
  <td class="erp-table__cell"><a id="callCommentAdd4c0feb1d-552d-4788-ac81-8a02e703ec2aId" href="/message/call_comment_add?uuid=4c0feb1d-552d-4788-ac81-8a02e703ec2a">comment</a></td>
</tr>
<tr class="erp-table__row">
  <td class="erp-table__cell">2</td>
  <td class="erp-table__cell">OUT</td>
  <td class="erp-table__cell">12.09.2026 16:38</td>
  <td class="erp-table__cell"><span id="audioRecordIdc78895e5-5c6f-452b-ad2c-d7f765cd15be"><a href="javascript:loadRecordFile(&quot;c78895e5-5c6f-452b-ad2c-d7f765cd15be&quot;, &quot;https:\/\/pbx.simnet.kiev.ua\/fop2\/getrec.php?id=1789220307.8508&quot;)">play</a></span></td>
  <td class="erp-table__cell">6047</td>
  <td class="erp-table__cell"><a href="/customer/35090">Бабіцькій Віталій Олеговіч - abon85791</a></td>
  <td class="erp-table__cell">0672201984</td>
  <td class="erp-table__cell"><a href="/employee/243">Зятьєв А.</a></td>
  <td class="erp-table__cell">0:00:16</td>
  <td class="erp-table__cell"></td>
  <td class="erp-table__cell"><a href="/message/call_comment_add?uuid=c78895e5-5c6f-452b-ad2c-d7f765cd15be">comment</a></td>
</tr>
<tr class="erp-table__row">
  <td class="erp-table__cell">3</td>
  <td class="erp-table__cell">IN</td>
  <td class="erp-table__cell">12.09.2026 17:32</td>
  <td class="erp-table__cell"><span id="audioRecordIdbba7d98a-412f-40a4-abc2-a25f580286f3"><a href="javascript:loadRecordFile(&quot;bba7d98a-412f-40a4-abc2-a25f580286f3&quot;, &quot;https:\/\/pbx.simnet.kiev.ua\/fop2\/getrec.php?id=1789223549.8616&quot;)">play</a></span></td>
  <td class="erp-table__cell">0930776427</td>
  <td class="erp-table__cell"><a href="/customer/58427">Злидений Роман Миколайович - abon500107</a><br><a href="/customer/56287">Злиденний Роман Миколайович - abon480766</a></td>
  <td class="erp-table__cell">6047</td>
  <td class="erp-table__cell"><a href="/employee/243">Зятьєв А.</a></td>
  <td class="erp-table__cell">0:02:32</td>
  <td class="erp-table__cell"></td>
  <td class="erp-table__cell"><a href="/message/call_comment_add?uuid=bba7d98a-412f-40a4-abc2-a25f580286f3">comment</a></td>
</tr>
</tbody></table>`;

const erpRows = parseUsersideCallListHtml(erpHtml, { operatorExtension: '6047', completedOnly: true });
assert.equal(erpRows.length, 3, 'UserSide 3.21.53 erp-table rows must parse');

const erpIn = erpRows.find(row => row.usersideCallId === '4c0feb1d-552d-4788-ac81-8a02e703ec2a');
assert.ok(erpIn, 'ERP incoming UUID call must be found');
assert.equal(erpIn.direction, 'IN');
assert.equal(erpIn.recordId, '1789221476.8577');
assert.equal(erpIn.callerId, '0501699088');
assert.equal(erpIn.customerId, '54961');
assert.equal(erpIn.login, 'abon468436');
assert.equal(erpIn.employeeId, '243');
assert.equal(erpIn.durationSeconds, 417);

const erpOut = erpRows.find(row => row.usersideCallId === 'c78895e5-5c6f-452b-ad2c-d7f765cd15be');
assert.ok(erpOut, 'ERP outgoing UUID call must be found');
assert.equal(erpOut.direction, 'OUT');
assert.equal(erpOut.callerId, '0672201984', 'outgoing caller identity is the number opposite 6047');
assert.equal(erpOut.customerId, '35090');
assert.equal(erpOut.login, 'abon85791');

const ambiguous = erpRows.find(row => row.usersideCallId === 'bba7d98a-412f-40a4-abc2-a25f580286f3');
assert.ok(ambiguous, 'ambiguous ERP call must still be preserved');
assert.equal(ambiguous.callerId, '0930776427');
assert.equal(ambiguous.customerId, '', 'multiple UserSide customers must not be silently collapsed to one');
assert.equal(ambiguous.customerCandidates.length, 2);
assert.deepEqual(ambiguous.customerCandidates.map(item => item.customerId), ['58427', '56287']);

console.log('userside_call_list_bridge_unit_test: ok');
