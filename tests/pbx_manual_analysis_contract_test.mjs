import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const entry = fs.readFileSync(path.join(ROOT, 'src/background-entry.js'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'src/pbx/pbx-analysis-background.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'src/pbx/pbx-analysis-ui.js'), 'utf8');

assert.equal(manifest.background.service_worker, 'src/background-entry.js');
assert.ok(manifest.host_permissions.includes('https://pbx.simnet.kiev.ua/*'));
assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
assert.ok(manifest.content_scripts.some(item =>
  item.matches?.includes('https://pbx.simnet.kiev.ua/*')
  && item.js?.includes('src/pbx/pbx-analysis-ui.js')
  && item.js?.includes('src/pbx/pbx-observer.js')
));

assert.match(entry, /import '\.\/background\.js'/);
assert.match(entry, /pbx-analysis-background\.js/);
assert.match(worker, /PBX_MANUAL_ANALYSIS_START/);
assert.match(worker, /getrec\.php/);
assert.match(worker, /\/transcribe/);
assert.match(worker, /simnet_pbx_manual_analysis_jobs_v1/);
assert.match(worker, /credentials:\s*'include'/);
assert.match(ui, /PBX_MANUAL_ANALYSIS_START/);
assert.match(ui, /wb-pbx-ai-result/);
assert.match(ui, /MutationObserver/);
assert.match(ui, /chrome\.storage\.onChanged/);

for (const relative of [
  'src/background-entry.js',
  'src/pbx/pbx-analysis-background.js',
  'src/pbx/pbx-analysis-ui.js'
]) {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, relative)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${relative} syntax error:\n${result.stderr}`);
}

console.log('pbx_manual_analysis_contract_test: PASS');
