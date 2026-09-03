import assert from 'node:assert/strict';
import { createCaseModel } from '../src/state/case-model.js';
import { refreshProgress } from '../src/state/progress.js';

const model = createCaseModel({
  nowIso: () => '2026-08-20T12:00:00.000Z',
  compact: (value, max=240) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max),
  rawFactValue: value => value && typeof value === 'object' && 'value' in value ? value.value : value,
  trimCaseJournal: value => Array.isArray(value) ? value : [],
  compactExistingConflicts: value => Array.isArray(value) ? value : [],
  sanitizeGuidePersistedDetails: value => value,
  refreshProgress
});

const legacy = model.ensureCaseShape({
  id: 'case-1',
  createdAt: '2026-08-19T10:00:00.000Z',
  appeal: {
    typeId: 'unstable',
    complaintPhrase: 'Постоянно вылогинивает из программы',
    source: 'operator-graph',
    startedAt: '2026-08-19T10:01:00.000Z',
    updatedAt: '2026-08-19T10:02:00.000Z'
  }
}, 'case-1');
assert.equal('appeal' in legacy, false, 'legacy Appeal object must be removed from Case');
assert.equal(legacy.complaint.category, 'unstable');
assert.equal(legacy.complaint.text, 'Постоянно вылогинивает из программы');
assert.equal(legacy.complaint.source, 'legacy-complaint-migration');

const modern = model.ensureCaseShape({
  id: 'case-2',
  complaint: { category: 'no_internet', text: 'Нет интернета', source: 'operator', capturedAt: '2026-08-20T11:00:00Z' },
  appeal: { typeId: 'wifi', complaintPhrase: 'legacy should not override' }
}, 'case-2');
assert.equal(modern.complaint.category, 'no_internet');
assert.equal(modern.complaint.text, 'Нет интернета');
assert.equal('appeal' in modern, false);
console.log('case_complaint_migration_test: PASS');
