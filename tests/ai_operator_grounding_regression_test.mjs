import test from 'node:test';
import assert from 'node:assert/strict';

import { isGeneralTariffCatalogQuestion } from '../src/features/ai-operator/semantic-probe-runtime-base.js';
import {
  deterministicGroundedFallback,
  groundedReplyIssues
} from '../src/features/ai-operator/semantic-tool-broker-core-runtime-base.js';

function resolution(entries) {
  return {
    evidence: entries.map(([path, value]) => ({
      path,
      status: 'known',
      value
    }))
  };
}

test('general apartment tariff catalog is recognized independently from model knowledge_need', () => {
  assert.equal(isGeneralTariffCatalogQuestion({
    probe: {
      whatUserWants: 'Узнать обычные тарифы для квартиры',
      unresolvedRequests: []
    },
    latestCustomer: {
      text: 'Какие у вас вообще есть обычные тарифы для квартиры?'
    }
  }), true);

  assert.equal(isGeneralTariffCatalogQuestion({
    probe: {
      whatUserWants: 'Узнать мой текущий тариф',
      unresolvedRequests: []
    },
    latestCustomer: {
      text: 'Какой тариф сейчас стоит именно на моём договоре?'
    }
  }), false);
});

test('current Billing amount already covered by balance cannot become another payment request', () => {
  const factResolution = resolution([
    ['subscriber.finance.balance.account', 401.2],
    ['subscriber.finance.totalDue', 399],
    ['subscriber.finance.balance.afterTariff', 2.2],
    ['subscriber.service.accessState', 'Разрешен']
  ]);

  const issues = groundedReplyIssues({
    reply: 'Вам нужно внести ещё 399 грн, после этого останется 2,20 грн.',
    factResolution,
    latestCustomer: { text: 'Сколько мне сейчас надо доплатить?' },
    analysis: {
      probe: {
        whatUserWants: 'Понять, сколько нужно доплатить сейчас',
        unresolvedRequests: []
      }
    }
  });

  assert.ok(issues.includes('CURRENT_DUE_ALREADY_COVERED'));

  const fallback = deterministicGroundedFallback({ factResolution, issues });
  assert.match(fallback, /401/);
  assert.match(fallback, /399/);
  assert.match(fallback, /2[,.]2/);
  assert.match(fallback, /не нужно/);
});

test('Billing access state alone cannot become an internet-is-working claim', () => {
  const factResolution = resolution([
    ['subscriber.service.accessState', 'Разрешен'],
    ['subscriber.finance.balance.account', 401.2]
  ]);

  const issues = groundedReplyIssues({
    reply: 'Доступ разрешён, интернет работает нормально.',
    factResolution,
    latestCustomer: { text: 'У меня интернет сейчас работает?' },
    analysis: {
      probe: {
        whatUserWants: 'Понять, работает ли интернет',
        unresolvedRequests: []
      }
    }
  });

  assert.ok(issues.includes('WORKING_STATE_NOT_VERIFIED'));
  assert.match(
    deterministicGroundedFallback({ factResolution, issues }),
    /не подтверждает фактическую работу интернета/
  );
});

test('tariff gigabit does not prove real gigabit line speed', () => {
  const factResolution = resolution([
    ['subscriber.tariff.current.speed', 1000],
    ['subscriber.access.connectionFamily', 'PON']
  ]);

  const issues = groundedReplyIssues({
    reply: 'У вас гигабит работает, подключение на 1000 Мбит.',
    factResolution,
    latestCustomer: { text: 'А гигабит у меня реально есть?' },
    analysis: {
      probe: {
        whatUserWants: 'Понять фактическую скорость подключения',
        unresolvedRequests: []
      }
    }
  });

  assert.ok(issues.includes('TARIFF_SPEED_IS_NOT_LINE_SPEED'));
  assert.match(
    deterministicGroundedFallback({ factResolution, issues }),
    /тарифная скорость/
  );
});

test('explicit Ethernet link speed allows a line-speed statement through this guard', () => {
  const factResolution = resolution([
    ['subscriber.tariff.current.speed', 1000],
    ['subscriber.access.ethernet.speedMbps', 1000]
  ]);

  const issues = groundedReplyIssues({
    reply: 'Линк сейчас 1000 Мбит/с.',
    factResolution,
    latestCustomer: { text: 'Какой линк?' },
    analysis: { probe: { whatUserWants: 'Узнать скорость линка', unresolvedRequests: [] } }
  });

  assert.ok(!issues.includes('TARIFF_SPEED_IS_NOT_LINE_SPEED'));
});
