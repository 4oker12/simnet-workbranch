import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const rail = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');

const headerStart = ui.indexOf('header() {');
const headerEnd = ui.indexOf('\n    surface(', headerStart);
const header = ui.slice(headerStart, headerEnd);
assert.match(header, /'Регистрация' : 'Звонок'/);
assert.doesNotMatch(header, /Звонок · снимок|Договор /);

const snapshotStart = ui.indexOf('renderSnapshotOnly(notice = null)');
const snapshotEnd = ui.indexOf('\n    testReplayPanel', snapshotStart);
const snapshot = ui.slice(snapshotStart, snapshotEnd);
assert.match(snapshot, />Выгрузить<\/button>/);
assert.match(snapshot, />Зарегистрировать<\/button>/);
assert.doesNotMatch(snapshot, /call_list:|Workbench не доказал|На привязку звонка это не влияет|Закрыть<\/button>/);

const formStart = ui.indexOf('renderForm(values = null, notice = null)');
const formEnd = ui.indexOf('\n    renderError(', formStart);
const form = ui.slice(formStart, formEnd);
assert.match(form, /registrationContextMarkup\(\)/);
assert.doesNotMatch(form, /this\.pbxPanel\(\)/);
assert.doesNotMatch(form, /Снимок нужен только|Отмена<\/button>/);
assert.doesNotMatch(form, /reliablePhone\(WB\.store\.activeCase/);

assert.match(rail, /'Звонок', active === 'call'/);
assert.doesNotMatch(rail, /'Звонок \/ снимок'/);

console.log('call_compact_operator_ui_contract_test: PASS');
