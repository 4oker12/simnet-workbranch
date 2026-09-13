import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const activeGuard = fs.readFileSync(new URL('../src/ui/call-active-focus-guard.js', import.meta.url), 'utf8');
const resolver = fs.readFileSync(new URL('../src/features/call/realtime/current-call-resolver.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(background, /refreshCallsFromUsersideCallList/);
assert.match(background, /CALL_LIST_PATH = '\/message\/call_list'/);
assert.match(background, /UserSide call_list is primary: no call-list\/PBX page needs to be open/);
assert.match(background, /if \(!refresh\?\.refreshed\)[\s\S]*forcePbxTabRefresh/);
assert.match(ui, /UserSide call_list/);
assert.match(ui, /Отдельная вкладка списка звонков не нужна/);
assert.doesNotMatch(ui, /Проверь, что вкладка PBX со списком разговоров открыта/);
const contentScripts = manifest.content_scripts.find(item => item.js?.includes('src/ui/call-active-focus-guard.js'))?.js || [];
const resolverIndex = contentScripts.indexOf('src/features/call/realtime/current-call-resolver.js');
const guardIndex = contentScripts.indexOf('src/ui/call-active-focus-guard.js');
assert.ok(resolverIndex >= 0, 'current LIVE call resolver must be loaded by the extension');
assert.ok(resolverIndex < guardIndex, 'current LIVE call resolver must load before the active focus guard');
assert.match(resolver, /fresh:\s*true/);
assert.match(resolver, /forceRefresh:\s*true/);
assert.match(activeGuard, /Workbench запросил call_list/);
assert.match(activeGuard, /data-action="refresh-focus"/);
console.log('call_list_direct_refresh_contract_test: ok');
