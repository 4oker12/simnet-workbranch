"use strict";

(() => {
  if (globalThis.__SIMNET_PAGE_FOCUS__) return;

  const STYLE_ID = "dp-page-focus-style";
  const OVERLAY_ID = "dp-page-focus-overlay";
  const runtime = {
    target: null,
    overlay: null,
    frame: 0,
    options: null
  };

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position:absolute !important;
        z-index:2147483644 !important;
        display:none !important;
        pointer-events:none !important;
        border:3px solid #2563eb !important;
        border-radius:8px !important;
        background:rgba(37,99,235,.055) !important;
        box-shadow:0 0 0 4px rgba(255,255,255,.92),0 8px 28px rgba(15,23,42,.24) !important;
        transition:left .14s ease,top .14s ease,width .14s ease,height .14s ease !important;
      }
      #${OVERLAY_ID}.show { display:block !important; }
      #${OVERLAY_ID}[data-tone="ok"] { border-color:#16a34a !important; background:rgba(22,163,74,.06) !important; }
      #${OVERLAY_ID}[data-tone="warning"] { border-color:#d97706 !important; background:rgba(217,119,6,.07) !important; }
      #${OVERLAY_ID}[data-tone="error"] { border-color:#dc2626 !important; background:rgba(220,38,38,.06) !important; }
      #${OVERLAY_ID} > span {
        position:absolute !important;
        left:7px !important;
        top:7px !important;
        max-width:min(360px,72vw) !important;
        padding:4px 8px !important;
        overflow:hidden !important;
        color:#fff !important;
        background:rgba(15,23,42,.94) !important;
        border-radius:999px !important;
        font:750 10px/1.3 Inter,"Segoe UI",Arial,sans-serif !important;
        text-overflow:ellipsis !important;
        white-space:nowrap !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureOverlay() {
    installStyles();
    if (runtime.overlay?.isConnected) return runtime.overlay;
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = "<span></span>";
    document.documentElement.appendChild(overlay);
    runtime.overlay = overlay;
    return overlay;
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function updatePosition() {
    runtime.frame = 0;
    const target = runtime.target;
    const overlay = runtime.overlay;
    if (!overlay || !isVisible(target)) {
      overlay?.classList.remove("show");
      if (target && !target.isConnected) clear("target-removed");
      return;
    }
    const rect = target.getBoundingClientRect();
    const padding = Number(runtime.options?.padding ?? 5);
    Object.assign(overlay.style, {
      left: `${Math.max(2, rect.left + scrollX - padding)}px`,
      top: `${Math.max(2, rect.top + scrollY - padding)}px`,
      width: `${Math.max(20, rect.width + padding * 2)}px`,
      height: `${Math.max(20, rect.height + padding * 2)}px`
    });
    overlay.classList.add("show");
  }

  function schedulePosition() {
    if (!runtime.frame) runtime.frame = requestAnimationFrame(updatePosition);
  }

  function show(element, options = {}) {
    if (!isVisible(element)) return false;
    const overlay = ensureOverlay();
    runtime.target = element;
    runtime.options = {
      label: String(options.label || "Проверяемый блок"),
      tone: String(options.tone || "info"),
      padding: Number(options.padding ?? 5)
    };
    overlay.dataset.tone = runtime.options.tone;
    overlay.querySelector("span").textContent = runtime.options.label;
    if (options.scroll !== false) {
      element.scrollIntoView({ behavior: options.behavior || "smooth", block: "center", inline: "nearest" });
      setTimeout(schedulePosition, 220);
    } else {
      schedulePosition();
    }
    document.dispatchEvent(new CustomEvent("dp:page-focus-change", { detail: { active: true } }));
    return true;
  }

  function clear(reason = "manual") {
    if (runtime.frame) cancelAnimationFrame(runtime.frame);
    runtime.frame = 0;
    runtime.target = null;
    runtime.options = null;
    runtime.overlay?.classList.remove("show");
    document.dispatchEvent(new CustomEvent("dp:page-focus-change", { detail: { active: false, reason } }));
  }

  function isActive() {
    return Boolean(runtime.target && runtime.overlay?.classList.contains("show"));
  }

  function currentElement() {
    return runtime.target;
  }

  addEventListener("scroll", schedulePosition, true);
  addEventListener("resize", schedulePosition);
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isActive()) clear("escape");
  }, true);

  globalThis.__SIMNET_PAGE_FOCUS__ = Object.freeze({
    show,
    clear,
    isActive,
    currentElement,
    schedulePosition
  });
})();
