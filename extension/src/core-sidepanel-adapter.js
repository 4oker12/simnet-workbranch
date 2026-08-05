"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__) return;

  const CORE_STATE = "SIMNET_WB_CORE_STATE";
  const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
  const HIGHLIGHT_ROOT_ID = "simnet-wb-highlight-overlay";
  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!core?.getState || !core?.subscribe) return;

  const EXACT_SELECTORS = Object.freeze({
    juniperNew: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div:nth-child(9) > a",
    juniperStatus: "#maindiv > table:nth-child(2) > tbody > tr > td:nth-child(2) > div.message > table > tbody > tr > td:nth-child(3) > ol > li:nth-child(4)",
    billingTechnical: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div.nav3 > a:nth-child(3)",
    billingOltField: "#maindiv > table.width100.pddng > tbody > tr > td:nth-child(2) > div > div > div > div > form > table > tbody > tr:nth-child(6) > td:nth-child(2) > div",
    pollerEpon: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div:nth-child(4) > a",
    pollerGpon: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div:nth-child(5) > a",
    pollerGcom: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div:nth-child(6) > a",
    pollerHuawei: "#maindiv > table:nth-child(6) > tbody > tr > td:nth-child(3) > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(2) > td:nth-child(3) > div:nth-child(1) > div:nth-child(7) > a"
  });

  function publish(state = core.getState()) {
    chrome.runtime.sendMessage({ type: CORE_STATE, state }).catch(() => {});
  }

  function safeQuery(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  function exactTarget(name) {
    const element = safeQuery(EXACT_SELECTORS[name]);
    return isVisible(element) ? element : null;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function smallestVisible(candidates) {
    return candidates.filter(isVisible).sort((left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return (a.width * a.height) - (b.width * b.height);
    })[0] || null;
  }

  function findByText(pattern) {
    const candidates = [];
    for (const element of document.querySelectorAll("a,button,[onclick],[role='button'],td,th,div,span,b,strong,label,li")) {
      if (!isVisible(element)) continue;
      const text = cleanText(element.textContent);
      if (!text || !pattern.test(text)) continue;
      candidates.push(element);
    }
    return smallestVisible(candidates);
  }

  function exactOrFallback(exactName, fallback) {
    return exactTarget(exactName) || fallback || null;
  }

  function fieldContainer(control) {
    return control?.closest("tr,.item,.table_block,fieldset,dl") || control?.parentElement || control;
  }

  function uniqueElements(items) {
    const seen = new Set();
    return items.filter(element => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function pollerTargets() {
    return uniqueElements([
      exactOrFallback("pollerEpon", findByText(/BDCOM\s+EPON/i)),
      exactOrFallback("pollerGpon", findByText(/BDCOM\s+GPON/i)),
      exactOrFallback("pollerGcom", findByText(/^GCOM(?:\s|\(|$)/i)),
      exactOrFallback("pollerHuawei", findByText(/HUAWEI\s+OLT/i))
    ]).filter(isVisible);
  }

  function pollerTarget(kind) {
    return ({
      "poller-epon": exactOrFallback("pollerEpon", findByText(/BDCOM\s+EPON/i)),
      "poller-gpon": exactOrFallback("pollerGpon", findByText(/BDCOM\s+GPON/i)),
      "poller-gcom": exactOrFallback("pollerGcom", findByText(/^GCOM(?:\s|\(|$)/i)),
      "poller-huawei": exactOrFallback("pollerHuawei", findByText(/HUAWEI\s+OLT/i))
    })[kind] || null;
  }

  function targetsFor(kind) {
    const context = core.getState()?.context || {};

    if (kind === "subscriber") {
      const login = cleanText(context.login);
      return uniqueElements([
        login ? findByText(new RegExp(`^${login}$`, "i")) : null,
        document.querySelector("a[href*='gotouser.php']"),
        document.querySelector("#customer-card-customer-id"),
        document.querySelector("#ref_adr")
      ]).filter(isVisible).slice(0, 3);
    }

    if (kind === "session") {
      return uniqueElements([
        exactOrFallback("juniperNew", findByText(/^Juniper\s*\(NEW\)$/i)),
        findByText(/^Juniper\s*2$/i),
        findByText(/^Juniper$/i),
        document.querySelector("#ref_ip_mac"),
        document.querySelector("iframe[src*='juniper' i]")
      ]).filter(isVisible).slice(0, 1);
    }

    if (kind === "session-status") {
      return [exactOrFallback(
        "juniperStatus",
        findByText(/\b(?:online|offline)\b/i)
      )].filter(isVisible);
    }

    if (kind === "billing-access") {
      const control = document.querySelector("select[name='state'],input[name='state']");
      return uniqueElements([fieldContainer(control), control, findByText(/^Доступ$/i)]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-block") {
      const control = document.querySelector("[name*='block' i],[id*='block' i]");
      return uniqueElements([fieldContainer(control), control, findByText(/Блокировк/i)]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-group") {
      const control = document.querySelector("select[name*='group' i],input[name*='group' i]");
      return uniqueElements([fieldContainer(control), control, findByText(/^Группа$/i)]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-tariff") {
      const control = document.querySelector("select[name*='tarif' i],select[name*='tariff' i],select[name='cstate'],input[name*='tarif' i]");
      return uniqueElements([fieldContainer(control), control, findByText(/Тариф|Состояние услуги/i)]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-start-day") {
      const control = document.querySelector("input[name='start_day'],select[name='start_day']");
      return uniqueElements([fieldContainer(control), control, findByText(/День начала потребления услуг/i)]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-technical") {
      return [exactOrFallback("billingTechnical", document.querySelector("a[href*='a=dopdata']") || findByText(/^Технические данные$/i))].filter(isVisible);
    }

    if (kind === "billing-olt-field") {
      const exact = exactTarget("billingOltField");
      if (exact) return [exact];
      const control = document.querySelector("select[name='dopfield_29'],input[name='dopfield_29']");
      return uniqueElements([fieldContainer(control), control, findByText(/^OLT$/i)]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-userside") {
      return uniqueElements([
        findByText(/^USERSIDE$/i),
        document.querySelector("a[href*='userside.simnet.kiev.ua']"),
        document.querySelector("a[href*='gotouser.php']")
      ]).filter(isVisible).slice(0, 2);
    }

    if (kind === "userside-tmc") {
      return uniqueElements([
        findByText(/^ТМЦ$/i),
        findByText(/Товарно.?материаль/i),
        findByText(/^Оборудование$/i),
        findByText(/Найдено\s+на\s+OLT/i)
      ]).filter(isVisible).slice(0, 3);
    }

    if (kind === "pollers-all") return pollerTargets();
    if (/^poller-(?:epon|gpon|gcom|huawei)$/.test(kind)) return [pollerTarget(kind)].filter(isVisible);
    return [];
  }

  function clearHighlight() {
    document.getElementById(HIGHLIGHT_ROOT_ID)?.remove();
  }

  function appendHighlightStyles(root) {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes simnetWbPulse {
        0%,100% { transform: scale(1); opacity: .96; box-shadow: 0 0 0 2px rgba(168,238,36,.28), 0 0 18px rgba(168,238,36,.42); }
        50% { transform: scale(1.025); opacity: 1; box-shadow: 0 0 0 7px rgba(168,238,36,.12), 0 0 34px rgba(168,238,36,.78); }
      }
      @keyframes simnetWbNoteIn {
        from { opacity: 0; transform: translate(-50%, 8px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    root.appendChild(style);
  }

  function createFrame(element, root, index) {
    const rect = element.getBoundingClientRect();
    const frame = document.createElement("div");
    frame.className = "simnet-wb-highlight-frame";
    Object.assign(frame.style, {
      position: "fixed",
      left: `${Math.max(3, rect.left - 6)}px`,
      top: `${Math.max(3, rect.top - 6)}px`,
      width: `${Math.max(14, rect.width + 12)}px`,
      height: `${Math.max(14, rect.height + 12)}px`,
      border: "3px solid #a8ee24",
      borderRadius: "10px",
      background: "rgba(168,238,36,.055)",
      transformOrigin: "center",
      animation: `simnetWbPulse 1.15s ease-in-out ${index * 0.12}s infinite`,
      zIndex: "2147483646",
      pointerEvents: "none",
      willChange: "transform,opacity,box-shadow"
    });
    frame.dataset.index = String(index);
    root.appendChild(frame);
  }

  function createBlockedOverlay(element, root) {
    const rect = element.getBoundingClientRect();
    const block = document.createElement("div");
    Object.assign(block.style, {
      position: "fixed",
      left: `${Math.max(1, rect.left)}px`,
      top: `${Math.max(1, rect.top)}px`,
      width: `${Math.max(12, rect.width)}px`,
      height: `${Math.max(12, rect.height)}px`,
      display: "grid",
      placeItems: "center",
      padding: "3px",
      color: "#d0d7e2",
      background: "rgba(4,8,13,.80)",
      border: "1px solid rgba(154,169,187,.55)",
      borderRadius: "6px",
      font: "700 9px Segoe UI,Arial,sans-serif",
      letterSpacing: ".02em",
      zIndex: "2147483647",
      pointerEvents: "none"
    });
    block.textContent = "Сначала определить OLT";
    root.appendChild(block);
  }

  function createNote(root, text) {
    if (!text) return;
    const note = document.createElement("div");
    Object.assign(note.style, {
      position: "fixed",
      left: "50%",
      bottom: "22px",
      maxWidth: "540px",
      transform: "translateX(-50%)",
      padding: "11px 15px",
      color: "#eef4fb",
      background: "rgba(16,25,39,.97)",
      border: "1px solid #57718f",
      borderRadius: "10px",
      boxShadow: "0 12px 38px rgba(0,0,0,.48)",
      font: "600 12px/1.4 Segoe UI,Arial,sans-serif",
      textAlign: "center",
      animation: "simnetWbNoteIn .22s ease-out both",
      zIndex: "2147483647",
      pointerEvents: "none"
    });
    note.textContent = text;
    root.appendChild(note);
  }

  function planFor(target) {
    const context = core.getState()?.context || {};
    if (target !== "line") return { focus: targetsFor(target), blocked: [], note: "" };

    if (context.system === "billing" && context.olt?.present) {
      const poller = context.olt.poller || "";
      return {
        focus: targetsFor(poller),
        blocked: [],
        note: poller
          ? `В Billing указана OLT «${context.olt.name}». Подсвечен соответствующий способ опроса.`
          : "OLT указана, но технология не распознана. Уточни тип подключения в технических данных."
      };
    }

    if (context.system === "userside") {
      return {
        focus: targetsFor("userside-tmc"),
        blocked: [],
        note: "Открой ТМЦ и найди блок «Найдено на OLT»: название, IP, порт и время обновления."
      };
    }

    const focus = context.kind === "billing_technical" ? targetsFor("billing-olt-field") : targetsFor("billing-technical");
    return {
      focus,
      blocked: pollerTargets(),
      note: "OLT в технических данных не указана. Опросы пока недоступны: сначала найди голову через UserSide ТМЦ."
    };
  }

  function highlight(target) {
    clearHighlight();
    const plan = planFor(target);
    const focus = uniqueElements(plan.focus || []).filter(isVisible);
    const blocked = uniqueElements(plan.blocked || []).filter(isVisible);
    if (!focus.length && !blocked.length) return { ok: false, count: 0 };

    const first = focus[0] || blocked[0];
    first?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

    window.setTimeout(() => {
      clearHighlight();
      const root = document.createElement("div");
      root.id = HIGHLIGHT_ROOT_ID;
      Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "2147483644", pointerEvents: "none" });
      appendHighlightStyles(root);

      const shade = document.createElement("div");
      Object.assign(shade.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(3,7,12,.50)",
        backdropFilter: "brightness(.76) saturate(.82)",
        pointerEvents: "none"
      });
      root.appendChild(shade);

      focus.filter(isVisible).forEach((element, index) => createFrame(element, root, index));
      blocked.filter(isVisible).forEach(element => createBlockedOverlay(element, root));
      createNote(root, plan.note);
      document.documentElement.appendChild(root);

      const clear = () => clearHighlight();
      window.setTimeout(clear, 6800);
      window.addEventListener("keydown", event => { if (event.key === "Escape") clear(); }, { once: true, capture: true });
      window.addEventListener("pointerdown", clear, { once: true, capture: true });
    }, 280);

    return { ok: true, count: focus.length + blocked.length };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== CORE_COMMAND) return false;
    try {
      if (message.action === "run") core.runDiagnostic();
      else if (message.action === "stop") core.stopDiagnostic();
      else if (message.action === "refresh") core.refresh();
      else if (message.action === "highlight") {
        sendResponse(highlight(message.target));
        return false;
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
    return false;
  });

  const unsubscribe = core.subscribe(publish);
  window.addEventListener("pagehide", unsubscribe, { once: true });
  publish();
  globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__ = {
    version: "0.4.3",
    publish,
    highlight,
    clearHighlight,
    exactSelectors: EXACT_SELECTORS
  };
})();
