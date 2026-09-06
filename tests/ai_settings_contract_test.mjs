import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const settingsHtml = readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const settingsJs = readFileSync(new URL('../src/ui/settings.js', import.meta.url), 'utf8');
const popupHtml = readFileSync(new URL('../src/ui/popup.html', import.meta.url), 'utf8');
const aiConfig = readFileSync(new URL('../src/config/ai-config.js', import.meta.url), 'utf8');
const postprocessor = readFileSync(new URL('../src/features/call/transcription/ai-postprocessor.js', import.meta.url), 'utf8');

test('manifest exposes a dedicated Workbench settings page', () => {
  assert.equal(manifest.options_ui?.page, 'src/ui/settings.html');
  assert.equal(manifest.options_ui?.open_in_tab, true);
});

test('Groq secret is configured locally rather than embedded in repository config', () => {
  assert.match(settingsHtml, /Groq API key/);
  assert.match(settingsJs, /chrome\.storage\.local/);
  assert.match(settingsJs, /simnet_workbench_ai_runtime_v1/);
  assert.match(aiConfig, /simnet_workbench_ai_runtime_v1/);
  assert.doesNotMatch(aiConfig, /gsk_[A-Za-z0-9_-]{10,}/);
});

test('settings validate Groq without spending a completion request', () => {
  assert.match(settingsJs, /openai\/v1\/models/);
  assert.match(settingsJs, /method:\s*'GET'/);
  assert.doesNotMatch(settingsJs, /chat\/completions/);
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
  }
  assert.match(postprocessor, /response\.status/);
  assert.match(postprocessor, /429|shouldStopFallback|retryAfter/);
});

test('popup only routes operator to settings instead of editing the key inline', () => {
  assert.match(popupHtml, /Открыть настройки AI/);
  assert.doesNotMatch(popupHtml, /id="groqApiKey"/);
});
