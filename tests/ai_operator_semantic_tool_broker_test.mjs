import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AI_OPERATOR_SOFT_TOOL_CAPABILITIES,
  AI_OPERATOR_TOOL_CAPABILITY_DETAILS,
  ensureNonEmptyReply,
  executeInformationNeeds,
  extractIdentityHints,
  mapInformationNeedsToTools
} from '../src/features/ai-operator/semantic-tool-broker.js';

test('soft broker maps information needs to evidence sources without phrase-script actions', () => {
  assert.deepEqual(AI_OPERATOR_SOFT_TOOL_CAPABILITIES, { billing: true, userside: true, network: true });
  assert.equal(AI_OPERATOR_TOOL_CAPABILITY_DETAILS.billing, 'live-read-only');
  assert.equal(AI_OPERATOR_TOOL_CAPABILITY_DETAILS.userside, 'live-read-only');

  const calls = mapInformationNeedsToTools([
    { system: 'Billing', field: 'баланс договора', why: 'ответить сколько денег на счёте' },
    { system: 'UserSide', field: 'точка подключения и порт', why: 'понять тип доступа' },
    { system: 'Network', field: 'BRAS session', why: 'проверить авторизацию' },
    { system: 'Network', field: 'оптический RX ONU', why: 'проверить сигнал' }
  ]);

  assert.deepEqual(calls.map(item => item.tool), [
    'billing.balance',
    'userside.snapshot',
    'network.session',
    'pon.signal'
  ]);
  assert.equal(calls.some(item => Object.hasOwn(item, 'intent')), false, 'broker must not emit hard intent classifications');
  assert.equal(calls.find(item => item.tool === 'userside.snapshot')?.toolArgs?.refresh, true, 'UserSide tool must request fresh data');
  assert.equal(calls.find(item => item.tool === 'pon.signal')?.toolArgs?.refresh, true, 'PON signal tool must request fresh data');
});

test('identity hints use explicit dialogue evidence and short numeric answer only in context', () => {
  assert.deepEqual(
    extractIdentityHints([
      { role: 'agent', text: 'Подскажите номер договора.' },
      { role: 'customer', text: '146888' }
    ], { probe: { latestMessageMeans: 'Клиент сообщил номер договора' } }),
    { contract: '146888' }
  );

  assert.deepEqual(
    extractIdentityHints([{ role: 'customer', text: 'abon470642' }], {}),
    { login: 'abon470642' }
  );

  assert.deepEqual(
    extractIdentityHints([{ role: 'customer', text: 'ул. Метрологическая 44 кв 9' }], {}),
    { address: 'ул. Метрологическая 44 кв 9' }
  );

  assert.deepEqual(
    extractIdentityHints([{ role: 'customer', text: '350' }], { probe: {} }),
    {},
    'a naked number must not automatically become a contract without conversational evidence'
  );
});

test('tool loop can identify subscriber and use returned state in the same semantic turn', async () => {
  const seen = [];
  const fakeExecute = async ({ tool, toolArgs, labState }) => {
    seen.push({ tool, toolArgs: structuredClone(toolArgs), labState: structuredClone(labState) });
    if (tool === 'customer.lookup') {
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-16T13:00:00.000Z',
        data: { candidate: { caseId: 'billing-live:42', contract: '146888', billingId: '42' }, source: 'billing-live-read-only' },
        warnings: [],
        statePatch: {
          confirmedCaseId: 'billing-live:42',
          confirmedSubscriber: { caseId: 'billing-live:42', contract: '146888', billingId: '42' }
        }
      };
    }
    if (tool === 'billing.balance') {
      assert.equal(labState.confirmedCaseId, 'billing-live:42', 'lookup statePatch must reach the following tool call');
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-16T13:00:01.000Z',
        data: { balanceAfterTariff: 123.45, source: 'billing-live-read-only' },
        warnings: [],
        statePatch: {}
      };
    }
    throw new Error(`unexpected tool ${tool}`);
  };

  const result = await executeInformationNeeds({
    needs: [{ system: 'Billing', field: 'текущий баланс', why: 'ответить клиенту' }],
    transcript: [{ role: 'customer', text: 'Договор 146888, какой у меня баланс?' }],
    analysis: { probe: { whatUserWants: 'Узнать текущий баланс' } },
    labState: {},
    execute: fakeExecute
  });

  assert.deepEqual(seen.map(item => item.tool), ['customer.lookup', 'billing.balance']);
  assert.equal(result.trace.length, 2);
  assert.equal(result.trace[0].source, 'billing-live-read-only');
  assert.equal(result.trace[1].ok, true);
  assert.equal(result.trace[1].data.balanceAfterTariff, 123.45);
  assert.equal(result.labState.confirmedCaseId, 'billing-live:42');
});

test('same turn can identify through Billing then read live UserSide with the confirmed state', async () => {
  const seen = [];
  const fakeExecute = async ({ tool, labState }) => {
    seen.push({ tool, labState: structuredClone(labState) });
    if (tool === 'customer.lookup') {
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-16T13:00:00.000Z',
        data: { source: 'billing-live-read-only' },
        warnings: [],
        statePatch: {
          confirmedCaseId: 'billing-live:42',
          confirmedSubscriber: { caseId: 'billing-live:42', billingId: '42', login: 'abon146888', contract: '146888' }
        }
      };
    }
    if (tool === 'userside.snapshot') {
      assert.equal(labState.confirmedSubscriber.login, 'abon146888');
      return {
        ok: true,
        tool,
        code: 'OK',
        observedAt: '2026-09-16T13:00:01.000Z',
        data: { network: { connectionFamily: 'Ethernet', accessPort: '8' }, source: 'userside-live-read-only' },
        warnings: [],
        statePatch: { confirmedSubscriber: { ...labState.confirmedSubscriber, customerId: '383410', connectionFamily: 'Ethernet' } }
      };
    }
    throw new Error(`unexpected tool ${tool}`);
  };

  const result = await executeInformationNeeds({
    needs: [{ system: 'UserSide', field: 'точка подключения и порт', why: 'проверить линию' }],
    transcript: [{ role: 'customer', text: 'abon146888, где я подключен?' }],
    analysis: { probe: { whatUserWants: 'Проверить подключение' } },
    labState: {},
    execute: fakeExecute
  });

  assert.deepEqual(seen.map(item => item.tool), ['customer.lookup', 'userside.snapshot']);
  assert.equal(result.trace[1].source, 'userside-live-read-only');
  assert.equal(result.trace[1].data.network.accessPort, '8');
  assert.equal(result.labState.confirmedSubscriber.customerId, '383410');
});

test('tool failure becomes observable evidence and never forces an empty subscriber answer', async () => {
  const result = await executeInformationNeeds({
    needs: [{ system: 'Network', field: 'BRAS session', why: 'проверить доступ' }],
    transcript: [],
    analysis: { probe: { whatUserWants: 'Понять, почему нет интернета' } },
    labState: {},
    execute: async ({ tool }) => ({
      ok: false,
      tool,
      code: 'IDENTITY_REQUIRED',
      observedAt: '2026-09-16T13:00:00.000Z',
      data: { message: 'Абонент не идентифицирован.' },
      warnings: [],
      statePatch: {}
    })
  });

  assert.ok(result.trace.length >= 1);
  assert.ok(result.trace.some(item => item.code === 'IDENTITY_REQUIRED'));
  const fallback = ensureNonEmptyReply('', { probe: { whatUserWants: 'Понять, почему нет интернета' } }, result.trace);
  assert.ok(fallback.trim().length > 0);
  assert.match(fallback, /номер договора|точный адрес/i);
});

test('soft broker stays independent of deterministic regulator files and distinguishes live evidence from fallback', () => {
  const source = fs.readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fact-runtime\.js/);
  assert.doesNotMatch(source, /fact-catalog\.js/);
  assert.doesNotMatch(source, /dialogue-state\.js/);
  assert.doesNotMatch(source, /workbench-userside-reader-context/);
  assert.match(source, /source=userside-live-read-only/);
  assert.match(source, /source=billing-live-read-only/);
  assert.match(source, /Workbench\/Network fallback не выдавай за свежий/i);
  assert.match(source, /поле reply ОБЯЗАТЕЛЬНО должно быть непустым/i);
  assert.match(source, /ok=false означает.*НЕ доказательство отрицательного факта/i);
});


test('tool synthesis prompt forbids card dumps and treating payment descriptions as service classifiers', () => {
  const source = fs.readFileSync(
    new URL('../src/features/ai-operator/semantic-tool-broker-core-runtime-base.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /не превращай ответ в сводку карточки/i);
  assert.match(source, /статусы услуги\/доступа.*не перечисляй/is);
  assert.match(source, /description.*не используй.*как доказательство типа услуги/is);
  assert.match(source, /1–3 короткими предложениями/i);
});
