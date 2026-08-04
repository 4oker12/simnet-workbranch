"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_MENTOR_EVIDENCE__) return;

  const baseCore = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!baseCore?.getState || !baseCore?.subscribe) return;

  const safe = (value, max = 1200) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const extractIps = value => [...new Set(String(value || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [])]
    .filter(ip => ip.split(".").every(part => Number(part) >= 0 && Number(part) <= 255));
  const normalizeMac = value => {
    const match = String(value || "").toUpperCase().match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b|\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/);
    if (!match) return "";
    const compact = match[0].replace(/[-.:]/g, "");
    return compact.match(/.{2}/g)?.join(":") || "";
  };

  function isVisible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  }

  function documentText() {
    const clone = (document.body || document.documentElement)?.cloneNode(true);
    if (!clone) return "";
    clone.querySelector("#dp-panel")?.remove();
    clone.querySelector("#simnet-workbench-dock")?.remove();
    clone.querySelector("#simnet-wb-highlight-overlay")?.remove();
    return safe(clone.textContent, 180000);
  }

  function selectedText(selector) {
    const control = document.querySelector(selector);
    if (!control) return "";
    if (control.tagName === "SELECT") {
      return safe(control.options?.[control.selectedIndex]?.textContent || control.value, 220);
    }
    return safe(control.value || control.textContent, 220);
  }

  function relatedJuniperText() {
    const parts = [];
    const selectors = [
      "iframe[src*='juniper' i]",
      "[id*='juniper' i]",
      "[class*='juniper' i]",
      "[data-tab*='juniper' i]",
      "[href*='juniper' i]"
    ];
    for (const element of document.querySelectorAll(selectors.join(","))) {
      if (element.closest("#dp-panel,#simnet-workbench-dock")) continue;
      const text = safe(element.textContent, 5000);
      if (text) parts.push(text);
      if (element.tagName !== "IFRAME") continue;
      try {
        const frameDoc = element.contentDocument;
        const frameText = safe(frameDoc?.body?.innerText || frameDoc?.body?.textContent, 16000);
        if (frameText) parts.push(frameText);
      } catch (_) {}
    }
    return safe(parts.join(" "), 24000);
  }

  function sessionEvidence() {
    const iframe = document.querySelector("iframe[src*='juniper' i]");
    const tab = [...document.querySelectorAll("a,button,[role='tab'],[onclick],td,span")]
      .find(element => /^Juniper(?:\s*\(NEW\)|\s+NEW|\s*2)?$/i.test(safe(element.textContent, 80)));
    const text = relatedJuniperText();
    const opened = Boolean((iframe && isVisible(iframe)) || (tab && /active|selected|open|show/i.test(tab.className || "")) || text.length > 40);
    const negative = /(?:нет|отсутствует|не найден[ао]?|не обнаружен[ао]?|no)\s+(?:активн\w*\s+)?сесси|сесси\w*\s+(?:нет|отсутств|не найден)|user\s+not\s+found|no\s+session/i.test(text);
    const ip = extractIps(text).find(value => !/^127\.|^0\.|^255\./.test(value)) || "";
    const mac = normalizeMac(text);
    const positive = !negative && opened && (
      Boolean(ip && mac)
      || /(?:active|online|uptime|start(?:ed)?|авторизован|сессия\s+(?:есть|активна|найдена))/i.test(text)
    );
    const loaded = opened && (text.length > 40 || (() => {
      try { return iframe?.contentDocument?.readyState === "complete"; } catch (_) { return false; }
    })());
    const status = negative ? "absent" : positive ? "active" : opened && !loaded ? "loading" : opened ? "unknown" : "unopened";

    return {
      status,
      opened,
      loaded,
      resolved: status === "active" || status === "absent",
      active: status === "active",
      absent: status === "absent",
      ip,
      mac,
      source: opened ? "Juniper NEW" : "",
      summary: status === "active"
        ? "Активная сессия распознана"
        : status === "absent"
          ? "Активная сессия не найдена"
          : status === "loading"
            ? "Juniper открыт, данные загружаются"
            : status === "unknown"
              ? "Juniper открыт, результат не распознан"
              : "Juniper ещё не открыт"
    };
  }

  function ponEvidence(context, pageText) {
    const technologyText = [
      context?.olt?.technology,
      context?.olt?.technologyLabel,
      selectedText("select[name='dopfield_39'],input[name='dopfield_39']")
    ].filter(Boolean).join(" ");
    const hasPonFields = Boolean(document.querySelector("[name='dopfield_19'],[name='dopfield_38']"));
    const isPon = /(?:gpon|epon|pon|huawei|gcom)/i.test(technologyText) || hasPonFields || /(?:GPON|EPON|PON)[-\s]?(?:MAC|ONU|ONT|Serial)/i.test(pageText);
    return {
      isPon,
      technology: context?.olt?.technology || "",
      billingOltStatus: context?.olt?.status || "unknown",
      billingOltPresent: Boolean(context?.olt?.present),
      tmcOltFound: Boolean(context?.tmc?.found)
    };
  }

  function lineEvidence(state, pageText) {
    const facts = (state?.facts || []).join(" ");
    const text = safe(`${facts} ${pageText}`, 220000);
    const polled = /(?:rx\s*[:=]|tx\s*[:=]|distance|расстоян|onu.{0,30}(?:online|offline)|ont.{0,30}(?:online|offline)|(?:оптич|сигнал).{0,30}(?:dbm|норм|плох|крит))/i.test(text);
    const problem = polled && /(?:offline|down|los|не найден|не доступ|крит|плох)/i.test(text);
    return { polled, problem };
  }

  function tmcOpened(context) {
    if (context?.system !== "userside") return false;
    if (context?.tmc?.found) return true;
    return [...document.querySelectorAll("a,button,[role='tab'],summary,h2,h3,td,span")]
      .some(element => isVisible(element) && /^(?:ТМЦ|Оборудование|Товарно.?материальные ценности)$/i.test(safe(element.textContent, 100))
        && /active|selected|open|show/i.test(element.className || ""));
  }

  function alertFromAccess(check) {
    const map = {
      access: { title: "Доступ ограничен", target: "billing-access" },
      block: { title: "Обнаружена блокировка", target: "billing-block" },
      group: { title: "Проверь группу абонента", target: "billing-group" },
      tariff: { title: "Проверь тариф или услугу", target: "billing-tariff" },
      "start-day": { title: "Некорректный день начала услуги", target: "billing-start-day" }
    };
    const meta = map[check.id] || { title: `Проверь: ${check.label}`, target: "subscriber" };
    return {
      id: `access-${check.id}`,
      severity: "critical",
      title: meta.title,
      text: `${check.label}: ${check.value || "требует внимания"}`,
      target: meta.target,
      source: "Billing"
    };
  }

  function buildAlerts(context, evidence) {
    const alerts = (context?.accessChecks || [])
      .filter(check => check.state === "warn")
      .map(alertFromAccess);

    if (evidence.pon.isPon && context?.olt?.status === "missing") {
      alerts.push({
        id: "missing-olt",
        severity: "warning",
        title: "Для PON не указана OLT",
        text: "Без привязки OLT нельзя достоверно выбрать способ live-опроса.",
        target: "billing-olt-field",
        source: "Billing"
      });
    }

    if (evidence.session.absent) {
      alerts.push({
        id: "session-absent",
        severity: "critical",
        title: "Сессия не подтверждена",
        text: "Juniper открыт, активная сессия не найдена.",
        target: "session",
        source: "Juniper NEW"
      });
    }

    const weight = { critical: 0, warning: 1, info: 2 };
    return alerts.sort((a, b) => (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9));
  }

  function enrichState(input) {
    const state = input || {};
    const context = state.context || {};
    const pageText = documentText();
    const session = sessionEvidence();
    const pon = ponEvidence(context, pageText);
    const line = lineEvidence(state, pageText);
    const evidence = {
      access: context.accessChecks || [],
      olt: context.olt || null,
      tmc: context.tmc || null,
      session,
      pon,
      line
    };
    const checkpoints = {
      subscriberOpened: Boolean(context.contract || context.billingId || context.customerId),
      technicalDataOpened: context.kind === "billing_technical",
      oltFieldChecked: context.kind === "billing_technical" && context.olt?.status !== "unknown",
      juniperOpened: session.opened,
      sessionResolved: session.resolved,
      sessionActive: session.active,
      tmcOpened: tmcOpened(context),
      tmcOltFound: Boolean(context.tmc?.found),
      oltKnown: Boolean(context.olt?.present || context.tmc?.found),
      onuPolled: line.polled
    };

    return {
      ...state,
      evidence,
      checkpoints,
      alerts: buildAlerts(context, evidence)
    };
  }

  const enrichedCore = {
    ...baseCore,
    version: "0.5.0",
    getState() {
      return enrichState(baseCore.getState());
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      return baseCore.subscribe(state => listener(enrichState(state)));
    }
  };

  globalThis.__SIMNET_WORKBENCH_CORE__ = enrichedCore;
  globalThis.__SIMNET_MENTOR_EVIDENCE__ = { version: "0.1.0", enrichState };
})();
