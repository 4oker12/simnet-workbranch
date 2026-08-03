"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_LIVE_PRECISION__) return;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();

  async function waitFor(key, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (globalThis[key]) return globalThis[key];
      await sleep(25);
    }
    return null;
  }

  const store = await waitFor("__SIMNET_OPERATOR_CONTEXT_STORE__");
  const live = await waitFor("__SIMNET_OPERATOR_LIVE_STATE__");
  if (!store || !live) return;

  const OLT_ACTIONS = new Set(["310", "311", "312", "313"]);
  let activeMark = null;
  let observer = null;

  const action = () => store.currentAction();

  function normalizeMac(value) {
    const hex = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return hex.length === 12 ? hex : "";
  }

  function formatMac(value) {
    const hex = normalizeMac(value);
    return hex ? hex.match(/.{2}/g).join(":") : "";
  }

  function extractMac(value) {
    const match = String(value || "").match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}|\b[0-9a-f]{12}\b/i);
    return formatMac(match?.[0]);
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > th,:scope > td")];
  }

  function isMacHeader(value) {
    return /mac|мак|mаc/iu.test(text(value));
  }

  function parseRequestTable() {
    for (const table of document.querySelectorAll("table")) {
      if (table.closest("#dp-panel")) continue;
      const rows = [...table.rows];
      for (let index = 0; index < rows.length; index += 1) {
        const headers = directCells(rows[index]).map((cell) => text(cell.innerText || cell.textContent));
        if (!headers.some((value) => /^olt$/i.test(value))) continue;
        const onuMacIndex = headers.findIndex((value) => isMacHeader(value) && /onu|ont/i.test(value));
        const expectedMacIndex = headers.findIndex((value, cellIndex) => cellIndex !== onuMacIndex && isMacHeader(value));
        if (expectedMacIndex < 0) continue;
        const dataRow = rows.slice(index + 1).find((row) => directCells(row).some((cell) => extractMac(cell.innerText || cell.textContent)));
        if (!dataRow) continue;
        const cells = directCells(dataRow);
        const expectedCell = cells[expectedMacIndex] || null;
        const onuCell = onuMacIndex >= 0 ? cells[onuMacIndex] : null;
        const expectedMac = extractMac(expectedCell?.innerText || expectedCell?.textContent);
        if (!expectedMac) continue;
        return {
          table,
          row: dataRow,
          expectedCell,
          expectedMac,
          onuMac: extractMac(onuCell?.innerText || onuCell?.textContent)
        };
      }
    }
    return null;
  }

  function pollRoot() {
    const candidates = [];
    for (const node of document.querySelectorAll("pre,textarea,code,td,div")) {
      if (node.closest("#dp-panel")) continue;
      const value = node.tagName === "TEXTAREA" ? node.value : node.innerText || node.textContent;
      const raw = String(value || "");
      if (raw.length < 120) continue;
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

  function captureExpectedMac() {
    if (!OLT_ACTIONS.has(action())) return false;
    const request = parseRequestTable();
    if (!request) return false;
    const context = store.current();
    const current = context.sources?.equipment?.data || {};
    const next = {
      ...current,
      routerMac: request.expectedMac,
      routerMacSource: "olt-request-row"
    };
    if (request.onuMac) next.onuMac = request.onuMac;
    if (normalizeMac(current.routerMac) === normalizeMac(next.routerMac) && current.routerMacSource === next.routerMacSource) return true;
    store.writeSource("equipment", next, {
      action: action(),
      parser: "olt-request-context",
      confidence: "high",
      identity: store.resolveIdentity()
    });
    return true;
  }

  function reconcileMacState() {
    const context = store.current();
    const ponSource = context.sources?.pon;
    if (!ponSource) return false;
    const expectedMac = normalizeMac(context.sources?.equipment?.data?.routerMac);
    const macs = Array.isArray(ponSource.data?.macs) ? ponSource.data.macs.map(formatMac).filter(Boolean) : [];
    const learned = macs.map(normalizeMac).filter(Boolean);
    const matched = Boolean(expectedMac && learned.includes(expectedMac));
    const mismatch = Boolean(expectedMac && learned.length && !matched);
    const previous = ponSource.data?.report || {};
    if (Boolean(previous.routerMacMatched) === matched
      && Boolean(previous.routerMacMismatch) === mismatch
      && formatMac(ponSource.data?.expectedRouterMac) === formatMac(expectedMac)) return true;

    const deviations = (Array.isArray(previous.deviations) ? previous.deviations : [])
      .map(text)
      .filter((item) => !/не получен зарегистрированный MAC роутера|MAC роутера за ONU не изучен|Изученный MAC .* не соответствует ожидаемому/i.test(item));
    if (mismatch) deviations.unshift(`Изученный MAC (${macs.join(", ")}) не соответствует ожидаемому ${formatMac(expectedMac)}.`);
    if (expectedMac && !learned.length && ponSource.data?.status !== "offline") deviations.unshift("Ожидаемый MAC задан, но за ONU MAC не изучен.");

    let severity = text(previous.severity || "unknown");
    if (mismatch) severity = "conflict";
    else if (matched && !deviations.length && ponSource.data?.status === "online" && ponSource.data?.ethernet?.link === "up") severity = "ok";
    else if (expectedMac && !learned.length && !["error", "conflict"].includes(severity)) severity = "warn";

    const strong = ponSource.data?.status === "online"
      && ponSource.data?.ethernet?.link === "up"
      && matched
      && !deviations.some((item) => /слаб|крит|service-port|ethernet/i.test(item));

    store.writeSource("pon", {
      ...ponSource.data,
      expectedRouterMac: formatMac(expectedMac),
      report: {
        ...previous,
        severity,
        deviations,
        routerMacPresent: learned.length > 0,
        routerMacMatched: matched,
        routerMacMismatch: mismatch,
        strongCurrentChain: strong,
        summary: mismatch
          ? "ONU online, но за ONU изучен другой MAC."
          : strong
            ? "ONU online, Ethernet-порт поднят и ожидаемый MAC подтверждён."
            : text(previous.summary),
        conclusion: strong ? "Участок OLT → ONU → роутер подтверждён." : text(previous.conclusion)
      }
    }, {
      action: ponSource.action,
      parser: ponSource.parser,
      confidence: ponSource.confidence,
      identity: context.identity
    });
    return true;
  }

  function clearPreciseMark() {
    if (!activeMark?.isConnected) return;
    const parent = activeMark.parentNode;
    activeMark.replaceWith(document.createTextNode(activeMark.textContent || ""));
    parent?.normalize?.();
    activeMark = null;
  }

  function markRegex(root, regex, group = 0) {
    if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("#dp-panel,script,style,noscript")) continue;
      const value = String(node.nodeValue || "");
      const match = value.match(regex);
      if (!match || match.index === undefined) continue;
      const selected = match[group] || match[0];
      const offset = match[0].indexOf(selected);
      const start = match.index + Math.max(0, offset);
      globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("precise-value");
      clearPreciseMark();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + selected.length);
      const mark = document.createElement("mark");
      mark.className = "dp-live-precise-mark";
      try { range.surroundContents(mark); } catch (_) { return false; }
      activeMark = mark;
      mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      return true;
    }
    return false;
  }

  function macRegex(value) {
    const hex = normalizeMac(value);
    if (!hex) return null;
    const p = hex.match(/.{2}/g);
    return new RegExp(`${p[0]}[:.-]?${p[1]}[:.-]?${p[2]}[:.-]?${p[3]}[:.-]?${p[4]}[:.-]?${p[5]}`, "i");
  }

  function preciseHighlight(key) {
    const model = live.buildModel();
    const context = model.context || store.current();
    const pon = context.sources?.pon?.data || {};
    const equipment = context.sources?.equipment?.data || {};
    const request = parseRequestTable();
    const raw = pollRoot();

    if (key === "routerMac") {
      const regex = macRegex(equipment.routerMac || pon.expectedRouterMac);
      return Boolean(regex && markRegex(request?.expectedCell || document.body, regex));
    }
    if (key === "learnedMac") {
      const regex = macRegex(pon.macs?.[0]);
      return Boolean(regex && raw?.node && markRegex(raw.node, regex));
    }
    if (key === "clientPort") {
      return Boolean(raw?.node && (
        markRegex(raw.node, /display\s+ont\s+port\s+state[\s\S]{0,900}?\b(up|down)\b/i, 1)
        || markRegex(raw.node, /(?:ethernet|eth(?:ernet)?\s*port|linkstate|link\s+state)[^\n]{0,120}\b(up|down)\b/i, 1)
      ));
    }
    if (key === "lineState") {
      return Boolean(raw?.node && (
        markRegex(raw.node, /ONU\s+[^\n]+?\s+is\s+-\s+(online|offline)/i, 1)
        || markRegex(raw.node, /Run\s+state\s*:\s*(online|offline)/i, 1)
      ));
    }
    if (key === "uptime") {
      return Boolean(raw?.node && (
        markRegex(raw.node, /ONT\s+online\s+duration\s*:\s*([^\n]+)/i, 1)
        || markRegex(raw.node, /Statistic\s+duration\s*:\s*([^\n]+)/i, 1)
      ));
    }
    if (key === "optics") {
      return Boolean(raw?.node && markRegex(raw.node, /Rx\s+optical\s+power\s*\(dBm\)\s*:\s*(-?[\d.]+)/i, 1));
    }
    return false;
  }

  function selectedStepFocusKey() {
    const model = live.buildModel();
    const active = document.querySelector("#dp-live-steps [data-live-step].active");
    const index = Number(active?.dataset.liveStep || 0);
    return model.route?.steps?.[index]?.focusKey || "";
  }

  document.addEventListener("click", (event) => {
    const entity = event.target.closest?.("#dp-live-entities [data-live-entity]");
    const showButton = event.target.closest?.("#dp-live-show");
    const key = entity?.dataset.liveEntity || (showButton ? selectedStepFocusKey() : "");
    if (!key || !["routerMac", "learnedMac", "clientPort", "lineState", "uptime", "optics"].includes(key)) return;
    const model = live.buildModel();
    const sourceAction = model.entities?.[key]?.sourceAction;
    if (sourceAction && sourceAction !== action()) return;
    if (!preciseHighlight(key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("dp:page-focus-change", (event) => {
    if (!event.detail?.active || !OLT_ACTIONS.has(action())) return;
    const target = globalThis.__SIMNET_PAGE_FOCUS__?.currentElement?.();
    const request = parseRequestTable();
    if (target && request && (target === request.row || target === request.table || request.row.contains(target))) {
      globalThis.__SIMNET_PAGE_FOCUS__?.clear?.("avoid-whole-request-row");
    }
  });

  function refreshPrecision() {
    captureExpectedMac();
    reconcileMacState();
    live.render();
  }

  refreshPrecision();
  setTimeout(refreshPrecision, 400);
  setTimeout(refreshPrecision, 1400);

  if (OLT_ACTIONS.has(action())) {
    const startedAt = Date.now();
    let timer = 0;
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        return target && !target.closest("#dp-panel");
      });
      if (!relevant) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        refreshPrecision();
        if (Date.now() - startedAt > 45000) observer?.disconnect();
      }, 180);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer?.disconnect(), 46000);
  }

  addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearPreciseMark();
  }, true);

  const style = document.createElement("style");
  style.textContent = "mark.dp-live-precise-mark{padding:1px 3px!important;background:#fde047!important;color:#111827!important;border:2px solid #f59e0b!important;border-radius:3px!important;box-shadow:0 0 0 3px rgba(245,158,11,.2)!important}";
  (document.head || document.documentElement).appendChild(style);

  globalThis.__SIMNET_OPERATOR_LIVE_PRECISION__ = Object.freeze({ parseRequestTable, preciseHighlight, refreshPrecision });
})().catch((error) => console.error("[SIMNET live precision] startup failed", error));
