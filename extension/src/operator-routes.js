"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_ROUTES__) return;

  const routes = Object.freeze({
    finance: Object.freeze({
      id: "finance",
      title: "Финансовый вопрос",
      description: "Проверь доступ и состояние, затем расчёт с учётом временных платежей, историю операций и активные услуги.",
      steps: Object.freeze([
        Object.freeze({
          id: "access-state",
          title: "Доступ и состояние",
          short: "Текущий статус, доступ, предупреждение и факт использования услуги",
          entityKeys: Object.freeze(["serviceState", "access", "startDay", "disconnectWarning"]),
          focusKey: "access",
          why: "Состояние услуги, административный доступ и предупреждение о будущем отключении — разные факты. Отрицательный остаток не означает, что абонент уже отключён. Авторизация и трафик подтверждают использование услуги, но не доказывают правильность начислений."
        }),
        Object.freeze({
          id: "calculation",
          title: "Расчёт",
          short: "Тариф, начисление, остаток с временным платежом и без него",
          entityKeys: Object.freeze(["tariff", "price", "totalDue", "balanceAfterTariff", "balanceWithoutTemporary", "temporaryPayment"]),
          focusKey: "balanceAfterTariff",
          why: "Временный платёж нужно отделять от обычного пополнения. Сравни тариф, сумму к оплате, текущий остаток с учётом временного платежа и остаток без него."
        }),
        Object.freeze({
          id: "payments",
          title: "Платежи",
          short: "Последние пополнения, списания, сообщения и комментарии",
          entityKeys: Object.freeze(["paymentHistory"]),
          focusKey: "paymentHistory",
          why: "История подтверждает дату, сумму и тип операции. Она нужна при споре об оплате, начислении или временном платеже."
        }),
        Object.freeze({
          id: "services",
          title: "Услуги",
          short: "Активные услуги сверх базового тарифа",
          entityKeys: Object.freeze(["activeServices"]),
          focusKey: "activeServices",
          why: "Дополнительные услуги могут объяснять разницу между стоимостью тарифа и итоговой суммой. Показываются только реально отмеченные позиции."
        })
      ])
    })
  });

  globalThis.__SIMNET_OPERATOR_ROUTES__ = routes;
})();
