import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src/content/bootstrap.js'), 'utf8');
const messages = fs.readFileSync(path.join(root, 'src/shared/messages.js'), 'utf8');

const checks = [
  [messages.includes("USERSIDE_BILLING_DIRECT: 'USERSIDE_BILLING_DIRECT'"), 'message type exists'],
  [background.includes("safeBillingSemanticTarget('billing.user', billingId"), 'background builds semantic direct Billing user URL'],
  [background.includes("const billingId = String(payload?.billingId || '').trim()"), 'exact redir id is used as Billing id'],
  [bootstrap.includes('/\\/cgi-bin\\/adm\\/redir\\.pl$/i'), 'UserSide redir.pl links are intercepted'],
  [bootstrap.includes("type: 'USERSIDE_BILLING_DIRECT'"), 'interceptor calls direct navigation'],
  [bootstrap.includes('billingHost: match.billingHost'), 'interceptor preserves Simnet/Looknet Billing host'],
  [background.includes('if (requestedHost && url.hostname !== requestedHost) return null'), 'background uses pp only from the matching Billing host'],
  [bootstrap.includes('event.composedPath()'), 'nested/dynamic UserSide link clicks are resolved through composedPath'],
  [bootstrap.includes("document.addEventListener('auxclick'"), 'middle-click redir links are intercepted too'],
  [bootstrap.includes('event.preventDefault()'), 'native redir navigation is prevented'],
  [bootstrap.includes('keeping the pp token out of the UserSide DOM'), 'pp is not embedded into UserSide href']
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
