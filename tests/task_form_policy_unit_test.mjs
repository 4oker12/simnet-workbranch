import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ui/task-form-assistant.js', import.meta.url), 'utf8');

const document = {
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  getElementById() { return null; },
  createElement() { return { dataset: {}, style: {}, appendChild() {}, setAttribute() {} }; },
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll() { return []; },
  querySelector() { return null; }
};
const windowObject = {
  addEventListener() {},
  removeEventListener() {}
};
windowObject.top = windowObject;
windowObject.self = windowObject;

const context = {
  console,
  Date,
  Math,
  URL,
  URLSearchParams,
  fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
  location: { href: 'https://userside.simnet.kiev.ua/anything', pathname: '/anything' },
  document,
  window: windowObject,
  globalThis: null,
  HTMLFormElement: class {},
  HTMLSelectElement: class {},
  Element: class {},
  CSS: { escape(value) { return String(value); } },
  SIMNET_WB: {}
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'task-form-assistant.js' });

const t = context.SIMNET_WB.taskFormAssistant?._test;
assert.ok(t, 'test helpers must be available');
assert.deepEqual([...t.fieldVisitTypes].sort(), [
  '10','14','29','50',
  '1','2','15','17','60','61','66','68','126','140',
  '3','9','11','12','18','19','26','34','38','42','43','65','144'
].sort(), 'canonical field-visit scope must be shared across every task entry point');
assert.equal(t.isBrigadeLabel('Бр. 2.3 "Игорь"'), true);
assert.equal(t.isBrigadeLabel('Техподдержка L1'), false);
assert.equal(t.isBrigadeLabel('Отдел B2C'), false);
assert.equal(t.isBrigadeDivision('17', ''), true, 'known historical brigade id must classify as crew even when EDIT label is absent');
assert.equal(t.isBrigadeDivision('1', 'Техподдержка L1'), false, 'L1 division must never classify as crew');

const validField = {
  mode: 'create',
  typeId: '2',
  dateKnown: true,
  dateValid: true,
  timeComplete: true,
  timeValid: true,
  hasAssignment: true,
  hasCrew: true,
  crewIds: ['17'],
  divisionIds: ['17'],
  hasKnownL1Division: false
};

let result = t.evaluateFieldVisitPolicy(validField, null);
assert.equal(result.applies, true);
assert.equal(result.strict, true);
assert.equal(result.issues.length, 0, 'valid field CREATE must pass policy');

result = t.evaluateFieldVisitPolicy({ ...validField, typeId: '66' }, null);
assert.equal(result.applies, true, 'PON switching type 66 must remain a strict field visit');
assert.equal(result.issues.length, 0, 'PON switching with valid schedule and a real brigade must pass');

result = t.evaluateFieldVisitPolicy({
  ...validField,
  dateKnown: false,
  dateValid: false,
  timeComplete: false,
  timeValid: false,
  hasAssignment: false,
  hasCrew: false,
  crewIds: [],
  divisionIds: []
}, null);
assert.deepEqual(
  [...result.issues.map(issue => issue.code)].sort(),
  ['field-date-required', 'field-time-required', 'field-crew-required'].sort(),
  'field CREATE must require date, time and a real brigade'
);

const invalidLegacyEdit = {
  mode: 'edit',
  typeId: '2',
  dateKnown: false,
  date: '23.08.2026',
  hour: '',
  minute: '',
  dateValid: false,
  timeComplete: false,
  timeValid: false,
  hasAssignment: true,
  hasCrew: false,
  crewIds: [],
  divisionIds: ['51'],
  hasKnownL1Division: false
};
result = t.evaluateFieldVisitPolicy({ ...invalidLegacyEdit }, invalidLegacyEdit);
assert.equal(result.strict, true, 'field EDIT must be strict: brigade and schedule are required on save');
assert.ok(result.issues.some(issue => issue.code === 'field-date-required'));
assert.ok(result.issues.some(issue => issue.code === 'field-time-required'));
assert.ok(result.issues.some(issue => issue.code === 'field-crew-required'));

const validEdit = {
  mode: 'edit',
  typeId: '2',
  dateKnown: true,
  date: '24.08.2026',
  hour: '10',
  minute: '00',
  dateValid: true,
  timeComplete: true,
  timeValid: true,
  hasAssignment: true,
  hasCrew: true,
  crewIds: ['17'],
  divisionIds: ['17'],
  hasKnownL1Division: false
};
result = t.evaluateFieldVisitPolicy(validEdit, validEdit);
assert.equal(result.issues.length, 0, 'valid field EDIT must pass');

const l1Baseline = {
  mode: 'edit',
  typeId: '90',
  dateKnown: false,
  date: '',
  hour: '',
  minute: '',
  dateValid: false,
  timeComplete: false,
  timeValid: false,
  hasAssignment: true,
  hasCrew: false,
  crewIds: [],
  divisionIds: ['1'],
  hasKnownL1Division: true
};
result = t.evaluateFieldVisitPolicy({
  ...validEdit,
  typeId: '2',
  divisionIds: ['1'],
  crewIds: [],
  hasCrew: false,
  hasKnownL1Division: true
}, l1Baseline);
assert.equal(result.typeChanged, true);
assert.ok(result.issues.some(issue => issue.code === 'field-crew-required'), 'L1 -> field visit still needs a brigade');
assert.equal(result.issues.some(issue => issue.code === 'field-l1-assignment-invalid'), false, 'L1 itself is not incompatible; only missing brigade blocks');

result = t.evaluateFieldVisitPolicy({
  ...validEdit,
  divisionIds: ['17', '1'],
  crewIds: ['17'],
  hasCrew: true,
  hasKnownL1Division: true
}, validEdit);
assert.equal(result.issues.length, 0, 'brigade + L1/other departments must pass when schedule is valid');

result = t.evaluateFieldVisitPolicy({
  ...validEdit,
  divisionIds: ['17', '1', '51'],
  crewIds: ['17'],
  hasCrew: true,
  hasKnownL1Division: true
}, validEdit);
assert.equal(result.issues.length, 0, 'brigade is the key invariant; extra departments/divisions may coexist');


assert.equal(t.fieldMinLeadMs, 3 * 60 * 60 * 1000, 'field minimum lead must be exactly three hours');

const nowMs = Date.UTC(2026, 7, 23, 12, 0, 0);
result = t.evaluateFieldVisitPolicy({
  ...validField,
  plannedAt: nowMs + (179 * 60 * 1000)
}, null, { nowMs });
assert.ok(result.issues.some(issue => issue.code === 'field-time-min-lead'), 'field CREATE at +2h59 must be blocked');

const repeatedCreateAttempt = t.evaluateFieldVisitPolicy({
  ...validField,
  plannedAt: nowMs + (179 * 60 * 1000)
}, null, { nowMs });
assert.ok(repeatedCreateAttempt.issues.some(issue => issue.code === 'field-time-min-lead'), 'repeated field CREATE attempt before +3h must remain blocked');
assert.deepEqual(
  [...t.createScheduleBlockingCodes].sort(),
  ['field-date-required', 'field-time-required', 'field-time-past', 'field-time-min-lead', 'field-crew-required'].sort(),
  'CREATE hard gate must enforce the same core field invariant as EDIT'
);

result = t.evaluateFieldVisitPolicy({
  ...validField,
  plannedAt: nowMs + (180 * 60 * 1000)
}, null, { nowMs });
assert.equal(result.issues.some(issue => issue.code === 'field-time-min-lead'), false, 'field CREATE at exactly +3 hours must pass lead-time policy');

const transitionBefore3h = {
  ...validEdit,
  typeId: '2',
  plannedAt: nowMs + (179 * 60 * 1000)
};
result = t.evaluateFieldVisitPolicy(transitionBefore3h, l1Baseline, { nowMs });
assert.ok(result.issues.some(issue => issue.code === 'field-time-min-lead'), 'L1 -> field transition before +3h must be blocked');

const existingFutureFieldBaseline = {
  ...validEdit,
  date: '23.08.2026',
  hour: '14',
  minute: '00',
  plannedAt: nowMs + (2 * 60 * 60 * 1000)
};
result = t.evaluateFieldVisitPolicy({ ...existingFutureFieldBaseline }, existingFutureFieldBaseline, { nowMs });
assert.equal(result.issues.some(issue => issue.code === 'field-time-min-lead'), false, 'unchanged future field appointment is not pushed forward just because it is inside 3h');
assert.equal(result.issues.some(issue => issue.code === 'field-time-past'), false, 'unchanged future field appointment remains valid');

const existingPastFieldBaseline = {
  ...validEdit,
  date: '23.08.2026',
  hour: '10',
  minute: '00',
  plannedAt: nowMs - (2 * 60 * 60 * 1000)
};
result = t.evaluateFieldVisitPolicy({ ...existingPastFieldBaseline }, existingPastFieldBaseline, { nowMs });
assert.ok(result.issues.some(issue => issue.code === 'field-time-past'), 'existing field task cannot be saved with a planned visit already in the past');

const changedExistingField = {
  ...existingFutureFieldBaseline,
  hour: '14',
  minute: '30',
  plannedAt: nowMs + (2.5 * 60 * 60 * 1000)
};
result = t.evaluateFieldVisitPolicy(changedExistingField, existingFutureFieldBaseline, { nowMs });
assert.ok(result.issues.some(issue => issue.code === 'field-time-min-lead'), 'changed field schedule inside +3h must be blocked');

// Representative historical field types from other entry points must use the exact same invariant.
for (const typeId of ['10', '68', '140', '19', '43', '144']) {
  result = t.evaluateFieldVisitPolicy({ ...validField, typeId, plannedAt: nowMs + (180 * 60 * 1000) }, null, { nowMs });
  assert.equal(result.applies, true, `${typeId} must be recognized as field work`);
  assert.equal(result.issues.length, 0, `${typeId} with brigade and +3h schedule must pass`);
}

result = t.evaluateFieldVisitPolicy({ ...validField, typeId: '87' }, null);
assert.equal(result.applies, false, 'L1 task must not inherit field-visit policy');

assert.equal(JSON.stringify(t.parseDummyAssignmentTokens('*division_17**division_1*')), JSON.stringify([
  { kind: 'division', id: '17' },
  { kind: 'division', id: '1' }
]));


assert.deepEqual([...t.privateSectorCrewIds].sort(), ['13', '17', '18', '45', '69'].sort(), 'private-sector matrix must keep only proven 2.x brigade ids');
assert.equal(t.nonPrivateCrewIds.includes('31'), true, 'ЖК/МКД matrix must include regular field brigades');
assert.equal(t.nonPrivateCrewIds.includes('17'), false, 'ЖК/МКД matrix must exclude private-sector 2.x brigades');

assert.equal(t.classifyBuildingTypeByText('Тип здания: Частный сектор').type, 'private');
assert.equal(t.classifyBuildingTypeByText('Тип здания: Многоквартирный дом').type, 'non-private');
assert.equal(t.classifyBuildingTypeByText('Тип здания: Таунхаус').type, 'townhouse');
assert.equal(t.classifyBuildingTypeByText('непонятный объект').type, 'unknown');
assert.equal(t.explicitTerritoryForTask({ typeId: '15', typeLabel: 'B2C - Подкл. Частный сектор' }).type, 'private');
assert.equal(t.explicitTerritoryForTask({ typeId: '1', typeLabel: 'B2C - Подкл. ЖК' }).type, 'non-private');

let territory = t.evaluateCrewTerritoryPolicy({ ...validField, crewIds: ['17'] }, { type: 'private', resolved: true });
assert.equal(territory.issues.length, 0, 'private sector + 2.x brigade must pass');
territory = t.evaluateCrewTerritoryPolicy({ ...validField, crewIds: ['31'] }, { type: 'private', resolved: true });
assert.ok(territory.issues.some(issue => issue.code === 'field-crew-territory-mismatch'), 'private sector + ЖК brigade must be blocked');
territory = t.evaluateCrewTerritoryPolicy({ ...validField, crewIds: ['31'] }, { type: 'non-private', resolved: true });
assert.equal(territory.issues.length, 0, 'ЖК/МКД + regular brigade must pass');
territory = t.evaluateCrewTerritoryPolicy({ ...validField, crewIds: ['17'] }, { type: 'non-private', resolved: true });
assert.ok(territory.issues.some(issue => issue.code === 'field-crew-territory-mismatch'), 'ЖК/МКД + private-sector brigade must be blocked');
territory = t.evaluateCrewTerritoryPolicy({ ...validField, crewIds: ['17'] }, { type: 'unknown', resolved: true });
assert.equal(territory.issues.length, 0, 'unknown building type must not hard-block');

console.log('task_form_policy_unit_test: PASS');
