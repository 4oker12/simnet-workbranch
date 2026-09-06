import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const settingsHtml = readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const settingsJs = readFileSync(new URL('../src/ui/settings.js', import.meta.url), 'utf8');
const settingsEnhancer = readFileSync(new URL('../src/ui/settings-enhancer.js', import.meta.url), 'utf8');
const pbxShell = readFileSync(new URL('../src/pbx/pbx-workbench-shell.js', import.meta.url), 'utf8');
const popupHtml = readFileSync(new URL('../src/ui/popup.html', import.meta.url), 'utf8');
const aiConfig = readFileSync(new URL('../src/config/ai-config.js', import.meta.url), 'utf8');
const runtimeService = readFileSync(new URL('../src/ai/runtime-service.js', import.meta.url), 'utf8');
const postprocessor = readFileSync(new URL('../src/features/call/transcription/ai-postprocessor.js', import.meta.url), 'utf8');

test('manifest exposes dedicated settings and human Workbench settings UI', () => {
  assert.equal(manifest.options_ui?.page, 'src/ui/settings.html');
  assert.equal(manifest.options_ui?.open_in_tab, true);
  const main = manifest.content_scripts.find(item => item.matches?.includes('https://userside.simnet.kiev.ua/*'));
  assert.ok(main?.js?.includes('src/ui/settings-enhancer.js'));
});

test('PBX gets a visible lightweight Workbench shell in addition to row analysis', () => {
  const pbx = manifest.content_scripts.find(item => item.matches?.includes('https://pbx.simnet.kiev.ua/*'));
  assert.ok(pbx?.js?.includes('src/pbx/pbx-manual-analysis-ui.js'));
  assert.ok(pbx?.js?.includes('src/pbx/pbx-workbench-shell.js'));
  assert.match(pbxShell, /Workbench · PBX/);
  assert.match(pbxShell, /Настройки AI/);
});

test('Groq secret is configured locally rather than embedded in repository config', () => {
  assert.match(settingsHtml, /Groq API key/);
  assert.match(settingsJs, /chrome\.storage\.local/);
  assert.match(settingsJs, /simnet_workbench_ai_runtime_v1/);
  assert.match(aiConfig, /simnet_workbench_ai_runtime_v1/);
  assert.doesNotMatch(aiConfig, /gsk_[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(runtimeService, /gsk_[A-Za-z0-9_-]{10,}/);
});

test('AI config stays MV3 service-worker safe: no top-level await', () => {
  assert.doesNotMatch(aiConfig, /\(await\s+chrome\.storage/);
  assert.match(aiConfig, /AI_CONFIG_READY/);
  assert.match(aiConfig, /chrome\.storage\.local\.get\(AI_RUNTIME_CONFIG_KEY\)\s*\.then/);
});

test('settings validate Groq without spending a completion request', () => {
  assert.match(settingsJs, /openai\/v1\/models/);
  assert.match(settingsJs, /method:\s*'GET'/);
  assert.doesNotMatch(settingsJs, /chat\/completions/);
  assert.match(runtimeService, /openai\/v1\/models/);
  assert.doesNotMatch(runtimeService, /chat\/completions/);
});

test('content-script AI settings buttons route through service worker', () => {
  assert.match(runtimeService, /AI_RUNTIME_OPEN_SETTINGS/);
  assert.match(runtimeService, /chrome\.runtime\.openOptionsPage\(\)/);
  assert.match(settingsEnhancer, /AI_RUNTIME_OPEN_SETTINGS/);
  assert.match(pbxShell, /AI_RUNTIME_OPEN_SETTINGS/);
  assert.doesNotMatch(settingsEnhancer, /chrome\.runtime\.openOptionsPage\?\.\(\)/);
  assert.doesNotMatch(pbxShell, /chrome\.runtime\.openOptionsPage\?\.\(\)/);
});

test('PBX shell collapses to its toggle and stays anchored to the right edge', () => {
  assert.match(pbxShell, /right:\s*'4px'/);
  assert.match(pbxShell, /width:\s*open\s*\?/);
  assert.match(pbxShell, /'max-content'/);
  assert.match(pbxShell, /margin-left:auto/);
});

test('in-panel settings expose key, model, test and current-case controls in one compact surface', () => {
  assert.match(settingsEnhancer, /AI_RUNTIME_SAVE/);
  assert.match(settingsEnhancer, /AI_RUNTIME_TEST/);
  assert.match(settingsEnhancer, /data-action=\"compact\"/);
  assert.match(settingsEnhancer, /data-action=\"export\"/);
  assert.match(settingsEnhancer, /data-action=\"reset\"/);
  assert.match(settingsEnhancer, /Полный сброс WB/);
});

test('call analysis keeps the approved Groq fallback order', () => {
  const expected = [
    'qwen/qwen3.6-27b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b'
  ];
  for (const model of expected) {
    assert.match(postprocessor, new RegExp(model.replace(/[/.]/g, '\\$&')));
    assert.match(settingsJs, new RegExp(model.replace(/[/.]/g, '\\$&')));
    assert.match(settingsEnhancer, new RegExp(model.replace(/[/.]/g, '\\$&')));
  }
  assert.match(postprocessor, /response\.status/);
  assert.match(postprocessor, /429|shouldStopFallback|retryAfter/);
});

test('popup only routes operator to settings instead of editing the key inline', () => {
  assert.match(popupHtml, /Открыть настройки AI/);
  assert.doesNotMatch(popupHtml, /id="groqApiKey"/);
});
