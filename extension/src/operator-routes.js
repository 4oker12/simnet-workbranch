"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_ROUTES__) return;

  const routes = Object.freeze({
    finance: Object.freeze({
      id: "finance",
      title: "Финансовый вопрос",
      description: "Сначала проверь состояние услуги и доступ, затем расчёт, платежи и активные дополнительные услуги.",
      steps: Object.freeze([
        Object.freeze({
          id: "state",
          title: "Состояние",
          short: "Статус услуги и день начала потребления",
          entityKeys: Object.freeze(["serviceState", "startDay"]),
          focusKey: "serviceState",
          why: "Состояние услуги и день начала потребления могут объяснить нестандартное поведение даже при нормальном балансе. Для штатного случая ожидаются «Все ОК» и неотрицательный день начала потребления."
        }),
        Object.freeze({
          id: "access",
          title: "Доступ",
          short: "Разрешён ли доступ сейчас и есть ли предупреждение",
          entityKeys: Object.freeze(["access", "disconnectWarning"]),
          focusKey: "access",
          why: "Текущий доступ и будущая автоматическая блокировка — разные факты. Отрицательный остаток сам по себе не доказывает, что абонент уже отключён."
        }),
        Object.freeze({
          id: "calculation",
          title: "Расчёт",
          short: "Тариф, цена, сумма к оплате и остаток после тарифа",
          entityKeys: Object.freeze(["tariff", "price", "totalDue", "balanceAfterTariff"]),
          focusKey: "balanceAfterTariff",
          why: "Этот блок связывает текущий тариф с итоговой суммой. Сравни цену тарифа, сумму к оплате и остаток после учёта тарифа."
        }),
        Object.freeze({
          id: "payments",
          title: "Платежи",
          short: "Последние пополнения, списания и сообщения",
          entityKeys: Object.freeze(["paymentHistory"]),
          focusKey: "paymentHistory",
          why: "История платежей подтверждает, когда и сколько поступило или списалось. Она нужна, если абонент спорит с суммой либо утверждает, что уже оплатил."
        }),
        Object.freeze({
          id: "services",
          title: "Услуги",
          short: "Активные услуги сверх базового тарифа",
          entityKeys: Object.freeze(["activeServices"]),
          focusKey: "activeServices",
          why: "Дополнительные услуги часто объясняют разницу между стоимостью тарифа и фактической суммой начислений. Показываем только реально активные позиции."
        })
      ])
    })
  });

  globalThis.__SIMNET_OPERATOR_ROUTES__ = routes;
})();
