"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_BASIC_DIAGNOSTIC_ROUTE__) return;

  const VERSION = "0.1.0";
  const MODE_KEY = "dp_workbench_operation_mode_v1";
  const STORAGE_KEY = "simnet_wb_basic_diagnostic_route_v1";
  const OVERLAY_ID = "simnet-wb-basic-route-overlay";
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  const gm = compat?.api || {};
  const runtime = {
    mode: readMode(),
    forced: false,
    state: null,
    target: null,
    stage: "",
    observer: null,
    raf: 0,
    clickHandler: null,
    disposed: false
  };

  const cleanText = (value, max = 1000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  function readMode() {
    try { return String(gm.GM_getValue?.(MODE_KEY, "diagnostic") || "diagnostic"); }
    catch (_) { return "diagnostic"; }
  }

  function enabled() {
    return runtime.forced || runtime.mode === "mentor";
  }

  function currentPage() {
    const url = new URL(location.href);
    const action = url.searchParams.get("a") || "";
    const billingId = url.searchParams.get("id") || "";
    const host = location.hostname.toLowerCase();
    const isBilling = host === "admin.simnet.kiev.ua" || host === "admin.looknet.kiev.ua";
    let kind = "other";
    if (isBilling && action === "user") kind = "billing-user";
    else if (isBilling && action === "252") kind = "billing-juniper";
    else if (isBilling && action === "dopdata") kind = "billing-technical";
    else if (isBilling && ["310", "311", "312", "313"].includes(action)) kind = "billing-poller";
    return { url, action, billingId, host, isBilling, kind };
  }

  function contractFromPage() {
    return (cleanText(document.body?.textContent, 160000).match(/\babon\d{3,14}\b/i) || [""])[0].toLowerCase();
  }

  function subscriberKey(page = currentPage()) {
    const id = page.billingId || contractFromPage();
    return id ? `${page.host}|${id}` : "";
  }

  async function storageGet(defaultValue) {
    try {
      const result = await chrome.storage.session.get({ [STORAGE_KEY]: defaultValue });
      return result?.[STORAGE_KEY] || defaultValue;
    } catch (_) {
      try {
        const result = await chrome.storage.local.get({ [STORAGE_KEY]: defaultValue });
        return result?.[STORAGE_KEY] || defaultValue;
      } catch (_) {
        return defaultValue;
      }
    }
  }

  async function storageSet(value) {
    try { await chrome.storage.session.set({ [STORAGE_KEY]: value }); return; }
    catch (_) {}
    try { await chrome.storage.local.set({ [STORAGE_KEY]: value }); } catch (_) {}
  }

  function blankState(key, page) {
    return {
      version: 1,
      key,
      host: page.host,
      billingId: page.billingId,
      contract: contractFromPage(),
      sessionReviewed: false,
      sessionStatus: "unknown",
      sessionSummary: "",
      technicalReviewed: false,
      olt: { present: false, name: "", technology: "", poller: "", pollerAction: "" },
      pollerOpened: false,
      askStarted: false,
      resultReviewed: false,
      completed: false,
      updatedAt: Date.now()
    };
  }

  async function loadState() {
    const page = currentPage();
    const key = subscriberKey(page);
    if (!page.isBilling || !key) return null;
    const all = await storageGet({});
    const saved = all[key];
    runtime.state = saved && saved.version === 1 ? saved : blankState(key, page);
    runtime.state.billingId ||= page.billingId;
    runtime.state.contract ||= contractFromPage();
    return runtime.state;
  }

  async function patchState(patch) {
    if (!runtime.state) return;
    runtime.state = {
      ...runtime.state,
      ...patch,
      olt: patch.olt ? { ...(runtime.state.olt || {}), ...patch.olt } : runtime.state.olt,
      updatedAt: Date.now()
    };
    const all = await storageGet({});
    all[runtime.state.key] = runtime.state;
    await storageSet(all);
  }

  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 6 && rect.height > 6 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function queryVisible(selector) {
    try { return [...document.querySelectorAll(selector)].find(visible) || null; }
    catch (_) { return null; }
  }

  function smallestByText(pattern, selector = "td,div,section,article,li") {
    return [...document.querySelectorAll(selector)]
      .filter(element => visible(element) && pattern.test(cleanText(element.textContent, 4000)))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0] || null;
  }

  function fieldRow(name) {
    const control = document.querySelector(`[name="${name}"]`);
    return control?.closest("tr") || control?.parentElement || null;
  }

  function selectedText(control) {
    if (!control) return "";
    if (control.tagName === "SELECT") return cleanText(control.options?.[control.selectedIndex]?.textContent || control.value, 300);
    return cleanText(control.value || control.textContent, 300);
  }

  function pollerFrom(oltName, technologyLabel) {
    const text = `${oltName} ${technologyLabel}`.toLowerCase();
    if (/huawei/.test(text)) return { technology: "huawei", poller: "poller-huawei", action: "313" };
    if (/gcom/.test(text)) return { technology: "gcom", poller: "poller-gcom", action: "312" };
    if (/gpon/.test(text)) return { technology: "gpon", poller: "poller-gpon", action: "311" };
    if (/epon|bdcom/.test(text)) return { technology: "epon", poller: "poller-epon", action: "310" };
    return { technology: "", poller: "", action: "" };
  }

  function juniperResult() {
    const candidates = [...document.querySelectorAll("td,div.message,table.table10")]
      .filter(visible)
      .map(element => ({ element, text: cleanText(element.textContent, 9000) }))
      .filter(item => /Статус\s+сес(?:с|і)и/i.test(item.text) && /BRAS/i.test(item.text) && /USERNAME/i.test(item.text))
      .sort((a, b) => a.text.length - b.text.length);
    return candidates[0] || null;
  }

  function pollResult() {
    const pattern = /(?:ONU|ONT|Serial|Серийн|MAC|оптик|Rx|Tx|dBm|distance|расстоя|порт|status|статус)/i;
    const reject = /Запрос\s+OLT|Данные\s+посланы\.\s*Ждите/i;
    return [...document.querySelectorAll("tr,td,div.message,table.tbg,table.table10")]
      .filter(visible)
      .map(element => ({ element, text: cleanText(element.textContent, 12000) }))
      .filter(item => pattern.test(item.text) && !reject.test(item.text) && item.text.length > 35 && item.text.length < 9000)
      .sort((a, b) => a.text.length - b.text.length)[0] || null;
  }

  function mainUrl() {
    const page = currentPage();
    const url = new URL(location.href);
    url.searchParams.set("a", "user");
    if (runtime.state?.billingId || page.billingId) url.searchParams.set("id", runtime.state?.billingId || page.billingId);
    url.searchParams.delete("act");
    url.searchParams.delete("olt_ip");
    url.searchParams.delete("parent_type");
    url.searchParams.delete("tmpl");
    return url.href;
  }

  function mainLink() {
    const id = runtime.state?.billingId || currentPage().billingId;
    return queryVisible(`a[href*="a=user"][href*="id=${CSS.escape(id)}"]`)
      || [...document.querySelectorAll("a[href]")].find(link => visible(link) && /^abon\d+$/i.test(cleanText(link.textContent)))
      || null;
  }

  function instruction(stage) {
    const steps = {
      "juniper-link": { index: 1, total: 7, title: "Открой Juniper (NEW)", detail: "Проверяем наличие активной сессии. Наличие или отсутствие сессии не останавливает базовый маршрут." },
      "juniper-result": { index: 2, total: 7, title: "Проверь результат сессии", detail: "Нажми на выделенный блок, когда прочитал статус, IP, MAC/USERNAME и BRAS." },
      "juniper-return": { index: 2, total: 7, title: "Сессия зафиксирована", detail: "Вернись на карточку абонента. Дальше маршрут подсветит «Технические данные»." },
      "technical-link": { index: 3, total: 7, title: "Открой технические данные", detail: "Следующий обязательный шаг — проверить технологию и привязанную OLT." },
      "technical-review": { index: 4, total: 7, title: "Проверь OLT и технологию", detail: "Нажми на выделенный блок после проверки. Значение читается из текущей карточки, без привязки к конкретной голове." },
      "technical-return": { index: 4, total: 7, title: "Вернись на карточку абонента", detail: "OLT зафиксирована. Теперь можно выбрать правильный poller." },
      "poller-link": { index: 5, total: 7, title: "Открой правильный poller", detail: "Подсвечена вкладка, соответствующая фактической OLT из технических данных." },
      "ask-olt": { index: 6, total: 7, title: "Запусти опрос OLT", detail: "Нажми «Запрос OLT →». Маршрут продолжится только после загрузки результата." },
      "wait-result": { index: 7, total: 7, title: "Ожидаем результат OLT", detail: "Клик уже выполнен. Перезагрузка или pageshow сами по себе не считаются результатом." },
      "poll-result": { index: 7, total: 7, title: "Проверь результат опроса", detail: "Нажми на выделенный результат после проверки статуса, порта, идентификатора и оптики." },
      complete: { index: 7, total: 7, title: "Базовый маршрут завершён", detail: "Сессия проверена, OLT подтверждена, правильный poller опрошен." },
      "olt-missing": { index: 4, total: 7, title: "OLT в технических данных отсутствует", detail: "Опрос выбирать нельзя. Нужна отдельная ветка поиска OLT через UserSide / ТМЦ." }
    };
    return steps[stage] || { index: 0, total: 7, title: "Маршрут", detail: "" };
  }

  function resolveStage() {
    const page = currentPage();
    const state = runtime.state;
    if (!state) return { stage: "", targets: [] };
    if (state.completed) return { stage: "complete", targets: [] };

    if (page.kind === "billing-juniper") {
      const result = juniperResult();
      if (state.sessionReviewed) return { stage: "juniper-return", targets: result ? [result.element] : [], evidence: result, navigateUrl: mainUrl() };
      return { stage: "juniper-result", targets: result ? [result.element] : [], evidence: result };
    }

    if (page.kind === "billing-technical") {
      const oltRow = fieldRow("dopfield_29");
      const techRow = fieldRow("dopfield_39");
      if (!state.technicalReviewed) return { stage: "technical-review", targets: [oltRow, techRow].filter(Boolean) };
      if (!state.olt?.present) return { stage: "olt-missing", targets: [oltRow, techRow].filter(Boolean) };
      return { stage: "technical-return", targets: [mainLink()].filter(Boolean), navigateUrl: mainUrl() };
    }

    if (page.kind === "billing-poller") {
      const result = pollResult();
      if (state.askStarted && result) return { stage: "poll-result", targets: [result.element], evidence: result };
      if (state.askStarted || page.url.searchParams.get("act") === "askolt") {
        return { stage: "wait-result", targets: [smallestByText(/Данные\s+посланы\.\s*Ждите/i)].filter(Boolean) };
      }
      return { stage: "ask-olt", targets: [queryVisible("a[href*='act=askolt']")].filter(Boolean) };
    }

    if (page.kind === "billing-user") {
      if (!state.sessionReviewed) {
        return { stage: "juniper-link", targets: [queryVisible("a[href*='a=252']")].filter(Boolean) };
      }
      if (!state.technicalReviewed) {
        return { stage: "technical-link", targets: [queryVisible("a[href*='a=dopdata'][href*='tmpl=1']") || queryVisible("a[href*='a=dopdata']")].filter(Boolean) };
      }
      if (!state.olt?.present) {
        return { stage: "technical-link", targets: [queryVisible("a[href*='a=dopdata'][href*='tmpl=1']") || queryVisible("a[href*='a=dopdata']")].filter(Boolean) };
      }
      const action = state.olt.pollerAction;
      const target = action ? queryVisible(`a[href*="a=${action}"]`) : null;
      return { stage: "poller-link", targets: [target].filter(Boolean) };
    }

    return { stage: "", targets: [] };
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    runtime.target = null;
    runtime.stage = "";
    if (runtime.raf) cancelAnimationFrame(runtime.raf);
    runtime.raf = 0;
  }

  function bounds(elements) {
    const rects = elements.filter(visible).map(element => element.getBoundingClientRect());
    if (!rects.length) return null;
    const padding = 9;
    const left = Math.max(4, Math.min(...rects.map(rect => rect.left)) - padding);
    const top = Math.max(4, Math.min(...rects.map(rect => rect.top)) - padding);
    const right = Math.min(innerWidth - 4, Math.max(...rects.map(rect => rect.right)) + padding);
    const bottom = Math.min(innerHeight - 4, Math.max(...rects.map(rect => rect.bottom)) + padding);
    return { left, top, right, bottom, width: Math.max(20, right - left), height: Math.max(20, bottom - top) };
  }

  function placeBox(element, styles) {
    Object.assign(element.style, { position: "fixed", background: "rgba(3,7,12,.68)", pointerEvents: "none", ...styles });
  }

  function renderOverlay(stage, targets, navigateUrl = "") {
    const previousStage = runtime.stage;
    const previousTarget = runtime.target;
    const nextTarget = targets.filter(visible)[0] || null;
    const sameTarget = previousStage === stage && previousTarget === nextTarget;
    removeOverlay();
    if (!stage || !enabled()) return;
    const info = instruction(stage);
    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "2147483645", pointerEvents: "none" });
    root.innerHTML = `<style>
      @keyframes simnetBasicPulse { 0%,100%{box-shadow:0 0 0 2px rgba(168,238,36,.34),0 0 18px rgba(168,238,36,.48)} 50%{box-shadow:0 0 0 7px rgba(168,238,36,.13),0 0 34px rgba(168,238,36,.82)} }
      #${OVERLAY_ID} .route-frame{position:fixed;border:3px solid #a8ee24;border-radius:11px;background:rgba(244,255,226,.10);animation:simnetBasicPulse 1.15s ease-in-out infinite;pointer-events:none}
      #${OVERLAY_ID} .route-note{position:fixed;max-width:460px;padding:12px 14px;background:rgba(13,22,35,.98);color:#f4f7fb;border:1px solid #607995;border-radius:11px;box-shadow:0 14px 42px rgba(0,0,0,.5);font:600 12px/1.42 Segoe UI,Arial,sans-serif;pointer-events:auto}
      #${OVERLAY_ID} .route-note b{display:block;color:#a8ee24;font-size:13px;margin-bottom:4px}
      #${OVERLAY_ID} .route-note small{display:block;color:#9fb0c3;margin-bottom:6px}
      #${OVERLAY_ID} .route-note button{margin-top:9px;padding:7px 10px;border:1px solid #71869d;border-radius:7px;background:#1d2b3b;color:#fff;cursor:pointer;font:600 12px Segoe UI,Arial,sans-serif}
    </style>`;
    document.documentElement.appendChild(root);

    const liveTargets = targets.filter(visible);
    const rect = bounds(liveTargets);
    if (rect) {
      const topShade = document.createElement("div");
      placeBox(topShade, { left: "0", top: "0", width: "100vw", height: `${rect.top}px` });
      const leftShade = document.createElement("div");
      placeBox(leftShade, { left: "0", top: `${rect.top}px`, width: `${rect.left}px`, height: `${rect.height}px` });
      const rightShade = document.createElement("div");
      placeBox(rightShade, { left: `${rect.right}px`, top: `${rect.top}px`, right: "0", height: `${rect.height}px` });
      const bottomShade = document.createElement("div");
      placeBox(bottomShade, { left: "0", top: `${rect.bottom}px`, width: "100vw", bottom: "0" });
      root.append(topShade, leftShade, rightShade, bottomShade);

      const frame = document.createElement("div");
      frame.className = "route-frame";
      Object.assign(frame.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      root.appendChild(frame);
      if (!sameTarget) liveTargets[0]?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } else if (stage !== "complete") {
      const shade = document.createElement("div");
      placeBox(shade, { inset: "0" });
      root.appendChild(shade);
    }

    const note = document.createElement("div");
    note.className = "route-note";
    const top = rect ? Math.min(innerHeight - 150, Math.max(14, rect.bottom + 12)) : 18;
    const left = rect ? Math.min(innerWidth - 480, Math.max(14, rect.left)) : 18;
    note.style.top = `${top}px`;
    note.style.left = `${left}px`;
    note.innerHTML = `<small>Шаг ${info.index} из ${info.total}</small><b>${info.title}</b><span>${info.detail}</span>`;
    if (navigateUrl) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "К карточке Billing";
      button.addEventListener("click", () => { location.href = navigateUrl; });
      note.appendChild(button);
    }
    root.appendChild(note);
    runtime.target = liveTargets[0] || null;
    runtime.stage = stage;
    if (stage === "complete") {
      window.setTimeout(() => { if (runtime.stage === "complete") removeOverlay(); }, 2400);
    }
  }

  async function capturePageEvidence(resolved) {
    if (!runtime.state) return;
    if (resolved.stage === "juniper-result" && resolved.evidence) {
      const text = resolved.evidence.text;
      const status = /online\s*\/\s*active/i.test(text) ? "online" : /offline|inactive|not\s+found/i.test(text) ? "offline" : "unknown";
      await patchState({ sessionStatus: status, sessionSummary: cleanText(text, 900) });
    }
    if (currentPage().kind === "billing-poller" && currentPage().url.searchParams.get("act") === "askolt" && !runtime.state.askStarted) {
      await patchState({ askStarted: true });
    }
    if (currentPage().kind === "billing-technical") {
      const oltControl = document.querySelector("select[name='dopfield_29'],input[name='dopfield_29']");
      const techControl = document.querySelector("select[name='dopfield_39'],input[name='dopfield_39']");
      const name = selectedText(oltControl);
      const technologyLabel = selectedText(techControl);
      const present = Boolean(oltControl && name && !/^(?:0|нет|не выбрано|не указано|выберите|—|-)$/i.test(name));
      const poller = pollerFrom(name, technologyLabel);
      await patchState({ olt: { present, name: present ? name : "", technology: poller.technology, technologyLabel, poller: poller.poller, pollerAction: poller.action } });
    }
  }

  async function render() {
    if (runtime.disposed || !enabled()) { removeOverlay(); return; }
    if (!runtime.state) await loadState();
    if (!runtime.state) { removeOverlay(); return; }
    const resolved = resolveStage();
    await capturePageEvidence(resolved);
    const refreshed = resolveStage();
    renderOverlay(refreshed.stage, refreshed.targets || [], refreshed.navigateUrl || "");
  }

  async function acknowledgeStage(stage) {
    if (!runtime.state) return;
    if (stage === "juniper-result") await patchState({ sessionReviewed: true });
    else if (stage === "technical-review") await patchState({ technicalReviewed: true });
    else if (stage === "poll-result") await patchState({ resultReviewed: true, completed: true });
    await render();
  }

  function clickedRelevantTarget(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !runtime.target) return false;
    return target === runtime.target || runtime.target.contains(target) || target.contains(runtime.target);
  }

  function installClickTracking() {
    runtime.clickHandler = async event => {
      if (!enabled() || !runtime.state) return;
      const stage = runtime.stage;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (stage === "juniper-link" && target.closest("a[href*='a=252']")) return;
      if (stage === "technical-link" && target.closest("a[href*='a=dopdata']")) return;
      if (stage === "poller-link") {
        const link = target.closest("a[href]");
        if (link && runtime.state.olt?.pollerAction && new URL(link.href, location.href).searchParams.get("a") === runtime.state.olt.pollerAction) {
          await patchState({ pollerOpened: true });
        }
        return;
      }
      if (stage === "ask-olt" && target.closest("a[href*='act=askolt']")) {
        await patchState({ askStarted: true });
        return;
      }
      if (["juniper-result", "technical-review", "poll-result"].includes(stage) && clickedRelevantTarget(event)) {
        await acknowledgeStage(stage);
      }
    };
    document.addEventListener("click", runtime.clickHandler, true);
  }

  function installObservers() {
    runtime.observer = new MutationObserver(records => {
      const externalChange = records.some(record => {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every(node => node instanceof Element && (node.id === OVERLAY_ID || node.closest?.(`#${OVERLAY_ID}`)))) return false;
        if (record.target instanceof Element && record.target.closest?.(`#${OVERLAY_ID}`)) return false;
        return true;
      });
      if (!externalChange || runtime.raf) return;
      runtime.raf = requestAnimationFrame(() => {
        runtime.raf = 0;
        void render();
      });
    });
    runtime.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "value"] });
    const scheduleRender = () => {
      if (runtime.raf) return;
      runtime.raf = requestAnimationFrame(() => { runtime.raf = 0; void render(); });
    };
    window.addEventListener("resize", scheduleRender, { passive: true });
    window.addEventListener("scroll", scheduleRender, { passive: true, capture: true });
  }

  async function reset() {
    if (!runtime.state) await loadState();
    if (!runtime.state) return;
    const all = await storageGet({});
    all[runtime.state.key] = blankState(runtime.state.key, currentPage());
    await storageSet(all);
    runtime.state = all[runtime.state.key];
    await render();
  }

  async function start(force = true) {
    runtime.forced = force;
    runtime.mode = readMode();
    await loadState();
    await render();
  }

  function stop() {
    runtime.forced = false;
    removeOverlay();
  }

  if (typeof gm.GM_addValueChangeListener === "function") {
    try {
      gm.GM_addValueChangeListener(MODE_KEY, (_key, _oldValue, newValue) => {
        runtime.mode = String(newValue || "diagnostic");
        void render();
      });
    } catch (_) {}
  }

  globalThis.__SIMNET_BASIC_DIAGNOSTIC_ROUTE__ = { version: VERSION, start, stop, reset, render, getState: () => runtime.state };

  installClickTracking();
  installObservers();
  window.addEventListener("pagehide", () => {
    runtime.disposed = true;
    runtime.observer?.disconnect();
    if (runtime.clickHandler) document.removeEventListener("click", runtime.clickHandler, true);
    removeOverlay();
  }, { once: true });

  void loadState().then(render);
})();
