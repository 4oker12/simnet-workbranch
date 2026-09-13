import assert from 'node:assert/strict';
import {
  kyivCalendarDate,
  optimizedCallListUrl
} from '../src/features/call/background/call-list-fetch-optimizer.js';

// 22:30 UTC is already the next calendar day in Kyiv in September.
const at = new Date('2026-09-12T22:30:00.000Z');
assert.equal(kyivCalendarDate(at), '13.09.2026');

const url = new URL(optimizedCallListUrl(
  'https://userside.simnet.kiev.ua/message/call_list?period0_date1=old&period0_date1=duplicate&page=7',
  { operatorExtension: '6047', now: at }
));
assert.equal(url.pathname, '/message/call_list');
assert.deepEqual(url.searchParams.getAll('period0_date1'), ['13.09.2026']);
assert.deepEqual(url.searchParams.getAll('period0_date2'), ['13.09.2026']);
assert.equal(url.searchParams.get('employee_ipphone_number0_value'), '6047');
assert.equal(url.searchParams.get('filter_selector0'), 'period');
assert.equal(url.searchParams.get('filter_selector2'), 'employee_ipphone_number');
assert.equal(url.searchParams.get('employee_ipphone_number2_value'), '6047');
assert.equal(url.searchParams.has('filter_selector1'), false);
assert.equal(url.searchParams.has('employee_ipphone_number1_value'), false);
assert.equal(url.searchParams.has('page'), false);
assert.equal(
  url.search,
  '?employee_ipphone_number0_value=6047&filter_selector0=period&period0_date1=13.09.2026&period0_date2=13.09.2026&filter_selector2=employee_ipphone_number&employee_ipphone_number2_value=6047'
);

const anotherOperator = new URL(optimizedCallListUrl(
  'https://userside.simnet.kiev.ua/message/call_list',
  { operatorExtension: '6013', now: at }
));
assert.equal(anotherOperator.searchParams.get('employee_ipphone_number0_value'), '6013');
assert.equal(anotherOperator.searchParams.get('employee_ipphone_number2_value'), '6013');

console.log('call_list_filtered_url_test: PASS');
