import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'simnet-ai-standalone-'));
test('standalone build copies the real AI graph, without the Workbench runtime', () => {
  try {
    execFileSync(process.execPath, ['scripts/build-standalone-ai.mjs', '--out', dir], { cwd: repo, stdio: 'pipe', timeout: 120_000 });
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'SIMNET Autonomous AI Operator');
    assert.deepEqual(manifest.content_scripts, undefined);
    assert.equal(manifest.background.service_worker, 'standalone-ai/background.js');
    assert.ok(manifest.permissions.includes('scripting'));
    assert.ok(manifest.permissions.includes('tabs'));
    assert.ok(existsSync(join(dir, 'src/features/ai-operator/lab-background.js')));
    assert.ok(existsSync(join(dir, 'src/features/ai-operator/semantic-probe.js')));
    assert.ok(existsSync(join(dir, 'src/features/ai-operator/semantic-tool-broker.js')));
    assert.ok(existsSync(join(dir, 'src/features/ai-operator/live-tool-runtime.js')));
    assert.ok(existsSync(join(dir, 'src/features/ai-operator/billing-live-search.js')));
    assert.ok(existsSync(join(dir, 'src/features/ai-operator/userside-live-search.js')));
    assert.ok(existsSync(join(dir, 'src/ai/runtime-service.js')));
    assert.ok(existsSync(join(dir, 'src/config/ai-config.js')));
    assert.ok(!existsSync(join(dir, 'src/background-entry.js')));
    assert.ok(!existsSync(join(dir, 'src/features/ai-operator/background.js')));
    assert.ok(!existsSync(join(dir, 'src/features/call')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('standalone entrypoint imports only AI runtime and the READ-only lab', () => {
  const src = readFileSync(join(repo, 'standalone-ai/background.js'), 'utf8');
  assert.match(src, /\.\.\/src\/features\/ai-operator\/lab-background\.js/);
  assert.doesNotMatch(src, /features\/call\/|features\/ai-operator\/background\.js|helpcrunch-page-bridge|setInterval/);
});

test('standalone chat has a separate credential field and full fresh-chat reset', () => {
  const html = readFileSync(join(repo, 'standalone-ai/chat.html'), 'utf8');
  const script = readFileSync(join(repo, 'standalone-ai/chat.js'), 'utf8');
  assert.match(html, /type="password"/);
  assert.match(script, /AI_RUNTIME_SAVE/);
  assert.match(script, /provider: 'deepseek'/);
  assert.match(script, /AI_OPERATOR_LAB_RESET/);
  assert.match(script, /chrome\.storage\.local\.remove\(LAB_KEY\)/);
  assert.doesNotMatch(script, /innerHTML|eval\(|HelpCrunch/);
});
