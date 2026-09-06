import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

test('background service worker has no runaway recursive CRM constant block', () => {
  assert.doesNotMatch(source, /AI_CRM_SEARCH_BUILDING_DETAIL_DETAIL_DETAIL/);
  assert.doesNotMatch(source, /Streat_query_limit_placeholder|STreet_query_limit_placeholder/);
});

test('background service worker does not redeclare top-level const identifiers', () => {
  const names = [...source.matchAll(/^const\s+([A-Z_$][A-Z0-9_$]*)\s*=/gm)].map(match => match[1]);
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  assert.deepEqual(duplicates, []);
});
