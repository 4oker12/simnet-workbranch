import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function checkModule(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = fs.readFileSync(url, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${relativePath} syntax error:\n${result.stderr || result.stdout}`);
}

function checkScript(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = fs.readFileSync(url, 'utf8');
  const result = spawnSync(process.execPath, ['--check'], {
    input: source,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${relativePath} syntax error:\n${result.stderr || result.stdout}`);
}

checkModule('../src/features/operator-companion/work-state.js');
checkModule('../src/features/operator-companion/background.js');
checkScript('../src/ui/operator-companion-conversation.js');

console.log('operator_companion_syntax_test: PASS');
