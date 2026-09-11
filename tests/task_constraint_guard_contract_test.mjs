import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const guard = fs.readFileSync(new URL('../src/ui/task-constraint-guard.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../src/core/crm-constraint-index.js', import.meta.url), 'utf8');

const contentFiles = manifest.content_scripts?.[0]?.js || [];
const indexPos = contentFiles.indexOf('src/core/crm-constraint-index.js');
const taskAssistantPos = contentFiles.indexOf('src/ui/task-form-assistant.js');
const guardPos = contentFiles.indexOf('src/ui/task-constraint-guard.js');

assert.ok(indexPos >= 0, 'constraint index must be loaded into Workbench pages');
assert.ok(guardPos > taskAssistantPos, 'constraint guard must load after native task assistant validation');
assert.ok(indexPos < guardPos, 'constraint index must exist before the save guard');

assert.match(index, /simnet_crm_building_snapshot_v1/);
assert.match(index, /simnet_crm_building_constraints_v1/);
assert.match(index, /connection_block/);
assert.match(index, /infrastructure_capacity/);
assert.match(index, /entrance_scope/);
assert.match(index, /speed_limit/);
assert.match(index, /technology_restriction/);
assert.match(index, /access_window/);
assert.match(index, /access_coordination/);
assert.match(index, /sourceField/);
assert.match(index, /evidence/);

assert.match(guard, /addEventListener\('submit', handleSubmit, true\)/,
  'guard must intercept UserSide save before native submit leaves the page');
assert.match(guard, /Особенности по адресу/);
assert.match(guard, /Абонент уже предупреждён/);
assert.match(guard, /Ознакомлен/);
assert.match(guard, /Подтвердить и сохранить/);
assert.match(guard, /simnet_crm_constraint_ack_v1/,
  'operator acknowledgement must be auditable');
assert.match(guard, /customerWarned/,
  'audit must distinguish actual customer warning from operator acknowledgement');
assert.match(guard, /requestSubmit/,
  'confirmed save must return through native UserSide submit/validation');

assert.doesNotMatch(guard, /api\.groq|Groq|AI_CHAT_REQUEST/,
  'save guard must be deterministic and must not call AI at save time');
assert.doesNotMatch(index, /api\.groq|Groq|AI_CHAT_REQUEST/,
  'constraint extraction must not depend on online AI at runtime');

console.log('Task CRM constraint guard contract passed');
