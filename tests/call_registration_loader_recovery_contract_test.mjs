import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync(new URL('../src/ui/call-registration-loader.js', import.meta.url), 'utf8');

test('lazy CALL loader self-heals when the real module already exists', () => {
  assert.match(loader, /function actualRegistration\(\)/);
  assert.match(loader, /function markLoadedIfPresent\(\)/);
  assert.match(loader, /WB\.__callRegistrationLoaded = true/);
  assert.match(loader, /const registration = markLoadedIfPresent\(\)/);
});

test('load failure does not poison an already mounted real CALL module', () => {
  assert.match(loader, /forceNextLoad = !markLoadedIfPresent\(\)/);
  assert.match(loader, /if \(!actualRegistration\(\)\) WB\.__callRegistrationLoaded = false/);
});

test('CALL loader writes the real error message into the visible log line', () => {
  assert.match(loader, /Модуль регистрации не загрузился: \$\{errorMessage\(err\)\}/);
  assert.match(loader, /Ошибка при открытии окна регистрации: \$\{errorMessage\(error\)\}/);
});

test('same loader failure is not emitted twice by nested open handlers', () => {
  assert.match(loader, /markLoadErrorLogged/);
  assert.match(loader, /wasLoadErrorLogged/);
  assert.match(loader, /if \(!wasLoadErrorLogged\(error\)\)/);
});
