import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => /^(?:ai_operator.*|ai_billing_tariff_semantics|ai_autonomous_operator_contract)_test\.mjs$/.test(name))
  .sort().map(name => `tests/${name}`);
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: new URL('../', import.meta.url), stdio: 'inherit'
});
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
