import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const guard = fs.readFileSync(new URL('../src/ui/task-current-contract-guard.js', import.meta.url), 'utf8');

const contentFiles = manifest.content_scripts?.[0]?.js || [];
const assistantPos = contentFiles.indexOf('src/ui/task-form-assistant.js');
const currentGuardPos = contentFiles.indexOf('src/ui/task-current-contract-guard.js');
const legacyConstraintGuardPos = contentFiles.indexOf('src/ui/task-constraint-guard.js');

assert.ok(currentGuardPos > assistantPos,
  'current UserSide contract guard must run after the existing task assistant');
assert.ok(legacyConstraintGuardPos > currentGuardPos,
  'current UUID/live guard must run before the legacy snapshot guard');

for (const uuid of [
  '1b34ce66-cd14-4893-a2ec-59c19bcf16dc', // Подкл. ЖК
  '3496276b-010a-46ed-a2c5-534c32e8f9e2', // Ремонт
  '378b0972-13b7-4df5-94f0-98ce6a37e9c0', // Частный сектор
  'd283b923-d58b-48d8-b31f-e440f32858ca', // PON
  'c15aa787-6989-425a-88db-67b902c4ed2c', // Gig
  '1ff17c41-e4a2-4938-b68d-d9576aac8066', // Перегляд В2С
  '0a7c59e7-a6de-44a3-977f-d90c84e87e5f'  // 2,5 Гбіт/с
]) {
  assert.ok(guard.includes(uuid), `field visit UUID must be recognized: ${uuid}`);
}

assert.match(guard, /task_type_uuid/,
  'current task type must be read from UUID contract');
assert.match(guard, /division_auto_task_staffuuids/,
  'create form crew must use current staff UUID field');
assert.match(guard, /division_task_staffuuids/,
  'edit/staff form contract must understand current staff UUID field');
assert.match(guard, /field-time-past/,
  'past field visit must be blocked');
assert.match(guard, /field-time-min-lead/,
  'new or changed field visit must keep the three-hour lead rule');
assert.match(guard, /field-crew-required/,
  'field visit must require a brigade');
assert.match(guard, /buildingTimeIntervalId/,
  'guard must compare the selected time with UserSide building work interval when available');

assert.match(guard, /buildingTaskCommentId/);
assert.match(guard, /buildingTaskInfoId/);
assert.match(guard, /buildingWorkDescriptionId/);
assert.match(guard, /extractBuildingConstraints/,
  'live UserSide notes must pass through the deterministic constraint extractor');
assert.match(guard, /userside-live/,
  'audit must distinguish live UserSide evidence');
assert.match(guard, /Особенности по адресу/);
assert.match(guard, /Абонент предупреждён/);
assert.match(guard, /Ознакомлен/);
assert.match(guard, /Подтвердить и сохранить/);
assert.match(guard, /simnet_crm_constraint_ack_v1/,
  'acknowledgements must remain in the common constraint audit');
assert.match(guard, /requestSubmit/,
  'confirmed warning must return through the native submit path');

assert.doesNotMatch(guard, /api\.groq|Groq|AI_CHAT_REQUEST/,
  'save guard must remain deterministic and must not call AI at save time');
assert.doesNotMatch(guard, /setInterval\(/,
  'guard must not add a continuous timer');
assert.doesNotMatch(guard, /new MutationObserver/,
  'guard should use form events instead of a permanent page observer');

console.log('Current UserSide task contract guard passed');
