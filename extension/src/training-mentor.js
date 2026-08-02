"use strict";

(async () => {
  const compat = globalThis.__SIMNET_EXTENSION_COMPAT__;
  const knowledge = globalThis.__SIMNET_TRAINING_KNOWLEDGE__;
  const billingProviders = globalThis.__SIMNET_BILLING_PROVIDER__;
  if (!compat?.ready || !compat?.api || !knowledge) return;
  await compat.ready;

  // Workbench and the mentor wait for the same asynchronous compatibility bootstrap.
  // Resolve its exported analyzers only after that wait: capturing them above could keep
  // `undefined` for the entire page lifetime even though Workbench publishes them next.
  const onuAnalysis = globalThis.__SIMNET_ONU_ANALYSIS__;
  const tmcAnalysis = globalThis.__SIMNET_TMC_ANALYSIS__;

  const {
    GM_getValue,
    GM_setValue,
    GM_addValueChangeListener,
    GM_addStyle,
    GM_xmlhttpRequest
  } = compat.api;
  const MODE_KEY = "dp_workbench_operation_mode_v1";
  const AUTO_HINTS_KEY = "dp_mentor_auto_hints_v1";
  const PROGRESS_KEY = "dp_mentor_progress_v1";
  const JUNIPER_REVIEWS_KEY = "dp_mentor_juniper_reviews_v1";
  const VALID_MODES = new Set(["diagnostic", "mentor"]);
  const ONU_MENU_BY_ACTION = Object.freeze({
    "310": "BDCOM EPON (1G)",
    "311": "BDCOM GPON (2.5G)",
    "312": "GCOM (2.5G)",
    "313": "HUAWEI OLT"
  });
  const runtime = {
    mode: normalizeMode(GM_getValue(MODE_KEY, "diagnostic")),
    autoHints: GM_getValue(AUTO_HINTS_KEY, false) === true,
    completed: new Set(),
    completedByContext: loadCompletedByContext(),
    juniperReviews: loadJuniperReviews(),
    contextKey: "",
    currentRules: [],
    currentInspections: [],
    inspectionAnchors: new Map(),
    reviewedInspectionIds: new Set(),
    openInspectionNotes: new Set(),
    closedInspectionNotes: new Set(),
    reviewedInspectionContext: "",
    expandedInspectionGroup: "",
    technicalProfiles: new Map(),
    technicalProfileRequests: new Map(),
    tmcProfiles: new Map(),
    tmcProfileRequests: new Map(),
    accountStatusProfiles: new Map(),
    accountStatusProfileRequests: new Map(),
    activeRuleId: "",
    highlighted: null,
    highlightedElements: [],
    marker: null,
    spotlight: null,
    focusFrame: 0,
    focusRequestId: 0,
    initialized: false,
    pageUrl: location.href
  };

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return VALID_MODES.has(mode) ? mode : "diagnostic";
  }

  function loadCompletedByContext() {
    let saved = {};
    try { saved = GM_getValue(PROGRESS_KEY, {}) || {}; } catch (_) {}
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return new Map();
    return new Map(
      Object.entries(saved)
        .filter(([, ids]) => Array.isArray(ids))
        .map(([key, ids]) => [key, new Set(ids.map((id) => String(id || "")).filter(Boolean))])
    );
  }

  function saveCompletedByContext() {
    const saved = {};
    for (const [key, ids] of runtime.completedByContext) saved[key] = [...ids];
    try { GM_setValue(PROGRESS_KEY, saved); } catch (_) {}
  }

  function loadJuniperReviews() {
    let saved = {};
    try { saved = GM_getValue(JUNIPER_REVIEWS_KEY, {}) || {}; } catch (_) {}
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return new Map();
    return new Map(Object.entries(saved).filter(([, result]) => result && typeof result === "object"));
  }

  function saveJuniperReviews() {
    const saved = Object.fromEntries(runtime.juniperReviews);
    try { GM_setValue(JUNIPER_REVIEWS_KEY, saved); } catch (_) {}
  }

  function subscriberIdentity() {
    const id = new URLSearchParams(location.search).get("id") || "";
    if (id) return `${location.hostname}|${id}`;
    const heading = normalizedText(document.querySelector("body")?.textContent).match(/\babon\d{3,14}\b/i)?.[0] || "";
    return `${location.hostname}|${heading.toLowerCase() || "unknown"}`;
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
      search: location.search,
      pageText: pageEvidenceText(),
      provider: providerForPage()
    });
  }

  function contextKey(context) {
    if (context.system === "billing") {
      return [context.hostname, context.pageType, context.billingSection, subscriberIdentity()].join("|");
    }
    return [
      context.hostname,
      context.pageType,
      context.provider,
      context.technology
    ].join("|");
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
      const sections = {
        account: "Карточка клиента",
        juniper: "Juniper",
        onu: "Опрос ONU / PON-порта",
        payments: "Финансы и события",
        technical: "Технические данные",
        traffic: "Трафик",
        general: "Другой раздел"
      };
      const section = sections[context.billingSection] || sections.general;
      return `Billing ${displayProvider(context.provider)} · ${section}`;
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
      if (button.getAttribute("role") === "switch") {
        button.setAttribute("aria-checked", selected ? "true" : "false");
      }
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
      clearFieldDecorations();
    }
  }

  function createModeControls(panel) {
    if (panel.querySelector("#dp-operation-mode")) return;
    const row = document.createElement("div");
    row.id = "dp-operation-mode";
    row.innerHTML = `
      <div class="dp-operation-mode-toggle">
        <span>Режим обучения</span>
        <button type="button" class="dp-operation-mode-switch" role="switch" aria-label="Переключить режим обучения" aria-checked="false" data-dp-operation-mode="mentor"><i aria-hidden="true"></i></button>
      </div>
      <span id="dp-mentor-progress-label">Изучено: 0 / 0</span>
    `;
    const roleBanner = panel.querySelector("#dp-role-banner");
    if (roleBanner) roleBanner.insertAdjacentElement("afterend", row);
    else panel.querySelector("#dp-head")?.insertAdjacentElement("afterend", row);
    row.querySelectorAll("[data-dp-operation-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(runtime.mode === "mentor" ? "diagnostic" : "mentor"));
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
        <div><span>Маршрут текущего раздела</span><button type="button" id="dp-mentor-reset">Сбросить маршрут</button></div>
        <i><b id="dp-mentor-progress-bar"></b></i>
      </div>
      <div id="dp-mentor-notice" role="status" aria-live="polite"></div>
      <aside id="dp-mentor-focus" hidden>
        <div>
          <small id="dp-mentor-focus-stage"></small>
          <b id="dp-mentor-focus-title"></b>
        </div>
        <button type="button" id="dp-mentor-focus-close">Закрыть</button>
        <p id="dp-mentor-focus-instruction"></p>
        <em id="dp-mentor-focus-why"></em>
      </aside>
      <section id="dp-mentor-inspections" hidden>
        <header>
          <b>Контроль полей страницы</b>
          <span>Зелёный — норма · красный — отклонение · синий — важное поле</span>
        </header>
        <div id="dp-mentor-inspection-list"></div>
      </section>
      <div id="dp-mentor-rules"></div>
    `;
    const inspectionHeader = workspace.querySelector("#dp-mentor-inspections > header");
    if (inspectionHeader) {
      inspectionHeader.querySelector("b").textContent = "Важные элементы страницы";
      inspectionHeader.querySelector("span").textContent = "Нажми строку — откроется пояснение; кнопка внутри подсветит источник на странице.";
    }
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
    workspace.querySelector("#dp-mentor-inspection-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mentor-inspection-show]");
      if (button) {
        revealInspection(button.dataset.mentorInspectionShow);
        return;
      }
      const fieldRow = event.target.closest("[data-mentor-inspection-note]");
      if (fieldRow) {
        const card = fieldRow.closest(".dp-mentor-inspection");
        const note = card?.querySelector(".dp-mentor-inspection-note");
        if (!card || !note) return;
        const open = !note.classList.contains("open");
        note.classList.toggle("open", open);
        fieldRow.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          runtime.openInspectionNotes.add(fieldRow.dataset.mentorInspectionNote);
          runtime.closedInspectionNotes.delete(fieldRow.dataset.mentorInspectionNote);
          markInspectionReviewed(fieldRow.dataset.mentorInspectionNote, card);
        } else {
          runtime.openInspectionNotes.delete(fieldRow.dataset.mentorInspectionNote);
          runtime.closedInspectionNotes.add(fieldRow.dataset.mentorInspectionNote);
        }
        return;
      }
      const summary = event.target.closest(".dp-mentor-inspection-group > summary");
      if (!summary) return;
      event.preventDefault();
      const group = summary.parentElement;
      const open = !group.open;
      workspace.querySelectorAll(".dp-mentor-inspection-group[open]").forEach((item) => {
        if (item !== group) item.open = false;
      });
      group.open = open;
      runtime.expandedInspectionGroup = open ? group.dataset.mentorInspectionGroup || "" : "";
    });
    workspace.querySelector("#dp-mentor-reset").addEventListener("click", () => {
      runtime.completed.clear();
      saveCompletedByContext();
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

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function directRowLabel(row) {
    const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
    return normalizedText(cells[0]?.innerText || cells[0]?.textContent || "");
  }

  function rowSelectedValue(row) {
    const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
    const control = row.querySelector("select, input:not([type='hidden']), textarea");
    if (control?.tagName === "SELECT") {
      return normalizedText(control.selectedOptions?.[0]?.textContent || control.value);
    }
    if (control) return normalizedText(control.value);
    return normalizedText(cells[1]?.innerText || cells[1]?.textContent || "");
  }

  function billingFieldRows(root = document) {
    const rows = new Map();
    root.querySelectorAll("tr").forEach((row) => {
      if (row.closest("#dp-panel")) return;
      const label = directRowLabel(row);
      if (!label || label.length > 80) return;
      const key = label.toLowerCase();
      if (!rows.has(key)) rows.set(key, { label, value: rowSelectedValue(row), element: row });
    });
    return rows;
  }

  function technicalDataUrl() {
    const link = [...document.querySelectorAll("a")].find((node) => (
      !node.closest("#dp-panel")
      && normalizedText(node.textContent).toLowerCase() === "технические данные"
    ));
    return link?.href || "";
  }

  function usersideCustomerUrl() {
    const links = [...document.querySelectorAll("a[href]")]
      .filter((node) => !node.closest("#dp-panel"));
    const match = links.find((node) => {
      let url;
      try { url = new URL(node.href, location.href); } catch (_) { return false; }
      if (url.hostname.toLowerCase() !== "userside.simnet.kiev.ua") return false;
      const text = normalizedText(node.textContent);
      return /userside/i.test(text) || /\/(?:script\/gotouser\.php|user|subscriber|customer)\b/i.test(url.pathname);
    });
    return match?.href || "";
  }

  function accountDataUrl() {
    const link = [...document.querySelectorAll("a[href]")].find((node) => {
      if (node.closest("#dp-panel")) return false;
      return /^(?:данные клиента|дані клієнта)$/i.test(normalizedText(node.textContent));
    });
    return link?.href || "";
  }

  function accountStatusProfileFromHtml(html) {
    const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
    const rows = billingFieldRows(parsed);
    const valueFor = (...names) => (
      names.map((name) => rows.get(String(name).toLowerCase())?.value).find(Boolean) || ""
    );
    const group = valueFor("группа", "група");
    const internetPackage = valueFor("пакет");
    const access = valueFor("доступ", "статус доступа", "статус");
    const state = valueFor("состояние");
    const balance = valueFor(
      "на счете с учетом стоимости тарифного плана, грн.",
      "на счете с учетом стоимости тарифного плана",
      "на рахунку з урахуванням вартості тарифного плану, грн."
    );
    const normalizedBalance = String(balance).replace(/[\s\u00a0]+/g, "").replace(",", ".");
    const parsedBalance = Number(normalizedBalance.match(/[+-]?\d+(?:\.\d+)?/)?.[0]);
    const negativeBalance = Number.isFinite(parsedBalance) && parsedBalance < 0;
    const reasons = [
      /удален|видален|архив|inactive|deleted/i.test(group) ? `группа «${group}»` : "",
      /заблок|заборон|blocked|відключ|отключ|inactive/i.test(internetPackage) ? `пакет «${internetPackage}»` : "",
      /запрещ|заборон|deny|forbid|blocked/i.test(access) ? `доступ «${access}»` : "",
      /пауза|заблок|inactive|disabled/i.test(state) ? `состояние «${state}»` : "",
      negativeBalance ? `отрицательный остаток «${balance}»` : ""
    ].filter(Boolean);
    return Object.freeze({
      group,
      internetPackage,
      access,
      state,
      balance,
      negativeBalance,
      inactive: reasons.length > 0,
      reasons: Object.freeze(reasons)
    });
  }

  function billingGroupTechnologyHint() {
    const groupRow = [...document.querySelectorAll("tr")].find((row) => {
      if (row.closest("#dp-panel")) return false;
      return /^(?:группа|група)$/i.test(directRowLabel(row));
    });
    const name = rowSelectedValue(groupRow);
    const match = String(name || "").match(/(?:xgs?-?pon|xg-?pon|gpon|epon|(?:^|[^a-z])pon(?:[^a-z]|$))/i);
    if (!match) return Object.freeze({ isPon: false, name, kind: "" });
    const kind = String(match[0] || "PON").replace(/[^a-z]/gi, "").toUpperCase() || "PON";
    return Object.freeze({ isPon: true, name, kind });
  }

  function technicalProfileFromHtml(html) {
    const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
    const fields = new Map();
    parsed.querySelectorAll("tr").forEach((row) => {
      const label = directRowLabel(row);
      if (!label || label.length > 100) return;
      const key = label.toLowerCase();
      if (!fields.has(key)) fields.set(key, rowSelectedValue(row));
    });
    const valueFor = (...names) => (
      names.map((name) => String(name).toLowerCase())
        .map((name) => fields.get(name))
        .find(Boolean) || ""
    );
    const technology = valueFor("технология подключения абонента");
    const rawOlt = valueFor("olt");
    const olt = /^(?:\.{2,}\s*)?(?:выбор|select|не выбрано)$/i.test(rawOlt) ? "" : rawOlt;
    const eponMac = valueFor("epon onu мак-адрес");
    const gponSerial = valueFor("gpon ont серийный id");
    const classified = knowledge.classifyBillingOlt?.({ technology, olt, eponMac, gponSerial }) || {};
    return Object.freeze({
      technology,
      olt,
      oltKind: classified.oltKind || "",
      isPon: classified.isPon === true,
      menuTexts: classified.menuTexts || []
    });
  }

  function requestPageText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 15_000,
        onload: (response) => {
          const status = Number(response?.status || 0);
          if (status >= 200 && status < 400) resolve(String(response.responseText || ""));
          else reject(new Error(`HTTP ${status || "error"}`));
        },
        onerror: (response) => reject(new Error(response?.statusText || "request failed")),
        ontimeout: () => reject(new Error("request timeout"))
      });
    });
  }

  function ensureTechnicalProfile(context) {
    if (context.system !== "billing" || context.billingSection !== "account") return;
    const url = technicalDataUrl();
    if (!url || runtime.technicalProfiles.has(url) || runtime.technicalProfileRequests.has(url)) return;
    const request = requestPageText(url)
      .then((html) => {
        runtime.technicalProfiles.set(url, technicalProfileFromHtml(html));
        if (runtime.mode === "mentor" && !runtime.highlighted && technicalDataUrl() === url) {
          renderFieldInspections(currentContext());
        }
      })
      .catch(() => {})
      .finally(() => runtime.technicalProfileRequests.delete(url));
    runtime.technicalProfileRequests.set(url, request);
  }

  function ensureTmcProfile(context, profile, groupHint = billingGroupTechnologyHint()) {
    if (context.system !== "billing" || context.billingSection !== "account") return;
    const technology = String(profile?.technology || "");
    const ethernet = /ethernet|etth|fttb|вит(?:ая|ій)|медн|мідн|lan/i.test(technology);
    const likelyPon = profile?.isPon === true || (!ethernet && groupHint?.isPon === true);
    if (!likelyPon || String(profile?.olt || "").trim() || !tmcAnalysis?.analyzeUserSideTmcHtml) return;
    const url = usersideCustomerUrl();
    if (!url || runtime.tmcProfiles.has(url) || runtime.tmcProfileRequests.has(url)) return;
    const request = requestPageText(url)
      .then((html) => {
        const result = tmcAnalysis.analyzeUserSideTmcHtml(html) || {};
        runtime.tmcProfiles.set(url, Object.freeze({ ...result, failed: false }));
        if (runtime.mode === "mentor" && !runtime.highlighted && usersideCustomerUrl() === url) {
          renderFieldInspections(currentContext());
        }
      })
      .catch((error) => {
        runtime.tmcProfiles.set(url, Object.freeze({
          action: "",
          failed: true,
          error: String(error?.message || error || "ТМЦ недоступна")
        }));
        if (runtime.mode === "mentor" && !runtime.highlighted && usersideCustomerUrl() === url) {
          renderFieldInspections(currentContext());
        }
      })
      .finally(() => runtime.tmcProfileRequests.delete(url));
    runtime.tmcProfileRequests.set(url, request);
  }

  function ensureJuniperAccountStatus(context) {
    if (context.system !== "billing" || context.billingSection !== "juniper") return;
    const url = accountDataUrl();
    if (!url || runtime.accountStatusProfiles.has(url) || runtime.accountStatusProfileRequests.has(url)) return;
    const request = requestPageText(url)
      .then((html) => {
        runtime.accountStatusProfiles.set(url, accountStatusProfileFromHtml(html));
        if (runtime.mode === "mentor" && !runtime.highlighted && accountDataUrl() === url) {
          renderFieldInspections(currentContext());
        }
      })
      .catch(() => {
        runtime.accountStatusProfiles.set(url, Object.freeze({
          group: "",
          internetPackage: "",
          access: "",
          state: "",
          balance: "",
          negativeBalance: false,
          inactive: false,
          reasons: Object.freeze([]),
          unavailable: true
        }));
        if (runtime.mode === "mentor" && !runtime.highlighted && accountDataUrl() === url) {
          renderFieldInspections(currentContext());
        }
      })
      .finally(() => runtime.accountStatusProfileRequests.delete(url));
    runtime.accountStatusProfileRequests.set(url, request);
  }

  function clearFieldDecorations() {
    if (runtime.highlighted?.closest?.("[data-dp-mentor-inspection-status]")) clearFocus();
    document.querySelectorAll("[data-dp-mentor-inspection-status]").forEach((node) => {
      node.removeAttribute("data-dp-mentor-inspection-status");
      node.removeAttribute("data-dp-mentor-inspection-id");
    });
    const parents = new Set();
    document.querySelectorAll("span[data-dp-mentor-inspection-line]").forEach((span) => {
      const parent = span.parentNode;
      parents.add(parent);
      span.replaceWith(document.createTextNode(span.textContent || ""));
    });
    parents.forEach((parent) => parent?.normalize?.());
    runtime.currentInspections = [];
    runtime.inspectionAnchors.clear();
  }

  function accountFieldInspections(context) {
    const rows = billingFieldRows();
    const values = {};
    rows.forEach((entry) => { values[entry.label] = entry.value; });
    const inspections = knowledge.evaluateBillingFields?.(context, values) || [];
    const fieldInspections = inspections.map((inspection) => {
      const fieldNames = new Set((inspection.fieldNames || []).map((name) => String(name).toLowerCase()));
      const row = [...rows.entries()].find(([name]) => fieldNames.has(name))?.[1]?.element || null;
      if (row) {
        row.dataset.dpMentorInspectionStatus = inspection.status;
        row.dataset.dpMentorInspectionId = inspection.id;
      }
      const group = inspection.serviceAvailability === "blocked"
        ? "availability"
        : inspection.id === "billing-field-balance-after-tariff"
        ? "finance"
        : [
            "billing-field-subscriber-group",
            "billing-field-internet-package",
            "billing-field-state",
            "billing-field-service-start-day"
          ].includes(inspection.id)
          ? "service"
          : "access";
      return { ...inspection, group, element: row };
    });
    const technicalInspections = accountTechnicalInspections(context);
    const savedReview = runtime.juniperReviews.get(subscriberIdentity());
    const directBlockers = fieldInspections.filter((inspection) => inspection.serviceAvailability === "blocked");
    const juniperInspection = technicalInspections.find((inspection) => inspection.id === "billing-check-juniper");
    const savedValue = String(savedReview?.value || "");
    const activeSession = /online\s*\/\s*active(?:\(\d+\))?/i.test(savedValue);
    let status = "info";
    let value = "Не подтверждено · проверь Juniper";
    let message = "Поля Billing не подтверждают наличие текущего интернета. Открой Juniper: только активный статус сессии прямо показывает, что интернет-сессия существует сейчас.";

    if (activeSession && directBlockers.length) {
      status = "warning";
      value = "Сессия активна, но Billing блокирует услугу";
      message = `Juniper показывает активную сессию, однако Billing содержит прямую блокировку: ${directBlockers.map((item) => `${item.label}: ${item.value}`).join("; ")}. Это противоречие нужно перепроверить.`;
    } else if (activeSession) {
      status = "ok";
      value = "Есть активная Juniper-сессия";
      message = "Статус online / active(n) в Juniper — прямое подтверждение, что интернет-сессия абонента существует сейчас.";
    } else if (directBlockers.length) {
      status = "warning";
      value = `Услуга заблокирована · ${directBlockers.map((item) => item.label).join(", ")}`;
      message = `Billing содержит прямые признаки отсутствия услуги: ${directBlockers.map((item) => `${item.label}: ${item.value}`).join("; ")}. Отрицательный остаток и явные административные блокировки автоматически исключают штатную работу услуги.`;
    } else if (savedReview?.status === "history") {
      status = "history";
      value = "Активной сессии нет · ранее была";
      message = savedReview.message;
    } else if (savedReview?.status === "inactive") {
      status = "inactive";
      value = "Активной сессии нет · ожидаемо";
      message = savedReview.message;
    } else if (savedReview?.status === "warning") {
      status = "warning";
      value = "Активной Juniper-сессии нет";
      message = savedReview.message;
    }

    const summaryElement = juniperInspection?.element || directBlockers[0]?.element || null;
    const availabilitySummary = {
      id: "billing-service-availability-summary",
      group: "availability",
      label: "Интернет сейчас",
      value,
      status,
      message,
      reviewed: Boolean(savedReview),
      element: summaryElement
    };
    return [availabilitySummary, ...fieldInspections, ...technicalInspections];
  }

  function technicalFieldInspections(context) {
    const rows = billingFieldRows();
    const values = {};
    rows.forEach((entry) => { values[entry.label] = entry.value; });
    const inspections = knowledge.evaluateBillingTechnicalFields?.(context, values) || [];
    return inspections.map((inspection) => {
      const fieldNames = new Set((inspection.fieldNames || []).map((name) => String(name).toLowerCase()));
      const row = [...rows.entries()].find(([name]) => fieldNames.has(name))?.[1]?.element || null;
      if (row) {
        row.dataset.dpMentorInspectionStatus = inspection.status;
        row.dataset.dpMentorInspectionId = inspection.id;
      }
      return { ...inspection, element: row };
    });
  }

  function accountTechnicalInspections(context) {
    if (context.system !== "billing" || context.billingSection !== "account") return [];
    const inspections = [];
    const juniperAnchor = findAnchor({ kind: "text", texts: ["Juniper (NEW)", "Juniper"] });
    if (juniperAnchor) {
      const savedReview = runtime.juniperReviews.get(subscriberIdentity());
      const checkedAt = savedReview?.checkedAt
        ? new Date(savedReview.checkedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        : "";
      const status = savedReview?.status || "info";
      juniperAnchor.dataset.dpMentorInspectionStatus = status;
      juniperAnchor.dataset.dpMentorInspectionId = "billing-check-juniper";
      inspections.push({
        id: "billing-check-juniper",
        group: "availability",
        label: savedReview ? "Статус сессии Juniper" : "Проверка Juniper",
        value: savedReview
          ? `Проверено${checkedAt ? ` в ${checkedAt}` : ""} · ${savedReview.value}`
          : normalizedText(juniperAnchor.textContent),
        status,
        message: savedReview?.message
          || "Открой Juniper и подтверди результат проверки: наличие сессии, IP, MAC, длительность и трафик. После просмотра результат сохранится в этом пункте.",
        reviewed: Boolean(savedReview),
        element: juniperAnchor
      });
    }

    const url = technicalDataUrl();
    const profile = url ? runtime.technicalProfiles.get(url) : null;
    const groupHint = billingGroupTechnologyHint();
    const addPonGroupHint = () => {
      const technicalAnchor = findAnchor({ kind: "text", texts: ["Технические данные"] });
      if (!groupHint.isPon || !technicalAnchor) return;
      technicalAnchor.dataset.dpMentorInspectionStatus = "info";
      technicalAnchor.dataset.dpMentorInspectionId = "billing-check-pon-group-hint";
      inspections.unshift({
        id: "billing-check-pon-group-hint",
        group: "technical",
        label: "Вероятно PON по группе",
        value: `${groupHint.kind} · ${groupHint.name}`,
        status: "info",
        message: "Название группы подсказывает PON-технологию. Наставник сверит «Технические данные», а если поле OLT пустое — определит оборудование по ТМЦ UserSide и укажет точный раздел опроса ONU.",
        element: technicalAnchor
      });
    };
    if (!profile) {
      addPonGroupHint();
      return inspections;
    }
    const ethernet = /ethernet|etth|fttb|вит(?:ая|ій)|медн|мідн|lan/i.test(String(profile.technology || ""));
    const likelyPon = profile.isPon || (!ethernet && groupHint.isPon);
    if (!likelyPon) {
      const usersideAnchor = ethernet
        ? findAnchor({ kind: "text", texts: ["USERSIDE", "UserSide"] })
        : null;
      if (usersideAnchor) {
        usersideAnchor.dataset.dpMentorInspectionStatus = "info";
        usersideAnchor.dataset.dpMentorInspectionId = "billing-check-userside-ethernet";
        inspections.unshift({
          id: "billing-check-userside-ethernet",
          group: "technical",
          label: "Линия Ethernet в UserSide",
          value: profile.technology || "Ethernet",
          status: "info",
          message: "У абонента не PON-технология: опрос ONU не нужен. Открой UserSide и проверь узел, коммутатор, порт, линию и технические данные подключения.",
          element: usersideAnchor
        });
      } else {
        addPonGroupHint();
      }
      return inspections;
    }

    if (!profile.menuTexts.length && !String(profile.olt || "").trim()) {
      ensureTmcProfile(context, profile, groupHint);
      const tmcUrl = usersideCustomerUrl();
      const tmc = tmcUrl ? runtime.tmcProfiles.get(tmcUrl) : null;
      const pending = Boolean(tmcUrl && runtime.tmcProfileRequests.has(tmcUrl));
      const sectionName = ONU_MENU_BY_ACTION[String(tmc?.action || "")] || "";
      const oltAnchor = sectionName
        ? findAnchor({ kind: "text", texts: [sectionName] })
        : findAnchor({ kind: "text", texts: ["USERSIDE", "UserSide"] })
          || findAnchor({ kind: "text", texts: ["Технические данные"] });
      if (!oltAnchor) return inspections;

      const evidence = normalizedText(
        tmc?.deviceName || tmc?.oltInfo || [tmc?.oltIp, tmc?.onuInterface].filter(Boolean).join(" · ")
      ).slice(0, 140);
      const resolved = Boolean(sectionName);
      const status = resolved || pending ? "info" : "warning";
      oltAnchor.dataset.dpMentorInspectionStatus = status;
      oltAnchor.dataset.dpMentorInspectionId = "billing-check-onu-tmc";
      inspections.unshift({
        id: "billing-check-onu-tmc",
        group: "technical",
        label: resolved ? "Опрос ONU по ТМЦ" : "Определение OLT по ТМЦ",
        value: resolved
          ? `${sectionName}${evidence ? ` · ${evidence}` : ""}`
          : pending
            ? "Читаю ТМЦ UserSide…"
            : "OLT не определена",
        status,
        message: resolved
          ? `В «Технических данных» поле OLT пустое. ТМЦ UserSide указывает ${evidence || "тип PON-оборудования"}, поэтому опроси ONU в разделе «${sectionName}».`
          : pending
            ? "В «Технических данных» поле OLT пустое. Наставник читает ТМЦ UserSide и после определения оборудования сам подсветит нужный раздел опроса ONU."
            : tmc?.failed
              ? "В «Технических данных» поле OLT пустое, а ТМЦ UserSide сейчас не удалось прочитать. Открой UserSide и проверь ТМЦ вручную — раздел опроса ONU без подтверждения не выбираем."
              : "В «Технических данных» поле OLT пустое, а ТМЦ UserSide не дала однозначного типа оборудования. Открой UserSide и подтверди OLT вручную — наставник не будет выбирать раздел наугад.",
        element: oltAnchor
      });
      return inspections;
    }

    const oltAnchor = profile.menuTexts.length
      ? findAnchor({ kind: "text", texts: profile.menuTexts })
      : findAnchor({ kind: "text", texts: ["Технические данные"] });
    if (!oltAnchor) return inspections;
    const sectionName = profile.menuTexts[0] || "Технические данные";
    oltAnchor.dataset.dpMentorInspectionStatus = profile.menuTexts.length ? "info" : "warning";
    oltAnchor.dataset.dpMentorInspectionId = "billing-check-onu";
    inspections.unshift({
      id: "billing-check-onu",
      group: "technical",
      label: "Опрос ONU",
      value: profile.olt ? `${sectionName} · ${profile.olt}` : sectionName,
      status: profile.menuTexts.length ? "info" : "warning",
      message: profile.menuTexts.length
        ? `Технические данные: ${profile.technology || "PON"}. Не забудь опросить ONU именно в разделе «${sectionName}».`
        : "У абонента указана технология PON, но тип OLT не удалось сопоставить с разделом. Сначала открой технические данные.",
      element: oltAnchor
    });
    return inspections;
  }

  function juniperFieldInspections(context) {
    if (context.system !== "billing" || context.billingSection !== "juniper") return [];
    ensureJuniperAccountStatus(context);
    const accountUrl = accountDataUrl();
    const account = accountUrl ? runtime.accountStatusProfiles.get(accountUrl) : null;
    const accountPending = Boolean(accountUrl && runtime.accountStatusProfileRequests.has(accountUrl));
    const sessionElement = [...document.querySelectorAll("td")]
      .filter((node) => !node.closest("#dp-panel"))
      .map((element) => ({ element, text: normalizedText(element.textContent) }))
      .filter((item) => /\bBRAS\s*-|Статус\s+сес(?:ії|сии)\s*-/i.test(item.text))
      .filter((item) => item.text.length <= 3500)
      .sort((left, right) => left.text.length - right.text.length)[0];
    if (!sessionElement) return [];

    const text = sessionElement.text;
    const noSession = /сес(?:ію|сия)[^.!]{0,100}не\s+(?:знайдено|найден[ао]?)/i.test(text)
      || /Сес(?:ія|сия)\s*-\s*0\b/i.test(text);
    const active = /online\s*\/\s*active(?:\(\d+\))?/i.test(text);
    const statusText = text.match(/(?:online\s*\/\s*active(?:\(\d+\))?|unknown\s*\/\s*unknown|offline\s*\/\s*[\w()-]+)/i)?.[0] || "не распознан";
    const inactiveStatus = /(?:offline\s*\/\s*(?:inactive|down|disabled?)(?:\(\d+\))?|\binactive(?:\(\d+\))?\b)/i.test(statusText);
    const sessionId = text.match(/Сес(?:ія|сия)\s*-\s*(\d+)/i)?.[1] || "";
    const ip = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "";
    const mac = text.match(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i)?.[0] || "";
    const vlan = text.match(/\bVLAN\s*-\s*(\d+)/i)?.[1] || "";
    const bras = text.match(/\bBRAS\s*-\s*(.*?)(?=Джерело\s+сесії|Источник\s+сессии|Сес(?:ія|сия)\s*-)/i)?.[1]?.trim() || "";
    const sessionSource = text.match(/(?:Джерело\s+сесії|Источник\s+сессии)\s*-\s*(.*?)(?=Сес(?:ія|сия)\s*-)/i)?.[1]?.trim() || "";
    const username = text.match(/\bUSERNAME\s*-\s*(.*?)(?=Тип\s+авторизац)/i)?.[1]?.trim() || "";
    const authorizationType = text.match(/Тип\s+авторизац(?:ії|ии)\s*[^-]*-\s*(.*?)(?=Час\s+старту|Время\s+старта|Час\s+авторизац|Время\s+авторизац)/i)?.[1]?.trim() || "";
    const startedAt = text.match(/(?:Час\s+старту|Время\s+старта|Час\s+авторизації|Время\s+авторизации)\s*-\s*(.*?)(?=Байти\s+прийнято|Байты\s+принято|Час\s+останньої|Время\s+последнего)/i)?.[1]?.trim() || "";
    const lastEventAt = text.match(/(?:Час\s+останньої\s+події|Время\s+последнего\s+события)\s*-\s*(.*?)(?=Остання\s+подія|Последнее\s+событие|ROUTER\s*-)/i)?.[1]?.trim() || "";
    const lastEvent = text.match(/(?:Остання\s+подія|Последнее\s+событие)\s*-\s*(.*?)(?=ROUTER\s*-|VENDOR\s*-|VLAN\s*-)/i)?.[1]?.trim() || "";
    const router = text.match(/\bROUTER\s*-\s*(.*?)(?=VENDOR\s*-|VLAN\s*-)/i)?.[1]?.trim() || "";
    const vendor = text.match(/\bVENDOR\s*-\s*(.*?)(?=VLAN\s*-|Запит\s+Juniper|Запрос\s+Juniper|Синхрон)/i)?.[1]?.trim() || "";
    const lineElement = (pattern) => [...sessionElement.element.querySelectorAll("li")]
      .find((node) => pattern.test(normalizedText(node.textContent)))
      || sessionElement.element;
    const nonZeroMac = Boolean(mac && !/^00(?::00){5}$/i.test(mac));
    const hasPreviousSessionTrace = Boolean(
      !active
      && (
        (sessionId && sessionId !== "0")
        || nonZeroMac
        || bras
        || username
        || lastEventAt
        || lastEvent
      )
    );
    const inactiveReason = account?.reasons?.join(", ") || "";
    const savedReview = runtime.juniperReviews.get(subscriberIdentity());
    let status = "info";
    let value = `${statusText}${sessionId ? ` · сессия ${sessionId}` : ""}`;
    let message = "Состояние Juniper нужно сопоставить с доступом и состоянием услуги в карточке Billing.";

    if (active) {
      status = account?.inactive ? "warning" : "ok";
      message = account?.inactive
        ? `Juniper-сессия активна, но карточка содержит признак неактивной услуги: ${inactiveReason}. Это противоречие нужно перепроверить.`
        : `Активная Juniper-сессия подтверждена${bras ? ` на ${bras}` : ""}. Сверь IP, MAC, VLAN и наличие трафика.`;
    } else if (hasPreviousSessionTrace) {
      status = "history";
      value = [
        "Активной сессии нет · ранее была",
        lastEventAt,
        lastEvent,
        sessionId && sessionId !== "0" ? `сессия ${sessionId}` : ""
      ].filter(Boolean).join(" · ");
      message = account?.inactive
        ? `Сейчас сессии нет, но Juniper сохранил след предыдущей работы. Последняя известная активность согласуется с тем, что услуга теперь неактивна: ${inactiveReason}.`
        : "Активной сессии сейчас нет, но session ID, MAC, BRAS или последнее событие подтверждают, что интернет работал ранее. Зафиксируй время последней активности и ищи причину последующего разрыва.";
    } else if (noSession) {
      status = accountPending ? "info" : account?.inactive ? "inactive" : "warning";
      value = accountPending
        ? "Сессия не найдена · сверяю карточку"
        : account?.inactive ? "Сессия и следы отсутствуют · ожидаемо" : "Сессия и следы отсутствуют";
      message = account?.inactive
        ? `Полное отсутствие Juniper-сессии соответствует неактивной услуге: ${inactiveReason}. Это подтверждённый результат, а не отдельная неисправность Juniper.`
        : accountPending
          ? "Juniper-сессия не найдена. Наставник сверяет состояние услуги в карточке Billing."
          : "Juniper-сессия и следы предыдущей работы не найдены, но неактивность услуги не подтверждена. Проверь доступ, пакет, питание роутера и авторизацию.";
    }
    const savedMatchesCurrent = Boolean(
      savedReview
      && savedReview.status === status
      && savedReview.value === value
    );

    sessionElement.element.dataset.dpMentorInspectionStatus = status;
    sessionElement.element.dataset.dpMentorInspectionId = "billing-juniper-session-result";
    const exactStatus = active
      ? "ok"
      : noSession || inactiveStatus
        ? accountPending ? "info" : account?.inactive ? "inactive" : "warning"
        : "info";
    const exactStatusValue = noSession && statusText === "не распознан" ? "Сессия не найдена" : statusText;
    const inspections = [{
      id: "billing-juniper-session-status-result",
      group: "availability",
      label: "Статус сессии",
      value: exactStatusValue,
      status: exactStatus,
      message: active
        ? `Juniper сообщает «${statusText}»: текущая сессия активна. Это прямое подтверждение наличия интернет-сессии со стороны BRAS.`
        : noSession || inactiveStatus
          ? `Juniper сообщает, что активной сессии нет${statusText !== "не распознан" ? `: «${statusText}»` : ""}. Это прямой признак отсутствия текущей интернет-сессии; причину нужно определить по Billing, последним событиям и оборудованию.`
          : "Статус сессии Juniper не распознан однозначно. Не делай вывод о наличии интернета по косвенным признакам Billing.",
      element: lineElement(/Статус\s+сес(?:ії|сии)\s*-/i)
    }, {
      id: "billing-juniper-session-result",
      group: "availability",
      label: "Итог проверки Juniper",
      value,
      status,
      message,
      reviewed: savedMatchesCurrent,
      element: sessionElement.element
    }];
    const addInspection = (inspection) => {
      if (inspection.element !== sessionElement.element) {
        inspection.element.dataset.dpMentorInspectionStatus = inspection.status;
        inspection.element.dataset.dpMentorInspectionId = inspection.id;
      }
      inspections.push(inspection);
    };

    if (active) {
      addInspection({
        id: "billing-juniper-network-result",
        group: "technical",
        label: "BRAS и источник сессии",
        value: [bras, sessionSource, authorizationType].filter(Boolean).join(" · ") || "Данные не распознаны",
        status: bras && sessionSource ? "ok" : "info",
        message: "BRAS показывает сетевой узел, который обслуживает абонента. Источник и тип авторизации объясняют, откуда пришла сессия и каким способом роутер получил доступ.",
        element: lineElement(/\bBRAS\s*-/i)
      });
      addInspection({
        id: "billing-juniper-addressing-result",
        group: "technical",
        label: "IP, MAC и VLAN",
        value: [ip, mac, vlan ? `VLAN ${vlan}` : ""].filter(Boolean).join(" · ") || "Данные не распознаны",
        status: ip && mac && !/^00(?::00){5}$/i.test(mac) ? "ok" : "info",
        message: "IP — выданный адрес сессии, MAC/USERNAME — авторизовавшееся устройство, VLAN — логический сегмент сети. Сопоставь их с Billing, техническими данными и UserSide.",
        element: sessionElement.element
      });
      addInspection({
        id: "billing-juniper-time-result",
        group: "technical",
        label: "Время и последнее событие",
        value: [startedAt ? `старт ${startedAt}` : "", lastEventAt, lastEvent].filter(Boolean).join(" · ") || "Время не распознано",
        status: startedAt || lastEventAt ? "info" : "warning",
        message: "Время старта показывает возраст текущей сессии. Последнее событие помогает понять, когда данные обновлялись; `Periodic` обычно означает штатное периодическое обновление, а не разрыв.",
        element: lineElement(/Час\s+останньої|Время\s+последнего|Остання\s+подія|Последнее\s+событие/i)
      });
      const trafficElement = lineElement(/Байти\s+прийнято|Байты\s+принято|Швидкість|Скорость/i);
      const traffic = text.match(/(?:Байти\s+прийнято\/передано|Байты\s+принято\/передано)\s*-\s*(.*?)(?=Швидкість|Скорость|Час\s+останньої|Время\s+последнего)/i)?.[1]?.trim() || "";
      const speed = text.match(/(?:Швидкість|Скорость)[^-]*-\s*(.*?)(?=Час\s+останньої|Время\s+последнего|Остання\s+подія|Последнее\s+событие)/i)?.[1]?.trim() || "";
      addInspection({
        id: "billing-juniper-traffic-result",
        group: "technical",
        label: "Обмен и текущая скорость",
        value: [traffic, speed].filter(Boolean).join(" · ") || "Трафик не распознан",
        status: traffic || speed ? "ok" : "info",
        message: "Наличие обмена подтверждает живую сессию. Нулевая текущая скорость сама по себе не доказывает неисправность — учитывай длительность и накопленный трафик.",
        element: trafficElement
      });
      addInspection({
        id: "billing-juniper-device-result",
        group: "technical",
        label: "ROUTER и VENDOR",
        value: [router, vendor].filter(Boolean).join(" · ") || "Данные не распознаны",
        status: router || vendor ? "info" : "warning",
        message: "ROUTER и VENDOR — подсказки по модели и сетевому отпечатку устройства. Они помогают распознать роутер, но не считаются доказательством модели без сверки с абонентом или UserSide.",
        element: lineElement(/\bROUTER\s*-|\bVENDOR\s*-/i)
      });
    } else if (hasPreviousSessionTrace) {
      addInspection({
        id: "billing-juniper-previous-result",
        group: "technical",
        label: "След предыдущей сессии",
        value: [
          lastEventAt,
          lastEvent,
          sessionId && sessionId !== "0" ? `сессия ${sessionId}` : "",
          nonZeroMac ? mac : "",
          bras
        ].filter(Boolean).join(" · ") || "Сохранено упоминание предыдущей работы",
        status: "history",
        message: "Эти значения не подтверждают интернет прямо сейчас. Они подтверждают, что сессия существовала ранее, и дают опорное время для поиска момента отключения.",
        element: lineElement(/Час\s+останньої|Время\s+последнего|Остання\s+подія|Последнее\s+событие|Сес(?:ія|сия)\s*-/i)
      });
    }
    return inspections;
  }

  function onuPollHeaderExpectations() {
    const macPattern = /(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|\b[0-9a-f]{4}(?:[.:-][0-9a-f]{4}){2}\b/i;
    for (const table of document.querySelectorAll("table")) {
      if (table.closest("#dp-panel")) continue;
      const rows = [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")];
      if (rows.length < 2) continue;
      const headers = [...rows[0].querySelectorAll(":scope > th, :scope > td")]
        .map((cell) => normalizedText(cell.textContent).toLowerCase());
      const values = [...rows[1].querySelectorAll(":scope > th, :scope > td")]
        .map((cell) => normalizedText(cell.textContent));
      const onuIndex = headers.findIndex((value) => /^(?:sn|mac)\s*onu$|серийн.*onu|мак.*onu/.test(value));
      const routerIndex = headers.findIndex((value) => /(?:mac|мак)[-\s]*(?:адрес)?\s*(?:абонента|абонента|клиента)/.test(value));
      if (onuIndex < 0 && routerIndex < 0) continue;
      const onuValue = onuIndex >= 0 ? values[onuIndex] || "" : "";
      const routerValue = routerIndex >= 0 ? values[routerIndex] || "" : "";
      return {
        expectedOnuMac: macPattern.test(onuValue) ? onuValue : "",
        expectedOnuSerial: onuValue && !macPattern.test(onuValue) ? onuValue : "",
        expectedRouterMac: macPattern.test(routerValue) ? routerValue : ""
      };
    }
    return { expectedOnuMac: "", expectedOnuSerial: "", expectedRouterMac: "" };
  }

  function decorateOnuOutput(context) {
    const inspections = new Map();
    const candidates = [...document.querySelectorAll("pre, code, td")]
      .filter((node) => !node.closest("#dp-panel"))
      .filter((node) => !node.querySelector("pre, code"))
      .filter((node) => /\b(?:gpon|epon|onu|olt)\b/i.test(node.textContent || ""))
      .slice(0, 30);

    for (const container of candidates) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const textNode of textNodes) {
        if (textNode.parentElement?.closest("#dp-panel, [data-dp-mentor-inspection-line]")) continue;
        const parts = String(textNode.nodeValue || "").split(/(\r?\n)/);
        let decorated = false;
        const fragment = document.createDocumentFragment();
        for (const part of parts) {
          if (/^\r?\n$/.test(part)) {
            fragment.appendChild(document.createTextNode(part));
            continue;
          }
          const lineInspections = knowledge.analyzeOnuOutputLine?.(context, part)
            || [knowledge.classifyOnuOutputLine?.(context, part)].filter(Boolean);
          if (!lineInspections.length) {
            fragment.appendChild(document.createTextNode(part));
            continue;
          }
          decorated = true;
          const primaryInspection = lineInspections[0];
          const span = document.createElement("span");
          span.textContent = part;
          span.dataset.dpMentorInspectionLine = primaryInspection.kind;
          span.dataset.dpMentorInspectionStatus = primaryInspection.status;
          span.dataset.dpMentorInspectionId = `billing-onu-line-${primaryInspection.kind}`;
          fragment.appendChild(span);
          const value = normalizedText(part).slice(0, 180);
          for (const inspection of lineInspections) {
            if (!inspections.has(inspection.kind)) {
              inspections.set(inspection.kind, {
                ...inspection,
                group: "technical",
                id: `billing-onu-line-${inspection.kind}`,
                values: value ? [value] : [],
                element: span,
                elements: [span]
              });
            } else {
              const current = inspections.get(inspection.kind);
              if (!current.elements.includes(span)) current.elements.push(span);
              if (value && !current.values.includes(value) && current.values.length < 4) {
                current.values.push(value);
              }
              const rank = { info: 0, ok: 1, warning: 2 };
              if ((rank[inspection.status] || 0) > (rank[current.status] || 0)) {
                current.status = inspection.status;
                current.message = inspection.message;
              }
            }
          }
        }
        if (decorated) textNode.replaceWith(fragment);
      }
    }
    const findings = [...inspections.values()].map((inspection) => ({
      ...inspection,
      value: inspection.values.join(" · ")
    }));
    let official = null;
    if (onuAnalysis?.analyzeOnuPollResult && candidates.length) {
      const outputContainer = [...candidates]
        .sort((left, right) => String(right.textContent || "").length - String(left.textContent || "").length)[0];
      const rawOutput = String(outputContainer?.textContent || "");
      const action = new URLSearchParams(location.search).get("a") || "";
      try {
        const transcript = onuAnalysis.isolateOnuPollTranscript?.(rawOutput) || rawOutput;
        official = onuAnalysis.analyzeOnuPollResult(transcript, {
          action,
          ...onuPollHeaderExpectations()
        });
      } catch (_) {}
    }

    const byKind = new Map(findings.map((item) => [item.kind, item]));
    const updateFinding = (kind, patch) => {
      const finding = byKind.get(kind);
      if (finding) Object.assign(finding, patch);
    };
    const interpretation = [];
    if (official?.facts && official?.report) {
      const facts = official.facts;
      const report = official.report;
      updateFinding("state", {
        value: `ONU ${facts.status || "unknown"}`,
        status: facts.status === "online" ? "ok" : facts.status === "offline" ? "warning" : "info",
        message: facts.status === "online"
          ? "Диагностический анализатор подтвердил, что ONU находится в сети."
          : facts.status === "offline"
            ? "ONU сейчас не в сети — используй последнюю причину отключения для следующего шага."
            : "Текущий статус ONU не распознан однозначно."
      });

      const routerMacs = facts.macTable?.subscriberMacs || [];
      const routerMacRows = facts.macTable?.subscriberRows || [];
      const onuIdentity = facts.onuMac || facts.serial || "";
      const learnedBindings = routerMacRows.map((row) => [
        row.mac,
        row.vlan ? `VLAN ${row.vlan}` : "",
        row.port || ""
      ].filter(Boolean).join(" · "));
      const macValues = facts.adapter === "bdcom-epon"
        ? [onuIdentity ? `ONU ${onuIdentity}` : "", ...learnedBindings.map((value) => `за ONU: ${value}`)].filter(Boolean)
        : learnedBindings.length
          ? learnedBindings
        : [onuIdentity ? `ONU ${onuIdentity}` : "", routerMacs.length ? `за ONU: ${routerMacs.join(", ")}` : ""].filter(Boolean);
      updateFinding("mac", {
        label: facts.adapter === "bdcom-gpon" ? "MAC, VLAN и PON-порт" : "Изученный MAC и VLAN",
        value: macValues.join(" · ") || "MAC не получен",
        status: routerMacs.length ? "ok" : onuIdentity ? "info" : facts.macTable?.seen ? "warning" : "info",
        message: routerMacs.length
          ? "OLT изучила MAC за этой ONU. VLAN и порт показывают, где именно он обнаружен; сопоставь MAC с Billing и активной Juniper-сессией."
          : onuIdentity
            ? "В выводе найден идентификатор самой ONU. MAC роутера проверяется отдельно в таблице изученных MAC или в Juniper."
          : facts.macTable?.seen
            ? "Таблица MAC получена, но MAC за этой ONU не изучен."
            : "Команда или таблица MAC отсутствует в результате опроса."
      });

      const registration = facts.registration || {};
      const registrationAt = registration.activeAt
        ? new Date(registration.activeAt).toLocaleString("ru-RU", { hour12: false })
        : "";
      const registrationDuration = registration.durationSeconds
        ? registration.durationSeconds >= 86400
          ? `${Math.floor(registration.durationSeconds / 86400)} д ${Math.floor((registration.durationSeconds % 86400) / 3600)} ч`
          : `${Math.floor(registration.durationSeconds / 3600)} ч ${Math.floor((registration.durationSeconds % 3600) / 60)} мин`
        : registration.durationText || "";
      const lastDownAt = registration.lastDownAt
        ? new Date(registration.lastDownAt).toLocaleString("ru-RU", { hour12: false })
        : "";
      updateFinding("registration", {
        value: [registrationAt ? `с ${registrationAt}` : "", registrationDuration ? `активна ${registrationDuration}` : "", registration.distanceMeters ? `${registration.distanceMeters} м` : "", registration.lastDownReasonRaw || "", lastDownAt].filter(Boolean).join(" · ") || "Текущая регистрация не распознана",
        status: registration.activeAt || registration.durationSeconds ? "ok" : "info",
        message: facts.adapter === "bdcom-epon"
          ? "Это единый блок BDCOM EPON: рабочие статусы подтверждают текущую регистрацию, LastRegTime и Alivetime показывают её возраст, а LastDeregTime/Reason относятся к предыдущему обрыву."
          : "Это одна текущая регистрация BDCOM GPON: Active Time — когда ONU поднялась, Active Duration — сколько она непрерывно работает. Короткое время нужно сопоставить с историей ниже."
      });

      const service = facts.service || {};
      updateFinding("service-path", {
        status: service.state === "down" ? "warning" : service.state === "up" ? "ok" : "info",
        message: service.state === "down"
          ? "Service-port найден, но находится down: проверь VLAN, привязку к ONT и состояние услуги."
          : "Сверь VLAN и привязку service-port к фактическим frame/slot/port и ONT этого абонента."
      });

      const ethernet = facts.ethernet || {};
      const ethernetParts = [
        ethernet.link ? `link ${ethernet.link}` : "",
        ethernet.speedMbps ? `${ethernet.speedMbps} Мбит/с` : "",
        ethernet.duplex && ethernet.duplex !== "unknown" ? `${ethernet.duplex}-duplex` : ""
      ].filter(Boolean);
      updateFinding("ethernet-port", {
        value: ethernetParts.join(" · ") || "Состояние порта не получено",
        status: ethernet.link === "down" || ethernet.duplex === "half"
          ? "warning"
          : ethernet.link === "up" ? "ok" : "info",
        message: ethernet.link === "up"
          ? "Линк ONU → роутер поднят; скорость и duplex взяты из общего диагностического анализатора."
          : ethernet.link === "down"
            ? "ONU online, но линк до роутера отсутствует: проверяй кабель, питание и WAN-порт."
            : "Состояние Ethernet-порта не распознано."
      });

      const optics = facts.optics || {};
      const opticalValues = [
        Number.isFinite(optics.onuRxDbm) ? `ONU Rx ${optics.onuRxDbm.toFixed(2)} dBm` : "",
        Number.isFinite(optics.onuTxDbm) ? `ONU Tx ${optics.onuTxDbm.toFixed(2)} dBm` : "",
        Number.isFinite(optics.oltRxDbm) ? `OLT Rx ${optics.oltRxDbm.toFixed(2)} dBm` : ""
      ].filter(Boolean);
      const receivedLevels = [optics.onuRxDbm, optics.oltRxDbm].filter(Number.isFinite);
      const opticalWarn = Number(onuAnalysis.thresholds?.opticalWarnDbm ?? -30);
      const opticalError = Number(onuAnalysis.thresholds?.opticalErrorDbm ?? -32);
      const criticalOptics = receivedLevels.some((value) => value <= opticalError);
      const weakOptics = receivedLevels.some((value) => value <= opticalWarn);
      updateFinding("optics", {
        value: opticalValues.join(" · ") || "Оптические уровни не получены",
        status: criticalOptics || weakOptics ? "warning" : opticalValues.length ? "ok" : "info",
        message: criticalOptics
          ? `Критически слабый приём: порог диагностического модуля ${opticalError} dBm.`
          : weakOptics
            ? `Слабый приём: порог предупреждения диагностического модуля ${opticalWarn} dBm.`
            : opticalValues.length
              ? "Оптические значения прочитаны и не пересекают текущие пороги диагностического модуля."
              : "В ответе нет распознанных оптических уровней."
      });

      const uptime = facts.uptime || {};
      updateFinding("duration", {
        label: facts.adapter === "bdcom-gpon" ? "Online Duration" : facts.adapter === "huawei" ? "Длительность текущей работы" : "Длительность работы",
        value: uptime.text || "Uptime не получен",
        status: uptime.seconds && uptime.seconds < Number(onuAnalysis.thresholds?.stableUptimeSeconds || 7200) && facts.history?.last
          ? "warning" : uptime.seconds ? "ok" : "info",
        message: uptime.seconds
          ? "Длительность интерпретируется вместе с историей отключений: короткий uptime при повторных событиях означает нестабильность, а не просто «ONU online»."
          : "Длительность текущей регистрации не распознана."
      });

      const history = facts.history || {};
      const lastEvent = history.last;
      const lastTime = lastEvent?.at ? new Date(lastEvent.at).toLocaleString("ru-RU", { hour12: false }) : "";
      updateFinding("events", {
        label: facts.adapter === "bdcom-gpon" ? "История включений и отключений" : "История событий ONU",
        value: lastEvent
          ? `${lastEvent.reasonRaw || lastEvent.reasonCode || "событие"}${lastTime ? ` · ${lastTime}` : ""}`
          : "Недавние отключения не распознаны",
        status: history.frequentRecent ? "warning" : lastEvent ? "ok" : "info",
        message: report.history?.length
          ? report.history.join(" ")
          : "История используется как контекст: старое событие не считается текущей причиной при длительном стабильном uptime."
      });

      if (facts.adapter === "bdcom-gpon") {
        const vlanFinding = byKind.get("vlan");
        const macFinding = byKind.get("mac");
        if (vlanFinding && macFinding) {
          macFinding.elements = [...new Set([...(vlanFinding.elements || []), ...(macFinding.elements || [])])];
          macFinding.element = macFinding.elements[0] || macFinding.element;
          const index = findings.indexOf(vlanFinding);
          if (index >= 0) findings.splice(index, 1);
          byKind.delete("vlan");
        }

        const durationFinding = byKind.get("duration");
        const eventsFinding = byKind.get("events");
        if (durationFinding && eventsFinding) {
          eventsFinding.label = "Стабильность: Online Duration и история";
          eventsFinding.value = [durationFinding.value, eventsFinding.value].filter(Boolean).join(" · ");
          eventsFinding.message = "Online Duration показывает возраст текущего подключения. История ниже объясняет, были ли перед ним повторные обрывы; серия LOSi означает потери оптического сигнала, даже если ONU сейчас online.";
          eventsFinding.elements = [...new Set([...(durationFinding.elements || []), ...(eventsFinding.elements || [])])];
          eventsFinding.element = eventsFinding.elements[0] || eventsFinding.element;
          const index = findings.indexOf(durationFinding);
          if (index >= 0) findings.splice(index, 1);
          byKind.delete("duration");
        }
      }

      if (facts.adapter === "bdcom-epon") {
        const removeFinding = (finding) => {
          const index = findings.indexOf(finding);
          if (index >= 0) findings.splice(index, 1);
          if (finding?.kind) byKind.delete(finding.kind);
        };
        const macFinding = byKind.get("mac");
        const vlanFinding = byKind.get("vlan");
        const conflictFinding = byKind.get("identity-conflict");
        if (macFinding) {
          macFinding.label = "MAC ONU и абонента на EPON-порту";
          macFinding.elements = [...new Set([
            ...(conflictFinding?.elements || []),
            ...(vlanFinding?.elements || []),
            ...(macFinding.elements || [])
          ])];
          macFinding.element = macFinding.elements[0] || macFinding.element;
          if (facts.sourceWarnings?.onuMacMismatch) {
            macFinding.status = "warning";
            macFinding.message = "OLT сообщает, что MAC ONU в Billing указан неверно. В таблице разделяй MAC самой ONU и изученный за ней MAC роутера, затем исправляй только подтверждённое значение.";
          }
          if (vlanFinding) removeFinding(vlanFinding);
          if (conflictFinding) removeFinding(conflictFinding);
        }

        const registrationFinding = byKind.get("registration");
        const durationFinding = byKind.get("duration");
        const eventsFinding = byKind.get("events");
        if (registrationFinding) {
          registrationFinding.label = "Текущая регистрация и предыдущий обрыв";
          registrationFinding.elements = [...new Set([
            ...(registrationFinding.elements || []),
            ...(durationFinding?.elements || []),
            ...(eventsFinding?.elements || [])
          ])];
          registrationFinding.element = registrationFinding.elements[0] || registrationFinding.element;
          if (durationFinding) removeFinding(durationFinding);
          if (eventsFinding) removeFinding(eventsFinding);
          const stateFinding = byKind.get("state");
          if (stateFinding) removeFinding(stateFinding);
        }
      }

      if (report.current?.length) {
        interpretation.push({
          id: "billing-onu-current-summary",
          group: "conclusion",
          label: "Что подтверждено",
          value: report.current.join(" "),
          status: "ok",
          message: "Факты сформированы существующим диагностическим анализатором.",
          element: null
        });
      }
      if (report.deviations?.length) {
        interpretation.push({
          id: "billing-onu-deviations-summary",
          group: "conclusion",
          label: "Что требует внимания",
          value: report.deviations.join(" "),
          status: "warning",
          message: "Каждое отклонение нужно сопоставить с подсвеченными исходными строками опроса.",
          element: null
        });
      }
      const status = report.severity === "ok" ? "ok"
        : ["warn", "error", "conflict"].includes(report.severity) ? "warning" : "info";
      interpretation.push({
        id: "billing-onu-conclusion-summary",
        group: "conclusion",
        label: "Вывод по опросу ONU",
        value: `${report.badge || "UNKNOWN"} · ${report.summary || "Результат получен"}`,
        status,
        message: report.conclusion || "Для полного вывода проверь фактическую сессию в Juniper.",
        element: null
      });
    } else {
      const coreKinds = ["state", "mac", "ethernet-port", "optics", "events"];
      const missing = coreKinds.filter((kind) => !byKind.has(kind));
      const warnings = findings.filter((item) => item.status === "warning");
      interpretation.push({
        id: "billing-onu-conclusion-summary",
        group: "conclusion",
        label: "Вывод по опросу ONU",
        value: warnings.length ? `Найдено отклонений: ${warnings.length}` : missing.length ? `Не хватает блоков: ${missing.length}` : "Основные данные считаны",
        status: warnings.length ? "warning" : missing.length ? "info" : "ok",
        message: "Основной диагностический анализатор недоступен; показан только резервный разбор строк.",
        element: null
      });
    }
    return [...findings, ...interpretation];
  }

  function inspectionHtml(inspection) {
    const statuses = {
      ok: "Норма",
      history: "Была ранее",
      inactive: "Ожидаемо нет",
      warning: "Проверь",
      info: "Важно"
    };
    const reviewed = inspection.reviewed === true || runtime.reviewedInspectionIds.has(inspection.id);
    const statusLabel = inspection.id === "billing-juniper-session-result" && inspection.status === "ok"
      ? "Сессия активна"
      : statuses[inspection.status] || "Показать";
    const notes = {
      ok: "Значение соответствует известному штатному условию.",
      history: "Активной сессии сейчас нет, но сохранился подтверждённый след предыдущей работы.",
      inactive: ["identifiers", "binding"].includes(inspection.group)
        ? "Для выбранной технологии это поле не требуется."
        : "Отсутствие сессии ожидаемо из-за подтверждённого неактивного состояния услуги.",
      warning: "Это значение требует отдельной проверки до продолжения работы.",
      info: "Это важное поле нужно прочитать и сопоставить с другими источниками."
    };
    const noteOpen = runtime.openInspectionNotes.has(inspection.id)
      || (inspection.status === "warning" && !runtime.closedInspectionNotes.has(inspection.id));
    return `
      <article class="dp-mentor-inspection ${escapeHtml(inspection.status)}${reviewed ? " reviewed" : ""}" data-mentor-inspection-card="${escapeHtml(inspection.id)}">
        <button type="button" class="dp-mentor-inspection-row" data-mentor-inspection-note="${escapeHtml(inspection.id)}" aria-expanded="${noteOpen ? "true" : "false"}">
          <span class="dp-mentor-inspection-label">${escapeHtml(inspection.label)}</span>
          <span class="dp-mentor-inspection-reading">
            <i class="dp-mentor-inspection-status-dot" aria-hidden="true"></i>
            <strong>${escapeHtml(inspection.value || "Найдено на странице")}</strong>
            <small title="Открыть учебное пояснение">?</small>
          </span>
        </button>
        <div class="dp-mentor-inspection-note${noteOpen ? " open" : ""}">
          <div class="dp-mentor-inspection-note-inner">
            <p>${escapeHtml(notes[inspection.status] || notes.info)}</p>
            <details class="dp-mentor-inspection-more">
              <summary>${escapeHtml(statusLabel)} · Подробнее</summary>
              <p>${escapeHtml(inspection.message)}</p>
            </details>
            ${inspection.element ? `<div class="dp-mentor-inspection-actions"><button type="button" data-mentor-inspection-show="${escapeHtml(inspection.id)}">${reviewed ? "Подсветить снова" : "Показать на странице"}</button></div>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function inspectionGroupHtml(group, title, inspections) {
    if (!inspections.length) return "";
    const reviewable = inspections.filter((item) => item.element);
    const reviewed = reviewable.filter((item) => item.reviewed === true || runtime.reviewedInspectionIds.has(item.id)).length;
    const warnings = inspections.filter((item) => item.status === "warning").length;
    const opened = runtime.expandedInspectionGroup === group;
    return `
      <details class="dp-mentor-inspection-group" data-mentor-inspection-group="${escapeHtml(group)}" data-mentor-warning-count="${warnings}"${opened ? " open" : ""}>
        <summary>
          <span><b>${escapeHtml(title)}</b><em>${inspections.length} ${inspections.length === 1 ? "пункт" : inspections.length < 5 ? "пункта" : "пунктов"}</em></span>
          ${warnings || reviewable.length ? `<small>${warnings ? `${warnings} проверь` : `${reviewed} / ${reviewable.length}`}</small>` : ""}
        </summary>
        <div>${inspections.map(inspectionHtml).join("")}</div>
      </details>
    `;
  }

  function renderFieldInspections(context) {
    clearFieldDecorations();
    const section = document.querySelector("#dp-mentor-inspections");
    const list = document.querySelector("#dp-mentor-inspection-list");
    if (!section || !list) return [];
    const headerHint = section.querySelector(":scope > header span");
    if (headerHint) {
      headerHint.textContent = context.billingSection === "juniper"
        ? "Juniper: зелёный — активна сейчас · жёлтый — была ранее · серый — ожидаемо нет · красный — необъяснённо нет. Нажми строку для пояснения."
        : context.billingSection === "technical"
          ? "Мини-курс: определи технологию, различи MAC абонента и ONU, проверь OLT и выбери правильный следующий раздел."
        : "Нажми строку — откроется пояснение; кнопка внутри подсветит источник на странице.";
    }
    let inspections = [];
    if (context.billingSection === "account") inspections = accountFieldInspections(context);
    if (context.billingSection === "technical") inspections = technicalFieldInspections(context);
    if (context.billingSection === "juniper") inspections = juniperFieldInspections(context);
    if (context.billingSection === "onu") inspections = decorateOnuOutput(context);
    runtime.currentInspections = inspections;
    runtime.inspectionAnchors = new Map(
      inspections.filter((item) => item.element).map((item) => [item.id, item.element])
    );
    const availability = inspections.filter((item) => item.group === "availability");
    const access = inspections.filter((item) => item.group === "access");
    const service = inspections.filter((item) => item.group === "service");
    const finance = inspections.filter((item) => item.group === "finance");
    const technology = inspections.filter((item) => item.group === "technology");
    const identifiers = inspections.filter((item) => item.group === "identifiers");
    const binding = inspections.filter((item) => item.group === "binding");
    const nextStep = inspections.filter((item) => item.group === "next-step");
    const technical = inspections.filter((item) => item.group === "technical");
    const conclusion = inspections.filter((item) => item.group === "conclusion");
    const other = inspections.filter((item) => !["availability", "access", "service", "finance", "technology", "identifiers", "binding", "next-step", "technical", "conclusion"].includes(item.group));
    list.innerHTML = [
      inspectionGroupHtml("availability", "Интернет сейчас", availability),
      inspectionGroupHtml("access", "Доступ и ограничения", access),
      inspectionGroupHtml("service", "Состояние услуги", service),
      inspectionGroupHtml("finance", "Финансы", finance),
      inspectionGroupHtml("technology", "Тип подключения", technology),
      inspectionGroupHtml("identifiers", "Идентификаторы оборудования", identifiers),
      inspectionGroupHtml("binding", "Привязка оборудования", binding),
      inspectionGroupHtml("next-step", "Следующий шаг", nextStep),
      inspectionGroupHtml("technical", "Техническая проверка", technical),
      inspectionGroupHtml("conclusion", "Интерпретация опроса", conclusion),
      inspectionGroupHtml("other", "Дополнительный контроль", other)
    ].join("");
    section.hidden = !inspections.length;
    updateProgress(runtime.currentRules, inspections);
    return inspections;
  }

  function markInspectionReviewed(id, card = null) {
    const inspection = runtime.currentInspections.find((item) => item.id === id);
    if (!inspection) return;
    runtime.reviewedInspectionIds.add(id);
    const targetCard = card || document.querySelector(`[data-mentor-inspection-card="${CSS.escape(id)}"]`);
    targetCard?.classList.add("reviewed");
    const showButton = targetCard?.querySelector("[data-mentor-inspection-show]");
    if (showButton) showButton.textContent = "Подсветить снова";
    const group = targetCard?.closest(".dp-mentor-inspection-group");
    const counter = group?.querySelector(":scope > summary small");
    if (group && counter) {
      const reviewable = group.querySelectorAll("[data-mentor-inspection-show]").length;
      const reviewed = group.querySelectorAll(".dp-mentor-inspection.reviewed [data-mentor-inspection-show]").length;
      const warnings = Number(group.dataset.mentorWarningCount || 0);
      counter.textContent = warnings ? `${warnings} проверь` : `${reviewed} / ${reviewable}`;
    }
    updateProgress(runtime.currentRules, runtime.currentInspections);
  }

  async function revealInspection(id) {
    const inspection = runtime.currentInspections.find((item) => item.id === id);
    const anchor = runtime.inspectionAnchors.get(id);
    if (!inspection || !anchor?.isConnected) {
      showMentorNotice("Поле уже изменилось или исчезло со страницы. Нажми «Обновить контекст».");
      return false;
    }
    const explanations = {
      ok: "Значение соответствует известному штатному условию.",
      history: "Активной сессии сейчас нет, но на странице остался подтверждённый след предыдущей работы.",
      inactive: "Отсутствие сессии ожидаемо из-за подтверждённого неактивного состояния услуги.",
      warning: "Это значение требует отдельной проверки до продолжения работы.",
      info: "Это важное поле нужно прочитать и сопоставить с другими источниками."
    };
    const focused = await showFocus({
      id: inspection.id,
      stage: "Контроль поля",
      title: `${inspection.label}: ${inspection.value || "найдено"}`,
      instruction: inspection.message,
      why: explanations[inspection.status] || explanations.info
    }, anchor, inspection.elements || []);
    if (!focused) {
      showMentorNotice("Не удалось раскрыть или точно навести нужное поле. Обнови контекст и повтори подсветку.");
      return false;
    }
    showMentorNotice("");
    const button = [...document.querySelectorAll("[data-mentor-inspection-show]")]
      .find((node) => node.dataset.mentorInspectionShow === inspection.id);
    const card = button?.closest(".dp-mentor-inspection");
    markInspectionReviewed(inspection.id, card);
    if (inspection.id === "billing-juniper-session-result") {
      runtime.juniperReviews.set(subscriberIdentity(), Object.freeze({
        status: inspection.status,
        value: inspection.value,
        message: inspection.message,
        checkedAt: new Date().toISOString()
      }));
      saveJuniperReviews();
    }
    return true;
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
          <label><input type="checkbox" data-mentor-done="${rule.id}"${completed ? " checked" : ""}> Шаг выполнен</label>
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
    const progress = knowledge.progressFor(ruleList, runtime.completed);
    if (!progress.next) {
      container.innerHTML = `
        <div class="dp-mentor-complete">
          <b>Раздел пройден</b>
          <span>Все ${progress.total} шагов этого раздела отмечены. При необходимости сбрось отметки и пройди маршрут заново.</span>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div class="dp-mentor-step-intro">
        <b>Шаг ${progress.done + 1} из ${progress.total}</b>
        <span>Сейчас изучаем только этот элемент страницы. После отметки откроется следующий шаг.</span>
      </div>
      ${ruleCardHtml(progress.next, false)}
    `;
    container.querySelectorAll("[data-mentor-show]").forEach((button) => {
      button.addEventListener("click", () => revealRule(button.dataset.mentorShow, true));
    });
    container.querySelectorAll("[data-mentor-done]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.mentorDone;
        if (checkbox.checked) runtime.completed.add(id);
        else runtime.completed.delete(id);
        saveCompletedByContext();
        clearFocus();
        refreshMentor({ autoReveal: runtime.autoHints });
      });
    });
  }

  function updateProgress(ruleList, inspections = runtime.currentInspections) {
    const progress = knowledge.progressFor(ruleList, runtime.completed);
    const label = document.querySelector("#dp-mentor-progress-label");
    const bar = document.querySelector("#dp-mentor-progress-bar");
    const reviewable = (inspections || []).filter((item) => item.element);
    const reviewed = reviewable.filter((item) => item.reviewed === true || runtime.reviewedInspectionIds.has(item.id)).length;
    const learnedPercent = reviewable.length ? Math.round((reviewed / reviewable.length) * 100) : progress.percent;
    if (label) {
      label.textContent = reviewable.length
        ? `Изучено: ${reviewed} / ${reviewable.length}`
        : `Изучено: ${progress.done} / ${progress.total}`;
    }
    if (bar) bar.style.width = `${learnedPercent}%`;
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
    runtime.focusRequestId += 1;
    const highlighted = runtime.highlightedElements.length
      ? runtime.highlightedElements
      : runtime.highlighted ? [runtime.highlighted] : [];
    highlighted.forEach((element) => element?.classList?.remove("dp-mentor-highlight"));
    runtime.highlighted = null;
    runtime.highlightedElements = [];
    runtime.activeRuleId = "";
    runtime.spotlight?.remove();
    runtime.spotlight = null;
    runtime.marker?.remove();
    runtime.marker = null;
    if (runtime.focusFrame) window.cancelAnimationFrame(runtime.focusFrame);
    runtime.focusFrame = 0;
    const focus = document.querySelector("#dp-mentor-focus");
    if (focus) focus.hidden = true;
  }

  function focusWorkArea() {
    const panel = document.querySelector("#dp-panel");
    const panelRect = panel?.getBoundingClientRect?.();
    const right = panelRect && panelRect.left > window.innerWidth * 0.45
      ? Math.min(window.innerWidth, panelRect.left)
      : window.innerWidth;
    return { left: 0, top: 0, right, bottom: window.innerHeight };
  }

  function setShadeRect(node, left, top, width, height) {
    node.style.left = `${Math.max(0, left)}px`;
    node.style.top = `${Math.max(0, top)}px`;
    node.style.width = `${Math.max(0, width)}px`;
    node.style.height = `${Math.max(0, height)}px`;
  }

  function highlightedRect(anchor) {
    const elements = runtime.highlighted === anchor && runtime.highlightedElements.length
      ? runtime.highlightedElements
      : [anchor];
    const rects = elements
      .filter((element) => element?.isConnected)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return anchor.getBoundingClientRect();
    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.min(...rects.map((rect) => rect.top)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
      width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
      height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top))
    };
  }

  function positionSpotlight(anchor, spotlight) {
    const rect = highlightedRect(anchor);
    const area = focusWorkArea();
    const padding = 8;
    const left = Math.max(area.left, Math.min(area.right, rect.left) - padding);
    const right = Math.max(left, Math.min(area.right, rect.right) + padding);
    const top = Math.max(area.top, Math.min(area.bottom, rect.top) - padding);
    const bottom = Math.max(top, Math.min(area.bottom, rect.bottom) + padding);
    const shades = spotlight.querySelectorAll(".dp-mentor-spotlight-shade");
    setShadeRect(shades[0], area.left, area.top, area.right - area.left, top - area.top);
    setShadeRect(shades[1], area.left, top, left - area.left, bottom - top);
    setShadeRect(shades[2], right, top, area.right - right, bottom - top);
    setShadeRect(shades[3], area.left, bottom, area.right - area.left, area.bottom - bottom);
  }

  function createSpotlight(anchor) {
    const spotlight = document.createElement("div");
    spotlight.id = "dp-mentor-spotlight";
    spotlight.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 4; index += 1) {
      const shade = document.createElement("button");
      shade.type = "button";
      shade.className = "dp-mentor-spotlight-shade";
      shade.tabIndex = -1;
      shade.setAttribute("aria-label", "Закрыть подсказку");
      shade.addEventListener("click", clearFocus);
      spotlight.appendChild(shade);
    }
    document.body.appendChild(spotlight);
    runtime.spotlight = spotlight;
    positionSpotlight(anchor, spotlight);
    return spotlight;
  }

  function positionMarker(anchor, marker) {
    const rect = highlightedRect(anchor);
    const area = focusWorkArea();
    const markerRect = marker.getBoundingClientRect();
    const width = markerRect.width || 280;
    const height = markerRect.height || 96;
    const gap = 18;
    const margin = 12;
    let side = "right";
    let left = rect.right + gap;
    let top = rect.top + (rect.height - height) / 2;

    if (left + width > area.right - margin) {
      side = "left";
      left = rect.left - width - gap;
    }
    if (left < area.left + margin) {
      side = "bottom";
      left = rect.left + (rect.width - width) / 2;
      top = rect.bottom + gap;
    }
    if (side === "bottom" && top + height > area.bottom - margin) {
      side = "top";
      top = rect.top - height - gap;
    }
    left = Math.max(area.left + margin, Math.min(area.right - width - margin, left));
    top = Math.max(area.top + margin, Math.min(area.bottom - height - margin, top));
    marker.dataset.side = side;
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;
  }

  function scheduleFocusPosition() {
    if (!runtime.highlighted || !runtime.marker || !runtime.spotlight || runtime.focusFrame) return;
    runtime.focusFrame = window.requestAnimationFrame(() => {
      runtime.focusFrame = 0;
      if (!runtime.highlighted?.isConnected) {
        clearFocus();
        return;
      }
      positionSpotlight(runtime.highlighted, runtime.spotlight);
      positionMarker(runtime.highlighted, runtime.marker);
    });
  }

  function nextPaint() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function anchorIsVisible(anchor) {
    if (!anchor?.isConnected) return false;
    const rect = anchor.getBoundingClientRect();
    const style = window.getComputedStyle(anchor);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  }

  async function expandCollapsedAncestors(anchor) {
    const chain = [];
    for (let node = anchor; node && node !== document.body; node = node.parentElement) {
      chain.push(node);
    }
    chain.reverse();
    for (const node of chain) {
      if (node.tagName === "DETAILS" && !node.open) {
        node.open = true;
        await nextPaint();
        continue;
      }
      const hidden = node.hidden
        || window.getComputedStyle(node).display === "none"
        || node.getClientRects().length === 0;
      if (!hidden) continue;

      let toggle = null;
      const legacy = String(node.id || "").match(/^my_x_(\d+)$/i);
      if (legacy) {
        const signature = `show_x(${legacy[1]})`;
        toggle = [...document.querySelectorAll("a[href]")]
          .find((candidate) => String(candidate.getAttribute("href") || "").replace(/\s+/g, "").includes(signature));
      }
      if (!toggle && node.id) {
        toggle = [...document.querySelectorAll("[aria-controls]")]
          .find((candidate) => candidate.getAttribute("aria-controls") === node.id);
      }
      if (toggle) {
        toggle.click();
        await nextPaint();
      }
      if (legacy && node.getClientRects().length === 0) {
        node.hidden = false;
        node.style.removeProperty("display");
        if (window.getComputedStyle(node).display === "none") {
          node.style.display = node.tagName === "TR" ? "table-row" : "block";
        }
        await nextPaint();
      }
    }
    await nextPaint();
    return anchorIsVisible(anchor);
  }

  async function showFocus(rule, anchor, relatedElements = []) {
    clearFocus();
    const requestId = runtime.focusRequestId;
    const visible = await expandCollapsedAncestors(anchor);
    if (!visible || requestId !== runtime.focusRequestId) return false;
    runtime.activeRuleId = rule.id;
    runtime.highlighted = anchor;
    runtime.highlightedElements = [...new Set([anchor, ...relatedElements])]
      .filter((element) => element?.isConnected);
    runtime.highlightedElements.forEach((element) => element.classList.add("dp-mentor-highlight"));
    anchor.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await nextPaint();
    await nextPaint();
    if (requestId !== runtime.focusRequestId || !anchorIsVisible(anchor)) return false;
    createSpotlight(anchor);

    const marker = document.createElement("aside");
    marker.id = "dp-mentor-target-marker";
    marker.setAttribute("role", "note");
    const markerStage = document.createElement("small");
    markerStage.textContent = rule.stage;
    const markerTitle = document.createElement("b");
    markerTitle.textContent = rule.title;
    const markerInstruction = document.createElement("p");
    markerInstruction.textContent = rule.instruction;
    marker.append(markerStage, markerTitle, markerInstruction);
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
    return true;
  }

  async function revealRule(id, explicit = false) {
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
    const focused = await showFocus(rule, anchor);
    if (!focused && explicit) {
      showMentorNotice("Не удалось раскрыть или точно навести нужный раздел. Обнови контекст и повтори подсветку.");
    }
    return focused;
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
    const reviewContextKey = `${nextContextKey}|${location.pathname}|${location.search}`;
    if (runtime.reviewedInspectionContext !== reviewContextKey) {
      runtime.reviewedInspectionContext = reviewContextKey;
      runtime.reviewedInspectionIds = new Set();
      runtime.openInspectionNotes = new Set();
      runtime.closedInspectionNotes = new Set();
      runtime.expandedInspectionGroup = context.billingSection === "technical" ? "technology" : "availability";
    }
    if (runtime.contextKey && runtime.contextKey !== nextContextKey) {
      runtime.completedByContext.set(runtime.contextKey, runtime.completed);
      clearFocus();
    }
    if (runtime.contextKey !== nextContextKey) {
      runtime.completed = runtime.completedByContext.get(nextContextKey) || new Set();
      runtime.completedByContext.set(nextContextKey, runtime.completed);
    }
    runtime.contextKey = nextContextKey;
    runtime.currentRules = knowledge.rulesForContext(context);
    const contextNode = document.querySelector("#dp-mentor-context");
    if (contextNode) contextNode.textContent = pageLabel(context);
    const inspections = renderFieldInspections(context);
    ensureTechnicalProfile(context);
    renderRules(context, runtime.currentRules);
    const progress = updateProgress(runtime.currentRules);
    const ponTargetPending = context.system === "billing"
      && context.billingSection === "onu"
      && !runtime.completed.has("billing-onu-target");
    const warningCount = inspections.filter((item) => item.status === "warning").length;
    showMentorNotice(
      warningCount
        ? `На странице найдено отклонений: ${warningCount}. Сначала проверь поля с красной подсветкой.`
        : ponTargetPending
        ? "PON: сначала подтверди, что открыт правильный OLT, порт и ONU. После отметки наставник перейдёт к статусу."
        : progress.total && progress.done === progress.total
          ? "Чек-лист завершён. Перед заявкой ещё раз отдели подтверждённые факты от предположений."
          : ""
    );
    if (options.autoReveal) window.setTimeout(revealNextRule, 220);
  }

  function installStyles() {
    GM_addStyle(`
      #dp-panel[data-operation-mode="mentor"] {
        --dp-mentor-bg:#f6f7f9;
        --dp-mentor-surface:#ffffff;
        --dp-mentor-surface-soft:#f9fafb;
        --dp-mentor-line:#d9dee7;
        --dp-mentor-line-strong:#b9c2d0;
        --dp-mentor-text:#172033;
        --dp-mentor-muted:#667085;
        --dp-mentor-blue:#2878f0;
        --dp-mentor-blue-soft:#eef5ff;
        color:var(--dp-mentor-text) !important;
        background:var(--dp-mentor-bg) !important;
      }
      #dp-operation-mode {
        display:flex !important; align-items:center !important; justify-content:space-between !important;
        gap:10px !important; padding:8px 14px !important; color:#344054 !important; background:#fff !important;
        border-bottom:1px solid #d9dee7 !important;
      }
      .dp-operation-mode-toggle { display:flex !important; align-items:center !important; gap:9px !important; color:#344054 !important; font-size:10.5px !important; font-weight:650 !important; }
      .dp-operation-mode-switch { position:relative !important; width:36px !important; height:20px !important; flex:0 0 auto !important; padding:0 !important; background:#b9c2d0 !important; border:0 !important; border-radius:999px !important; box-shadow:inset 0 0 0 1px rgba(16,24,40,.08) !important; cursor:pointer !important; transition:background .16s ease !important; }
      .dp-operation-mode-switch > i { position:absolute !important; top:2px !important; left:2px !important; width:16px !important; height:16px !important; background:#fff !important; border-radius:50% !important; box-shadow:0 1px 2px rgba(16,24,40,.22) !important; transition:transform .16s ease !important; }
      .dp-operation-mode-switch.active { background:#2878f0 !important; }
      .dp-operation-mode-switch.active > i { transform:translateX(16px) !important; }
      #dp-mentor-progress-label { color:#175cd3 !important; font:600 10px/1.2 Consolas,"SFMono-Regular",monospace !important; opacity:0 !important; transition:opacity .18s ease !important; }
      #dp-panel[data-operation-mode="mentor"] #dp-mentor-progress-label { opacity:1 !important; }
      #dp-mentor-workspace { display:none !important; min-height:0 !important; flex:1 1 auto !important; overflow:auto !important; color:var(--dp-mentor-text) !important; background:var(--dp-mentor-bg) !important; }
      #dp-panel[data-operation-mode="mentor"] #dp-role-banner,
      #dp-panel[data-operation-mode="mentor"] #dp-workspace-tabs,
      #dp-panel[data-operation-mode="mentor"] #dp-status,
      #dp-panel[data-operation-mode="mentor"] #dp-form,
      #dp-panel[data-operation-mode="mentor"] #dp-results,
      #dp-panel[data-operation-mode="mentor"] #dp-journal-resizer,
      #dp-panel[data-operation-mode="mentor"] #dp-journal-wrap { display:none !important; }
      #dp-panel[data-operation-mode="mentor"] #dp-mentor-workspace { display:block !important; }
      .dp-mentor-header { position:sticky !important; top:0 !important; z-index:3 !important; display:flex !important; justify-content:space-between !important; align-items:center !important; gap:12px !important; padding:12px 14px !important; background:rgba(255,255,255,.97) !important; border-bottom:1px solid var(--dp-mentor-line) !important; box-shadow:0 1px 2px rgba(16,24,40,.04) !important; }
      .dp-mentor-header > div { display:grid !important; gap:2px !important; min-width:0 !important; }
      .dp-mentor-header b { color:var(--dp-mentor-text) !important; font-size:14px !important; font-weight:750 !important; }
      .dp-mentor-header span { color:var(--dp-mentor-muted) !important; font-size:10.5px !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
      .dp-mentor-header-actions { display:flex !important; align-items:center !important; gap:7px !important; }
      .dp-mentor-header-actions > button { min-height:28px !important; padding:0 8px !important; color:#344054 !important; background:#fff !important; border:1px solid #d0d5dd !important; border-radius:7px !important; box-shadow:0 1px 2px rgba(16,24,40,.05) !important; font-size:9.5px !important; font-weight:700 !important; cursor:pointer !important; }
      .dp-mentor-header label { display:flex !important; align-items:center !important; gap:5px !important; color:#475467 !important; font-size:10px !important; white-space:nowrap !important; cursor:pointer !important; }
      .dp-mentor-header input, .dp-mentor-rule input { accent-color:var(--dp-mentor-blue) !important; }
      .dp-mentor-progress { display:grid !important; gap:7px !important; padding:10px 14px !important; background:#fff !important; border-bottom:1px solid var(--dp-mentor-line) !important; }
      .dp-mentor-progress > div { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; color:#175cd3 !important; font-size:10.5px !important; font-weight:750 !important; }
      .dp-mentor-progress button { padding:3px 7px !important; color:#667085 !important; background:transparent !important; border:0 !important; border-radius:6px !important; font-size:9.5px !important; cursor:pointer !important; }
      .dp-mentor-progress button:hover { color:#344054 !important; background:#f2f4f7 !important; }
      .dp-mentor-progress i { height:4px !important; overflow:hidden !important; background:#e9edf3 !important; border-radius:99px !important; }
      .dp-mentor-progress i b { display:block !important; width:0; height:100% !important; background:var(--dp-mentor-blue) !important; border-radius:inherit !important; transition:width .2s ease !important; }
      #dp-mentor-notice { margin:10px 12px 0 !important; padding:9px 10px !important; color:#7a4d0b !important; background:#fff8eb !important; border:1px solid #f2d39b !important; border-radius:8px !important; font-size:10.5px !important; line-height:1.4 !important; }
      #dp-mentor-notice:empty { display:none !important; }
      #dp-mentor-focus { display:grid !important; grid-template-columns:minmax(0,1fr) auto !important; gap:7px 10px !important; margin:10px 12px 0 !important; padding:11px !important; color:var(--dp-mentor-text) !important; background:var(--dp-mentor-blue-soft) !important; border:1px solid #84adff !important; border-radius:10px !important; box-shadow:0 4px 12px rgba(40,120,240,.09) !important; }
      #dp-mentor-focus[hidden] { display:none !important; }
      #dp-mentor-focus > div { display:grid !important; gap:2px !important; min-width:0 !important; }
      #dp-mentor-focus small { color:#175cd3 !important; font-size:9px !important; font-weight:750 !important; letter-spacing:.04em !important; text-transform:uppercase !important; }
      #dp-mentor-focus b { color:#1849a9 !important; font-size:13px !important; }
      #dp-mentor-focus > button { align-self:start !important; min-height:27px !important; padding:0 8px !important; color:#344054 !important; background:#fff !important; border:1px solid #b2ccff !important; border-radius:7px !important; font-size:9.5px !important; font-weight:700 !important; cursor:pointer !important; }
      #dp-mentor-focus p, #dp-mentor-focus em { grid-column:1 / -1 !important; margin:0 !important; line-height:1.45 !important; }
      #dp-mentor-focus p { color:#344054 !important; font-size:11px !important; }
      #dp-mentor-focus em { color:#667085 !important; font-size:10px !important; font-style:normal !important; }
      #dp-mentor-rules { display:grid !important; gap:10px !important; padding:12px !important; }
      #dp-mentor-inspections { display:grid !important; gap:10px !important; padding:13px 12px !important; background:var(--dp-mentor-bg) !important; border-bottom:1px solid var(--dp-mentor-line) !important; }
      #dp-mentor-inspections[hidden] { display:none !important; }
      #dp-mentor-inspections > header { display:grid !important; gap:2px !important; }
      #dp-mentor-inspections > header b { color:var(--dp-mentor-text) !important; font-size:12px !important; font-weight:750 !important; }
      #dp-mentor-inspections > header span { color:var(--dp-mentor-muted) !important; font-size:9.5px !important; line-height:1.35 !important; }
      #dp-mentor-inspection-list { display:grid !important; gap:8px !important; }
      .dp-mentor-inspection-group { --dp-mentor-group:#667085; display:block !important; padding:0 !important; overflow:hidden !important; background:var(--dp-mentor-surface) !important; border:1px solid var(--dp-mentor-line) !important; border-radius:10px !important; box-shadow:0 1px 2px rgba(16,24,40,.04) !important; }
      .dp-mentor-inspection-group > summary { display:grid !important; grid-template-columns:minmax(0,1fr) auto auto !important; align-items:center !important; gap:9px !important; min-height:46px !important; box-sizing:border-box !important; padding:9px 11px 9px 13px !important; color:var(--dp-mentor-text) !important; background:#fff !important; box-shadow:inset 3px 0 var(--dp-mentor-group) !important; cursor:pointer !important; list-style:none !important; user-select:none !important; }
      .dp-mentor-inspection-group > summary::-webkit-details-marker { display:none !important; }
      .dp-mentor-inspection-group > summary::after { content:"›" !important; color:#98a2b3 !important; font-size:20px !important; font-weight:700 !important; line-height:1 !important; transform:rotate(0deg) !important; transition:transform .16s ease !important; }
      .dp-mentor-inspection-group[open] > summary::after { transform:rotate(90deg) !important; }
      .dp-mentor-inspection-group[open] > summary { background:#fcfcfd !important; border-bottom:1px solid var(--dp-mentor-line) !important; }
      .dp-mentor-inspection-group > summary > span { display:grid !important; gap:2px !important; min-width:0 !important; }
      .dp-mentor-inspection-group > summary b { color:var(--dp-mentor-group) !important; font-size:11px !important; font-weight:750 !important; letter-spacing:0 !important; text-transform:none !important; }
      .dp-mentor-inspection-group > summary em { color:#98a2b3 !important; font-size:9px !important; font-style:normal !important; font-weight:600 !important; }
      .dp-mentor-inspection-group > summary small { min-width:34px !important; color:#667085 !important; font-size:9px !important; font-weight:700 !important; text-align:right !important; }
      .dp-mentor-inspection-group[data-mentor-warning-count]:not([data-mentor-warning-count="0"]) > summary small { color:#d92d20 !important; }
      .dp-mentor-inspection-group > div { display:grid !important; gap:7px !important; padding:8px !important; background:#f8fafc !important; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="availability"] { --dp-mentor-group:#0e9384; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="access"] { --dp-mentor-group:#039855; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="service"] { --dp-mentor-group:#6172f3; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="finance"] { --dp-mentor-group:#dc6803; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="technology"] { --dp-mentor-group:#0e9384; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="identifiers"] { --dp-mentor-group:#1570ef; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="binding"] { --dp-mentor-group:#7f56d9; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="next-step"] { --dp-mentor-group:#dc6803; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="technical"] { --dp-mentor-group:#1570ef; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="conclusion"] { --dp-mentor-group:#7f56d9; }
      .dp-mentor-inspection-group[data-mentor-inspection-group="other"] { --dp-mentor-group:#667085; }
      .dp-mentor-inspection { --dp-mentor-status:#2e90fa; display:block !important; overflow:hidden !important; padding:0 !important; background:#fff !important; border:1px solid #dfe3ea !important; border-radius:9px !important; box-shadow:0 1px 2px rgba(16,24,40,.03) !important; transition:border-color .16s ease,box-shadow .16s ease !important; }
      .dp-mentor-inspection.ok { --dp-mentor-status:#12b76a; }
      .dp-mentor-inspection.history { --dp-mentor-status:#f79009; }
      .dp-mentor-inspection.inactive { --dp-mentor-status:#98a2b3; }
      .dp-mentor-inspection.warning { --dp-mentor-status:#f04438; }
      .dp-mentor-inspection.info { --dp-mentor-status:#2e90fa; }
      .dp-mentor-inspection:has(.dp-mentor-inspection-note.open) { border-color:#84adff !important; box-shadow:0 0 0 2px #e8f1ff !important; }
      .dp-mentor-inspection-row { display:flex !important; align-items:center !important; justify-content:space-between !important; flex-wrap:wrap !important; gap:5px 10px !important; width:100% !important; min-height:42px !important; box-sizing:border-box !important; padding:9px 10px !important; color:var(--dp-mentor-text) !important; background:#fff !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; text-align:left !important; cursor:pointer !important; }
      .dp-mentor-inspection-row:hover { background:#fcfcfd !important; }
      .dp-mentor-inspection-label { flex:0 1 38% !important; min-width:80px !important; color:#667085 !important; font-size:10px !important; font-weight:600 !important; line-height:1.35 !important; }
      .dp-mentor-inspection-reading { display:flex !important; align-items:center !important; justify-content:flex-end !important; gap:6px !important; flex:1 1 58% !important; min-width:150px !important; color:#101828 !important; font:600 9.5px/1.35 Consolas,"SFMono-Regular",monospace !important; text-align:right !important; overflow-wrap:anywhere !important; }
      .dp-mentor-inspection-reading > strong { min-width:0 !important; color:inherit !important; font:inherit !important; }
      .dp-mentor-inspection-status-dot { width:7px !important; height:7px !important; flex:0 0 auto !important; background:var(--dp-mentor-status) !important; border-radius:50% !important; }
      .dp-mentor-inspection-reading > small { display:grid !important; place-items:center !important; width:17px !important; height:17px !important; flex:0 0 auto !important; color:#175cd3 !important; background:#eaf2ff !important; border-radius:50% !important; font:800 9px/1 Arial,sans-serif !important; }
      .dp-mentor-inspection.reviewed .dp-mentor-inspection-reading > small { color:#027a48 !important; background:#ecfdf3 !important; }
      .dp-mentor-inspection-note { max-height:0 !important; overflow:hidden !important; background:#fff !important; transition:max-height .2s ease !important; }
      .dp-mentor-inspection-note.open { max-height:1200px !important; border-top:1px solid #eaecf0 !important; }
      .dp-mentor-inspection-note-inner { display:grid !important; gap:8px !important; padding:9px 10px 10px !important; }
      .dp-mentor-inspection-note-inner > p { margin:0 !important; color:#344054 !important; font-size:9.5px !important; line-height:1.5 !important; }
      .dp-mentor-inspection-more { margin:0 !important; padding:0 !important; border:0 !important; }
      .dp-mentor-inspection-more > summary { display:inline-flex !important; align-items:center !important; gap:5px !important; min-height:20px !important; padding:0 !important; color:#175cd3 !important; background:transparent !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; font-size:9.5px !important; font-weight:650 !important; list-style:none !important; cursor:pointer !important; }
      .dp-mentor-inspection-more > summary::-webkit-details-marker { display:none !important; }
      .dp-mentor-inspection-more > summary::before { content:"⌄" !important; color:#175cd3 !important; font-size:12px !important; transform:rotate(-90deg) !important; transition:transform .15s ease !important; }
      .dp-mentor-inspection-more[open] > summary::before { transform:rotate(0deg) !important; }
      .dp-mentor-inspection-more > p { margin:6px 0 0 !important; padding:0 !important; color:#667085 !important; border:0 !important; font-size:9.5px !important; line-height:1.5 !important; }
      .dp-mentor-inspection-actions { display:flex !important; justify-content:flex-start !important; }
      .dp-mentor-inspection-actions button { min-height:29px !important; padding:0 9px !important; color:#175cd3 !important; background:#fff !important; border:1px solid #84adff !important; border-radius:7px !important; box-shadow:0 1px 2px rgba(16,24,40,.04) !important; font-size:9.5px !important; font-weight:700 !important; cursor:pointer !important; }
      .dp-mentor-inspection-actions button:hover { background:#eff6ff !important; }
      .dp-mentor-step-intro, .dp-mentor-complete { display:grid !important; gap:4px !important; padding:10px 11px !important; color:#667085 !important; background:#f9fafb !important; border:1px solid #dfe3ea !important; border-radius:9px !important; font-size:10.5px !important; line-height:1.4 !important; }
      .dp-mentor-step-intro b, .dp-mentor-complete b { color:#344054 !important; font-size:12px !important; }
      .dp-mentor-complete { padding:16px !important; color:#027a48 !important; border-color:#abefc6 !important; background:#ecfdf3 !important; text-align:center !important; }
      .dp-mentor-complete b { color:#05603a !important; }
      .dp-mentor-rule { padding:12px !important; background:#fff !important; border:1px solid #d0d5dd !important; border-radius:10px !important; box-shadow:0 1px 2px rgba(16,24,40,.04) !important; }
      .dp-mentor-rule.done { opacity:.72 !important; }
      .dp-mentor-rule.caution { border-color:#fdb022 !important; }
      .dp-mentor-rule-stage { color:#175cd3 !important; font-size:9px !important; font-weight:750 !important; letter-spacing:.05em !important; text-transform:uppercase !important; }
      .dp-mentor-rule h3 { margin:3px 0 5px !important; color:#101828 !important; font-size:13px !important; line-height:1.3 !important; }
      .dp-mentor-rule > p { margin:0 !important; color:#344054 !important; font-size:11px !important; line-height:1.45 !important; }
      .dp-mentor-rule details { margin-top:8px !important; padding-top:7px !important; border-top:1px solid #eaecf0 !important; }
      .dp-mentor-rule summary { color:#475467 !important; font-size:10px !important; font-weight:650 !important; cursor:pointer !important; }
      .dp-mentor-why { color:#475467 !important; font-size:10.5px !important; line-height:1.45 !important; }
      .dp-mentor-rule ul { margin:6px 0 0 18px !important; padding:0 !important; color:#667085 !important; font-size:10.5px !important; line-height:1.45 !important; }
      .dp-mentor-rule-actions { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; margin-top:9px !important; }
      .dp-mentor-rule-actions button { min-height:30px !important; padding:0 9px !important; color:#175cd3 !important; background:#fff !important; border:1px solid #84adff !important; border-radius:7px !important; font-size:10px !important; font-weight:700 !important; cursor:pointer !important; }
      .dp-mentor-rule-actions button:hover { background:#eff6ff !important; }
      .dp-mentor-rule-actions label { display:flex !important; align-items:center !important; gap:5px !important; color:#475467 !important; font-size:10.5px !important; font-weight:650 !important; cursor:pointer !important; }
      .dp-mentor-empty { display:grid !important; gap:5px !important; padding:16px !important; color:#667085 !important; background:#fff !important; border:1px dashed #b9c2d0 !important; border-radius:10px !important; text-align:center !important; }
      .dp-mentor-empty b { color:#344054 !important; }
      .dp-mentor-highlight { position:relative !important; background:#fff !important; outline:3px solid #fff !important; outline-offset:5px !important; border-radius:3px !important; box-shadow:0 0 0 9px rgba(255,255,255,.18),0 10px 34px rgba(0,0,0,.48) !important; scroll-margin:90px !important; }
      .dp-mentor-highlight > td, .dp-mentor-highlight > th { background:#fff !important; }
      span[data-dp-mentor-inspection-line].dp-mentor-highlight { display:block !important; min-width:max-content !important; padding:3px 7px !important; color:#15171a !important; }
      #dp-mentor-spotlight { position:fixed !important; inset:0 !important; z-index:2147483638 !important; pointer-events:none !important; }
      .dp-mentor-spotlight-shade { position:fixed !important; display:block !important; margin:0 !important; padding:0 !important; background:rgba(31,34,38,.86) !important; border:0 !important; border-radius:0 !important; box-shadow:none !important; cursor:pointer !important; pointer-events:auto !important; }
      #dp-mentor-target-marker { position:fixed !important; z-index:2147483645 !important; display:grid !important; gap:5px !important; width:min(280px,calc(100vw - 24px)) !important; box-sizing:border-box !important; padding:13px 15px !important; color:#17191c !important; background:#fff !important; border:1px solid #d2d4d7 !important; border-radius:9px !important; box-shadow:0 12px 38px rgba(0,0,0,.5) !important; font-family:"Segoe UI",Arial,sans-serif !important; pointer-events:none !important; user-select:none !important; }
      #dp-mentor-target-marker::before { content:"" !important; position:absolute !important; width:0 !important; height:0 !important; border:10px solid transparent !important; }
      #dp-mentor-target-marker[data-side="right"]::before { left:-20px !important; top:20px !important; border-right-color:#fff !important; }
      #dp-mentor-target-marker[data-side="left"]::before { right:-20px !important; top:20px !important; border-left-color:#fff !important; }
      #dp-mentor-target-marker[data-side="bottom"]::before { left:22px !important; top:-20px !important; border-bottom-color:#fff !important; }
      #dp-mentor-target-marker[data-side="top"]::before { left:22px !important; bottom:-20px !important; border-top-color:#fff !important; }
      #dp-mentor-target-marker small { color:#666c74 !important; font-size:9px !important; font-weight:800 !important; letter-spacing:.06em !important; text-transform:uppercase !important; }
      #dp-mentor-target-marker b { color:#111315 !important; font-size:14px !important; line-height:1.25 !important; }
      #dp-mentor-target-marker p { margin:0 !important; color:#34383e !important; font-size:11.5px !important; line-height:1.45 !important; }
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
      runtime.pageUrl = location.href;
      clearFocus();
      refreshMentor({ autoReveal: runtime.autoHints });
    };
    window.addEventListener("popstate", refreshAfterNavigation);
    window.addEventListener("hashchange", refreshAfterNavigation);
    window.addEventListener("pageshow", refreshAfterNavigation);
    window.addEventListener("resize", scheduleFocusPosition);
    window.addEventListener("scroll", scheduleFocusPosition, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && runtime.highlighted) clearFocus();
    });
    document.addEventListener("change", (event) => {
      if (runtime.mode !== "mentor" || event.target.closest?.("#dp-panel")) return;
      window.setTimeout(() => refreshMentor({ autoReveal: false }), 0);
    }, true);
    window.setInterval(() => {
      if (location.href === runtime.pageUrl) return;
      refreshAfterNavigation();
    }, 750);

    try {
      GM_addValueChangeListener(MODE_KEY, (_name, _oldValue, value) => {
        const mode = normalizeMode(value);
        if (mode === runtime.mode) return;
        runtime.mode = mode;
        applyMode("storage");
      });
      GM_addValueChangeListener(AUTO_HINTS_KEY, (_name, _oldValue, value) => {
        runtime.autoHints = value === true;
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
