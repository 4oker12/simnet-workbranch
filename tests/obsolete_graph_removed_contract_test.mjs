import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mustNotExist = [
  'src/core/semantic-tree.js',
  'src/semantic-studio/index.html',
  'src/semantic-studio/studio.js',
  'src/graph',
  'src/domain/appeal-policy.js',
  'src/ui/appeals-navigator.js',
  'src/ui/appeals-loader.js'
];
for (const rel of mustNotExist) assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} must stay deleted`);

const manifest = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
const featureLoader = fs.readFileSync(path.join(root, 'src/infrastructure/feature-loader.js'), 'utf8');
const caseView = fs.readFileSync(path.join(root, 'src/ui/case-view.js'), 'utf8');
const combined = [manifest, featureLoader, caseView].join('\n');
assert.equal(/operator-graph|graph-loader|appeals-navigator|appeals-loader|APPEAL_SELECT_|projections\?\.graph/i.test(combined), false,
  'runtime must not retain Appeal/diagnostic Graph compatibility paths');
assert.match(featureLoader, /companion: Object\.freeze\(\[/, 'Operator Companion is the retained presentation-only replacement');
console.log('obsolete_graph_removed_contract_test: PASS');
