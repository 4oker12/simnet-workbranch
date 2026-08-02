"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_FINANCE__) return;

  const listeners = new Set();
  let latestModel = null;

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > td, :scope > th")];
  }

  function rowLabel(row) {
    return text(directCells(row)[0]?.innerText || directCells(row)[0]?.textContent);
  }

  function rowValue(row) {
    if (!row) return "";
    const cells = directCells(row);
    const control = row.querySelector("select, input:not([type='hidden']), textarea");
    if (control?.tagName === "SELECT") {
      return text(control.selectedOptions?.[0]?.textContent || control.value);
    }
    if (control) return text(control.value);
    return text(cells.at(-1)?.innerText || cells.at(-1)?.textContent);
  }

  function rowForControl(selector) {
    const control = document.querySelector(selector);
    return control ? { control, element: control.closest("tr") || control } : { control: null, element: null };
  }

  function normalizeLabel(value) {
    return lower(value)
      .replace(/[іi]/g, "и")
      .replace(/ё/g, "е")
      .replace(/[.,:;()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findRow(labelVariants) {
    const wanted = labelVariants.map(normalizeLabel);
    let best = null;
    let bestScore = -1;
    for (const row of document.querySelectorAll("tr")) {
      if (row.closest("#dp-panel")) continue;
      const label = normalizeLabel(rowLabel(row));
      if (!label) continue;
      for (const variant of wanted) {
        let score = -1;
        if (label === variant) score = 100;
        else if (label.startsWith(variant)) score = 75;
        else if (label.includes(variant)) score = 45;
        if (score > bestScore) {
          best = row;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function findWarning() {
    return [...document.querySelectorAll(".message.cntr, .message")]
      .filter((node) => !node.closest("#dp-panel"))
      .find((node) => /баланс ниже границы отключения|произойдет его отключение/i.test(text(node.textContent))) || null;
  }

  function parseNumber(value) {
    const match = text(value).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function formatMoney(value) {
    return Number.isFinite(value)
      ? `${value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} грн`
      : "Не найдено";
  }

  function entity(key, label, value, element, status = "info", meaning = "") {
    return { key, label, value: value || "Не найдено", element: element || null, status, meaning };
  }

  function paymentNodes() {
    const table = document.querySelector("#my_x_16");
    const toggle = [...document.querySelectorAll("a[href]")]
      .find((node) => /show_x\(16\)/.test(String(node.getAttribute("href") || "")))
      || [...document.querySelectorAll("a")].find((node) => /последние\s+6\s+платеж/i.test(text(node.textContent)));
    return { table, toggle };
  }

  function readPayments(table) {
    if (!table) return [];
    return [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")]
      .map((row) => {
        const cells = directCells(row);
        return {
          date: text(cells[0]?.textContent),
          description: text(cells[1]?.textContent),
          amount: text(cells[2]?.textContent),
          element: row
        };
      })
      .filter((item) => item.date || item.description || item.amount)
      .slice(0, 6);
  }

  function readActiveServices() {
    const services = [];
    for (const checkbox of document.querySelectorAll('input[type="checkbox"][name^="sr"]')) {
      if (!checkbox.checked) continue;
      const outerRow = checkbox.closest("tr");
      const innerRow = checkbox.closest("table")?.querySelector("tr") || outerRow;
      const cells = innerRow ? directCells(innerRow) : [];
      const name = text(cells[0]?.textContent).replace(/^услуга\s*/i, "");
      const amountText = text(cells.at(-1)?.textContent);
      services.push({
        name: name || `Услуга ${checkbox.name}`,
        amountText,
        amount: parseNumber(amountText),
        element: outerRow || checkbox
      });
    }
    return services;
  }

  function firstServiceElement() {
    return document.querySelector('input[type="checkbox"][name^="sr"]')?.closest("tr") || null;
  }

  function read() {
    const stateNode = rowForControl('select[name="cstate"]');
    const accessNode = rowForControl('select[name="state"]');
    const startDayNode = rowForControl('input[name="start_day"]');
    const tariffNode = rowForControl('select[name="paket"]');

    const serviceState = stateNode.control
      ? text(stateNode.control.selectedOptions?.[0]?.textContent || stateNode.control.value)
      : "";
    const access = accessNode.control
      ? text(accessNode.control.selectedOptions?.[0]?.textContent || accessNode.control.value)
      : "";
    const startDayRaw = startDayNode.control ? text(startDayNode.control.value) : "";
    const startDay = parseNumber(startDayRaw);
    const tariff = tariffNode.control
      ? text(tariffNode.control.selectedOptions?.[0]?.textContent || tariffNode.control.value)
      : "";

    const priceRow = findRow(["Ціна, грн", "Цена, грн"]);
    const totalRow = findRow(["Разом до сплати, грн", "Разом до сплати"]);
    const balanceRow = findRow([
      "На счете с учетом стоимости тарифного плана, грн",
      "На рахунку з урахуванням вартості тарифного плану, грн"
    ]);
    const warningNode = findWarning();
    const payments = paymentNodes();
    const paymentItems = readPayments(payments.table);
    const activeServices = readActiveServices();

    const priceRaw = rowValue(priceRow);
    const totalRaw = rowValue(totalRow);
    const balanceRaw = rowValue(balanceRow);
    const price = parseNumber(priceRaw);
    const totalDue = parseNumber(totalRaw);
    const balanceAfterTariff = parseNumber(balanceRaw);

    const stateOk = /все\s*ок|все\s*о\.??к/i.test(serviceState);
    const accessAllowed = /разреш|дозвол|^on$/i.test(access) || accessNode.control?.value === "on";
    const accessDenied = /запрещ|заборон|^off$/i.test(access) || accessNode.control?.value === "off";
    const tariffBlocked = /заблокирован|заблоковано/i.test(tariff);
    const pendingDisconnect = Boolean(warningNode);

    let verdict = {
      status: "unknown",
      title: "Недостаточно данных",
      message: "Не все обязательные финансовые поля найдены на текущей странице."
    };

    if (accessDenied || tariffBlocked) {
      verdict = {
        status: "error",
        title: "Доступ уже ограничен",
        message: accessDenied
          ? "В Billing доступ установлен как запрещённый."
          : "В качестве тарифа выбран заблокированный пакет."
      };
    } else if (serviceState && !stateOk) {
      verdict = {
        status: "warning",
        title: "Состояние услуги требует проверки",
        message: `Текущее состояние: ${serviceState}.`
      };
    } else if (Number.isFinite(startDay) && startDay < 0) {
      verdict = {
        status: "warning",
        title: "Проверь день начала потребления",
        message: `Найдено отрицательное значение: ${startDay}.`
      };
    } else if (Number.isFinite(balanceAfterTariff) && balanceAfterTariff < 0 && pendingDisconnect) {
      verdict = {
        status: "warning",
        title: accessAllowed ? "Доступ пока есть · ожидается блокировка" : "Ожидается автоматическая блокировка",
        message: `После учёта тарифа: ${formatMoney(balanceAfterTariff)}. Billing показывает предупреждение о будущем отключении.`
      };
    } else if (Number.isFinite(balanceAfterTariff) && balanceAfterTariff < 0) {
      verdict = {
        status: "warning",
        title: "Отрицательный остаток",
        message: `После учёта тарифа: ${formatMoney(balanceAfterTariff)}. Фактический доступ и границу отключения нужно проверить отдельно.`
      };
    } else if (stateOk && accessAllowed && (!Number.isFinite(startDay) || startDay >= 0)) {
      verdict = {
        status: "ok",
        title: "Явных финансовых ограничений нет",
        message: "Состояние услуги штатное, доступ разрешён, отрицательное значение после тарифа не найдено."
      };
    }

    const activeServicesTotal = activeServices.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
    const entities = {
      serviceState: entity(
        "serviceState",
        "Состояние услуги",
        serviceState,
        stateNode.element,
        !serviceState ? "unknown" : stateOk ? "ok" : "warning",
        "Для штатного случая ожидается «Все ОК»."
      ),
      access: entity(
        "access",
        "Доступ сейчас",
        access,
        accessNode.element,
        !access ? "unknown" : accessDenied ? "error" : accessAllowed ? "ok" : "warning",
        "Показывает фактическое административное разрешение доступа сейчас."
      ),
      startDay: entity(
        "startDay",
        "День начала потребления",
        startDayRaw,
        startDayNode.element,
        !startDayRaw ? "unknown" : Number.isFinite(startDay) && startDay < 0 ? "warning" : "ok",
        "Отрицательное значение требует отдельной проверки."
      ),
      tariff: entity(
        "tariff",
        "Тариф на Интернет",
        tariff,
        tariffNode.element,
        !tariff ? "unknown" : tariffBlocked ? "error" : "ok",
        "Активный пакет определяет базовую стоимость услуги."
      ),
      price: entity("price", "Цена", priceRaw || formatMoney(price), priceRow, priceRow ? "ok" : "unknown"),
      totalDue: entity("totalDue", "Разом до сплати", totalRaw || formatMoney(totalDue), totalRow, totalRow ? "ok" : "unknown"),
      balanceAfterTariff: entity(
        "balanceAfterTariff",
        "После учёта тарифа",
        balanceRaw || formatMoney(balanceAfterTariff),
        balanceRow,
        !Number.isFinite(balanceAfterTariff) ? "unknown" : balanceAfterTariff < 0 ? "warning" : "ok",
        "Отрицательное значение показывает финансовый риск, но не доказывает уже выполненную блокировку."
      ),
      disconnectWarning: entity(
        "disconnectWarning",
        "Предупреждение Billing",
        warningNode ? text(warningNode.textContent) : "Не найдено",
        warningNode,
        warningNode ? "warning" : "ok",
        "Предупреждение подтверждает ожидаемое отключение, а не обязательно уже отключённый доступ."
      ),
      paymentHistory: entity(
        "paymentHistory",
        "История платежей",
        paymentItems.length ? `${paymentItems.length} последних событий` : payments.toggle ? "Раздел найден, сейчас свернут" : "Не найдена",
        isVisible(payments.table) ? payments.table : payments.toggle,
        payments.toggle || payments.table ? "info" : "unknown"
      ),
      activeServices: entity(
        "activeServices",
        "Активные доп. услуги",
        activeServices.length
          ? `${activeServices.length} · ${formatMoney(activeServicesTotal)}`
          : "Активные позиции не отмечены",
        activeServices[0]?.element || firstServiceElement(),
        activeServices.length ? "info" : "ok"
      )
    };

    latestModel = {
      readAt: Date.now(),
      subscriber: text(document.querySelector('input[name="name"]')?.value)
        || text(document.querySelector('input[name="contract"]')?.value)
        || "текущий абонент",
      verdict,
      entities,
      payments: paymentItems,
      activeServices,
      activeServicesTotal,
      evidence: {
        stateOk,
        accessAllowed,
        accessDenied,
        tariffBlocked,
        pendingDisconnect,
        startDay,
        price,
        totalDue,
        balanceAfterTariff
      }
    };
    return latestModel;
  }

  async function expandPayments() {
    const { table, toggle } = paymentNodes();
    if (!table && !toggle) return null;
    if (table && !isVisible(table) && toggle) {
      toggle.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const current = document.querySelector("#my_x_16") || table;
    if (current && !isVisible(current)) {
      current.hidden = false;
      current.style.removeProperty("display");
      if (getComputedStyle(current).display === "none") current.style.display = "table";
    }
    refresh();
    return current || toggle;
  }

  function elementForEntity(key) {
    return (latestModel || read()).entities[key]?.element || null;
  }

  function elementForStep(stepId) {
    const model = latestModel || read();
    if (stepId === "state") return model.entities.serviceState.element || model.entities.startDay.element;
    if (stepId === "access") return model.entities.access.element || model.entities.disconnectWarning.element;
    if (stepId === "calculation") return model.entities.balanceAfterTariff.element || model.entities.tariff.element;
    if (stepId === "payments") return model.entities.paymentHistory.element;
    if (stepId === "services") return model.entities.activeServices.element;
    return null;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function refresh() {
    const model = read();
    for (const listener of listeners) {
      try { listener(model); } catch (error) { console.warn("[SIMNET operator finance] listener failed", error); }
    }
    document.dispatchEvent(new CustomEvent("dp:operator-finance-refresh", { detail: model }));
    return model;
  }

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.('select[name="cstate"],select[name="state"],input[name="start_day"],select[name="paket"],input[name^="sr"]')) {
      refresh();
    }
  }, true);

  globalThis.__SIMNET_OPERATOR_FINANCE__ = Object.freeze({
    read,
    refresh,
    subscribe,
    expandPayments,
    elementForEntity,
    elementForStep,
    isVisible
  });
})();
