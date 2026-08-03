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
      short: "Регистрация ONU, Ethernet-порт, MAC, оптика и время работы",
      entityKeys: Object.freeze(["lineState", "clientPort", "learnedMac", "routerMac", "optics", "uptime"]),
      focusKey: "lineState",
      why: "ONU online подтверждает регистрацию, а LinkState UP — физический линк ONU–роутер. Изученный MAC сравнивается с ожидаемым MAC из строки запроса. Линк 100 Мбит/с при тарифе выше 100 — частый признак работы только двух пар: повреждённого или четырёхжильного патч-корда, плохого обжима/коннектора, Fast Ethernet-порта, неисправности порта либо принудительно заданной скорости 100M."
    }),
    ethernetPort: step({
      id: "ethernet-port",
      title: "Порт и привязка",
      short: "Коммутатор, физический link, ожидаемый и изученный MAC, VLAN",
      entityKeys: Object.freeze(["lineState", "clientPort", "learnedMac", "routerMac", "vlan"]),
      focusKey: "lineState",
      why: "Для Ethernet/FTTB проверяются порт доступа, link, изученный и ожидаемый MAC, VLAN и признаки нестабильности. Линк 100 Мбит/с ограничит скорость даже при гигабитном тарифе; проверь четыре пары кабеля, обжим, коннекторы, возможности портов и автосогласование."
    }),
    detectTechnology: step({
      id: "detect-technology",
      title: "Технология",
      short: "Открой технические данные и определи тип подключения",
      entityKeys: Object.freeze(["technology"]),
      focusKey: "technology",
      why: "Пока технология не подтверждена, Workbench не должен запускать PON-опрос или считать отсутствие ONU ошибкой."
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
      description: "Определи уровень разрыва: доступ, сессия, линия или порт подключения.",
      technology,
      steps: Object.freeze([
        connectivitySteps.access,
        connectivitySteps.session,
        branch,
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
