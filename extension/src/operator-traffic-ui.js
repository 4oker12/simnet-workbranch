"use strict";

(() => {
  if (top !== self || globalThis.__SIMNET_OPERATOR_TRAFFIC_UI__) return;

  const state = {
    offset: 0,
    status: "idle",
    report: null,
    error: "",
    requestId: 0
  };

  const monthNames = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
  ];

  function trafficApi() {
    return globalThis.__SIMNET_OPERATOR_TRAFFIC__ || null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function period(offset = state.offset) {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth() + Number(offset || 0), 1);
    return { month: date.getMonth() + 1, year: date.getFullYear() };
  }

  function periodLabel(value = period()) {
    return `${monthNames[value.month - 1]} ${value.year}`;
  }

  function dailyValue(value) {
    return trafficApi()?.formatMegabytes?.(value) || `${Number(value || 0).toFixed(2)} МБ`;
  }

  function reportHtml(report) {
    const range = report.firstActiveDay && report.lastActiveDay
      ? report.firstActiveDay === report.lastActiveDay
        ? `${report.firstActiveDay} число`
        : `${report.firstActiveDay}–${report.lastActiveDay} числа`
      : "активных дней нет";
    return `
      <div class="dp-traffic-summary-grid">
        <div><span>Активных дней</span><b>${escapeHtml(report.activeDays)}</b></div>
        <div><span>Принято</span><b>${escapeHtml(report.formatted.receive)}</b></div>
        <div><span>Отправлено</span><b>${escapeHtml(report.formatted.send)}</b></div>
        <div><span>Всего</span><b>${escapeHtml(report.formatted.total)}</b></div>
      </div>
      <p class="dp-traffic-range">Период активности: ${escapeHtml(range)}. Источник: Billing → «Трафік подобово».</p>
      ${report.recentActiveDays.length ? `
        <details class="dp-traffic-days">
          <summary>Последние активные дни</summary>
          <div>${report.recentActiveDays.map((item) => `
            <span><b>${escapeHtml(item.day)} число</b><i>↓ ${escapeHtml(dailyValue(item.receive))}</i><i>↑ ${escapeHtml(dailyValue(item.send))}</i></span>
          `).join("")}</div>
        </details>
      ` : ""}
    `;
  }

  function contentHtml() {
    const selected = period();
    if (state.status === "loading") {
      return `<div class="dp-traffic-state">Загружаю посуточную статистику за ${escapeHtml(periodLabel(selected))}…</div>`;
    }
    if (state.status === "error") {
      return `<div class="dp-traffic-state error">${escapeHtml(state.error || "Не удалось загрузить трафик.")}</div>`;
    }
    if (state.status === "ready" && state.report) return reportHtml(state.report);
    return `<div class="dp-traffic-state">Запрос выполняется только по кнопке. Фонового опроса нет.</div>`;
  }

  function render() {
    const usage = document.querySelector("#dp-operator-workspace .dp-operator-usage");
    if (!usage) return;
    const oldNote = usage.querySelector(":scope > p");
    if (oldNote) {
      oldNote.textContent = "Сводные байты основной карточки — только резервный контекст. Точная помесячная статистика загружается из stat.pl.";
    }

    let root = usage.querySelector("#dp-operator-monthly-traffic");
    if (!root) {
      root = document.createElement("section");
      root.id = "dp-operator-monthly-traffic";
      usage.appendChild(root);
    }
    const selected = period();
    root.innerHTML = `
      <header>
        <div><b>Трафик за месяц</b><span>${escapeHtml(periodLabel(selected))}</span></div>
        <nav>
          <button type="button" data-dp-traffic-offset="0" class="${state.offset === 0 ? "active" : ""}">Текущий</button>
          <button type="button" data-dp-traffic-offset="-1" class="${state.offset === -1 ? "active" : ""}">Предыдущий</button>
        </nav>
      </header>
      <div class="dp-traffic-content">${contentHtml()}</div>
      <footer>
        <button type="button" data-dp-traffic-load ${state.status === "loading" ? "disabled" : ""}>${state.status === "ready" ? "Обновить" : "Загрузить трафик"}</button>
        <span>Значения страницы приходят в МБ</span>
      </footer>
    `;
  }

  async function load(force = false) {
    const api = trafficApi();
    if (!api?.loadMonth) {
      state.status = "error";
      state.error = "Модуль статистики не загружен.";
      render();
      return;
    }
    const requestId = ++state.requestId;
    const selected = period();
    state.status = "loading";
    state.error = "";
    render();
    try {
      const report = await api.loadMonth({ ...selected, force });
      if (requestId !== state.requestId) return;
      state.report = report;
      state.status = "ready";
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.report = null;
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error || "Не удалось загрузить трафик.");
    }
    render();
  }

  document.addEventListener("click", (event) => {
    const periodButton = event.target.closest("[data-dp-traffic-offset]");
    if (periodButton) {
      state.offset = Number(periodButton.dataset.dpTrafficOffset) || 0;
      state.status = "idle";
      state.report = trafficApi()?.peekMonth?.(period()) || null;
      if (state.report) state.status = "ready";
      state.error = "";
      render();
      return;
    }
    if (event.target.closest("[data-dp-traffic-load]")) load(state.status === "ready");
  }, true);

  const observer = new MutationObserver(() => render());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const style = document.createElement("style");
  style.dataset.simnetOperatorTraffic = "1";
  style.textContent = `
    #dp-operator-monthly-traffic{display:grid!important;gap:7px!important;margin-top:2px!important;padding-top:8px!important;border-top:1px solid #dbe3ee!important}
    #dp-operator-monthly-traffic>header{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important}
    #dp-operator-monthly-traffic>header>div{display:grid!important;gap:1px!important}#dp-operator-monthly-traffic>header b{color:#334155!important;font-size:9.5px!important}#dp-operator-monthly-traffic>header span{color:#64748b!important;font-size:8px!important}
    #dp-operator-monthly-traffic nav{display:flex!important;gap:3px!important}#dp-operator-monthly-traffic button{padding:5px 7px!important;color:#475569!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:6px!important;font:700 8px/1 "Segoe UI",Arial,sans-serif!important;cursor:pointer!important}#dp-operator-monthly-traffic nav button.active{color:#1d4ed8!important;background:#eff6ff!important;border-color:#93c5fd!important}#dp-operator-monthly-traffic button:disabled{opacity:.55!important;cursor:wait!important}
    .dp-traffic-state{padding:8px!important;color:#526174!important;background:#fff!important;border:1px dashed #cbd5e1!important;border-radius:7px!important;font-size:8.5px!important;line-height:1.4!important}.dp-traffic-state.error{color:#991b1b!important;background:#fef2f2!important;border-color:#f0a6a6!important}
    .dp-traffic-summary-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:4px!important}.dp-traffic-summary-grid>div{display:grid!important;gap:1px!important;padding:6px!important;background:#fff!important;border:1px solid #dbe3ee!important;border-radius:6px!important}.dp-traffic-summary-grid span{color:#64748b!important;font-size:7.8px!important}.dp-traffic-summary-grid b{color:#172033!important;font-size:9px!important}
    .dp-traffic-range{margin:0!important;color:#64748b!important;font-size:8px!important;line-height:1.4!important}.dp-traffic-days{padding:6px!important;background:#fff!important;border:1px solid #dbe3ee!important;border-radius:6px!important}.dp-traffic-days summary{color:#334155!important;font-size:8.5px!important;font-weight:700!important;cursor:pointer!important}.dp-traffic-days>div{display:grid!important;gap:3px!important;margin-top:5px!important}.dp-traffic-days span{display:grid!important;grid-template-columns:52px 1fr 1fr!important;gap:4px!important;color:#526174!important;font-size:7.8px!important}.dp-traffic-days i{font-style:normal!important;text-align:right!important}.dp-traffic-days b{color:#334155!important}
    #dp-operator-monthly-traffic>footer{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important}#dp-operator-monthly-traffic>footer>button{color:#fff!important;background:#2563eb!important;border-color:#1d4ed8!important}#dp-operator-monthly-traffic>footer>span{color:#7b8798!important;font-size:7.5px!important}
  `;
  (document.head || document.documentElement).appendChild(style);

  globalThis.__SIMNET_OPERATOR_TRAFFIC_UI__ = Object.freeze({ render, load });
  render();
})();
