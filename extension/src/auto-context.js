"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_AUTO_CONTEXT__) return;

  const EVENT_NAME = "simnet-workbench-context";
  const PANEL_SELECTOR = "#dp-panel";
  const INPUT_SELECTOR = "#dp-input";
  const RUN_SELECTOR = "#dp-run";
  const STOP_SELECTOR = "#dp-stop";
  const RESULT_SELECTOR = "#dp-results";
  const MAX_TEXT = 100000;

  const runtime = {
    context: null,
    observer: null,
    timer: 0,
    installTimer: 0,
    lastStartedKey: "",
    lastUrl: location.href,
    startedAt: 0
  };

  function safeText(value, max = MAX_TEXT) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function normalizeDigits(value, min = 4, max = 14) {
    const match = String(value || "").match(new RegExp(`\\d{${min},${max}}`));
    return match ? match[0] : "";
  }

  function normalizeContract(value) {
    const raw = String(value || "").trim();
    const abon = raw.match(/\babon\s*[-_:]?\s*(\d{4,14})\b/i);
    if (abon) return abon[1];
    return normalizeDigits(raw, 4, 14);
  }

  function validIp(value) {
    const match = String(value || "").match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
    if (!match) return "";
    const parts = match[1].split(".").map(Number);
    return parts.every(part => part >= 0 && part <= 255) ? match[1] : "";
  }

  function normalizeMac(value) {
    const raw = String(value || "").toUpperCase();
    const colon = raw.match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/);
    if (colon) return colon[0].replace(/-/g, ":");
    const dotted = raw.match(/\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/);
    if (!dotted) return "";
    const compact = dotted[0].replace(/\./g, "");
    return compact.match(/.{2}/g).join(":");
  }

  function urlValue(names) {
    const url = new URL(location.href);
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value) return value;
    }
    return "";
  }

  function pageSystem() {
    if (/userside/i.test(location.hostname)) return "userside";
    if (/admin\.(?:simnet|looknet)/i.test(location.hostname)) return "billing";
    return "unknown";
  }

  function subscriberPage(system) {
    const url = new URL(location.href);
    if (system === "userside") {
      return /\/customer\/\d+/i.test(location.pathname)
        || /customer/i.test(location.pathname)
        || Boolean(document.querySelector('[href*="/customer/"]'));
    }
    if (system === "billing") {
      const action = String(url.searchParams.get("a") || "").toLowerCase();
      return ["user", "dopdata", "tab", "juniper", "payments", "traffic"].includes(action)
        || Boolean(url.searchParams.get("id"));
    }
    return false;
  }

  function pageRows() {
    return [...document.querySelectorAll("tr, .item, .row, dl")]
      .filter(node => !node.closest(PANEL_SELECTOR))
      .slice(0, 650);
  }

  function rowValue(labelPattern, validator = value => value) {
    for (const row of pageRows()) {
      const text = safeText(row.textContent, 700);
      const label = text.match(labelPattern);
      if (!label) continue;
      const raw = safeText(text.slice((label.index || 0) + label[0].length).replace(/^[\s:—\-|]+/, ""), 240);
      const value = validator(raw || text);
      if (value) return value;
    }
    return "";
  }

  function contractFromControls() {
    const selectors = [
      'input[name*="contract" i]',
      'input[name*="agreement" i]',
      'input[name*="dogovor" i]',
      'input[id*="contract" i]',
      'input[id*="agreement" i]',
      "[data-contract]",
      "[data-agreement]"
    ];
    for (const node of document.querySelectorAll(selectors.join(","))) {
      if (node.closest(PANEL_SELECTOR)) continue;
      const candidate = normalizeContract(node.value || node.dataset?.contract || node.dataset?.agreement || node.textContent);
      if (candidate) return candidate;
    }
    return "";
  }

  function contractFromRows() {
    return rowValue(/(?:номер\s+договора|номер\s+договору|договор|договір|контракт|agreement|логин|login)\s*/i, normalizeContract);
  }

  function contractFromPageText(text) {
    const abon = text.match(/\babon\s*[-_:]?\s*(\d{4,14})\b/i);
    if (abon) return abon[1];
    const labeled = text.match(/(?:номер\s+договора|номер\s+договору|договор|договір|контракт|agreement)\D{0,50}(\d{4,14})/i);
    return labeled ? labeled[1] : "";
  }

  function nameFromRows() {
    return rowValue(/(?:ФИО|ПІБ|абонент|клиент|клієнт)\s*/i, raw => {
      const clean = safeText(raw.replace(/\b(?:abon)?\d{4,14}\b/ig, ""), 120);
      if (clean.length < 3 || !/[A-Za-zА-Яа-яЁёІіЇїЄє]/.test(clean)) return "";
      if (/^(?:статус|адрес|тариф|договор|логин|ip|mac)\b/i.test(clean)) return "";
      return clean;
    });
  }

  function addressFromRows() {
    return rowValue(/(?:адрес|адреса)\s*/i, raw => {
      const clean = safeText(raw, 180);
      return clean.length >= 4 ? clean : "";
    });
  }

  function ipFromRows() {
    return rowValue(/(?:IP(?:-адрес)?|IPv4)\s*/i, validIp);
  }

  function macFromRows() {
    return rowValue(/(?:MAC(?:\s+(?:ONU|ONT|роутера|router))?)\s*/i, normalizeMac);
  }

  function detectContext() {
    const system = pageSystem();
    const text = safeText(document.body?.innerText || document.body?.textContent || "");
    const contract = contractFromControls()
      || contractFromRows()
      || contractFromPageText(text)
      || normalizeContract(urlValue(["agreement_number", "contract", "agreement", "login", "name", "search"]));
    const userId = normalizeDigits(
      urlValue(["id", "customer_id", "customerId"])
      || location.pathname.match(/\/customer\/(\d+)/i)?.[1]
      || "",
      1,
      14
    );
    const ip = validIp(urlValue(["ip", "user_ip", "address"])) || ipFromRows() || validIp(text);
    const mac = macFromRows() || normalizeMac(text);
    const page = subscriberPage(system);
    return {
      system,
      contract,
      userId,
      ip,
      mac,
      name: nameFromRows(),
      address: addressFromRows(),
      page,
      href: location.href,
      key: [location.hostname, location.pathname, contract, userId, ip, mac].join("|"),
      autoStarted: false,
      detectedAt: Date.now()
    };
  }

  function emitContext(context) {
    runtime.context = context;
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...context } })); } catch (_) {}
  }

  function loginPage() {
    return Boolean(document.querySelector('input[type="password"]'));
  }

  function diagnosticsBusy() {
    const stop = document.querySelector(STOP_SELECTOR);
    return Boolean(stop && !stop.disabled);
  }

  function mirrorTab() {
    return document.querySelector(PANEL_SELECTOR)?.dataset.tabRole === "mirror";
  }

  function meaningfulResults() {
    const text = safeText(document.querySelector(RESULT_SELECTOR)?.textContent || "", 1200);
    return text.length > 80 && !/результат(?:ы)?\s+будут\s+здесь|нет\s+результат/i.test(text);
  }

  function syncInput(contract) {
    const input = document.querySelector(INPUT_SELECTOR);
    if (!input || input.readOnly || !contract) return false;
    if (String(input.value || "").trim() !== contract) {
      input.value = contract;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  function tryAutoStart(context) {
    if (!context.page || !context.contract || loginPage() || mirrorTab()) return false;
    if (!syncInput(context.contract)) return false;
    const run = document.querySelector(RUN_SELECTOR);
    if (!run || run.disabled || diagnosticsBusy()) return false;
    const key = `${context.key}|${context.contract}`;
    if (runtime.lastStartedKey === key) return false;
    if (meaningfulResults()) {
      runtime.lastStartedKey = key;
      return false;
    }
    runtime.lastStartedKey = key;
    runtime.startedAt = Date.now();
    run.click();
    context.autoStarted = true;
    return true;
  }

  function syncContext() {
    runtime.timer = 0;
    if (runtime.lastUrl !== location.href) {
      runtime.lastUrl = location.href;
      runtime.lastStartedKey = "";
    }
    const context = detectContext();
    tryAutoStart(context);
    emitContext(context);
  }

  function scheduleSync(delay = 220) {
    if (runtime.timer) window.clearTimeout(runtime.timer);
    runtime.timer = window.setTimeout(syncContext, delay);
  }

  function installObserver() {
    runtime.observer?.disconnect();
    runtime.observer = new MutationObserver(mutations => {
      const relevant = mutations.some(mutation => {
        if (mutation.type !== "childList") return false;
        return [...mutation.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && !node.closest?.(PANEL_SELECTOR));
      });
      if (relevant) scheduleSync(320);
    });
    runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function install() {
    installObserver();
    scheduleSync(80);
    let attempts = 0;
    runtime.installTimer = window.setInterval(() => {
      attempts += 1;
      if (document.querySelector(PANEL_SELECTOR)) scheduleSync(80);
      if (document.querySelector(PANEL_SELECTOR) || attempts >= 120) {
        window.clearInterval(runtime.installTimer);
        runtime.installTimer = 0;
      }
    }, 250);
  }

  globalThis.__SIMNET_AUTO_CONTEXT__ = {
    version: "0.2.0",
    runtime,
    current: () => runtime.context ? { ...runtime.context } : null,
    refresh: () => scheduleSync(0)
  };

  window.addEventListener("popstate", () => scheduleSync(50));
  window.addEventListener("hashchange", () => scheduleSync(50));
  window.addEventListener("pageshow", () => scheduleSync(80));
  window.addEventListener("pagehide", () => {
    runtime.observer?.disconnect();
    if (runtime.timer) window.clearTimeout(runtime.timer);
    if (runtime.installTimer) window.clearInterval(runtime.installTimer);
  });

  install();
})();
