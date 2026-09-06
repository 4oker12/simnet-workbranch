import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/infrastructure/feature-loader.js', import.meta.url), 'utf8');

test('lazy feature injection cache is scoped to sender.documentId, not tabId alone', () => {
  assert.match(source, /const injectedByDocument = new Map\(\)/);
  assert.match(source, /sender\?\.documentId/);
  assert.match(source, /documentKey\(sender, tabId\)/);
  assert.doesNotMatch(source, /const injectedByTab = new Map\(\)/);
});

test('same tab navigation drops stale document feature markers', () => {
  assert.match(source, /forgetOlderDocuments\(tabId, docKey\)/);
  assert.match(source, /key\.startsWith\(prefix\) && key !== keepKey/);
});

test('missing documentId favors safe reinjection over stale dedupe', () => {
  assert.match(source, /const done = docKey \? \(injectedByDocument\.get\(docKey\) \|\| new Set\(\)\) : null/);
  assert.match(source, /if \(done\?\.has\(key\) && !force\)/);
});
