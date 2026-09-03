import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');

assert.match(background, /refreshCallsFromUsersideCallList/);
assert.match(background, /CALL_LIST_PATH = '\/message\/call_list'/);
assert.match(background, /UserSide call_list is primary: no call-list\/PBX page needs to be open/);
assert.match(background, /if \(!refresh\?\.refreshed\)[\s\S]*forcePbxTabRefresh/);
assert.match(ui, /UserSide call_list/);
assert.match(ui, /Отдельная вкладка списка звонков не нужна/);
assert.doesNotMatch(ui, /Проверь, что вкладка PBX со списком разговоров открыта/);
console.log('call_list_direct_refresh_contract_test: ok');
