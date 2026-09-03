"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_PON_DETAIL__) return;

  const ADAPTER_LABELS = Object.freeze({
    "bdcom-epon": "BDCOM EPON",
    "bdcom-gpon": "BDCOM GPON",
    gcom: "GCOM",
    huawei: "Huawei GPON",
    unknown: "PON"
  });
  const HIGHLIGHT_NAME = "dp-pon-source-line";
  const state = {
    analysis: null,
    raw: "",
    rawElement: null,
    fingerprints: "",
    highlightTimer: 0
  };

  const text = (value) => String(value || "").replace(/\r/g, "").trim();
  const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function normalizeMac(value) {
    const hex = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return hex.length === 12 ? hex : "";
  }

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.closest("#dp-panel")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function elementText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return String(element.value || "");
    return String(element.innerText || element.textContent || "");
  }

  function rawScore(value) {
    const raw = String(value || "");
    if (raw.length < 220) return -1;
    let score = 0;
    const markers = [
      /pon_port_by_onu/i,
      /onu_by_onu/i,
      /display\s+ont\b/i,
      /show\s+(?:epon|gpon|onu|ont)\b/i,
      /Rx\s+optical\s+power/i,
      /ONT\s+online\s+duration/i,
      /learned[-\s]?mac/i,
      /LinkState/i,
      /OAM\s+operational/i,
      /service-port/i
    ];
    for (const marker of markers) if (marker.test(raw)) score += 25;
    score += Math.min(40, raw.length / 1000);
    return score;
  }

  function findRawOutput() {
    let best = null;
    let bestScore = -1;
    const candidates = document.querySelectorAll("pre,textarea,code,td,div");
    for (const element of candidates) {
      if (!visible(element)) continue;
      const value = elementText(element);
      const score = rawScore(value);
      if (score <= bestScore) continue;
      const childCandidate = [...element.children].some((child) => rawScore(elementText(child)) >= score - 5);
      if (childCandidate && !["PRE", "TEXTAREA", "CODE"].includes(element.tagName)) continue;
      best = element;
      bestScore = score;
    }
    if (!best) return { element: null, raw: "" };
    return { element: best, raw: elementText(best) };
  }

  function detectAction(raw) {
    const action = new URL(location.href).searchParams.get("a");
    if (["310", "311", "312", "313"].includes(action)) return action;
    if (/MA5800|display\s+ont\b|display\s+service-port\b/i.test(raw)) return "313";
    if (/\bGCOM\b|show\s+onu\s+(?:information|optical)|onu\s+detail\s+information/i.test(raw)) return "312";
    if (/\bGPON\b|show\s+gpon\b|gpon-onu/i.test(raw)) return "311";
    if (/\bEPON\b|show\s+epon\b|ctc-oam-oper|OAM\s+operational/i.test(raw)) return "310";
    return "";
  }

  function findLabeledValue(patterns) {
    for (const row of document.querySelectorAll("tr")) {
      if (row.closest("#dp-panel")) continue;
      const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
      if (!cells.length) continue;
      const label = compact(cells[0]?.textContent);
      if (!patterns.some((pattern) => pattern.test(label))) continue;
      const control = row.querySelector("input:not([type='hidden']),select,textarea");
      const value = control?.tagName === "SELECT"
        ? compact(control.selectedOptions?.[0]?.textContent || control.value)
        : control ? compact(control.value) : compact(cells.at(-1)?.textContent);
      return { value, element: row };
    }
    return { value: "", element: null };
  }

  function expectedContext() {
    const router = findLabeledValue([
      /mac\s+(?:роутера|маршрутизатора)/i,
      /router\s+mac/i,
      /mac\s+клиентского\s+оборудования/i
    ]);
    const onuMac = findLabeledValue([/mac\s+(?:onu|ont)/i, /(?:onu|ont)\s+mac/i]);
    const serial = findLabeledValue([/(?:sn|serial)\s+(?:onu|ont)/i, /(?:onu|ont)\s+(?:sn|serial)/i]);
    return {
      routerMac: normalizeMac(router.value),
      onuMac: normalizeMac(onuMac.value),
      serial: compact(serial.value),
      elements: { router: router.element, onuMac: onuMac.element, serial: serial.element }
    };
  }

  function analyze() {
    const api = globalThis.__SIMNET_ONU_ANALYSIS__;
    if (!api?.analyzeOnuPollResult) return null;
    const output = findRawOutput();
    if (!output.raw) return null;
    const expected = expectedContext();
    const action = detectAction(output.raw);
    const result = api.analyzeOnuPollResult(output.raw, {
      action,
      expectedRouterMac: expected.routerMac,
      expectedOnuMac: expected.onuMac,
      expectedOnuSerial: expected.serial
    });
    state.analysis = result;
    state.raw = output.raw;
    state.rawElement = output.element;
    state.fingerprints = [action, output.raw.length, output.raw.slice(-160), expected.routerMac, expected.onuMac, expected.serial].join("|");
    return { ...result, expected, rawElement: output.element };
  }

  function statusTone(value) {
    if (["error", "conflict"].includes(value)) return "error";
    if (value === "warn") return "warning";
    if (value === "ok") return "ok";
    return "unknown";
  }

  function factModel() {
    const result = analyze();
    if (!result) return null;
    const { adapter, facts, report, expected, rawElement } = result;
    const learned = facts.macTable?.subscriberMacs || [];
    const expectedRouter = expected.routerMac;
    const macMatched = Boolean(expectedRouter && learned.includes(expectedRouter));
    const macMismatch = Boolean(expectedRouter && learned.length && !macMatched);
    const macMissing = Boolean(facts.macTable?.seen && !learned.length && facts.status !== "offline");
    const port = facts.ethernet || {};
    const optics = facts.optics || {};
    const uptime = facts.uptime || {};
    return {
      adapter,
      adapterLabel: ADAPTER_LABELS[adapter] || ADAPTER_LABELS.unknown,
      report,
      facts,
      rawElement,
      expectedRouter,
      learned,
      cards: [
        {
          key: "onu-state",
          label: "Состояние ONU",
          value: facts.status === "online" ? "online" : facts.status === "offline" ? "offline" : "не получено",
          status: facts.status === "online" ? "ok" : facts.status === "offline" ? "error" : "warning",
          patterns: [/ONU[^\n]{0,60}(?:online|offline)/i, /Run\s+state\s*:\s*(?:online|offline)/i, /Control\s+flag\s*:/i]
        },
        {
          key: "ethernet-port",
          label: "Ethernet-порт ONU",
          value: port.link === "up"
            ? `UP${port.speedMbps ? ` · ${port.speedMbps} Мбит/с` : ""}${port.duplex && port.duplex !== "unknown" ? ` · ${port.duplex}` : ""}`
            : port.link === "down" ? "DOWN" : "не получено",
          status: port.link === "up" ? "ok" : port.link === "down" ? "error" : "warning",
          patterns: [/LinkState[^\n]*\n[^\n]*(?:up|down)/i, /(?:Ethernet|ETH|LAN)[^\n]{0,80}\b(?:up|down)\b/i, /port\s+state[^\n]*/i]
        },
        {
          key: "learned-mac",
          label: "MAC оборудования за ONU",
          value: learned.length ? learned.join(", ") : "не изучен",
          status: macMismatch ? "error" : macMissing ? "warning" : macMatched ? "ok" : learned.length ? "warning" : "warning",
          note: macMismatch
            ? `Ожидается ${expectedRouter}; изучен другой MAC.`
            : macMissing ? "ONU online, но MAC за Ethernet-портом не изучен."
              : macMatched ? "Изученный MAC совпадает с техническими данными."
                : expectedRouter ? "MAC получен, но автоматическая сверка не подтверждена." : "В технических данных нет MAC для автоматической сверки.",
          patterns: learned.length
            ? learned.map((mac) => new RegExp(mac.match(/.{1,4}/g)?.join("[-:.]?") || mac, "i"))
            : [/learned[-\s]?mac/i, /MAC-ADDRESS/i]
        },
        {
          key: "uptime",
          label: "Общее время работы",
          value: uptime.text || "не получено",
          status: uptime.text ? (uptime.seconds && uptime.seconds < Number(globalThis.__SIMNET_ONU_ANALYSIS__?.thresholds?.stableUptimeSeconds || 7200) ? "warning" : "ok") : "warning",
          patterns: [/ONT\s+online\s+duration[^\n]*/i, /Online\s+Duration[^\n]*/i, /(?:ONU|ONT)?\s*uptime[^\n]*/i, /Statistic\s+duration[^\n]*/i]
        },
        {
          key: "optics",
          label: "Оптические уровни",
          value: [
            Number.isFinite(optics.onuRxDbm) ? `ONU Rx ${optics.onuRxDbm.toFixed(2)} dBm` : "",
            Number.isFinite(optics.oltRxDbm) ? `OLT Rx ${optics.oltRxDbm.toFixed(2)} dBm` : ""
          ].filter(Boolean).join(" · ") || "не получены",
          status: report.deviations?.some((item) => /слаб|критическ|оптическ/i.test(item)) ? "warning" : Number.isFinite(optics.onuRxDbm) || Number.isFinite(optics.oltRxDbm) ? "ok" : "warning",
          patterns: [/Rx\s+optical\s+power[^\n]*/i, /OLT\s+Rx\s+(?:ONT|ONU)\s+optical\s+power[^\n]*/i, /(?:ONU|ONT)\s+Rx[^\n]*dBm/i]
        }
      ]
    };
  }

  function findTextRange(root, patterns) {
    if (!root || !patterns?.length) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = String(node.nodeValue || "");
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(value);
        if (!match) continue;
        const range = new Range();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        return range;
      }
    }
    return null;
  }

  function clearSourceHighlight() {
    try { CSS.highlights?.delete(HIGHLIGHT_NAME); } catch (_) {}
    clearTimeout(state.highlightTimer);
  }

  function highlightSource(card) {
    clearSourceHighlight();
    const root = state.rawElement;
    if (!root) return false;
    const range = findTextRange(root, card.patterns || []);
    if (range && globalThis.Highlight && CSS.highlights) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) window.scrollTo({ top: Math.max(0, scrollY + rect.top - innerHeight * 0.35), behavior: "smooth" });
      state.highlightTimer = setTimeout(clearSourceHighlight, 12000);
      return true;
    }
    globalThis.__SIMNET_PAGE_FOCUS__?.show?.(root, {
      label: `${card.label} · ${card.value}`,
      tone: card.status === "error" ? "error" : card.status === "warning" ? "warning" : "ok",
      scroll: true
    });
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render() {
    const host = document.querySelector("#dp-connectivity-entities");
    const model = globalThis.__SIMNET_OPERATOR_CONNECTIVITY__?.read?.();
    const active = document.querySelector("#dp-connectivity-steps button.active");
    const stepIndex = Number(active?.dataset.connectivityStep || -1);
    const step = model?.route?.steps?.[stepIndex];
    let block = document.querySelector("#dp-pon-critical");
    if (!host || model?.technology?.id !== "pon" || step?.id !== "pon-line") {
      block?.remove();
      clearSourceHighlight();
      return;
    }
    const detail = factModel();
    if (!detail) {
      block?.remove();
      return;
    }
    if (!block) {
      block = document.createElement("section");
      block.id = "dp-pon-critical";
      host.insertAdjacentElement("afterend", block);
    }
    block.innerHTML = `
      <header>
        <div><b>${escapeHtml(detail.adapterLabel)}</b><span>Критические поля опроса</span></div>
        <em class="${escapeHtml(statusTone(detail.report.severity))}">${escapeHtml(detail.report.badge || "UNKNOWN")}</em>
      </header>
      <div class="dp-pon-critical-grid">
        ${detail.cards.map((card) => `
          <button type="button" class="${escapeHtml(card.status)}" data-dp-pon-card="${escapeHtml(card.key)}">
            <span>${escapeHtml(card.label)}</span>
            <b>${escapeHtml(card.value)}</b>
            ${card.note ? `<small>${escapeHtml(card.note)}</small>` : ""}
          </button>
        `).join("")}
      </div>
      <article class="${escapeHtml(statusTone(detail.report.severity))}">
        <b>${escapeHtml(detail.report.summary || "Результат разобран")}</b>
        <span>${escapeHtml(detail.report.conclusion || "")}</span>
      </article>
    `;
    block.onclick = (event) => {
      const button = event.target.closest("[data-dp-pon-card]");
      if (!button) return;
      const card = detail.cards.find((item) => item.key === button.dataset.dpPonCard);
      if (card) highlightSource(card);
    };
  }

  const style = document.createElement("style");
  style.dataset.simnetPonDetail = "1";
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}){background:#fde68a;color:#111827;text-decoration:underline 2px #d97706}
    #dp-pon-critical{display:grid!important;gap:7px!important;padding:9px!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;border-radius:8px!important}
    #dp-pon-critical>header{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:8px!important}
    #dp-pon-critical>header>div{display:grid!important;gap:1px!important}#dp-pon-critical>header b{color:#172033!important;font-size:10px!important}#dp-pon-critical>header span{color:#64748b!important;font-size:8px!important}
    #dp-pon-critical>header em{padding:3px 6px!important;border-radius:999px!important;font-size:8px!important;font-style:normal!important;font-weight:800!important}.dp-pon-critical-grid{display:grid!important;gap:5px!important}
    .dp-pon-critical-grid button{display:grid!important;gap:2px!important;width:100%!important;padding:7px 8px!important;text-align:left!important;background:#fff!important;border:1px solid #d5dde8!important;border-left:3px solid #64748b!important;border-radius:7px!important;cursor:pointer!important}.dp-pon-critical-grid button.ok{border-left-color:#16a34a!important}.dp-pon-critical-grid button.warning{border-left-color:#d97706!important}.dp-pon-critical-grid button.error{border-left-color:#dc2626!important}
    .dp-pon-critical-grid span{color:#64748b!important;font-size:8px!important}.dp-pon-critical-grid b{color:#172033!important;font-size:9.5px!important}.dp-pon-critical-grid small{color:#92400e!important;font-size:8px!important;line-height:1.35!important}
    #dp-pon-critical>article{display:grid!important;gap:2px!important;padding:7px 8px!important;background:#fff!important;border:1px solid #d5dde8!important;border-radius:7px!important}#dp-pon-critical>article.warning{background:#fffbeb!important;border-color:#f4cc7b!important}#dp-pon-critical>article.error{background:#fef2f2!important;border-color:#f0a6a6!important}#dp-pon-critical>article.ok{background:#f0fdf4!important;border-color:#a7d9b8!important}#dp-pon-critical>article b{color:#172033!important;font-size:9px!important}#dp-pon-critical>article span{color:#526174!important;font-size:8px!important;line-height:1.4!important}
  `;
  (document.head || document.documentElement).appendChild(style);

  document.addEventListener("click", (event) => {
    if (event.target.closest("#dp-connectivity-steps,[data-operator-scenario],#dp-connectivity-refresh")) requestAnimationFrame(render);
  }, true);
  document.addEventListener("dp:operator-connectivity-refresh", () => requestAnimationFrame(render));
  document.addEventListener("dp:operation-mode-change", () => requestAnimationFrame(render));
  new MutationObserver(() => {
    if (document.querySelector("#dp-connectivity-workspace") && !document.querySelector("#dp-pon-critical")) requestAnimationFrame(render);
  }).observe(document.documentElement, { childList: true, subtree: true });

  globalThis.__SIMNET_OPERATOR_PON_DETAIL__ = Object.freeze({ analyze, factModel, render, highlightSource, clearSourceHighlight });
  render();
})();
