import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/parsers/juniper/session.js', import.meta.url), 'utf8');
const sandbox = { globalThis: null, SIMNET_WB: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'src/parsers/juniper/session.js' });
const parser = sandbox.SIMNET_JUNIPER_PARSER;
assert.ok(parser, 'Juniper parser must publish its browser API');

function rootWithSession(sessionText, extraText = '') {
  const block = { innerText: sessionText, textContent: sessionText };
  return {
    innerText: `${sessionText} ${extraText}`,
    textContent: `${sessionText} ${extraText}`,
    querySelectorAll(selector) {
      return selector === 'table.table10, .message table' ? [block] : [];
    }
  };
}

const onlineText = [
  '10.8.84.55 (b0:4e:26:95:03:f7)',
  'BRAS - SIM-Juniper (192.168.9.5)',
  'Джерело сесії - Radius2 / subscriber_session',
  'Сесія - 1029445',
  'Статус сесії - online / active(2)',
  'USERNAME - b04e.2695.03f7',
  'Тип авторизації Radius2 - dhcp',
  'Час старту - 07-09-2026 21:23:44',
  'Байти прийнято/передано - 10.7gb / 776.2mb',
  'Швидкість прийом/передача за останню секунду - 0bit/s / 0bit/s',
  'Час останньої події - 10-09-2026 16:54:02',
  'Остання подія - Periodic',
  'ROUTER - TL-WR940N',
  'VENDOR - MSFT 5.0',
  'VLAN - 3800:3022'
].join(' ');

const online = parser.parseDocument(rootWithSession(
  onlineText,
  "Warning: Permanently added '192.168.9.5' to the list of known hosts. simnet@192.168.9.5: Permission denied (publickey)."
));
assert.equal(online.result, 'online');
assert.equal(online.session.activeSessionFound, true);
assert.equal(online.session.subscriberIp, '10.8.84.55');
assert.equal(online.session.subscriberMac, 'B0:4E:26:95:03:F7');
assert.equal(online.session.brasName, 'SIM-Juniper');
assert.equal(online.session.brasIp, '192.168.9.5');
assert.equal(online.session.sessionId, '1029445');
assert.equal(online.session.authType, 'dhcp');
assert.equal(online.session.vlan, '3800:3022');
assert.equal(online.sourceError, null, 'backend warning must not override a valid session');
assert.equal(online.sourceWarning?.type, 'backend_auth');

const stoppedText = [
  '10.8.84.55 (b0:4e:26:95:03:f7)',
  'online-сесію не знайдено, показано останню stopped-сесію',
  'BRAS - SIM-Juniper (192.168.9.5)',
  'Джерело сесії - Radius2 / subscriber_session stopped',
  'Сесія - 1029445',
  'Статус сесії - stopped / stopped',
  'Тип авторизації Radius2 - dhcp',
  'Час старту - 07-09-2026 21:24:02',
  'Час останньої події - 10-09-2026 17:08:15',
  'Остання подія - NAS-Request',
  'ROUTER - TL-WR940N',
  'VENDOR - MSFT 5.0',
  'VLAN - 3800:3022'
].join(' ');
const stopped = parser.parseDocument(rootWithSession(stoppedText));
assert.equal(stopped.result, 'offline');
assert.equal(stopped.session.activeSessionFound, false);
assert.equal(stopped.session.noActiveSession, true);
assert.equal(stopped.session.stopped, true);
assert.equal(stopped.session.sessionId, '1029445');
assert.match(stopped.summary, /активная online-сессия не найдена/i);

const sourceErrorRoot = {
  innerText: 'simnet@192.168.9.5: Permission denied (publickey).',
  textContent: 'simnet@192.168.9.5: Permission denied (publickey).',
  querySelectorAll() { return []; }
};
const sourceError = parser.parseDocument(sourceErrorRoot);
assert.equal(sourceError.result, 'error');
assert.equal(sourceError.session, null);
assert.equal(sourceError.sourceError?.type, 'backend_auth');
assert.equal(sourceError.sourceError?.retryable, false);

console.log('juniper_current_markup_regression_test: PASS');
