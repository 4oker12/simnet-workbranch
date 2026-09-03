import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ui/rail.js', import.meta.url), 'utf8');
const start = source.indexOf('  const EXPORT_SECRET_KEY_RE');
const end = source.indexOf('  const esc = value =>', start);
assert.ok(start >= 0 && end > start, 'export sanitizer block must exist');
const block = source.slice(start, end);
const context = { URL, WeakSet };
vm.createContext(context);
vm.runInContext(`${block}\nthis.sanitizeCaseExport = sanitizeCaseExport;`, context);
const input = {
  operations: { poll: { current: { href: 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?a=313&pp=SECRET123&id=1' } } },
  nested: [{ url: 'https://example.test/?token=abc&x=1' }],
  pp: 'raw-secret',
  authorization: 'Bearer abc.def'
};
const out = context.sanitizeCaseExport(input);
const text = JSON.stringify(out);
assert.doesNotMatch(text, /SECRET123|raw-secret|abc\.def/);
assert.match(out.operations.poll.current.href, /pp=%5Bredacted%5D|pp=\[redacted\]/);
assert.equal(out.pp, '[redacted]');
assert.equal(out.authorization, '[redacted]');
console.log('case_export_redaction_behavior_test: PASS');
