"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_TECH_GUIDE_V2__) return;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const runtime = { root: null, expanded: false, target: null, dims: [], frame: null, card: null, raf: 0 };
  let observer = null;

  const HELP = Object.freeze({
    technology: ["Технология", "Выбирает ветку диагностики.", "Сначала сверь её с фактическим типом подключения."],
    olt: ["OLT", "Определяет устройство и вкладку опроса.", "Сверь Billing с UserSide или фактическим live-опросом."],
    onu: ["ONU / ONT", "Идентификатор терминала.", "Для GPON обычно нужен Serial, для EPON — MAC ONU."],
    mac: ["MAC абонента", "Ожидаемый MAC оборудования за ONU.", "Сравни его с MAC, который фактически изучила OLT."]
  });

  function isTechPage() {
    try {
      const url = new URL(location.href);
      return url.searchParams.get("a") === "dopdata" && url.searchParams.get("tmpl") === "1";
    } catch (_) {
      return Boolean(document.querySelector('input[name="a"][value="dopdata"]')
        && document.querySelector('input[name="tmpl"][value="1"]'));
    }
  }

  function isNavigator() {
    const panel = document.querySelector("#dp-panel");
    return panel?.dataset.operationMode === "navigator"
      || Boolean(panel?.querySelector('[data-dp-operation-mode-v2="navigator"].active'));
  }

  function valueOf(control) {
    if (!control) return "";
    return text(control.tagName === "SELECT"
      ? control.selectedOptions?.[0]?.textContent || control.value
      : control.value || control.textContent);
  }

  function visibleTarget(control) {
    if (!control) return null;
    if (control.matches?.("select.selectized")) {
      const row = control.closest("tr");
      return row || control.nextElementSibling || control;
    }
    return control.closest?.("tr") || control;
  }

  function fields() {
    const technology = document.querySelector('[name="dopfield_39"]');
    const olt = document.querySelector('[name="dopfield_29"]');
    const serial = document.querySelector('[name="dopfield_38"]');
    const onuMac = document.querySelector('[name="dopfield_19"]');
    const mac = document.querySelector('[name="dopfield_4"]');
    const combined = `${valueOf(technology)} ${valueOf(olt)}`;
    const onu = /gpon|huawei/i.test(combined) ? serial
      : /epon/i.test(combined) ? onuMac
        : valueOf(serial) ? serial : onuMac;
    return {
      technology: { control: technology, target: visibleTarget(technology), value: valueOf(technology) },
      olt: { control: olt, target: visibleTarget(olt), value: valueOf(olt) },
      onu: { control: onu, target: visibleTarget(onu), value: valueOf(onu), kind: onu === serial ? "Serial" : "MAC ONU" },
      mac: { control: mac, target: visibleTarget(mac), value: valueOf(mac) }
    };
  }

  function currentPp() {
    try { return new URL(location.href).searchParams.get("pp") || document.querySelector('input[name="pp"]')?.value || ""; }
    catch (_) { return ""; }
  }

  function currentId() {
    try { return new URL(location.href).searchParams.get("id") || document.querySelector('input[name="id"]')?.value || ""; }
    catch (_) { return ""; }
  }

  function pollUrl(data) {
    const combined = `${data.technology.value} ${data.olt.value}`;
    const action = /huawei/i.test(combined) ? "313"
      : /gcom/i.test(combined) ? "312"
        : /gpon/i.test(combined) ? "311"
          : /epon/i.test(combined) ? "310" : "";
    if (!action) return "";
    const url = new URL("/cgi-bin/adm/stat.pl", location.origin);
    const pp = currentPp();
    const id = currentId();
    if (pp) url.searchParams.set("pp", pp);
    if (id) url.searchParams.set("id", id);
    url.searchParams.set("a", action);
    return url.toString();
  }

  function installStyle() {
    if (document.getElementById("dp-tech-guide-v2-style")) return;
    const style = document.createElement("style");
    style.id = "dp-tech-guide-v2-style";
    style.textContent = `
      #dp-tech-guide-v2{display:grid!important;gap:7px!important;margin:0 16px 10px!important;padding:10px 11px!important;border:1px solid #dbe3ec!important;border-radius:9px!important;background:#fff!important}
      #dp-tech-guide-v2[hidden]{display:none!important}
      #dp-tech-guide-v2>header{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important}
      #dp-tech-guide-v2>header>div{display:grid!important;gap:2px!important;min-width:0!important}
      #dp-tech-guide-v2>header b{font-size:11.5px!important;color:#1a2332!important}
      #dp-tech-guide-v2>header span{font-size:9.5px!important;color:#8892a0!important}
      #dp-tech-guide-v2-toggle{padding:6px 9px!important;border:1px solid #cdd9e8!important;border-radius:7px!important;background:#f4f7fb!important;color:#2f6feb!important;font-size:10.5px!important;font-weight:700!important}
      #dp-tech-guide-v2-body{display:grid!important;gap:6px!important}
      #dp-tech-guide-v2-body[hidden]{display:none!important}
      #dp-tech-guide-v2-fields{display:grid!important;grid-template-columns:1fr 1fr!important;gap:6px!important}
      .dp-tech-v2-field{display:grid!important;grid-template-columns:18px minmax(0,1fr)!important;gap:6px!important;align-items:center!important;min-height:42px!important;padding:7px 8px!important;border:1px solid #e2e6ec!important;border-radius:8px!important;background:#fff!important;text-align:left!important}
      .dp-tech-v2-field>i{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;border-radius:50%!important;background:#eaf2ff!important;color:#2f6feb!important;font-size:9px!important;font-style:normal!important;font-weight:800!important}
      .dp-tech-v2-field>span{display:grid!important;gap:1px!important;min-width:0!important}
      .dp-tech-v2-field b{font-size:9.5px!important;color:#435063!important}
      .dp-tech-v2-field small{overflow:hidden!important;font-size:8.5px!important;color:#8892a0!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      .dp-tech-v2-field.missing{border-color:#f4cc7b!important;background:#fffbeb!important}
      #dp-tech-guide-v2-links{display:flex!important;gap:6px!important}
      #dp-tech-guide-v2-links a{padding:6px 8px!important;border:1px solid #dde3ea!important;border-radius:7px!important;background:#f4f6f9!important;color:#5b6472!important;font-size:9.5px!important;font-weight:700!important;text-decoration:none!important}
      #dp-tech-guide-v2-links a[aria-disabled="true"]{opacity:.45!important;pointer-events:none!important}
      .dp-tech-v2-dim{position:fixed!important;z-index:2147483600!important;background:rgba(2,6,23,.72)!important;pointer-events:none!important}
      #dp-tech-v2-frame{position:fixed!important;z-index:2147483602!important;border:4px solid #84cc16!important;border-radius:10px!important;box-shadow:0 0 0 2px rgba(255,255,255,.92),0 0 28px rgba(132,204,22,.44)!important;pointer-events:none!important}
      #dp-tech-v2-card{position:fixed!important;z-index:2147483604!important;display:grid!important;gap:3px!important;width:min(330px,calc(100vw - 24px))!important;padding:9px 11px!important;border:1px solid rgba(132,204,22,.8)!important;border-radius:9px!important;background:rgba(15,23,42,.98)!important;color:#e2e8f0!important;box-shadow:0 12px 34px rgba(0,0,0,.42)!important;font:500 10.5px/1.35 "Segoe UI",Arial,sans-serif!important;pointer-events:none!important}
      #dp-tech-v2-card b{color:#bef264!important;font-size:11.5px!important}
      #dp-tech-v2-card em{color:#fef08a!important;font-style:normal!important;font-weight:700!important}
      #dp-tech-v2-card small{color:#94a3b8!important;font-size:8.5px!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearFocus() {
    if (runtime.raf) cancelAnimationFrame(runtime.raf);
    runtime.raf = 0;
    runtime.target = null;
    runtime.dims.forEach((node) => node.remove());
    runtime.dims = [];
    runtime.frame?.remove();
    runtime.card?.remove();
    runtime.frame = null;
    runtime.card = null;
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function updateFocus() {
    runtime.raf = 0;
    if (!isVisible(runtime.target)) return clearFocus();
    const rect = runtime.target.getBoundingClientRect();
    const pad = 7;
    const left = Math.max(0, rect.left - pad);
    const top = Math.max(0, rect.top - pad);
    const right = Math.min(innerWidth, rect.right + pad);
    const bottom = Math.min(innerHeight, rect.bottom + pad);
    const [topDim, leftDim, rightDim, bottomDim] = runtime.dims;
    Object.assign(topDim.style, { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${top}px` });
    Object.assign(leftDim.style, { left: "0px", top: `${top}px`, width: `${left}px`, height: `${bottom - top}px` });
    Object.assign(rightDim.style, { left: `${right}px`, top: `${top}px`, width: `${Math.max(0, innerWidth - right)}px`, height: `${bottom - top}px` });
    Object.assign(bottomDim.style, { left: "0px", top: `${bottom}px`, width: `${innerWidth}px`, height: `${Math.max(0, innerHeight - bottom)}px` });
    Object.assign(runtime.frame.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(20, right - left)}px`, height: `${Math.max(20, bottom - top)}px` });
    const cardWidth = runtime.card.offsetWidth || 330;
    const cardHeight = runtime.card.offsetHeight || 90;
    const panelRect = document.querySelector("#dp-panel")?.getBoundingClientRect();
    const maxRight = panelRect && panelRect.left > innerWidth / 2 ? panelRect.left - 10 : innerWidth - 10;
    const cardLeft = Math.max(10, Math.min(maxRight - cardWidth, left));
    const cardTop = bottom + cardHeight + 10 < innerHeight ? bottom + 10 : Math.max(10, top - cardHeight - 10);
    Object.assign(runtime.card.style, { left: `${cardLeft}px`, top: `${cardTop}px` });
  }

  function focusField(key) {
    const data = fields()[key];
    const copy = HELP[key];
    if (!data?.target || !copy || !isVisible(data.target)) return false;
    clearFocus();
    runtime.target = data.target;
    runtime.dims = Array.from({ length: 4 }, () => {
      const node = document.createElement("div");
      node.className = "dp-tech-v2-dim";
      document.documentElement.appendChild(node);
      return node;
    });
    runtime.frame = document.createElement("div");
    runtime.frame.id = "dp-tech-v2-frame";
    document.documentElement.appendChild(runtime.frame);
    runtime.card = document.createElement("div");
    runtime.card.id = "dp-tech-v2-card";
    runtime.card.innerHTML = "<b></b><span></span><em></em><small>Esc — закрыть</small>";
    runtime.card.querySelector("b").textContent = copy[0];
    runtime.card.querySelector("span").textContent = copy[1];
    runtime.card.querySelector("em").textContent = copy[2];
    document.documentElement.appendChild(runtime.card);
    data.target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(() => { runtime.raf = requestAnimationFrame(updateFocus); }, 220);
    return true;
  }

  function short(value, max = 25) {
    const current = text(value);
    if (!current) return "не заполнено";
    return current.length > max ? `${current.slice(0, max - 1)}…` : current;
  }

  function render() {
    if (!runtime.root?.isConnected) return;
    const data = fields();
    const order = [["technology", "1"], ["olt", "2"], ["onu", "3"], ["mac", "4"]];
    runtime.root.querySelector("#dp-tech-guide-v2-fields").innerHTML = order.map(([key, number]) => {
      const info = data[key];
      const label = HELP[key][0];
      const value = key === "onu" && info?.kind ? `${info.kind}: ${short(info.value, 19)}` : short(info?.value);
      return `<button type="button" class="dp-tech-v2-field ${info?.value ? "" : "missing"}" data-tech-v2="${key}"><i>${number}</i><span><b>${label}</b><small>${value}</small></span></button>`;
    }).join("");
    const poll = runtime.root.querySelector("#dp-tech-guide-v2-poll");
    const url = pollUrl(data);
    poll.href = url || "#";
    poll.setAttribute("aria-disabled", url ? "false" : "true");
    const history = runtime.root.querySelector("#dp-tech-guide-v2-history");
    const historyLink = document.querySelector('a[href*="a=dopdata"][href*="act=revisions"]');
    history.href = historyLink?.href || "#";
    history.setAttribute("aria-disabled", historyLink?.href ? "false" : "true");
  }

  function mount() {
    if (!isTechPage()) return false;
    const panel = document.querySelector("#dp-panel");
    if (!panel) return false;
    panel.querySelector("#dp-tech-guide")?.setAttribute("hidden", "");
    if (!runtime.root?.isConnected) {
      const root = document.createElement("section");
      root.id = "dp-tech-guide-v2";
      root.innerHTML = `
        <header><div><b>Техданные</b><span>Технология → OLT → ONU/ONT → MAC</span></div><button type="button" id="dp-tech-guide-v2-toggle">Показать</button></header>
        <div id="dp-tech-guide-v2-body" hidden>
          <div id="dp-tech-guide-v2-fields"></div>
          <div id="dp-tech-guide-v2-links"><a id="dp-tech-guide-v2-poll" href="#">Опрос ONU</a><a id="dp-tech-guide-v2-history" href="#">История</a></div>
        </div>`;
      const workspace = panel.querySelector("#dp-operator-workspace");
      const scenarios = workspace?.querySelector("#dp-operator-scenarios-live");
      if (scenarios) scenarios.insertAdjacentElement("afterend", root);
      else (workspace || panel).prepend(root);
      runtime.root = root;
      root.querySelector("#dp-tech-guide-v2-toggle").addEventListener("click", () => {
        runtime.expanded = !runtime.expanded;
        root.querySelector("#dp-tech-guide-v2-body").hidden = !runtime.expanded;
        root.querySelector("#dp-tech-guide-v2-toggle").textContent = runtime.expanded ? "Скрыть" : "Показать";
        if (!runtime.expanded) clearFocus();
        render();
      });
      root.querySelector("#dp-tech-guide-v2-fields").addEventListener("click", (event) => {
        const button = event.target.closest("[data-tech-v2]");
        if (button) focusField(button.dataset.techV2);
      });
    }
    runtime.root.hidden = !isNavigator();
    render();
    return true;
  }

  function scheduleFocus() {
    if (!runtime.raf) runtime.raf = requestAnimationFrame(updateFocus);
  }

  installStyle();
  mount();
  [250, 700, 1400, 2800, 5000, 9000, 15000, 25000].forEach((delay) => window.setTimeout(mount, delay));
  document.addEventListener("dp:operation-mode-change", () => window.setTimeout(mount, 0));
  document.addEventListener("change", (event) => {
    if (event.target?.matches?.('[name="dopfield_4"],[name="dopfield_19"],[name="dopfield_29"],[name="dopfield_38"],[name="dopfield_39"]')) {
      window.setTimeout(render, 0);
    }
  }, true);
  addEventListener("scroll", scheduleFocus, true);
  addEventListener("resize", scheduleFocus);
  addEventListener("keydown", (event) => { if (event.key === "Escape") clearFocus(); }, true);

  const startedAt = Date.now();
  observer = new MutationObserver(() => {
    mount();
    if (Date.now() - startedAt > 30000) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer?.disconnect(), 30500);

  globalThis.__SIMNET_OPERATOR_TECH_GUIDE_V2__ = Object.freeze({ mount, render, focusField, clear: clearFocus });
})();
