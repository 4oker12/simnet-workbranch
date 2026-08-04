"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_WORKBENCH_CORE__) return;

  const subscribers = new Set();
  const ISSUE_KEY = "simnet_workbench_current_issue_v1";
  const state = {
    context: null,
    issue: "",
    status: { running: false, text: "", stage: "idle" },
    facts: [],
    revision: 0,
    updatedAt: 0
  };
  let rememberedIdentity = null;

  const safeText = (value, max = 240) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const extractLogins = text => [...new Set((String(text || "").match(/\babon\d{3,12}\b/ig) || []).map(value => value.toLowerCase()))];
  const extractIps = text => [...new Set(String(text || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])]
    .filter(ip => ip.split(".").every(part => Number(part) >= 0 && Number(part) <= 255));
  const normalizeMac = text => {
    const match = String(text || "").toUpperCase().match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b|\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/);
    if (!match) return "";
    const compact = match[0].replace(/[-.:]/g, "");
    return compact.match(/.{2}/g)?.join(":") || "";
  };

  function panel() {
    return document.querySelector("#dp-panel");
  }

  function textOf(selector) {
    return safeText(document.querySelector(selector)?.textContent || "", 1400);
  }

  function pageText() {
    const root = document.body || document.documentElement;
    if (!root) return "";
    const clone = root.cloneNode(true);
    clone.querySelector("#dp-panel")?.remove();
    clone.querySelector("#simnet-mentor-shell")?.remove();
    clone.querySelector("#simnet-workbench-dock")?.remove();
    clone.querySelector("#simnet-wb-highlight-overlay")?.remove();
    return safeText(clone.textContent || "", 250000);
  }

  function selectedControlText(control) {
    if (!control) return "";
    if (control.tagName === "SELECT") {
      const option = control.options?.[control.selectedIndex];
      return safeText(option?.textContent || control.value || "", 220);
    }
    return safeText(control.value || control.textContent || "", 220);
  }

  function controlValue(selector) {
    return selectedControlText(document.querySelector(selector));
  }

  function labelValue(labelPattern, max = 180) {
    for (const row of document.querySelectorAll("tr,.item,.table_block,dl,fieldset")) {
      if (row.closest("#dp-panel,#simnet-mentor-shell,#simnet-workbench-dock")) continue;
      const text = safeText(row.textContent, 1200);
      const match = text.match(labelPattern);
      if (!match) continue;
      const value = safeText(text.slice((match.index || 0) + match[0].length).replace(/^[\s:—|\-]+/, ""), max);
      if (value) return value;
    }
    return "";
  }

  function findLoginElement() {
    const candidates = document.querySelectorAll("input[value],a[href],td,th,span,b,strong,option,div");
    for (const element of candidates) {
      if (element.closest("#dp-panel,#simnet-mentor-shell,#simnet-workbench-dock")) continue;
      const value = safeText(element.value || element.textContent || "", 160);
      if (/^abon\d{3,12}$/i.test(value)) return element;
    }
    return null;
  }

  function billingRowData(loginElement) {
    const row = loginElement?.closest("tr");
    const text = safeText(row?.textContent || "", 1200);
    return {
      text,
      ip: extractIps(text).find(ip => !/^127\.|^0\.|^255\./.test(ip)) || ""
    };
  }

  function technologyFromText(value) {
    const text = safeText(value, 500).toLowerCase();
    if (!text) return "";
    if (/huawei/.test(text)) return "huawei";
    if (/gcom/.test(text)) return "gcom";
    if (/gpon/.test(text)) return "gpon";
    if (/epon/.test(text)) return "epon";
    return "";
  }

  function pollerForTechnology(technology) {
    return ({ huawei: "poller-huawei", gcom: "poller-gcom", gpon: "poller-gpon", epon: "poller-epon" })[technology] || "";
  }

  function isEmptySelection(value) {
    const text = safeText(value, 220);
    return !text || /^(?:0|нет|не выбрано|не указано|выберите|—|-|none|null)$/i.test(text);
  }

  function billingOltInfo() {
    const oltControl = document.querySelector("select[name='dopfield_29'],input[name='dopfield_29']");
    const techControl = document.querySelector("select[name='dopfield_39'],input[name='dopfield_39']");
    const name = selectedControlText(oltControl);
    const technologyLabel = selectedControlText(techControl);
    const present = Boolean(oltControl && !isEmptySelection(name));
    const technology = technologyFromText(`${name} ${technologyLabel}`);
    return {
      status: !oltControl ? "unknown" : present ? "present" : "missing",
      present,
      name: present ? name : "",
      ip: present ? (extractIps(name)[0] || "") : "",
      technology,
      technologyLabel,
      poller: pollerForTechnology(technology),
      source: present ? "Billing: технические данные" : ""
    };
  }

  function usersideTmcInfo() {
    const candidates = [];
    const selector = "tr,li,section,article,.item,.table_block,.card,.panel,div";
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest("#dp-panel,#simnet-mentor-shell,#simnet-workbench-dock")) continue;
      const text = safeText(element.textContent, 3200);
      if (!/Найдено\s+на\s+OLT/i.test(text)) continue;
      if (text.length > 2800) continue;
      const rect = element.getBoundingClientRect();
      candidates.push({ element, text, area: Math.max(1, rect.width * rect.height) });
    }
    candidates.sort((a, b) => a.text.length - b.text.length || a.area - b.area);
    const hit = candidates[0];
    if (!hit) {
      return {
        status: "unknown",
        found: false,
        name: "",
        ip: "",
        port: "",
        technology: "",
        updatedAtText: "",
        source: ""
      };
    }

    const text = hit.text;
    const ips = extractIps(text);
    const port = (text.match(/\b(?:gpon|epon)\s*\d+(?:[\/:.-]\d+){1,4}\b/i) || [""])[0];
    const updatedAtText = (text.match(/\b\d{2}[.\/-]\d{2}[.\/-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/) || [""])[0];
    const afterLabel = safeText((text.split(/Найдено\s+на\s+OLT\s*:?/i)[1] || ""), 500);
    let name = afterLabel;
    if (ips[0]) name = safeText(name.split(ips[0])[0], 220);
    if (port) name = safeText(name.split(port)[0], 220);
    name = safeText(name.replace(/^[\s:—|\-]+|[\s:—|\-]+$/g, ""), 180);
    const technology = technologyFromText(`${name} ${port} ${text}`);

    return {
      status: "found",
      found: true,
      name,
      ip: ips[0] || "",
      port,
      technology,
      updatedAtText,
      source: "UserSide: ТМЦ / «Найдено на OLT»"
    };
  }

  function toneFrom(value, negativePattern, positivePattern = null) {
    const text = safeText(value, 220).toLowerCase();
    if (!text) return "unknown";
    if (negativePattern.test(text)) return "warn";
    if (!positivePattern || positivePattern.test(text)) return "ok";
    return "unknown";
  }

  function billingAccessChecks() {
    const access = controlValue("select[name='state']") || labelValue(/Доступ\s*/i, 120);
    const block = labelValue(/Блокировк(?:а|и)?\s*/i, 140);
    const group = controlValue("select[name*='group']") || labelValue(/Группа\s*/i, 140);
    const tariff = controlValue("select[name*='tarif'],select[name*='tariff']") || labelValue(/Тариф(?:ный план|ы на Интернет)?\s*/i, 180);
    const serviceState = controlValue("select[name='cstate']") || labelValue(/Состояние услуги\s*/i, 140);
    const startDayRaw = controlValue("input[name='start_day']") || labelValue(/День начала потребления услуг\s*/i, 80);
    const startDayMatch = String(startDayRaw).match(/-?\d+/);
    const startDayNumber = startDayMatch ? Number(startDayMatch[0]) : null;

    return [
      { id: "access", label: "Доступ", value: access, state: toneFrom(access, /запрещ|deny|disabled|заблок|нет доступа/i, /разреш|allow|enabled|актив/i) },
      { id: "block", label: "Блокировка", value: block, state: toneFrom(block, /^(?!.*(?:нет|отсутств)).*(?:есть|да|заблок|block)/i, /нет|отсутств/i) },
      { id: "group", label: "Группа", value: group, state: toneFrom(group, /удал[её]н|deleted|неактив/i) },
      { id: "tariff", label: "Тариф", value: tariff || serviceState, state: toneFrom(`${tariff} ${serviceState}`, /заблок|blocked|отключ|неактив|stop/i) },
      { id: "start-day", label: "День начала", value: startDayRaw, state: startDayNumber == null ? "unknown" : startDayNumber < 0 ? "warn" : "ok" }
    ];
  }

  function billingRoutes(billingId) {
    if (!billingId) return { main: "", technical: "", userside: "" };
    const base = new URL(location.href);
    const main = new URL(base.href);
    main.searchParams.set("a", "user");
    main.searchParams.set("id", billingId);
    main.searchParams.delete("parent_type");
    main.searchParams.delete("tmpl");

    const technical = new URL(base.href);
    technical.searchParams.set("a", "dopdata");
    technical.searchParams.set("parent_type", "0");
    technical.searchParams.set("id", billingId);
    technical.searchParams.set("tmpl", "1");

    const usersideLink = [...document.querySelectorAll("a[href]")]
      .find(link => /userside/i.test(link.textContent || "") || /userside\.simnet\.kiev\.ua/i.test(link.href || ""));
    return {
      main: main.href,
      technical: technical.href,
      userside: usersideLink?.href || ""
    };
  }

  function detectBillingContext(text) {
    const params = new URL(location.href).searchParams;
    const action = params.get("a") || "";
    const billingId = params.get("id") || "";
    const loginElement = findLoginElement();
    const rowData = billingRowData(loginElement);
    const fallbackLogin = extractLogins(text)[0] || "";
    let login = safeText(loginElement?.value || loginElement?.textContent || fallbackLogin, 80).toLowerCase();

    const gotouser = document.querySelector("a[href*='userside.simnet.kiev.ua/script/gotouser.php']");
    let routeIp = "";
    try {
      routeIp = gotouser ? new URL(gotouser.href, location.href).searchParams.get("ip") || "" : "";
    } catch (_) {}

    const labeledIp = labelValue(/IP(?:-адрес)?\s*/i, 80);
    let ip = rowData.ip || routeIp || extractIps(labeledIp)[0] || "";
    let contract = login.replace(/^abon/i, "");

    if (!contract && rememberedIdentity && rememberedIdentity.billingId === billingId) {
      login = rememberedIdentity.login;
      contract = rememberedIdentity.contract;
      ip = ip || rememberedIdentity.ip;
    }
    if (contract || billingId) rememberedIdentity = { system: "billing", login, contract, billingId, ip };

    const isSubscriberPage = action === "user" || action === "dopdata" || Boolean(login || billingId);
    return {
      system: "billing",
      kind: action === "dopdata" ? "billing_technical" : action === "user" ? "billing_user" : "billing_other",
      isSubscriberPage,
      login,
      contract,
      billingId,
      customerId: "",
      ip,
      accessChecks: billingAccessChecks(),
      olt: billingOltInfo(),
      tmc: null,
      routes: billingRoutes(billingId)
    };
  }

  function detectUsersideContext(text) {
    const customerId = (location.pathname.match(/^\/customer\/(\d+)/) || [])[1] || "";
    const cardText = [document.title, textOf("#customer-card-customer-id"), textOf("#slider_content_id"), text].join(" ");
    const login = extractLogins(cardText)[0] || "";
    const ipMacText = textOf("#ref_ip_mac") || cardText;
    const ips = extractIps(ipMacText).filter(value => !/^172\.16\.|^127\.|^0\./.test(value));
    return {
      system: "userside",
      kind: customerId ? "userside_customer" : "userside_other",
      isSubscriberPage: Boolean(customerId || login),
      login,
      contract: login.replace(/^abon/i, ""),
      billingId: "",
      customerId,
      ip: ips[0] || "",
      accessChecks: [],
      olt: { status: "unknown", present: false, name: "", ip: "", technology: "", poller: "", source: "" },
      tmc: usersideTmcInfo(),
      routes: { main: "", technical: "", userside: location.href }
    };
  }

  function detectContext() {
    const text = pageText();
    const userside = /userside/i.test(location.hostname);
    const base = userside ? detectUsersideContext(text) : detectBillingContext(text);
    const userSideAddress = userside ? textOf("#ref_adr") : "";
    const userSideName = userside ? safeText(document.title.split("-")[0], 140) : "";
    const ipMacText = userside ? textOf("#ref_ip_mac") : "";

    return {
      ...base,
      fullName: userSideName || labelValue(/(?:ФИО|ПІБ|Абонент|Клиент|Клієнт)\s*/i, 140),
      address: userSideAddress || labelValue(/(?:Адрес|Адреса)\s*/i, 180),
      mac: normalizeMac(ipMacText || labelValue(/MAC(?:\s+(?:ONU|ONT|роутера|router))?\s*/i, 180) || text),
      href: location.href,
      key: [location.hostname, location.pathname, base.kind, base.login, base.billingId, base.customerId].join("|")
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

  function collectFacts(context) {
    const out = [];
    for (const check of context.accessChecks || []) {
      if (check.value) out.push(`${check.label}: ${check.value}`);
    }
    if (context.olt?.present) out.push(`OLT Billing: ${[context.olt.name, context.olt.ip, context.olt.technologyLabel].filter(Boolean).join(" · ")}`);
    if (context.tmc?.found) out.push(`OLT ТМЦ: ${[context.tmc.name, context.tmc.ip, context.tmc.port, context.tmc.updatedAtText].filter(Boolean).join(" · ")}`);
    for (const node of panel()?.querySelectorAll("#dp-results tr,#dp-results details,#dp-results .dp-result-row,#dp-results [data-dp-result]") || []) {
      const text = safeText(node.textContent, 260);
      if (!text || /ожидани|номер договора|рандом|пуск/i.test(text)) continue;
      if (!/(договор|адрес|mac|ip|onu|olt|сигнал|сесси|баланс|услуг|доступ|тариф|блокиров|группа)/i.test(text)) continue;
      if (!out.includes(text)) out.push(text);
      if (out.length >= 18) break;
    }
    return out;
  }

  function snapshot() {
    const p = panel();
    const stop = p?.querySelector("#dp-stop");
    const statusText = safeText(p?.querySelector("#dp-status")?.textContent || "", 180);
    const running = Boolean(stop && !stop.disabled);
    const context = detectContext();
    return {
      context,
      issue: state.issue,
      status: { running, text: statusText, stage: stageFromStatus(statusText, running) },
      facts: collectFacts(context),
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

  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  function setIssue(value) {
    state.issue = safeText(value, 600);
    try { sessionStorage.setItem(ISSUE_KEY, state.issue); } catch (_) {}
    publish();
  }

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

  try { state.issue = safeText(sessionStorage.getItem(ISSUE_KEY) || "", 600); } catch (_) {}

  globalThis.__SIMNET_WORKBENCH_CORE__ = {
    version: "0.4.0",
    getState,
    setIssue,
    runDiagnostic,
    stopDiagnostic,
    refresh: publish,
    subscribe
  };

  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(publish, 140);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "value", "class", "selected", "checked"]
  });
  window.addEventListener("popstate", publish);
  window.addEventListener("hashchange", publish);
  window.addEventListener("pageshow", publish);
  window.setTimeout(publish, 450);
  window.setTimeout(publish, 1400);
  publish();
})();
