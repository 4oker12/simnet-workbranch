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

test('live recovery re-reads UserSide building work description', () => {
  assert.match(source, /\/task\/load_building_work_description/);
  assert.match(source, /buildingTaskCommentId/);
  assert.match(source, /buildingTaskInfoId/);
  assert.match(source, /buildingWorkDescriptionId/);
  assert.match(source, /special_info_recovery_shown/);
  assert.match(source, /Особенности по адресу/);
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
  assert.match(source, /live_info_prefetch_result/);
  assert.match(source, /special_info_recovery_evaluated/);
  assert.match(source, /crew_recovery_selected/);
});
