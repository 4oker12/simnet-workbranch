"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__) return;

  const CORE_STATE = "SIMNET_WB_CORE_STATE";
  const CORE_COMMAND = "SIMNET_WB_CORE_COMMAND";
  const HIGHLIGHT_ROOT_ID = "simnet-wb-highlight-overlay";
  const core = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!core?.getState || !core?.subscribe) return;

  function publish(state = core.getState()) {
    chrome.runtime.sendMessage({ type: CORE_STATE, state }).catch(() => {});
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function smallestVisible(candidates) {
    return candidates
      .filter(isVisible)
      .sort((left, right) => {
        const a = left.getBoundingClientRect();
        const b = right.getBoundingClientRect();
        return (a.width * a.height) - (b.width * b.height);
      })[0] || null;
  }

  function findByText(pattern) {
    const candidates = [];
    for (const element of document.querySelectorAll("a,button,[onclick],[role='button'],td,th,div,span,b,strong,label")) {
      if (!isVisible(element)) continue;
      const text = cleanText(element.textContent);
      if (!text || !pattern.test(text)) continue;
      candidates.push(element);
    }
    return smallestVisible(candidates);
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
      findByText(/BDCOM\s+EPON/i),
      findByText(/BDCOM\s+GPON/i),
      findByText(/^GCOM(?:\s|\(|$)/i),
      findByText(/HUAWEI\s+OLT/i)
    ]).filter(isVisible);
  }

  function pollerTarget(kind) {
    return ({
      "poller-epon": findByText(/BDCOM\s+EPON/i),
      "poller-gpon": findByText(/BDCOM\s+GPON/i),
      "poller-gcom": findByText(/^GCOM(?:\s|\(|$)/i),
      "poller-huawei": findByText(/HUAWEI\s+OLT/i)
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
        findByText(/^Juniper$/i),
        findByText(/^Juniper\s*\(NEW\)$/i),
        findByText(/^Juniper\s*2$/i),
        document.querySelector("#ref_ip_mac"),
        document.querySelector("iframe[src*='juniper' i]")
      ]).filter(isVisible).slice(0, 4);
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
      return uniqueElements([
        findByText(/^Технические данные$/i),
        document.querySelector("a[href*='a=dopdata']")
      ]).filter(isVisible).slice(0, 2);
    }

    if (kind === "billing-olt-field") {
      const control = document.querySelector("select[name='dopfield_29'],input[name='dopfield_29']");
      return uniqueElements([
        fieldContainer(control),
        control,
        findByText(/^OLT$/i)
      ]).filter(isVisible).slice(0, 2);
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

  function createFrame(element, root, index) {
    const rect = element.getBoundingClientRect();
    const frame = document.createElement("div");
    frame.className = "simnet-wb-highlight-frame";
    Object.assign(frame.style, {
      position: "fixed",
      left: `${Math.max(2, rect.left - 4)}px`,
      top: `${Math.max(2, rect.top - 4)}px`,
      width: `${Math.max(12, rect.width + 8)}px`,
      height: `${Math.max(12, rect.height + 8)}px`,
      border: "3px solid #a8ee24",
      borderRadius: "8px",
      boxShadow: "0 0 0 3px rgba(168,238,36,.22), 0 0 24px rgba(168,238,36,.45)",
      zIndex: "2147483646",
      pointerEvents: "none"
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
      background: "rgba(4,8,13,.78)",
      border: "1px solid rgba(154,169,187,.45)",
      borderRadius: "5px",
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
      maxWidth: "520px",
      transform: "translateX(-50%)",
      padding: "10px 14px",
      color: "#eef4fb",
      background: "#101927",
      border: "1px solid #40526a",
      borderRadius: "9px",
      boxShadow: "0 12px 38px rgba(0,0,0,.42)",
      font: "600 12px/1.4 Segoe UI,Arial,sans-serif",
      textAlign: "center",
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

    const focus = context.kind === "billing_technical"
      ? targetsFor("billing-olt-field")
      : targetsFor("billing-technical");
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
      Object.assign(root.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483644",
        pointerEvents: "none"
      });

      const shade = document.createElement("div");
      Object.assign(shade.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(3,7,12,.58)",
        backdropFilter: "brightness(.70)",
        pointerEvents: "none"
      });
      root.appendChild(shade);

      focus.filter(isVisible).forEach((element, index) => createFrame(element, root, index));
      blocked.filter(isVisible).forEach(element => createBlockedOverlay(element, root));
      createNote(root, plan.note);
      document.documentElement.appendChild(root);

      const clear = () => clearHighlight();
      window.setTimeout(clear, 6200);
      window.addEventListener("keydown", event => {
        if (event.key === "Escape") clear();
      }, { once: true, capture: true });
      window.addEventListener("pointerdown", clear, { once: true, capture: true });
    }, 260);

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
  globalThis.__SIMNET_CORE_SIDE_PANEL_ADAPTER__ = { version: "0.4.1", publish, highlight, clearHighlight };
})();
