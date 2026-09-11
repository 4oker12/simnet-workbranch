import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ui/task-current-live-recovery.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('live recovery is loaded after current task guards', () => {
  const scripts = manifest.content_scripts?.[0]?.js || [];
  const contract = scripts.indexOf('src/ui/task-current-contract-guard.js');
  const staff = scripts.indexOf('src/ui/task-current-staff-transition.js');
  const recovery = scripts.indexOf('src/ui/task-current-live-recovery.js');
  assert.ok(contract >= 0);
  assert.ok(staff > contract);
  assert.ok(recovery > staff);
});

test('live recovery re-reads current UserSide address context and notes', () => {
  assert.match(source, /\/task\/load_building_work_description/);
  assert.match(source, /buildingTaskCommentId/);
  assert.match(source, /buildingTaskInfoId/);
  assert.match(source, /buildingWorkDescriptionId/);
  assert.match(source, /address_context_resolve_result/);
  assert.match(source, /special_info_recovery_shown/);
});

test('address context cannot leak from a previous street or building', () => {
  assert.match(source, /address_context_reset/);
  assert.match(source, /address_context_resolve_discarded/);
  assert.match(source, /address_context_waiting_for_building/);
  assert.match(source, /hasBuildingLevelSelection/);
  assert.match(source, /state\.resolvedBuildingUuid = ''/);
  assert.match(source, /state\.infoRows = \[\]/);
  assert.doesNotMatch(source, /parseBuildingUuidFromScripts\(document\)/);
});

test('special info guard shows only actionable operator warnings', () => {
  assert.match(source, /function interpretSpecialInfo/);
  assert.match(source, /special_info_interpreted/);
  assert.match(source, /infrastructure_capacity/);
  assert.match(source, /connection_block/);
  assert.match(source, /access_coordination/);
  assert.match(source, /access_window/);
  assert.match(source, /speed_limit/);
  assert.match(source, /technology_restriction/);
  assert.match(source, /Показано только то, что может повлиять на выполнение заявки/);
  assert.match(source, /if \(!items\.length \|\| state\.approvedSignature === signature\)/);
});

test('contact facts are interpreted row-by-row so unrelated notes are not mixed', () => {
  assert.match(source, /function interpretRow/);
  assert.match(source, /for \(const row of rawRows\) interpretRow\(row, items\)/);
});

test('special info UI keeps important text short, black and bold', () => {
  assert.match(source, /MAX_ACTIONABLE = 3/);
  assert.match(source, /wb-live-item-text/);
  assert.match(source, /font-weight:700;color:#111/);
  assert.match(source, /data-severity="critical"/);
  assert.match(source, /Важно перед сохранением/);
});

test('L1 transition can recover brigade choices from current UserSide endpoint', () => {
  assert.match(source, /\/task\/reload_auto_staff/);
  assert.match(source, /division_auto_task_staffuuids/);
  assert.match(source, /crew_recovery_load_result/);
  assert.match(source, /— выбрать бригаду —/);
  assert.match(source, /data-simnet-wb-recovery-crew-input/);
});

test('decision trace records recovery branches', () => {
  assert.match(source, /TASK_FLOW/);
  assert.match(source, /address_context_resolve_result/);
  assert.match(source, /special_info_recovery_evaluated/);
  assert.match(source, /special_info_interpreted/);
  assert.match(source, /crew_recovery_selected/);
});
