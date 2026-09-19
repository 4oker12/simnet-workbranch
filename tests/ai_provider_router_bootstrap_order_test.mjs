import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const backgroundEntryUrl = new URL('../src/background-entry.js', import.meta.url);

test('AI provider router is installed before AI runtimes are evaluated', async () => {
  const source = await readFile(backgroundEntryUrl, 'utf8');
  const router = source.indexOf("import './ai/provider-router.js';");
  const runtime = source.indexOf("import './ai/runtime-service.js';");
  const operator = source.indexOf("import './features/ai-operator/background.js';");
  const lab = source.indexOf("import './features/ai-operator/lab-background.js';");
  const replay = source.indexOf("import './features/ai-operator/replay-background.js';");

  assert.notEqual(router, -1, 'background entry must load the provider router');
  for (const [name, position] of [['runtime-service', runtime], ['ai-operator', operator], ['lab', lab], ['replay', replay]]) {
    assert.notEqual(position, -1, `${name} import must remain present`);
    assert.ok(router < position, `provider router must be evaluated before ${name}`);
  }
});
