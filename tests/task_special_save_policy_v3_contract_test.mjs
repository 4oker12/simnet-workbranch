import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ui/task-special-save-policy-v3.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('save policy v3 is syntactically valid and loaded after live address recovery', () => {
  assert.doesNotThrow(() => new vm.Script(source));
  const scripts = manifest.content_scripts?.[0]?.js || [];
  const core = scripts.indexOf('src/core/task-special-policy-v3.js');
  const recovery = scripts.indexOf('src/ui/task-current-live-recovery.js');
  const policy = scripts.indexOf('src/ui/task-special-save-policy-v3.js');
  const legacyIndexGuard = scripts.indexOf('src/ui/task-constraint-guard.js');
  assert.ok(core >= 0);
  assert.ok(recovery >= 0);
  assert.ok(policy > recovery);
  assert.ok(legacyIndexGuard > policy);
});

test('save policy runs only on final submit and does not pop on form field changes', () => {
  assert.match(source, /window\.addEventListener\('submit', handleSubmit, true\)/);
  assert.match(source, /FORM_ACTION_RE = \/\^\\\/task\\\/save/);
  assert.doesNotMatch(source, /document\.addEventListener\('change'/);
  assert.doesNotMatch(source, /window\.addEventListener\('change'/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('save policy reuses isolated live UserSide building context', () => {
  assert.match(source, /WB\.taskCurrentLiveRecovery/);
  assert.match(source, /recovery\.debug\(form\)/);
  assert.match(source, /debug\.noteRows/);
  assert.match(source, /WB\.taskSpecialPolicyV3/);
});

test('old noisy live warning is bypassed only after v3 has evaluated the save', () => {
  assert.match(source, /LEGACY_BYPASS_ID = 'simnet-wb-current-task-special-info'/);
  assert.match(source, /approvalValid\(form\)/);
  assert.match(source, /armLegacyBypass\(\)/);
  assert.match(source, /fallbackToExistingGuard/);
});

test('modal is compact and exposes raw note only for manual review', () => {
  assert.match(source, /Особые условия по адресу/);
  assert.match(source, /MAX_VISIBLE = 6/);
  assert.match(source, /wb-sp-summary/);
  assert.match(source, /font-weight:700;color:#111/);
  assert.match(source, /item\.needsReview && item\.evidence/);
  assert.match(source, /Исходная заметка/);
  assert.doesNotMatch(source, /Абонент предупреждён/);
});