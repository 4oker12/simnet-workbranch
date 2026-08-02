"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_ROUTES__) return;

  const step = (definition) => Object.freeze(definition);

  const finance = Object.freeze({
    id: "finance",
    title: "Финансовый вопрос",
    description: "Проверь доступ и состояние, затем расчёт, платежи и активные дополнительные услуги.",
    steps: Object.freeze([
      step({
        id: "access-state",
        title: "Доступ и состояние",
        short: "Статус услуги, доступ, день начала и предупреждение Billing",
        entityKeys: Object.freeze(["serviceState", "access", "startDay", "disconnectWarning"]),
        focusKey: "accessSummary",
        why: "Состояние услуги, административный доступ и ожидаемая финансовая блокировка — разные факты. Отрицательный остаток сам по себе не означает, что доступ уже отключён."
      }),
      step({
        id: "calculation",
        title: "Расчёт",
        short: "Тариф, начисление, временный платёж и два варианта остатка",
        entityKeys: Object.freeze(["tariff", "price", "totalDue", "balanceAfterTariff", "balanceWithoutTemporary", "temporaryPayment"]),
        focusKey: "balanceAfterTariff",
        why: "При временном платеже обязательно сравни остаток с его учётом и без него. Это показывает текущую отсрочку, но не отменяет фактическую задолженность."
      }),
      step({
        id: "payments",
        title: "Платежи",
        short: "Последние пополнения, списания и сообщения",
        entityKeys: Object.freeze(["paymentHistory"]),
        focusKey: "paymentHistory",
        why: "История подтверждает дату и сумму пополнения или списания. Она нужна при споре с начислением или утверждении, что оплата уже выполнена."
      }),
      step({
        id: "services",
        title: "Услуги",
        short: "Активные услуги сверх базового тарифа",
        entityKeys: Object.freeze(["activeServices"]),
        focusKey: "activeServices",
        why: "Дополнительные услуги объясняют разницу между базовой стоимостью тарифа и итоговой суммой начислений."
      })
    ])
  });

  const connectivitySteps = Object.freeze({
    access: step({
      id: "access",
      title: "Доступ",
      short: "Состояние услуги и административное разрешение доступа",
      entityKeys: Object.freeze(["accessSummary", "serviceState", "access", "disconnectWarning"]),
      focusKey: "accessSummary",
      why: "Сначала исключи административную или финансовую причину. Пока доступ запрещён, техническая ветка не объясняет отсутствие интернета."
    }),
    session: step({
      id: "session",
      title: "Сессия",
      short: "Есть ли активная авторизация и когда абонент был виден последний раз",
      entityKeys: Object.freeze(["sessionState", "sessionLogin", "sessionIp", "lastAuthorization"]),
      focusKey: "sessionState",
      why: "Отсутствие активной сессии не равно отсутствию физической линии. Сопоставь с технологической веткой и последней авторизацией."
    }),
    ponLine: step({
      id: "pon-line",
      title: "ONU и линия",
      short: "Регистрация ONU, оптика, Ethernet-порт и события линии",
      entityKeys: Object.freeze(["lineState", "optics", "clientPort", "uptime"]),
      focusKey: "lineState",
      why: "Этот шаг существует только при подтверждённой PON-технологии. ONU online подтверждает регистрацию, но не гарантирует активную сессию или исправность локальной сети."
    }),
    ethernetPort: step({
      id: "ethernet-port",
      title: "Порт и привязка",
      short: "Коммутатор, физический link, MAC, VLAN и ошибки порта",
      entityKeys: Object.freeze(["lineState", "clientPort", "learnedMac", "vlan"]),
      focusKey: "lineState",
      why: "Для Ethernet/FTTB вместо ONU проверяется порт доступа: link, изученный MAC, VLAN и признаки нестабильности."
    }),
    detectTechnology: step({
      id: "detect-technology",
      title: "Технология",
      short: "Открой технические данные и определи тип подключения",
      entityKeys: Object.freeze(["technology"]),
      focusKey: "technology",
      why: "Пока технология не подтверждена, Workbench не должен запускать PON-опрос или считать отсутствие ONU ошибкой."
    }),
    equipment: step({
      id: "equipment",
      title: "Оборудование",
      short: "Граница между сетью провайдера и роутером абонента",
      entityKeys: Object.freeze(["clientPort", "learnedMac", "routerMac"]),
      focusKey: "clientPort",
      why: "Сопоставь физический линк и MAC за портом. Это помогает локализовать проблему до роутера либо уже внутри локальной сети абонента."
    }),
    history: step({
      id: "history",
      title: "История",
      short: "Недавние обрывы, короткий uptime и изменения идентификаторов",
      entityKeys: Object.freeze(["historySummary"]),
      focusKey: "historySummary",
      why: "История нужна как контекст текущего состояния. Старое событие само по себе не считается текущей причиной."
    })
  });

  function buildNoInternet(technology) {
    const branch = technology === "pon"
      ? connectivitySteps.ponLine
      : technology === "ethernet"
        ? connectivitySteps.ethernetPort
        : connectivitySteps.detectTechnology;
    return Object.freeze({
      id: "no-internet",
      title: "Нет интернета",
      description: "Определи уровень разрыва: доступ, сессия, линия или клиентское оборудование.",
      technology,
      steps: Object.freeze([
        connectivitySteps.access,
        connectivitySteps.session,
        branch,
        connectivitySteps.equipment,
        connectivitySteps.history
      ])
    });
  }

  globalThis.__SIMNET_OPERATOR_ROUTES__ = Object.freeze({
    finance,
    connectivitySteps,
    buildNoInternet
  });
})();
