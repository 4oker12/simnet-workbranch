import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkSessionText } from '../src/features/ai-operator/network-live-search.js';

test('parseNetworkSessionText extracts L1 session facts from Billing stat.pl a=252 text', () => {
  const parsed = parseNetworkSessionText(`
10.0.0.42 (aa:bb:cc:dd:ee:ff)
1. BRAS - SIM-Juniper (192.168.9.5)
2. Джерело сесії - Radius2 / subscriber_session
3. Сесія - 902041
4. Статус сесії - online / active(2)
5. Сервіси - svc-ipoe-global (WORLD = 20 Mbit, UA = 100 Mbit) - активний
6. USERNAME - aa:bb:cc:dd:ee:ff
7. Тип авторизації Radius2 - dhcp
8. Час старту - 31-08-2026 15:57:10
9. Байти прийнято/передано - 156.8gb / 30.4gb
10. Швидкість прийом/передача за останню секунду - 0bit/s / 0bit/s
11. Час останньої події - 17-09-2026 06:17:29
12. Остання подія - Periodic
13. ROUTER - MiWiFi-R1CL
14. VENDOR - udhcp 1.19.4
15. VLAN - 105
`);

  assert.equal(parsed.hasUsefulData, true);
  assert.equal(parsed.subscriberIp, '10.0.0.42');
  assert.equal(parsed.subscriberMac, 'aa:bb:cc:dd:ee:ff');
  assert.equal(parsed.bras, 'SIM-Juniper');
  assert.equal(parsed.brasIp, '192.168.9.5');
  assert.equal(parsed.sessionSource, 'Radius2 / subscriber_session');
  assert.equal(parsed.sessionId, '902041');
  assert.equal(parsed.status, 'online / active(2)');
  assert.equal(parsed.isOnline, true);
  assert.equal(parsed.isActive, true);
  assert.match(parsed.services, /WORLD = 20 Mbit/);
  assert.equal(parsed.authorizationType, 'dhcp');
  assert.equal(parsed.startTime, '31-08-2026 15:57:10');
  assert.equal(parsed.lastEventTime, '17-09-2026 06:17:29');
  assert.equal(parsed.lastEvent, 'Periodic');
  assert.equal(parsed.router, 'MiWiFi-R1CL');
  assert.equal(parsed.vendor, 'udhcp 1.19.4');
  assert.equal(parsed.vlan, '105');
});

test('parseNetworkSessionText does not invent a session when page has no useful fields', () => {
  const parsed = parseNetworkSessionText('Статистика абонента недоступна');
  assert.equal(parsed.hasUsefulData, false);
  assert.equal(parsed.sessionId, '');
  assert.equal(parsed.status, '');
  assert.equal(parsed.subscriberIp, '');
});
