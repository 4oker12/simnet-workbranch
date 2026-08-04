"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_WORKBENCH_CORE__) return;

  const subscribers = new Set();
  const state = {
    context: null,
    status: { running: false, text: "", stage: "idle" },
    facts: [],
    revision: 0,
    updatedAt: 0
  };

  const safeText = (value, max = 240) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const extractLogins = text => [...new Set((String(text || "").match(/\babon\d{3,12}\b/ig) || []).map(value => value.toLowerCase()))];
  const extractIps = text => [...new Set(String(text || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])].filter(ip => ip.split(".").every(part => Number(part) >= 0 && Number(part) <= 255));
  const normalizeMac = text => {
    const match = String(text || "").toUpperCase().match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b|\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/);
    if (!match) return "";
    const compact = match[0].replace(/[-.:]/g, "");
    return compact.match(/.{2}/g)?.join(":") || "";
  };

  function panel() { return document.querySelector("#dp-panel"); }

  function detectBillingContext(text) {
    const gotouser = document.querySelector('a[href*="userside.simnet.kiev.ua/script/gotouser.php"]');
    let ip = "";
    try { ip = gotouser ? new URL(gotouser.href, location.href).searchParams.get("ip") || "" : ""; } catch (_) {}
    const loginInput = [...document.querySelectorAll('input[value],a[href],td,span,b,strong')]
      .map(element => safeText(element.value || element.textContent || "", 120))
      .find(value => /^abon\d{3,12}$/i.test(value));
    const login = String(loginInput || extractLogins(text)[0] || "").toLowerCase();
    const params = new URL(location.href).searchParams;
    const billingId = params.get("id") || "";
    return { system: "billing", login, contract: login.replace(/^abon/i, ""), billingId, customerId: "", ip: ip || extractIps(text).find(value => !/^127\.|^0\.|^255\./.test(value)) || "" };
  }

  function detectUsersideContext(text) {
    const customerId = (location.pathname.match(/^\/customer\/(\d+)/) || [])[1] || "";
    const login = extractLogins(`${document.title} ${text}`)[0] || "";
    return { system: "userside", login, contract: login.replace(/^abon/i, ""), billingId: "", customerId, ip: extractIps(text).find(value => !/^172\.16\.|^127\.|^0\./.test(value)) || "" };
  }

  function labelValue(labelPattern, max = 180) {
    for (const row of document.querySelectorAll("tr,.item,.table_block,dl")) {
      if (row.closest("#dp-panel,#simnet-mentor-shell")) continue;
      const text = safeText(row.textContent, 900);
      const match = text.match(labelPattern);
      if (!match) continue;
      const value = safeText(text.slice((match.index || 0) + match[0].length).replace(/^[\s:—|\-]+/, ""), max);
      if (value) return value;
    }
    return "";
  }

  function detectContext() {
    const root = document.body || document.documentElement;
    const clone = root.cloneNode(true);
    clone.querySelector("#dp-panel")?.remove();
    clone.querySelector("#simnet-mentor-shell")?.remove();
    const text = safeText(clone.innerText || clone.textContent || "", 70000);
    const base = /userside/i.test(location.hostname) ? detectUsersideContext(text) : detectBillingContext(text);
    return {
      ...base,
      fullName: labelValue(/(?:ФИО|ПІБ|Абонент|Клиент|Клієнт)\s*/i, 140),
      address: labelValue(/(?:Адрес|Адреса)\s*/i, 180),
      mac: normalizeMac(labelValue(/MAC(?:\s+(?:ONU|ONT|роутера|router))?\s*/i, 180) || text),
      href: location.href,
      key: [location.hostname, location.pathname, base.login, base.billingId, base.customerId].join("|")
    };
  }

  function stageFromStatus(text, running) {
    const value = safeText(text, 180).toLowerCase();
    if (!running && /заверш|готов|успеш|итог/.test(value)) return "done";
    if (/onu|olt|сигнал|оптик/.test(value)) return "onu";
    if (/userside|юзерсайд/.test(value)) return "userside";
    if (/billing|биллинг/.test(value)) return "billing";
    if (/анализ|сопостав/.test(value)) return "analysis";
    return running ? "collecting" : "idle";
  }

  function collectFacts() {
    const out = [];
    for (const node of panel()?.querySelectorAll("#dp-results tr,#dp-results details,#dp-results .dp-result-row,#dp-results [data-dp-result]") || []) {
      const text = safeText(node.textContent, 260);
      if (!text || /ожидани|номер договора|рандом|пуск/i.test(text)) continue;
      if (!/(договор|адрес|mac|ip|onu|olt|сигнал|сесси|баланс|услуг|доступ|тариф)/i.test(text)) continue;
      if (!out.includes(text)) out.push(text);
      if (out.length >= 10) break;
    }
    return out;
  }

  function snapshot() {
    const p = panel();
    const stop = p?.querySelector("#dp-stop");
    const statusText = safeText(p?.querySelector("#dp-status")?.textContent || "", 180);
    const running = Boolean(stop && !stop.disabled);
    return {
      context: detectContext(),
      status: { running, text: statusText, stage: stageFromStatus(statusText, running) },
      facts: collectFacts(),
      revision: state.revision + 1,
      updatedAt: Date.now()
    };
  }

  function publish() {
    Object.assign(state, snapshot());
    for (const listener of subscribers) {
      try { listener(getState()); } catch (_) {}
    }
  }

  function getState() { return JSON.parse(JSON.stringify(state)); }
  function runDiagnostic() {
    const p = panel();
    const input = p?.querySelector("#dp-input");
    const contract = state.context?.contract || "";
    if (input && contract && input.value !== contract) {
      input.value = contract;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const run = p?.querySelector("#dp-run");
    if (run && !run.disabled) run.click();
  }
  function stopDiagnostic() {
    const stop = panel()?.querySelector("#dp-stop");
    if (stop && !stop.disabled) stop.click();
  }
  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    listener(getState());
    return () => subscribers.delete(listener);
  }

  globalThis.__SIMNET_WORKBENCH_CORE__ = { version: "0.1.0", getState, runDiagnostic, stopDiagnostic, refresh: publish, subscribe };

  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(publish, 120);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "value", "class"] });
  window.addEventListener("popstate", publish);
  window.addEventListener("hashchange", publish);
  window.addEventListener("pageshow", publish);
  publish();
})();
