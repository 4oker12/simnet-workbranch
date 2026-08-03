"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_GUIDANCE__) return;

  const OLT_ACTIONS = new Set(["310", "311", "312", "313"]);
  const SPOTLIGHT_KEYS = new Set(["routerMac", "learnedMac", "clientPort", "lineState", "uptime", "optics"]);
  const runtime = {
    tooltip: null,
    tooltipAnchor: null,
    spotlight: null,
    range: null,
    element: null,
    spotlightKey: "",
    frame: 0
  };

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const currentAction = () => {
    try { return new URL(location.href).searchParams.get("a") || ""; } catch (_) { return ""; }
  };

  // Подсветка после перехода больше не запускается сама. На новой странице
  // оператор нажимает «Показать источник» или конкретное поле ещё раз.
  try { sessionStorage.removeItem("dp_operator_live_pending_focus_v1"); } catch (_) {}

  const JUNIPER_HELP = Object.freeze({
    askjun: {
      title: "Запит Juniper",
      body: "Запрашивает текущее состояние сессии. Соединение не разрывает."
    },
    coasync: {
      title: "Синхронізація (SYNC)",
      body: "Повторно синхронизирует состояние клиента. Полезно при расхождении Billing и Juniper."
    },
    coadisconnect: {
      title: "Disconnect",
      body: "Принудительно завершает текущую сессию. Клиенту потребуется повторная авторизация."
    }
  });

  const SPOTLIGHT_COPY = Object.freeze({
    routerMac: {
      title: "Ожидаемый MAC",
      body: "Эталон из строки запроса. С ним сравнивается MAC, который фактически изучила OLT."
    },
    learnedMac: {
      title: "MAC за ONU",
      body: "Фактически изученный MAC. Совпадение с ожидаемым MAC подтверждает подключённое оборудование."
    },
    clientPort: {
      title: "Ethernet-порт ONU",
      body: "LinkState UP подтверждает физический линк ONU–роутер. DOWN — проверяем кабель, питание и WAN-порт."
    },
    lineState: {
      title: "Состояние ONU",
      body: "ONU online означает регистрацию на OLT. Это ещё не подтверждает наличие сессии."
    },
    uptime: {
      title: "Время работы ONU",
      body: "Длительный uptime говорит о стабильной регистрации. Короткий — повод проверить недавний обрыв."
    },
    optics: {
      title: "Оптические уровни",
      body: "Показывают качество линии. Для оценки сопоставляются уровни со стороны ONU и OLT."
    }
  });

  function installStyle() {
    if (document.getElementById("dp-operator-guidance-style")) return;
    const style = document.createElement("style");
    style.id = "dp-operator-guidance-style";
    style.textContent = `
      a.dp-juniper-guided{position:relative!important;padding-right:17px!important}
      a.dp-juniper-guided::after{content:"?"!important;position:absolute!important;right:3px!important;top:50%!important;display:grid!important;place-items:center!important;width:12px!important;height:12px!important;transform:translateY(-50%)!important;color:#fff!important;background:#2563eb!important;border-radius:50%!important;font:800 8px/1 Arial,sans-serif!important}
      #dp-juniper-tooltip{position:fixed!important;z-index:2147483647!important;display:none!important;width:min(230px,calc(100vw - 20px))!important;padding:8px 9px!important;color:#e5edf8!important;background:rgba(15,23,42,.97)!important;border:1px solid rgba(148,163,184,.55)!important;border-radius:8px!important;box-shadow:0 10px 28px rgba(15,23,42,.32)!important;font:500 11px/1.35 "Segoe UI",Arial,sans-serif!important;pointer-events:none!important}
      #dp-juniper-tooltip.show{display:grid!important;gap:2px!important}
      #dp-juniper-tooltip b{color:#fff!important;font-size:11px!important}
      #dp-juniper-tooltip span{color:#cbd5e1!important}
      .dp-source-dim{position:fixed!important;z-index:2147483638!important;background:rgba(2,6,23,.72)!important;pointer-events:none!important}
      #dp-source-spotlight-frame{position:fixed!important;z-index:2147483640!important;display:none!important;border:4px solid #84cc16!important;border-radius:10px!important;box-shadow:0 0 0 2px rgba(255,255,255,.92),0 0 30px rgba(132,204,22,.45)!important;pointer-events:none!important}
      #dp-source-spotlight-frame.show{display:block!important}
      #dp-source-spotlight-card{position:fixed!important;z-index:2147483642!important;display:none!important;width:min(360px,calc(100vw - 20px))!important;padding:9px 11px!important;color:#e2e8f0!important;background:rgba(15,23,42,.98)!important;border:1px solid rgba(132,204,22,.75)!important;border-radius:9px!important;box-shadow:0 12px 34px rgba(0,0,0,.4)!important;font:500 11px/1.4 "Segoe UI",Arial,sans-serif!important;pointer-events:none!important}
      #dp-source-spotlight-card.show{display:grid!important;gap:3px!important}
      #dp-source-spotlight-card b{color:#bef264!important;font-size:12px!important}
      #dp-source-spotlight-card span{color:#e2e8f0!important}
      #dp-source-spotlight-card small{color:#94a3b8!important;font-size:9px!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function juniperAction(link) {
    if (!(link instanceof HTMLAnchorElement)) return "";
    try {
      const url = new URL(link.href, location.href);
      if (url.searchParams.get("a") !== "252") return "";
      const act = url.searchParams.get("act") || "";
      return JUNIPER_HELP[act] ? act : "";
    } catch (_) { return ""; }
  }

  function scanJuniperLinks() {
    for (const link of document.querySelectorAll('a[href*="a=252"][href*="act="]')) {
      const act = juniperAction(link);
      if (!act) continue;
      link.classList.add("dp-juniper-guided");
      link.dataset.dpJuniperHelp = act;
      link.setAttribute("aria-describedby", "dp-juniper-tooltip");
    }
  }

  function ensureTooltip() {
    if (runtime.tooltip?.isConnected) return runtime.tooltip;
    const tooltip = document.createElement("div");
    tooltip.id = "dp-juniper-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.innerHTML = "<b></b><span></span>";
    document.documentElement.appendChild(tooltip);
    runtime.tooltip = tooltip;
    return tooltip;
  }

  function positionTooltip() {
    const tooltip = runtime.tooltip;
    const anchor = runtime.tooltipAnchor;
    if (!tooltip?.classList.contains("show") || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = tooltip.offsetWidth || 230;
    const height = tooltip.offsetHeight || 54;
    const left = Math.max(8, Math.min(innerWidth - width - 8, rect.left));
    const above = rect.top - height - 8;
    const top = above >= 8 ? above : Math.min(innerHeight - height - 8, rect.bottom + 8);
    Object.assign(tooltip.style, { left: `${left}px`, top: `${Math.max(8, top)}px` });
  }

  function showTooltip(link) {
    const act = juniperAction(link);
    if (!act) return;
    const copy = JUNIPER_HELP[act];
    const tooltip = ensureTooltip();
    runtime.tooltipAnchor = link;
    tooltip.querySelector("b").textContent = copy.title;
    tooltip.querySelector("span").textContent = copy.body;
    tooltip.classList.add("show");
    requestAnimationFrame(positionTooltip);
  }

  function hideTooltip() {
    runtime.tooltip?.classList.remove("show");
    runtime.tooltipAnchor = null;
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > th,:scope > td")];
  }

  function extractMac(value) {
    const match = String(value || "").match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}|\b[0-9a-f]{12}\b/i);
    return match?.[0] || "";
  }

  function expectedMacCell() {
    for (const table of document.querySelectorAll("table")) {
      if (table.closest("#dp-panel")) continue;
      const rows = [...table.rows];
      for (let index = 0; index < rows.length; index += 1) {
        const headers = directCells(rows[index]).map((cell) => text(cell.innerText || cell.textContent));
        if (!headers.some((value) => /^olt$/i.test(value))) continue;
        const onuMacIndex = headers.findIndex((value) => /mac|мак/iu.test(value) && /onu|ont/i.test(value));
        const expectedIndex = headers.findIndex((value, cellIndex) => cellIndex !== onuMacIndex && /mac|мак/iu.test(value));
        if (expectedIndex < 0) continue;
        const dataRow = rows.slice(index + 1).find((row) => directCells(row).some((cell) => extractMac(cell.innerText || cell.textContent)));
        const cell = dataRow ? directCells(dataRow)[expectedIndex] : null;
        if (cell && extractMac(cell.innerText || cell.textContent)) return cell;
      }
    }
    return null;
  }

  function pollRoot() {
    const candidates = [];
    for (const node of document.querySelectorAll("pre,code,textarea,td,div")) {
      if (node.closest("#dp-panel")) continue;
      const raw = node instanceof HTMLTextAreaElement ? node.value : node.textContent || "";
      if (raw.length < 160) continue;
      const score = [
        /pon_port_by_onu/i,
        /display\s+(?:ont|onu)/i,
        /ONU\s+.+\s+is\s+-/i,
        /optical\s+power/i,
        /learned[-\s]?mac/i,
        /ONT online duration/i
      ].filter((regex) => regex.test(raw)).length;
      if (score >= 2) candidates.push({ node, raw, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.raw.length - b.raw.length);
    return candidates[0] || null;
  }

  function firstMatch(raw, patterns) {
    let best = null;
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (!match || match.index === undefined) continue;
      if (!best || match.index < best.index) best = match;
    }
    return best;
  }

  function nextCommandIndex(raw, from) {
    const pattern = /(?:^|[\r\n]+)\s*(?:display|show)\s+[^\r\n]*/ig;
    pattern.lastIndex = Math.max(0, from);
    const match = pattern.exec(raw);
    if (!match || match.index === undefined) return -1;
    const commandOffset = match[0].search(/(?:display|show)/i);
    return match.index + Math.max(0, commandOffset);
  }

  function commandBlock(raw, patterns) {
    const startMatch = firstMatch(raw, patterns);
    if (!startMatch || startMatch.index === undefined) return null;
    const start = startMatch.index;
    const next = nextCommandIndex(raw, start + startMatch[0].length);
    const end = next > start ? next : Math.min(raw.length, start + 1800);
    return { start, end };
  }

  function lineBlock(raw, patterns) {
    const match = firstMatch(raw, patterns);
    if (!match || match.index === undefined) return null;
    return { start: match.index, end: match.index + match[0].length };
  }

  function blockForKey(key, raw) {
    if (key === "learnedMac") {
      return commandBlock(raw, [
        /display\s+mac-address\s+port\b[^\r\n]*/i,
        /display\s+ont-learned-mac\b[^\r\n]*/i,
        /show\s+[^\r\n]{0,100}\bmac\b[^\r\n]*/i
      ]);
    }
    if (key === "clientPort") {
      return commandBlock(raw, [
        /display\s+ont\s+port\s+state\b[^\r\n]*/i,
        /show\s+[^\r\n]{0,100}(?:ethernet|eth|port)[^\r\n]{0,60}(?:state|status)?[^\r\n]*/i
      ]);
    }
    if (key === "optics") {
      return commandBlock(raw, [
        /display\s+ont\s+optical-info\b[^\r\n]*/i,
        /show\s+[^\r\n]{0,100}(?:optical|transceiver|rx\s+power)[^\r\n]*/i
      ]);
    }
    if (key === "uptime") {
      return lineBlock(raw, [
        /ONT\s+online\s+duration\s*:\s*[^\r\n]*/i,
        /Statistic\s+duration\s*:\s*[^\r\n]*/i,
        /(?:online\s+duration|uptime)\s*:\s*[^\r\n]*/i
      ]);
    }
    if (key === "lineState") {
      return lineBlock(raw, [
        /ONU\s+[^\r\n]{1,140}\s+is\s+-\s+(?:online|offline)/i,
        /Run\s+state\s*:\s*(?:online|offline)/i,
        /(?:ONU|ONT|OAM)[^\r\n]{0,100}\b(?:online|offline)\b/i
      ]);
    }
    return null;
  }

  function rangeFromOffsets(root, start, end) {
    if (!root || start < 0 || end <= start) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent && !parent.closest("#dp-panel,script,style,noscript")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    let offset = 0;
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    while ((node = walker.nextNode())) {
      const length = node.nodeValue?.length || 0;
      if (!startNode && start >= offset && start <= offset + length) {
        startNode = node;
        startOffset = Math.max(0, start - offset);
      }
      if (end >= offset && end <= offset + length) {
        endNode = node;
        endOffset = Math.max(0, end - offset);
        break;
      }
      offset += length;
    }
    if (!startNode) return null;
    if (!endNode) {
      endNode = startNode;
      endOffset = startNode.nodeValue?.length || 0;
    }
    const range = document.createRange();
    try {
      range.setStart(startNode, Math.min(startOffset, startNode.nodeValue?.length || 0));
      range.setEnd(endNode, Math.min(endOffset, endNode.nodeValue?.length || 0));
      return range;
    } catch (_) { return null; }
  }

  function ensureSpotlight() {
    if (runtime.spotlight?.frame?.isConnected) return runtime.spotlight;
    const masks = ["top", "left", "right", "bottom"].map((side) => {
      const node = document.createElement("div");
      node.className = "dp-source-dim";
      node.dataset.side = side;
      document.documentElement.appendChild(node);
      return node;
    });
    const frame = document.createElement("div");
    frame.id = "dp-source-spotlight-frame";
    document.documentElement.appendChild(frame);
    const card = document.createElement("div");
    card.id = "dp-source-spotlight-card";
    card.innerHTML = "<b></b><span></span><small>Esc — закрыть · повторный клик — снять фокус</small>";
    document.documentElement.appendChild(card);
    runtime.spotlight = { masks, frame, card };
    return runtime.spotlight;
  }

  function activeRect() {
    if (runtime.range) return runtime.range.getBoundingClientRect();
    if (runtime.element?.isConnected) return runtime.element.getBoundingClientRect();
    return null;
  }

  function positionSpotlight() {
    runtime.frame = 0;
    const ui = runtime.spotlight;
    const rect = activeRect();
    if (!ui || !rect || rect.width <= 0 || rect.height <= 0) return;
    const pad = 8;
    const left = Math.max(5, rect.left - pad);
    const top = Math.max(5, rect.top - pad);
    const right = Math.min(innerWidth - 5, rect.right + pad);
    const bottom = Math.min(innerHeight - 5, rect.bottom + pad);
    const width = Math.max(20, right - left);
    const height = Math.max(20, bottom - top);
    const bySide = Object.fromEntries(ui.masks.map((node) => [node.dataset.side, node]));
    Object.assign(bySide.top.style, { left: "0px", top: "0px", width: "100vw", height: `${top}px` });
    Object.assign(bySide.bottom.style, { left: "0px", top: `${bottom}px`, width: "100vw", height: `${Math.max(0, innerHeight - bottom)}px` });
    Object.assign(bySide.left.style, { left: "0px", top: `${top}px`, width: `${left}px`, height: `${height}px` });
    Object.assign(bySide.right.style, { left: `${right}px`, top: `${top}px`, width: `${Math.max(0, innerWidth - right)}px`, height: `${height}px` });
    Object.assign(ui.frame.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    ui.frame.classList.add("show");

    const cardWidth = ui.card.offsetWidth || Math.min(360, innerWidth - 20);
    const cardHeight = ui.card.offsetHeight || 70;
    const cardLeft = Math.max(8, Math.min(innerWidth - cardWidth - 8, left));
    const above = top - cardHeight - 10;
    const cardTop = above >= 8 ? above : Math.min(innerHeight - cardHeight - 8, bottom + 10);
    Object.assign(ui.card.style, { left: `${cardLeft}px`, top: `${Math.max(8, cardTop)}px` });
    ui.card.classList.add("show");
  }

  function scheduleSpotlight() {
    if (!runtime.frame) runtime.frame = requestAnimationFrame(positionSpotlight);
  }

  function unwrapLegacyMarks() {
    for (const mark of document.querySelectorAll("mark.dp-live-precise-mark,mark.dp-live-source-mark")) {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
      parent?.normalize?.();
    }
  }

  function clearSpotlight() {
    if (runtime.frame) cancelAnimationFrame(runtime.frame);
    runtime.frame = 0;
    runtime.range = null;
    runtime.element = null;
    runtime.spotlightKey = "";
    const ui = runtime.spotlight;
    ui?.frame.classList.remove("show");
    ui?.card.classList.remove("show");
    for (const mask of ui?.masks || []) Object.assign(mask.style, { width: "0px", height: "0px" });
    removeEventListener("scroll", scheduleSpotlight, true);
    removeEventListener("resize", scheduleSpotlight);
  }

  function dynamicCopy(key) {
    const base = SPOTLIGHT_COPY[key] || { title: "Источник", body: "Проверяемое значение в исходных данных." };
    const model = globalThis.__SIMNET_OPERATOR_LIVE_STATE__?.buildModel?.();
    const context = model?.context || {};
    const equipment = context.sources?.equipment?.data || {};
    const pon = context.sources?.pon?.data || {};
    let suffix = "";
    if (key === "learnedMac") {
      const expected = String(equipment.routerMac || pon.expectedRouterMac || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
      const learned = (pon.macs || []).map((value) => String(value).replace(/[^0-9a-f]/gi, "").toUpperCase());
      if (expected && learned.includes(expected)) suffix = " Совпадение подтверждено.";
      else if (expected && learned.length) suffix = " MAC не совпадает с ожидаемым — это тревога.";
    }
    return { title: base.title, body: `${base.body}${suffix}` };
  }

  function activateSpotlight(key, range = null, element = null) {
    if (runtime.spotlightKey === key && (runtime.range || runtime.element)) {
      clearSpotlight();
      return true;
    }
    globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("semantic-spotlight");
    unwrapLegacyMarks();
    clearSpotlight();
    const ui = ensureSpotlight();
    const copy = dynamicCopy(key);
    ui.card.querySelector("b").textContent = copy.title;
    ui.card.querySelector("span").textContent = copy.body;
    runtime.range = range;
    runtime.element = element;
    runtime.spotlightKey = key;
    addEventListener("scroll", scheduleSpotlight, true);
    addEventListener("resize", scheduleSpotlight);

    const rect = activeRect();
    if (element?.scrollIntoView) element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    else if (rect) {
      const targetTop = scrollY + rect.top - Math.min(150, innerHeight * .22);
      scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    }
    setTimeout(scheduleSpotlight, 40);
    setTimeout(scheduleSpotlight, 280);
    return true;
  }

  function spotlightForKey(key) {
    if (!SPOTLIGHT_KEYS.has(key) || !OLT_ACTIONS.has(currentAction())) return false;
    if (key === "routerMac") {
      const cell = expectedMacCell();
      return cell ? activateSpotlight(key, null, cell) : false;
    }
    const source = pollRoot();
    if (!source) return false;
    if (source.node instanceof HTMLTextAreaElement) {
      const block = blockForKey(key, source.raw);
      if (!block) return false;
      source.node.focus();
      source.node.setSelectionRange(block.start, block.end);
      return activateSpotlight(key, null, source.node);
    }
    const block = blockForKey(key, source.raw);
    if (!block) return false;
    const range = rangeFromOffsets(source.node, block.start, block.end);
    return range ? activateSpotlight(key, range, null) : false;
  }

  function selectedStepFocusKey() {
    const live = globalThis.__SIMNET_OPERATOR_LIVE_STATE__;
    const model = live?.buildModel?.();
    const active = document.querySelector("#dp-live-steps [data-live-step].active");
    const index = Number(active?.dataset.liveStep || 0);
    return model?.route?.steps?.[index]?.focusKey || "";
  }

  function panelClick(event) {
    const entity = event.target.closest?.("#dp-live-entities [data-live-entity]");
    const show = event.target.closest?.("#dp-live-show");
    const key = entity?.dataset.liveEntity || (show ? selectedStepFocusKey() : "");
    if (!SPOTLIGHT_KEYS.has(key) || !OLT_ACTIONS.has(currentAction())) return;
    const model = globalThis.__SIMNET_OPERATOR_LIVE_STATE__?.buildModel?.();
    const sourceAction = model?.entities?.[key]?.sourceAction;
    if (sourceAction && sourceAction !== currentAction()) return;
    if (!spotlightForKey(key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  installStyle();
  scanJuniperLinks();
  setTimeout(scanJuniperLinks, 500);
  setTimeout(scanJuniperLinks, 1500);

  document.addEventListener("pointerover", (event) => {
    const link = event.target.closest?.("a.dp-juniper-guided");
    if (link) showTooltip(link);
  }, true);
  document.addEventListener("pointerout", (event) => {
    const link = event.target.closest?.("a.dp-juniper-guided");
    if (link && !link.contains(event.relatedTarget)) hideTooltip();
  }, true);
  document.addEventListener("focusin", (event) => {
    const link = event.target.closest?.("a.dp-juniper-guided");
    if (link) showTooltip(link);
  }, true);
  document.addEventListener("focusout", (event) => {
    const link = event.target.closest?.("a.dp-juniper-guided");
    if (link) hideTooltip();
  }, true);
  document.addEventListener("click", panelClick, true);
  addEventListener("scroll", positionTooltip, true);
  addEventListener("resize", positionTooltip);
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    hideTooltip();
    clearSpotlight();
  }, true);

  globalThis.__SIMNET_OPERATOR_GUIDANCE__ = Object.freeze({
    scanJuniperLinks,
    spotlightForKey,
    clearSpotlight
  });
})();
