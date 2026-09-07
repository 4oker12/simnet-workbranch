import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const background = readFileSync(new URL('../src/features/call/transcription/background.js', import.meta.url), 'utf8');
const homeConfig = readFileSync(new URL('../tools/workbench-home.config.ps1', import.meta.url), 'utf8');

test('transcriber runtime uses the same local ASR port as Workbench tunnel scripts', () => {
  assert.match(background, /DEFAULT_TRANSCRIBER_URL = 'http:\/\/127\.0\.0\.1:8090'/);
  assert.match(homeConfig, /LocalAsrPort = 8090/);
  assert.match(homeConfig, /RemoteAsrPort = 8000/);
});

test('legacy local :8000 config migrates to the tunnel endpoint', () => {
  assert.match(background, /LEGACY_TRANSCRIBER_URL_RE/);
  assert.match(background, /migratedFrom/);
  assert.match(background, /baseUrl/);
});

test('network failure on POST transcribe probes health before reporting cause', () => {
  assert.match(background, /diagnoseTranscriberFetch/);
  assert.match(background, /\/health/);
  assert.match(background, /SSH-туннель и backend доступны/);
  assert.match(background, /\/health также недоступен/);
});
