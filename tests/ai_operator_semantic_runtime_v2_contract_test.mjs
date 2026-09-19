import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const semanticProbeUrl = new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url);

async function source() {
  return readFile(semanticProbeUrl, 'utf8');
}

test('semantic runtime consumes the native three-scale behavior contract', async () => {
  const text = await source();
  assert.match(text, /from '\.\/behavior-profile\.js'/);
  assert.match(text, /behaviorRuntimeHints/);
  assert.match(text, /behaviorPromptGuidance\(profile\)/);
  assert.doesNotMatch(text, /function clampBehavior\(/);
  assert.doesNotMatch(text, /Решительность \$\{profile\.confidenceStyle\}/);
  assert.doesNotMatch(text, /Любопытство \$\{profile\.curiosity\}/);
  assert.doesNotMatch(text, /Скепсис \$\{profile\.skepticism\}/);
});

test('Prompt Guard skip from provider router is propagated as an honest skipped diagnostic', async () => {
  const text = await source();
  assert.match(text, /x-simnet-prompt-guard-skipped/);
  assert.match(text, /promptGuardSkipped/);
  assert.match(text, /promptGuardSkipReason/);
  assert.match(text, /provider_capability_unavailable/);
  assert.match(text, /skipped:\s*true/);
  assert.match(text, /skipReason/);
});

test('semantic runtime uses provider-neutral API error wording', async () => {
  const text = await source();
  assert.doesNotMatch(text, /Groq HTTP/);
  assert.doesNotMatch(text, /Groq returned an empty response/);
  assert.doesNotMatch(text, /Groq request timeout/);
  assert.doesNotMatch(text, /Groq API key is not configured/);
});
