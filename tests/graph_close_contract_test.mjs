import fs from 'node:fs';
import assert from 'node:assert/strict';

const chat = fs.readFileSync(new URL('../src/ui/operator-companion.js', import.meta.url), 'utf8');

assert.match(chat, /:host\(\[hidden\]\)\{display:none!important\}/,
  'Chat host must have an explicit hidden CSS invariant');
assert.match(chat, /state\.host\.style\.setProperty\('display', 'none', 'important'\)/,
  'Chat close must force the host out of layout');
assert.match(chat, /state\.host\.style\.setProperty\('pointer-events', 'none', 'important'\)/,
  'Chat close must disable hit-testing');
assert.match(chat, /event\.composedPath\?\.\(\)\.find/, 'Chat click routing must resolve actions through the Shadow DOM composed path');
assert.match(chat, /data-action=\"close\"/, 'Chat close control must remain present');
assert.match(chat, /if \(action === 'close'\) return close\(\)/, 'Chat close control must call close()');

console.log('graph_close_contract_test: PASS (AI chat close contract)');
