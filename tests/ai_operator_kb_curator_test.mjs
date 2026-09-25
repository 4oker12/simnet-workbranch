import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
const lab = fs.readFileSync(new URL('../src/ui/ai-operator-lab.js', import.meta.url), 'utf8');
const lightCss = fs.readFileSync(new URL('../src/ui/settings-light.css', import.meta.url), 'utf8');

assert.doesNotMatch(html, /ai-operator-kb-curator\.js/, 'removed KB curator must not be loaded');
assert.doesNotMatch(html, /ai-operator-token-meter\.js/, 'removed token meter must not be loaded');
assert.doesNotMatch(html, /Пополнение базы знаний/);
assert.doesNotMatch(lab, /aiLabUsage|Расход API|Токены|ток\./, 'operator Lab must not render AI token/cost counters');
assert.doesNotMatch(lightCss, /\.ai-kb-curator\b/, 'dead curator styles must be removed');
assert.match(lightCss, /\.ai-lab-diagnostic-row\.warn/);

console.log('ai_operator_kb_curator_test: removed surfaces PASS');
