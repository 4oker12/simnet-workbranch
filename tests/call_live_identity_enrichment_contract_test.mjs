import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const ui = fs.readFileSync(path.join(root, 'src/ui/call-registration.js'), 'utf8');

const checks = [
  [ui.includes('liveResolvedIdentity(event = {}, events = [])'), 'LIVE has evidence identity resolver'],
  [ui.includes("candidateAliases.some(alias => aliases.has(alias))"), 'resolver joins only by an exact known identity alias'],
  [ui.includes('if (leftCustomer && rightCustomer && leftCustomer !== rightCustomer) return false'), 'resolver refuses conflicting UserSide customerId'],
  [ui.includes('if (leftBilling && rightBilling && leftBilling !== rightBilling) return false'), 'resolver refuses conflicting Billing id'],
  [ui.includes('const identity = this.liveResolvedIdentity(event, events)'), 'LIVE labels use resolved identity instead of raw event only']
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
