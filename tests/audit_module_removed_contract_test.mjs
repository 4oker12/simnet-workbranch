import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const featureLoader = readFileSync(new URL('../src/infrastructure/feature-loader.js', import.meta.url), 'utf8');

const manifestPaths = [
  ...(manifest.content_scripts || []).flatMap(item => item.js || []),
  ...(manifest.web_accessible_resources || []).flatMap(item => item.resources || [])
];

test('legacy standalone Audit module stays removed', () => {
  assert.equal(manifestPaths.some(path => String(path).startsWith('src/audit/')), false);
  assert.doesNotMatch(featureLoader, /\baudit\s*:\s*Object\.freeze/);
});
