"use strict";
(() => {
  if (globalThis.__SIMNET_FLOATING_RAIL__ || window.top !== window.self) return;

  const HOST_ID = "simnet-workbench-rail-host";
  const STYLE_ID = "simnet-workbench-rail-bridge-style";
  const SIDE_KEY = "dp_floating_rail_side_v1";
  const HIDDEN_KEY = "dp_floating_rail_hidden_v1";
  const runtime = {
    host: null, root: null, observer: null, frame: 0,
    side: read(SIDE_KEY, "right") === "left" ? "left" : "right",
    hidden: read(HIDDEN_KEY, "0") === "1", flyout: "", panelOpen: false,
    counts: { activity: 0, results: 0, warnings: 0 },
    unread: { activity: 0, results: 0, warnings: 0 }, baseline: false, status: ""
  };

  const icons = {
    side: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
    activity: "M3 12h4l2.2-6 4.2 12L16 12h5",
    element: "M4 4h7v7H4zM13 13h7v7h-7zM14 4h6v6M4 14v6h6",
    area: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
    note: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
    results: "M5 5h14v14H5zM8 9h8M8 13h8M8 17h5",
    export: "M12 3v12M7 8l5-5 5 5M5 14v6h14v-6",
    clear: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5",
    settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4.9 6.3 7 7l1.2-1.2-.7-2.1M16.5 3.7l-.7 2.1L17 7l2.1-.7M19.1 17.7 17 17l-1.2 1.2.7 2.1M7.5 20.3l.7-2.1L7 17l-2.1.7",
    panel: "M4 5h16v14H4zM9 5v14M12 9h5M12 13h5",
    hide: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 9.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z",
    close: "M6 6l12 12M18 6 6 18"
  };
  const actions = [
    ["activity", "Фоновая активность", "activity", "activity"],
    ["element", "Захват DOM-элемента", "element", null, /маркер|элемент|блок|dom|picker/i],
    ["area", "Выделение области", "area", null, /област|рамк|регион|area|region/i],
    ["note", "Заметка", "note", null, /замет|комментар|note/i],
    ["results", "Новые результаты", "results", "results"],
    ["export", "Экспорт слепка", "export", null, /экспорт|выгруз|export|download/i],
    ["clear", "Очистить материал", "clear", null, /очист|сброс|clear|reset/i],
    ["settings", "Настройки", "settings", null, /настрой|параметр|settings/i],
    ["panel", "Полная панель", "panel"],
    ["hide", "Скрыть UI, оставить фон", "hide"]
  ].map(([id, label, icon, flyout, match]) => ({ id, label, icon, flyout, match }));

  function read(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; } }
  function write(key, value) { try { localStorage.setItem(key, String(value)); } catch (_) {} }
  function esc(value) { return String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
  function text(value, max = 180) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }
  function svg(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"/></svg>`; }

  function bridge() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.dp-workbench-dock-reserved,html.dp-workbench-dock-reserved body{width:auto!important;max-width:none!important;margin-right:0!important;padding-right:0!important;overflow-x:initial!important}
      #dp-panel[data-dp-rail="1"]{position:fixed!important;top:0!important;left:calc(100vw + 1000px)!important;right:auto!important;width:520px!important;min-width:520px!important;max-width:520px!important;height:100vh!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:none!important;z-index:2147483645!important}
      #dp-panel[data-dp-rail="1"][data-dp-rail-open="1"]{top:12px!important;right:64px!important;bottom:12px!important;left:auto!important;width:min(520px,calc(100vw - 88px))!important;min-width:min(360px,calc(100vw - 88px))!important;max-width:min(620px,calc(100vw - 88px))!important;height:calc(100vh - 24px)!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;border-radius:14px!important;box-shadow:0 22px 70px rgba(15,23,42,.4)!important}
      #dp-panel[data-dp-rail="1"][data-dp-rail-side="left"][data-dp-rail-open="1"]{right:auto!important;left:64px!important}
      #dp-panel[data-dp-rail="1"] #dp-panel-resize{display:none!important}`;
    (document.head || document.documentElement).appendChild(style);
  }
  function releaseDock() {
    const html = document.documentElement, body = document.body;
    html?.classList.remove("dp-workbench-dock-reserved");
    [html, body].forEach(node => ["width","max-width","padding-right","overflow-x","--dp-workbench-dock-space"].forEach(key => node?.style.removeProperty(key)));
  }
  function panel() {
    const node = document.querySelector("#dp-panel");
    if (!node) return null;
    if (node.dataset.dpRail !== "1") node.dataset.dpRail = "1";
    if (node.dataset.dpRailSide !== runtime.side) node.dataset.dpRailSide = runtime.side;
    const open = runtime.panelOpen ? "1" : "0";
    if (node.dataset.dpRailOpen !== open) node.dataset.dpRailOpen = open;
    return node;
  }
  function findLegacy(regex) {
    const root = panel();
    if (!root || !regex) return null;
    return [...root.querySelectorAll("button,a[href],[role=button],input[type=button],input[type=submit]")]
      .filter(node => !node.disabled)
      .map(node => ({ node, value: text([node.id,node.title,node.getAttribute("aria-label"),node.textContent,Object.values(node.dataset || {}).join(" ")].join(" "), 700) }))
      .filter(item => regex.test(item.value))
      .sort((a,b) => a.value.length - b.value.length)[0]?.node || null;
  }
  function trigger(action) {
    if (action.id === "activity" || action.id === "results") return toggleFlyout(action.id);
    if (action.id === "panel") return runtime.panelOpen ? closePanel() : openPanel();
    if (action.id === "hide") return hide();
    const target = findLegacy(action.match);
    if (!target) { toast(`«${action.label}» не найдена — открыта полная панель`, "warning"); return openPanel(); }
    if (action.id === "clear" && !confirm("Очистить текущий материал Workbench?")) return;
    try { target.click(); toast(action.label, "ok"); } catch (error) { toast(text(error?.message || error), "error"); }
  }

  function scan() {
    const root = panel();
    if (!root) return { activity: 0, results: 0, warnings: 0, status: "Workbench загружается" };
    const journal = root.querySelector("#dp-journal-list"), results = root.querySelector("#dp-results");
    return {
      activity: journal ? journal.querySelectorAll(":scope > *,li,.dp-journal-entry").length : root.querySelectorAll(".dp-log-entry,[data-dp-event]").length,
      results: results ? results.querySelectorAll(":scope > article,:scope > section,:scope > details,.dp-result,.dp-result-card").length : root.querySelectorAll(".dp-random-result,.dp-history-reasoning,.dp-neighbor-olt").length,
      warnings: root.querySelectorAll(".warning,.error,[data-severity=warning],[data-severity=error]").length,
      status: text(root.querySelector("#dp-status")?.textContent || "Workbench работает", 220)
    };
  }
  function refreshCounts(next) {
    ["activity","results","warnings"].forEach(key => {
      if (runtime.baseline && next[key] > runtime.counts[key] && runtime.flyout !== key) runtime.unread[key] = Math.min(99, runtime.unread[key] + next[key] - runtime.counts[key]);
      runtime.counts[key] = next[key];
    });
    runtime.status = next.status; runtime.baseline = true;
  }
  function tone() { const value = runtime.status.toLowerCase(); return /ошиб|error|не удалось/.test(value) ? "error" : /предуп|warning|останов/.test(value) ? "warning" : /готов|успеш|online|актив|работает/.test(value) ? "ok" : "info"; }

  function render() {
    const shell = runtime.root?.querySelector(".shell"); if (!shell) return;
    shell.dataset.side = runtime.side; shell.dataset.hidden = String(runtime.hidden);
    shell.querySelector(".dot").dataset.tone = tone();
    shell.querySelectorAll("[data-badge]").forEach(node => { const value = runtime.unread[node.dataset.badge] || 0; node.textContent = value > 99 ? "99+" : value; node.hidden = !value; });
    renderFlyout();
  }
  function renderFlyout() {
    const fly = runtime.root?.querySelector(".fly"); if (!fly) return;
    fly.hidden = !runtime.flyout; fly.dataset.side = runtime.side;
    if (!runtime.flyout) return;
    const results = runtime.flyout === "results";
    runtime.unread[runtime.flyout] = 0;
    fly.innerHTML = `<header><div><b>${results ? "Результаты" : "Фоновая активность"}</b><small>${results ? "Новые выводы Workbench" : "Сбор продолжается при скрытом UI"}</small></div><button data-close>${svg("close")}</button></header>
      ${results ? `<div class="summary"><strong>${runtime.counts.results}</strong><span><b>результатов</b><small>${runtime.counts.warnings} требуют внимания</small></span></div>` : `<div class="status ${tone()}"><i></i><span><b>${esc(runtime.status)}</b><small>Network, DOM и журнал работают в фоне</small></span></div><div class="metrics"><b>${runtime.counts.activity}<small>событий</small></b><b>${runtime.counts.results}<small>результатов</small></b><b>${runtime.counts.warnings}<small>warning</small></b></div>`}
      <button class="primary" data-open-panel>Открыть полную панель</button>`;
    fly.querySelector("[data-close]").onclick = closeFlyout;
    fly.querySelector("[data-open-panel]").onclick = openPanel;
  }
  function toggleFlyout(kind) { runtime.flyout = runtime.flyout === kind ? "" : kind; render(); }
  function closeFlyout() { runtime.flyout = ""; render(); }
  function openPanel() { runtime.panelOpen = true; runtime.hidden = false; panel(); closeFlyout(); render(); }
  function closePanel() { runtime.panelOpen = false; panel(); render(); }
  function toggleSide() { runtime.side = runtime.side === "right" ? "left" : "right"; write(SIDE_KEY, runtime.side); panel(); render(); toast(`Rail: ${runtime.side === "right" ? "справа" : "слева"}`); }
  function hide() { runtime.hidden = true; runtime.flyout = ""; runtime.panelOpen = false; write(HIDDEN_KEY, "1"); panel(); render(); toast("UI скрыт, фон продолжает работу"); }
  function show() { runtime.hidden = false; write(HIDDEN_KEY, "0"); render(); }
  function toast(message, type = "info") {
    const box = runtime.root?.querySelector(".toasts"); if (!box) return;
    const node = document.createElement("div"); node.className = `toast ${type}`; node.textContent = text(message, 240); box.appendChild(node);
    requestAnimationFrame(() => node.classList.add("on")); setTimeout(() => { node.classList.remove("on"); setTimeout(() => node.remove(), 160); }, 2800);
  }

  function markup() {
    const buttons = actions.map(action => `<button data-action="${action.id}" aria-label="${esc(action.label)}"><span>${svg(action.icon)}</span><em>${esc(action.label)}</em>${action.flyout ? `<i data-badge="${action.id}" hidden></i>` : ""}</button>`).join("");
    return `<div class="shell" data-side="${runtime.side}" data-hidden="${runtime.hidden}"><button class="wake">WB</button><aside><button class="head" data-side-toggle><span class="dot" data-tone="info"></span>${svg("side")}</button><nav>${buttons}</nav></aside><section class="fly" hidden></section><div class="toasts"></div></div>`;
  }
  function styles() { return `
    :host{all:initial}*,*:before,*:after{box-sizing:border-box}button{font:inherit}svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .shell{--w:50px;position:fixed;z-index:2147483647;top:50%;right:0;width:var(--w);height:min(570px,calc(100vh - 20px));transform:translateY(-50%) translateX(40px);transition:transform .18s ease;font:12px/1.35 "Segoe UI",Arial,sans-serif;pointer-events:none}.shell[data-side=left]{right:auto;left:0;transform:translateY(-50%) translateX(-40px)}.shell:hover,.shell:focus-within{transform:translateY(-50%)}
    aside{display:flex;flex-direction:column;width:50px;height:100%;overflow:visible;border:1px solid #3a4350;border-right:0;border-radius:15px 0 0 15px;background:rgba(20,26,35,.97);box-shadow:0 18px 48px #0006;backdrop-filter:blur(16px);pointer-events:auto}[data-side=left] aside{border-left:0;border-right:1px solid #3a4350;border-radius:0 15px 15px 0}.head,nav button{position:relative;display:grid;place-items:center;width:100%;min-height:46px;padding:0;border:0;color:#aeb7c4;background:transparent;cursor:pointer}.head{border-bottom:1px solid #ffffff1f;color:#fff}.head:hover,nav button:hover,nav button:focus-visible{color:#fff;background:#ffffff17}nav{display:flex;flex:1;flex-direction:column;overflow-y:auto;scrollbar-width:none}nav::-webkit-scrollbar{display:none}.dot{position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:#60a5fa;box-shadow:0 0 8px currentColor}.dot[data-tone=ok]{background:#34d399}.dot[data-tone=warning]{background:#fbbf24}.dot[data-tone=error]{background:#fb7185}
    nav em{position:absolute;right:calc(100% + 9px);top:50%;width:max-content;max-width:230px;padding:7px 9px;border:1px solid #526071;border-radius:8px;color:#f8fafc;background:#0f172af7;box-shadow:0 8px 24px #0006;font-style:normal;opacity:0;transform:translate(5px,-50%);transition:.12s;pointer-events:none;white-space:nowrap}[data-side=left] nav em{right:auto;left:calc(100% + 9px);transform:translate(-5px,-50%)}nav button:hover em,nav button:focus-visible em{opacity:1;transform:translate(0,-50%)}nav i{position:absolute;top:4px;right:3px;display:grid;place-items:center;min-width:17px;height:17px;padding:0 4px;border:2px solid #171d26;border-radius:99px;color:#fff;background:#ef4444;font:800 9px/1 Arial}
    .wake{display:none;width:50px;height:70px;border:1px solid #3a4350;border-right:0;border-radius:14px 0 0 14px;color:#fff;background:#171d26;font-weight:800;letter-spacing:.08em;pointer-events:auto;cursor:pointer}.shell[data-hidden=true]{height:70px}.shell[data-hidden=true] aside{display:none}.shell[data-hidden=true] .wake{display:block}
    .fly{position:absolute;top:10px;right:calc(100% + 10px);width:min(330px,calc(100vw - 82px));overflow:hidden;border:1px solid #526071;border-radius:14px;color:#e5e7eb;background:#171d26fa;box-shadow:0 22px 60px #0008;pointer-events:auto}[data-side=left] .fly{right:auto;left:calc(100% + 10px)}.fly[hidden]{display:none}.fly header{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid #ffffff1f}.fly header div,.status span,.summary span{display:grid;gap:2px}.fly header b,.status b,.summary b{color:#fff}.fly header small,.status small,.summary small{color:#94a3b8;font-size:10px}.fly header button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;color:#94a3b8;background:transparent;cursor:pointer}.fly header svg{width:17px}.status{display:grid;grid-template-columns:auto 1fr;gap:10px;margin:13px;padding:12px;border:1px solid #60a5fa55;border-radius:10px;background:#1e293b}.status i{width:9px;height:9px;margin-top:4px;border-radius:50%;background:#60a5fa}.status.ok{border-color:#34d39966}.status.ok i{background:#34d399}.status.warning{border-color:#fbbf2466}.status.warning i{background:#fbbf24}.status.error{border-color:#fb718566}.status.error i{background:#fb7185}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:0 13px 13px}.metrics b{display:grid;gap:2px;padding:9px 4px;border:1px solid #ffffff22;border-radius:9px;text-align:center;font-size:16px}.metrics small{color:#94a3b8;font-size:9px}.summary{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px;padding:16px}.summary strong{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;color:#fff;background:#2563eb;font-size:18px}.primary{width:calc(100% - 28px);min-height:36px;margin:0 14px 14px;border:1px solid #3b82f6;border-radius:9px;color:#fff;background:#2563eb;font-weight:700;cursor:pointer}
    .toasts{position:fixed;right:66px;bottom:18px;display:grid;gap:8px;width:min(340px,calc(100vw - 86px));pointer-events:none}[data-side=left] .toasts{right:auto;left:66px}.toast{padding:10px 12px;border:1px solid #526071;border-left:3px solid #60a5fa;border-radius:9px;color:#fff;background:#0f172af7;box-shadow:0 12px 34px #0006;opacity:0;transform:translateY(8px);transition:.16s}.toast.on{opacity:1;transform:none}.toast.ok{border-left-color:#34d399}.toast.warning{border-left-color:#fbbf24}.toast.error{border-left-color:#fb7185}@media(max-height:610px){.shell{height:calc(100vh - 10px)}.head,nav button{min-height:40px}}@media(prefers-reduced-motion:reduce){.shell,nav em,.toast{transition:none!important}}`; }

  function create() {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("div"); host.id = HOST_ID; host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style";
    const root = host.attachShadow({ mode: "closed" }); root.innerHTML = `<style>${styles()}</style>${markup()}`;
    document.documentElement.appendChild(host); runtime.host = host; runtime.root = root;
    root.querySelector("[data-side-toggle]").onclick = toggleSide; root.querySelector(".wake").onclick = show;
    root.querySelectorAll("[data-action]").forEach(button => button.onclick = () => trigger(actions.find(action => action.id === button.dataset.action)));
  }
  function schedule() { if (runtime.frame) return; runtime.frame = requestAnimationFrame(() => { runtime.frame = 0; releaseDock(); panel(); refreshCounts(scan()); render(); }); }
  function observe() {
    runtime.observer = new MutationObserver(mutations => { if (!mutations.every(m => m.target === runtime.host)) schedule(); });
    runtime.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class","hidden","data-state","data-severity"] });
    ["dp:operator-live-captured","dp:operator-context-change","dp:operation-mode-change","dp:workbench-changed"].forEach(name => document.addEventListener(name, schedule));
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("keydown", event => { if (event.key !== "Escape") return; if (runtime.flyout) closeFlyout(); else if (runtime.panelOpen) closePanel(); }, true);
  }
  function destroy() { runtime.observer?.disconnect(); if (runtime.frame) cancelAnimationFrame(runtime.frame); runtime.host?.remove(); document.getElementById(STYLE_ID)?.remove(); const node = document.querySelector("#dp-panel"); if (node) ["dpRail","dpRailOpen","dpRailSide"].forEach(key => delete node.dataset[key]); }
  function init() { bridge(); releaseDock(); create(); panel(); observe(); schedule(); [100,400,900,1800,3200].forEach(delay => setTimeout(schedule, delay)); document.dispatchEvent(new CustomEvent("dp:floating-rail-ready", { detail: { version: "1.0.0" } })); }

  globalThis.__SIMNET_FLOATING_RAIL__ = Object.freeze({ version: "1.0.0", refresh: schedule, showToast: toast, openPanel, closePanel, show, hide, destroy });
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init, { once: true }) : init();
})();
