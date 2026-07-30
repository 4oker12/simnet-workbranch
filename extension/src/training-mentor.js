"use strict";

(async () => {
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  const knowledge = globalThis.__SIMNET_TRAINING_KNOWLEDGE__;
  const billingProviders = globalThis.__SIMNET_BILLING_PROVIDER__;
  if (!compat?.ready || !compat?.api || !knowledge) return;
  await compat.ready;

  const {
    GM_getValue,
    GM_setValue,
    GM_addValueChangeListener,
    GM_addStyle
  } = compat.api;
  const MODE_KEY = "dp_workbench_operation_mode_v1";
  const AUTO_HINTS_KEY = "dp_mentor_auto_hints_v1";
  const VALID_MODES = new Set(["diagnostic", "mentor"]);
  const runtime = {
    mode: normalizeMode(GM_getValue(MODE_KEY, "diagnostic")),
    autoHints: GM_getValue(AUTO_HINTS_KEY, true) !== false,
    completed: new Set(),
    contextKey: "",
    currentRules: [],
    activeRuleId: "",
    highlighted: null,
    marker: null,
    initialized: false
  };

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return VALID_MODES.has(mode) ? mode : "diagnostic";
  }

  function pageEvidenceText() {
    const selectors = [
      "h1", "h2", "h3", ".item", ".left_data", "[role=\"tab\"]",
      "a", "button", "th", "td", "label", "legend"
    ];
    return [...document.querySelectorAll(selectors.join(","))]
      .filter((node) => !node.closest("#dp-panel, #dp-mentor-target-marker"))
      .slice(0, 600)
      .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 30000);
  }

  function providerForPage() {
    const byHost = billingProviders?.providerForHostname?.(location.hostname);
    if (byHost) return byHost;
    return billingProviders?.detectFromDocument?.(document)?.provider || "";
  }

  function currentContext() {
    return knowledge.classifyContext({
      hostname: location.hostname,
      pathname: location.pathname,
      pageText: pageEvidenceText(),
      provider: providerForPage()
    });
  }

  function contextKey(context) {
    return `${context.hostname}|${context.pathname}`;
  }

  function displayProvider(provider) {
    if (provider === "looknet") return "Looknet";
    if (provider === "simnet") return "Simnet";
    return "не определён";
  }

  function pageLabel(context) {
    if (context.pageType === "userside-customer") {
      return `UserSide · абонент · ${displayProvider(context.provider)}`;
    }
    if (context.pageType === "billing") {
      return `Billing ${displayProvider(context.provider)}`;
    }
    return "Открой карточку абонента UserSide или Billing";
  }

  function operationIsBusy() {
    const stop = document.querySelector("#dp-stop");
    return Boolean(stop && !stop.disabled);
  }

  function setMode(value, source = "ui") {
    const mode = normalizeMode(value);
    if (mode === "mentor" && operationIsBusy()) {
      showMentorNotice("Сначала останови или дождись завершения активной диагностики.");
      renderModeControls();
      return false;
    }
    runtime.mode = mode;
    try { GM_setValue(MODE_KEY, mode); } catch (_) {}
    applyMode(source);
    return true;
  }

  function renderModeControls() {
    document.querySelectorAll("[data-dp-operation-mode]").forEach((button) => {
      const selected = button.dataset.dpOperationMode === runtime.mode;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function applyMode(source = "") {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return;
    panel.dataset.operationMode = runtime.mode;
    renderModeControls();
    if (runtime.mode === "mentor") {
      refreshMentor({ autoReveal: source !== "storage" });
    } else {
      clearFocus();
    }
  }

  function createModeControls(panel) {
    if (panel.querySelector("#dp-operation-mode")) return;
    const row = document.createElement("div");
    row.id = "dp-operation-mode";
    row.innerHTML = `
      <span>Режим</span>
      <div role="group" aria-label="Режим работы Workbench">
        <button type="button" data-dp-operation-mode="diagnostic">Диагностика</button>
        <button type="button" data-dp-operation-mode="mentor">Обучение</button>
      </div>
    `;
    const roleBanner = panel.querySelector("#dp-role-banner");
    if (roleBanner) roleBanner.insertAdjacentElement("afterend", row);
    else panel.querySelector("#dp-head")?.insertAdjacentElement("afterend", row);
    row.querySelectorAll("[data-dp-operation-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.dpOperationMode));
    });
  }

  function createMentorWorkspace(panel) {
    if (panel.querySelector("#dp-mentor-workspace")) return;
    const workspace = document.createElement("section");
    workspace.id = "dp-mentor-workspace";
    workspace.innerHTML = `
      <header class="dp-mentor-header">
        <div>
          <b>Наставник оператора</b>
          <span id="dp-mentor-context">Определяю страницу…</span>
        </div>
        <div class="dp-mentor-header-actions">
          <button type="button" id="dp-mentor-refresh">Обновить контекст</button>
          <label title="Подсвечивать следующий доступный DOM-элемент при открытии режима">
            <input id="dp-mentor-auto-hints" type="checkbox">
            Автоподсказки
          </label>
        </div>
      </header>
      <div class="dp-mentor-progress">
        <div><span id="dp-mentor-progress-label">0 из 0</span><button type="button" id="dp-mentor-reset">Сбросить отметки</button></div>
        <i><b id="dp-mentor-progress-bar"></b></i>
      </div>
      <div id="dp-mentor-notice" role="status" aria-live="polite"></div>
      <aside id="dp-mentor-focus" hidden>
        <div>
          <small id="dp-mentor-focus-stage"></small>
          <b id="dp-mentor-focus-title"></b>
        </div>
        <button type="button" id="dp-mentor-focus-close">Снять подсветку</button>
        <p id="dp-mentor-focus-instruction"></p>
        <em id="dp-mentor-focus-why"></em>
      </aside>
      <div id="dp-mentor-rules"></div>
    `;
    const providerRow = panel.querySelector("#dp-billing-provider");
    if (providerRow) providerRow.insertAdjacentElement("afterend", workspace);
    else panel.appendChild(workspace);

    const autoHints = workspace.querySelector("#dp-mentor-auto-hints");
    autoHints.checked = runtime.autoHints;
    autoHints.addEventListener("change", () => {
      runtime.autoHints = autoHints.checked;
      try { GM_setValue(AUTO_HINTS_KEY, runtime.autoHints); } catch (_) {}
      if (!runtime.autoHints) clearFocus();
      else revealNextRule();
    });
    workspace.querySelector("#dp-mentor-refresh").addEventListener("click", () => {
      clearFocus();
      refreshMentor({ autoReveal: runtime.autoHints });
    });
    workspace.querySelector("#dp-mentor-focus-close").addEventListener("click", clearFocus);
    workspace.querySelector("#dp-mentor-reset").addEventListener("click", () => {
      runtime.completed.clear();
      clearFocus();
      refreshMentor({ autoReveal: runtime.autoHints });
    });
  }

  function showMentorNotice(message) {
    const notice = document.querySelector("#dp-mentor-notice");
    if (!notice) return;
    notice.textContent = String(message || "");
    notice.hidden = !notice.textContent;
  }

  function ruleCardHtml(rule, completed) {
    const checklist = rule.checklist
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `
      <article class="dp-mentor-rule${completed ? " done" : ""}${rule.caution ? " caution" : ""}" data-mentor-rule="${rule.id}">
        <div class="dp-mentor-rule-stage">${escapeHtml(rule.stage)}</div>
        <h3>${escapeHtml(rule.title)}</h3>
        <p>${escapeHtml(rule.instruction)}</p>
        <details>
          <summary>Зачем и что подтвердить</summary>
          <p class="dp-mentor-why">${escapeHtml(rule.why)}</p>
          <ul>${checklist}</ul>
        </details>
        <div class="dp-mentor-rule-actions">
          <button type="button" data-mentor-show="${rule.id}">Показать на странице</button>
          <label><input type="checkbox" data-mentor-done="${rule.id}"${completed ? " checked" : ""}> Проверено</label>
        </div>
      </article>
    `;
  }

  function renderRules(context, ruleList) {
    const container = document.querySelector("#dp-mentor-rules");
    if (!container) return;
    if (!ruleList.length) {
      container.innerHTML = `
        <div class="dp-mentor-empty">
          <b>Здесь пока нет активного сценария</b>
          <span>Открой карточку абонента в UserSide или авторизованную карточку в Billing.</span>
        </div>
      `;
      return;
    }
    container.innerHTML = ruleList
      .map((rule) => ruleCardHtml(rule, runtime.completed.has(rule.id)))
      .join("");
    container.querySelectorAll("[data-mentor-show]").forEach((button) => {
      button.addEventListener("click", () => revealRule(button.dataset.mentorShow, true));
    });
    container.querySelectorAll("[data-mentor-done]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.mentorDone;
        if (checkbox.checked) runtime.completed.add(id);
        else runtime.completed.delete(id);
        clearFocus();
        refreshMentor({ autoReveal: runtime.autoHints });
      });
    });
  }

  function updateProgress(ruleList) {
    const progress = knowledge.progressFor(ruleList, runtime.completed);
    const label = document.querySelector("#dp-mentor-progress-label");
    const bar = document.querySelector("#dp-mentor-progress-bar");
    if (label) label.textContent = `${progress.done} из ${progress.total} · ${progress.percent}%`;
    if (bar) bar.style.width = `${progress.percent}%`;
    return progress;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function candidateElements() {
    return [...document.querySelectorAll([
      ".left_data", "[role=\"tab\"]", "a", "button", "th", "td",
      "label", "legend", "span", "b", "strong", "h1", "h2", "h3"
    ].join(","))]
      .filter((node) => !node.closest("#dp-panel, #dp-mentor-target-marker"))
      .slice(0, 2500);
  }

  function findAnchor(anchor) {
    if (!anchor || !Array.isArray(anchor.texts)) return null;
    if (anchor.kind === "left-data") {
      const labels = [...document.querySelectorAll(".left_data")]
        .filter((node) => !node.closest("#dp-panel"));
      for (const expected of anchor.texts) {
        const match = labels.find((node) => (
          String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase()
          === expected.toLowerCase()
        ));
        if (match) return match.closest(".item") || match.parentElement || match;
      }
    }
    const candidates = candidateElements();
    for (const expected of anchor.texts) {
      const lower = expected.toLowerCase();
      const exact = candidates.find((node) => (
        String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === lower
      ));
      if (exact) return exact;
    }
    for (const expected of anchor.texts) {
      const lower = expected.toLowerCase();
      const partial = candidates.find((node) => {
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        return text && text.length <= 180 && text.includes(lower);
      });
      if (partial) return partial;
    }
    return null;
  }

  function clearFocus() {
    if (runtime.highlighted) runtime.highlighted.classList.remove("dp-mentor-highlight");
    runtime.highlighted = null;
    runtime.activeRuleId = "";
    runtime.marker?.remove();
    runtime.marker = null;
    const focus = document.querySelector("#dp-mentor-focus");
    if (focus) focus.hidden = true;
  }

  function positionMarker(anchor, marker) {
    const rect = anchor.getBoundingClientRect();
    marker.style.left = `${Math.max(4, rect.left + window.scrollX - 13)}px`;
    marker.style.top = `${Math.max(4, rect.top + window.scrollY - 13)}px`;
  }

  function showFocus(rule, anchor) {
    clearFocus();
    runtime.activeRuleId = rule.id;
    runtime.highlighted = anchor;
    anchor.classList.add("dp-mentor-highlight");
    anchor.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });

    const marker = document.createElement("span");
    marker.id = "dp-mentor-target-marker";
    marker.textContent = "!";
    marker.setAttribute("aria-hidden", "true");
    document.body.appendChild(marker);
    runtime.marker = marker;
    positionMarker(anchor, marker);

    const focus = document.querySelector("#dp-mentor-focus");
    if (focus) {
      const stage = focus.querySelector("#dp-mentor-focus-stage");
      const title = focus.querySelector("#dp-mentor-focus-title");
      const instruction = focus.querySelector("#dp-mentor-focus-instruction");
      const why = focus.querySelector("#dp-mentor-focus-why");
      if (stage) stage.textContent = rule.stage;
      if (title) title.textContent = rule.title;
      if (instruction) instruction.textContent = rule.instruction;
      if (why) why.textContent = rule.why;
      focus.hidden = false;
      focus.scrollIntoView({ behavior: "auto", block: "nearest" });
    }
  }

  function revealRule(id, explicit = false) {
    const rule = runtime.currentRules.find((item) => item.id === id);
    if (!rule) return false;
    const anchor = findAnchor(rule.anchor);
    if (!anchor) {
      if (explicit) {
        showMentorNotice("Нужный элемент не открыт на этой вкладке. Перейди в указанный раздел и нажми «Показать» ещё раз.");
      }
      return false;
    }
    showMentorNotice("");
    showFocus(rule, anchor);
    return true;
  }

  function revealNextRule() {
    if (runtime.mode !== "mentor" || !runtime.autoHints || runtime.activeRuleId) return;
    const progress = knowledge.progressFor(runtime.currentRules, runtime.completed);
    if (progress.next) revealRule(progress.next.id, false);
  }

  function refreshMentor(options = {}) {
    if (runtime.mode !== "mentor") return;
    const context = currentContext();
    const nextContextKey = contextKey(context);
    if (runtime.contextKey && runtime.contextKey !== nextContextKey) {
      runtime.completed.clear();
      clearFocus();
    }
    runtime.contextKey = nextContextKey;
    runtime.currentRules = knowledge.rulesForContext(context);
    const contextNode = document.querySelector("#dp-mentor-context");
    if (contextNode) contextNode.textContent = pageLabel(context);
    renderRules(context, runtime.currentRules);
    const progress = updateProgress(runtime.currentRules);
    const ponPortRulePending = context.system === "billing"
      && context.technology === "pon"
      && !runtime.completed.has("billing-pon-port-poll");
    showMentorNotice(
      ponPortRulePending
        ? "PON: прежде всего сверь актуальный опрос порта. Только после этого переходи к остальным выводам."
        : progress.total && progress.done === progress.total
          ? "Чек-лист завершён. Перед заявкой ещё раз отдели подтверждённые факты от предположений."
          : ""
    );
    if (options.autoReveal) window.setTimeout(revealNextRule, 220);
  }

  function installStyles() {
    GM_addStyle(`
      #dp-operation-mode {
        display:flex !important; align-items:center !important; justify-content:space-between !important;
        gap:10px !important; padding:8px 14px !important; background:#101827 !important;
        border-bottom:1px solid #35435a !important;
      }
      #dp-operation-mode > span { color:#b8c2d3 !important; font-size:10px !important; font-weight:850 !important; letter-spacing:.08em !important; text-transform:uppercase !important; }
      #dp-operation-mode > div { display:grid !important; grid-template-columns:1fr 1fr !important; gap:4px !important; padding:3px !important; background:#0b1220 !important; border:1px solid #40506a !important; border-radius:9px !important; }
      #dp-operation-mode button { min-height:30px !important; padding:0 10px !important; color:#b8c2d3 !important; background:transparent !important; border:0 !important; border-radius:6px !important; font-size:11px !important; font-weight:800 !important; cursor:pointer !important; }
      #dp-operation-mode button.active { color:#072f2b !important; background:#5ee7d3 !important; box-shadow:0 2px 8px rgba(0,0,0,.25) !important; }
      #dp-mentor-workspace { display:none !important; min-height:0 !important; flex:1 1 auto !important; overflow:auto !important; color:#eef4fb !important; background:#111827 !important; }
      #dp-panel[data-operation-mode="mentor"] #dp-role-banner,
      #dp-panel[data-operation-mode="mentor"] #dp-workspace-tabs,
      #dp-panel[data-operation-mode="mentor"] #dp-status,
      #dp-panel[data-operation-mode="mentor"] #dp-form,
      #dp-panel[data-operation-mode="mentor"] #dp-results,
      #dp-panel[data-operation-mode="mentor"] #dp-journal-resizer,
      #dp-panel[data-operation-mode="mentor"] #dp-journal-wrap { display:none !important; }
      #dp-panel[data-operation-mode="mentor"] #dp-mentor-workspace { display:block !important; }
      .dp-mentor-header { position:sticky !important; top:0 !important; z-index:3 !important; display:flex !important; justify-content:space-between !important; align-items:center !important; gap:12px !important; padding:12px 14px !important; background:#172239 !important; border-bottom:1px solid #40506a !important; }
      .dp-mentor-header > div { display:grid !important; gap:2px !important; min-width:0 !important; }
      .dp-mentor-header b { color:#fff !important; font-size:14px !important; }
      .dp-mentor-header span { color:#aebbd0 !important; font-size:10.5px !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
      .dp-mentor-header-actions { display:flex !important; align-items:center !important; gap:7px !important; }
      .dp-mentor-header-actions > button { min-height:28px !important; padding:0 8px !important; color:#ddecff !important; background:#233a5d !important; border:1px solid #5f8fc8 !important; border-radius:7px !important; font-size:9.5px !important; font-weight:800 !important; cursor:pointer !important; }
      .dp-mentor-header label { display:flex !important; align-items:center !important; gap:5px !important; color:#c9d4e5 !important; font-size:10px !important; white-space:nowrap !important; cursor:pointer !important; }
      .dp-mentor-progress { display:grid !important; gap:7px !important; padding:10px 14px !important; background:#162033 !important; border-bottom:1px solid #35435a !important; }
      .dp-mentor-progress > div { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; color:#dce8f7 !important; font-size:11px !important; font-weight:800 !important; }
      .dp-mentor-progress button { padding:3px 7px !important; color:#b8c6d9 !important; background:transparent !important; border:1px solid #53647e !important; border-radius:6px !important; font-size:9.5px !important; cursor:pointer !important; }
      .dp-mentor-progress i { height:6px !important; overflow:hidden !important; background:#0b1220 !important; border-radius:99px !important; }
      .dp-mentor-progress i b { display:block !important; width:0; height:100% !important; background:linear-gradient(90deg,#5ee7d3,#7db7ff) !important; transition:width .2s ease !important; }
      #dp-mentor-notice { margin:10px 12px 0 !important; padding:9px 10px !important; color:#fff1c7 !important; background:#382d18 !important; border:1px solid #80642d !important; border-radius:8px !important; font-size:11px !important; }
      #dp-mentor-notice:empty { display:none !important; }
      #dp-mentor-focus { display:grid !important; grid-template-columns:minmax(0,1fr) auto !important; gap:7px 10px !important; margin:10px 12px 0 !important; padding:11px !important; color:#edf4ff !important; background:#152238 !important; border:2px solid #ffca58 !important; border-radius:10px !important; box-shadow:0 6px 18px rgba(0,0,0,.22) !important; }
      #dp-mentor-focus[hidden] { display:none !important; }
      #dp-mentor-focus > div { display:grid !important; gap:2px !important; min-width:0 !important; }
      #dp-mentor-focus small { color:#ffda84 !important; font-size:9px !important; font-weight:900 !important; letter-spacing:.06em !important; text-transform:uppercase !important; }
      #dp-mentor-focus b { color:#fff !important; font-size:13px !important; }
      #dp-mentor-focus > button { align-self:start !important; min-height:28px !important; padding:0 8px !important; color:#fff1c7 !important; background:#3b301d !important; border:1px solid #8a6a30 !important; border-radius:7px !important; font-size:9.5px !important; font-weight:800 !important; cursor:pointer !important; }
      #dp-mentor-focus p, #dp-mentor-focus em { grid-column:1 / -1 !important; margin:0 !important; line-height:1.45 !important; }
      #dp-mentor-focus p { color:#e2eaf5 !important; font-size:11px !important; }
      #dp-mentor-focus em { color:#aebbd0 !important; font-size:10px !important; font-style:normal !important; }
      #dp-mentor-rules { display:grid !important; gap:10px !important; padding:12px !important; }
      .dp-mentor-rule { padding:11px !important; background:#182235 !important; border:1px solid #40506a !important; border-left:4px solid #7db7ff !important; border-radius:10px !important; }
      .dp-mentor-rule.done { opacity:.72 !important; border-left-color:#70e1a1 !important; }
      .dp-mentor-rule.caution { border-left-color:#ffd166 !important; }
      .dp-mentor-rule-stage { color:#83aee8 !important; font-size:9px !important; font-weight:900 !important; letter-spacing:.07em !important; text-transform:uppercase !important; }
      .dp-mentor-rule h3 { margin:3px 0 5px !important; color:#fff !important; font-size:13px !important; line-height:1.3 !important; }
      .dp-mentor-rule > p { margin:0 !important; color:#d5deeb !important; font-size:11.5px !important; line-height:1.45 !important; }
      .dp-mentor-rule details { margin-top:8px !important; padding-top:7px !important; border-top:1px solid #33435a !important; }
      .dp-mentor-rule summary { color:#9ec7ff !important; font-size:10.5px !important; font-weight:750 !important; cursor:pointer !important; }
      .dp-mentor-why { color:#c6d0df !important; font-size:10.5px !important; line-height:1.45 !important; }
      .dp-mentor-rule ul { margin:6px 0 0 18px !important; padding:0 !important; color:#b8c6d9 !important; font-size:10.5px !important; line-height:1.45 !important; }
      .dp-mentor-rule-actions { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; margin-top:9px !important; }
      .dp-mentor-rule-actions button { min-height:30px !important; padding:0 9px !important; color:#ddecff !important; background:#233a5d !important; border:1px solid #5f8fc8 !important; border-radius:7px !important; font-size:10px !important; font-weight:800 !important; cursor:pointer !important; }
      .dp-mentor-rule-actions label { display:flex !important; align-items:center !important; gap:5px !important; color:#d7e1ed !important; font-size:10.5px !important; font-weight:750 !important; cursor:pointer !important; }
      .dp-mentor-empty { display:grid !important; gap:5px !important; padding:16px !important; color:#aebbd0 !important; background:#182235 !important; border:1px dashed #53647e !important; border-radius:10px !important; text-align:center !important; }
      .dp-mentor-empty b { color:#fff !important; }
      .dp-mentor-highlight { outline:4px solid #ffca58 !important; outline-offset:4px !important; border-radius:4px !important; box-shadow:0 0 0 8px rgba(255,202,88,.18),0 0 22px rgba(255,202,88,.42) !important; scroll-margin:90px !important; }
      #dp-mentor-target-marker { position:absolute !important; z-index:2147483645 !important; display:grid !important; place-items:center !important; width:26px !important; height:26px !important; color:#2c2106 !important; background:#ffca58 !important; border:2px solid #ffffff !important; border-radius:50% !important; box-shadow:0 4px 12px rgba(0,0,0,.35) !important; font:900 15px/1 "Segoe UI",Arial,sans-serif !important; pointer-events:none !important; user-select:none !important; }
      @media (max-width:700px) {
        .dp-mentor-header { align-items:flex-start !important; flex-direction:column !important; }
        .dp-mentor-header-actions { width:100% !important; justify-content:space-between !important; }
      }
    `);
  }

  function initialize(panel) {
    if (runtime.initialized) return;
    runtime.initialized = true;
    installStyles();
    createModeControls(panel);
    createMentorWorkspace(panel);
    renderModeControls();
    applyMode("initial");

    const refreshAfterNavigation = () => {
      clearFocus();
      refreshMentor({ autoReveal: runtime.autoHints });
    };
    window.addEventListener("popstate", refreshAfterNavigation);
    window.addEventListener("hashchange", refreshAfterNavigation);
    window.addEventListener("pageshow", refreshAfterNavigation);

    try {
      GM_addValueChangeListener(MODE_KEY, (_name, _oldValue, value) => {
        const mode = normalizeMode(value);
        if (mode === runtime.mode) return;
        runtime.mode = mode;
        applyMode("storage");
      });
      GM_addValueChangeListener(AUTO_HINTS_KEY, (_name, _oldValue, value) => {
        runtime.autoHints = value !== false;
        const checkbox = document.querySelector("#dp-mentor-auto-hints");
        if (checkbox) checkbox.checked = runtime.autoHints;
        if (!runtime.autoHints) clearFocus();
      });
    } catch (_) {}
  }

  function waitForPanel(attempt = 0) {
    const panel = document.querySelector("#dp-panel");
    if (panel) {
      initialize(panel);
      return;
    }
    if (attempt >= 120) {
      console.warn("[SIMNET-WB-EXT] Mentor mode skipped: Workbench panel was not created");
      return;
    }
    window.setTimeout(() => waitForPanel(attempt + 1), 100);
  }
  waitForPanel();
})().catch((error) => {
  console.error("[SIMNET-WB-EXT] Mentor mode failed to initialize", error);
});
