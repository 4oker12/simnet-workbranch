"use strict";

(() => {
  const ROUTE_GET = "SIMNET_WB_MENTOR_ROUTE_GET";
  const ROUTE_COMMAND = "SIMNET_WB_MENTOR_ROUTE_COMMAND";
  const ROUTE_STATE = "SIMNET_WB_MENTOR_ROUTE_STATE";
  const CORE_STATE_MESSAGE = "SIMNET_WB_CORE_STATE";
  const CORE_COMMAND_MESSAGE = "SIMNET_WB_CORE_COMMAND";
  const routeRevisions = new Map();
  const autoStarting = new Set();

  const safe = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

  function subscriberKey(state) {
    const context = state?.context || {};
    if (context.contract) return `contract:${context.contract}`;
    if (context.billingId) return `billing:${context.billingId}`;
    if (context.customerId) return `userside:${context.customerId}`;
    return "no-context";
  }

  function pageKind(tab, state) {
    const context = state?.context || {};
    let action = "";
    try { action = new URL(tab?.url || "").searchParams.get("a") || ""; } catch (_) {}
    if (["310", "311", "312", "313"].includes(action)) return "billing-poller";
    return ({
      billing_user: "billing-user",
      billing_technical: "billing-technical",
      userside_customer: "userside-customer",
      billing_other: "billing-other",
      userside_other: "userside-other"
    })[context.kind] || "other";
  }

  function pollerFrom(value) {
    const text = safe(value, 320).toLowerCase();
    if (/huawei/.test(text)) return "poller-huawei";
    if (/gcom/.test(text)) return "poller-gcom";
    if (/gpon/.test(text)) return "poller-gpon";
    if (/epon/.test(text)) return "poller-epon";
    return "";
  }

  function workflowForTab(tab, state) {
    try { return workflowFor(state, tab?.id) || null; } catch (_) { return null; }
  }

  function routeEvidence(state, workflow) {
    const context = state?.context || {};
    const checkpoints = state?.checkpoints || {};
    const evidence = state?.evidence || {};
    const billingOlt = context.olt?.present
      ? context.olt
      : workflow?.billingOlt?.present
        ? workflow.billingOlt
        : null;
    const tmc = context.tmc?.found
      ? context.tmc
      : workflow?.tmc?.found
        ? workflow.tmc
        : null;
    const poller = billingOlt?.poller || pollerFrom(`${billingOlt?.name || ""} ${billingOlt?.technology || ""}`);
    return {
      context,
      checkpoints,
      evidence,
      billingOlt,
      tmc,
      oltKnown: Boolean(billingOlt?.present || checkpoints.oltKnown),
      tmcFound: Boolean(tmc?.found),
      onuPolled: Boolean(checkpoints.onuPolled),
      poller
    };
  }

  function inactiveRoute(tab, state) {
    return {
      active: false,
      revision: 0,
      subscriberKey: subscriberKey(state),
      management: {
        routeId: "",
        stage: "idle",
        currentPage: pageKind(tab, state),
        expectedPage: "",
        progress: { current: 0, total: 0 },
        steps: []
      },
      action: {
        id: "none",
        type: "none",
        command: "",
        target: "",
        title: "",
        detail: "",
        label: "",
        pageMatched: false
      },
      ui: {
        severity: "info",
        autoHighlight: false,
        blockForeignHighlights: false
      }
    };
  }

  function routeSteps(stage, proof) {
    const order = [
      { id: "detect", label: "OLT", detail: "обнаружено отсутствие" },
      { id: "billing-main", label: "Billing", detail: "основная карточка" },
      { id: "userside", label: "UserSide", detail: "ТМЦ и найденная OLT" },
      { id: "fill", label: "Привязка", detail: "OLT в технических данных" },
      { id: "poll", label: "Опрос", detail: "правильный poller" },
      { id: "result", label: "Результат", detail: "статус и оптика ONU" }
    ];
    const rank = {
      "go-billing-main": 1,
      "open-userside": 2,
      "find-tmc": 2,
      "return-billing": 3,
      "open-technical": 3,
      "fill-olt": 4,
      "return-for-poll": 4,
      "poll-onu": 5,
      "wait-poll-result": 5,
      complete: 6
    }[stage] ?? 1;
    return order.map((step, index) => ({
      ...step,
      complete: index < rank || (step.id === "fill" && proof.oltKnown),
      active: index === Math.min(rank, order.length - 1) && stage !== "complete"
    }));
  }

  function routeStateFor(tab, state, workflow = workflowForTab(tab, state)) {
    const proof = routeEvidence(state, workflow);
    const currentPage = pageKind(tab, state);
    const routeActive = Boolean(workflow?.active && workflow?.type === "olt-discovery");
    if (!routeActive) return inactiveRoute(tab, state);

    let stage = "go-billing-main";
    let expectedPage = "billing-user";
    let action = {
      id: "billing-main",
      type: "navigate",
      command: "billing-main",
      target: "",
      title: "Перейди на основную карточку Billing",
      detail: "Нужный элемент находится на другой странице. Сначала открой карточку абонента.",
      label: "На карточку Billing",
      pageMatched: false
    };

    if (proof.onuPolled) {
      stage = "complete";
      expectedPage = currentPage;
      action = {
        id: "complete",
        type: "complete",
        command: "",
        target: "",
        title: "Маршрут OLT и опрос ONU завершены",
        detail: "Получен структурированный результат live-опроса ONU.",
        label: "Готово",
        pageMatched: true
      };
    } else if (currentPage === "billing-poller") {
      stage = "wait-poll-result";
      expectedPage = "billing-poller";
      action = {
        id: "wait-poll-result",
        type: "wait",
        command: "refresh",
        target: "",
        title: "Дождись результата опроса ONU",
        detail: "Чекпоинт закроется только после появления структурированного результата: статус, порт, идентификатор или оптические значения.",
        label: "Обновить",
        pageMatched: true
      };
    } else if (currentPage === "billing-technical") {
      if (proof.billingOlt?.present) {
        stage = "return-for-poll";
        expectedPage = "billing-user";
        action = {
          id: "billing-main",
          type: "navigate",
          command: "billing-main",
          target: "",
          title: "OLT подтверждена — вернись к способам опроса",
          detail: "На основной карточке будет подсвечен poller, соответствующий технологии OLT.",
          label: "К способам опроса",
          pageMatched: false
        };
      } else if (proof.tmcFound) {
        stage = "fill-olt";
        expectedPage = "billing-technical";
        action = {
          id: "fill-olt",
          type: "highlight",
          command: "highlight",
          target: "billing-olt-field",
          title: "Заполни поле OLT в технических данных",
          detail: "OLT уже найдена в ТМЦ. Сейчас подсвечивается только точное поле OLT на текущей странице.",
          label: "Подсветить OLT",
          pageMatched: true
        };
      } else {
        stage = "go-billing-main";
        expectedPage = "billing-user";
        action = {
          id: "billing-main",
          type: "navigate",
          command: "billing-main",
          target: "",
          title: "Для поиска OLT вернись на карточку Billing",
          detail: "На технической странице нет перехода по следующему этапу. После возврата Workbench подсветит UserSide.",
          label: "На карточку Billing",
          pageMatched: false
        };
      }
    } else if (currentPage === "billing-user") {
      if (proof.billingOlt?.present) {
        stage = "poll-onu";
        expectedPage = "billing-user";
        action = {
          id: "poll-onu",
          type: "highlight",
          command: "highlight",
          target: proof.poller || "line",
          title: "Запусти live-опрос ONU",
          detail: proof.poller
            ? "Подсвечен способ опроса, соответствующий подтверждённой технологии OLT."
            : "OLT подтверждена, но технология не распознана. Уточни тип подключения перед опросом.",
          label: "Подсветить опрос",
          pageMatched: true
        };
      } else if (proof.tmcFound) {
        stage = "open-technical";
        expectedPage = "billing-user";
        action = {
          id: "billing-technical",
          type: "page-action",
          command: "billing-technical",
          target: "billing-technical",
          title: "Открой технические данные",
          detail: "На этой странице подсвечивается точная вкладка. После перехода Workbench автоматически выделит поле OLT.",
          label: "Открыть техданные",
          pageMatched: true
        };
      } else {
        stage = "open-userside";
        expectedPage = "billing-user";
        action = {
          id: "userside",
          type: "page-action",
          command: "userside",
          target: "billing-userside",
          title: "Перейди в UserSide и проверь ТМЦ",
          detail: "На текущей карточке подсвечивается только точный переход в UserSide.",
          label: "Открыть UserSide",
          pageMatched: true
        };
      }
    } else if (currentPage === "userside-customer") {
      if (proof.tmcFound) {
        stage = "return-billing";
        expectedPage = "billing-user";
        action = {
          id: "return-billing",
          type: "navigate",
          command: "return-billing",
          target: "",
          title: "OLT найдена — вернись в Billing",
          detail: "После возврата Workbench направит в технические данные и подсветит поле OLT.",
          label: "Вернуться в Billing",
          pageMatched: false
        };
      } else {
        stage = "find-tmc";
        expectedPage = "userside-customer";
        action = {
          id: "find-tmc",
          type: "highlight",
          command: "highlight",
          target: "userside-tmc",
          title: "Открой ТМЦ и найди «Найдено на OLT»",
          detail: "Подсвечивается только раздел ТМЦ на текущей карточке UserSide.",
          label: "Подсветить ТМЦ",
          pageMatched: true
        };
      }
    }

    const revisionKey = `${subscriberKey(state)}:${stage}:${currentPage}:${action.target}:${action.command}`;
    let revision = routeRevisions.get(revisionKey);
    if (!revision) {
      revision = Date.now();
      routeRevisions.set(revisionKey, revision);
    }

    const steps = routeSteps(stage, proof);
    const current = Math.max(1, steps.filter(step => step.complete).length + (stage === "complete" ? 0 : 1));
    return {
      active: true,
      revision,
      subscriberKey: subscriberKey(state),
      management: {
        routeId: "olt-discovery",
        stage,
        currentPage,
        expectedPage,
        progress: { current: Math.min(current, steps.length), total: steps.length },
        steps
      },
      action,
      ui: {
        severity: stage === "complete" ? "ok" : stage === "wait-poll-result" ? "info" : "warning",
        autoHighlight: Boolean(action.pageMatched && action.target),
        blockForeignHighlights: true
      },
      evidence: {
        billingOlt: proof.billingOlt,
        tmc: proof.tmc,
        oltKnown: proof.oltKnown,
        onuPolled: proof.onuPolled,
        poller: proof.poller
      }
    };
  }

  async function ensureAutomaticOltRoute(tab, state) {
    const context = state?.context || {};
    const evidence = state?.evidence || {};
    const key = subscriberKey(state);
    if (key === "no-context" || autoStarting.has(key)) return workflowForTab(tab, state);
    const existing = workflowForTab(tab, state);
    if (existing?.active) return existing;
    const shouldStart = context.kind === "billing_technical"
      && evidence.pon?.isPon
      && context.olt?.status === "missing"
      && !state?.checkpoints?.onuPolled;
    if (!shouldStart) return existing;

    autoStarting.add(key);
    try {
      return await startOltWorkflow(tab);
    } catch (_) {
      return null;
    } finally {
      autoStarting.delete(key);
    }
  }

  async function publishRoute(tab, state = null) {
    if (!Number.isInteger(tab?.id)) return inactiveRoute(tab, state);
    const resolvedState = state || snapshots.get(tab.id) || null;
    const workflow = await ensureAutomaticOltRoute(tab, resolvedState);
    const route = routeStateFor(tab, resolvedState, workflow || workflowForTab(tab, resolvedState));
    chrome.tabs.sendMessage(tab.id, { type: ROUTE_STATE, route }).catch(() => {});
    chrome.runtime.sendMessage({ type: ROUTE_STATE, tabId: tab.id, route }).catch(() => {});
    return route;
  }

  async function openUserside(tab, state, workflow) {
    if (!workflow) throw new Error("Маршрут OLT не запущен");
    const url = workflow.routes?.userside || state?.context?.routes?.userside || "";
    if (!url) throw new Error("Ссылка UserSide для текущего абонента не найдена");

    workflow.stage = "opening_userside";
    workflow.updatedAt = Date.now();
    workflows[workflow.key] = workflow;
    await persistWorkflows();
    broadcastWorkflow(workflow, tab.id);

    if (Number.isInteger(workflow.usersideTabId)) {
      const existing = await chrome.tabs.get(workflow.usersideTabId).catch(() => null);
      if (existing) {
        await activateAndNavigate(existing.id, workflow.windowId || tab.windowId, url);
        return;
      }
    }

    const created = await chrome.tabs.create({
      windowId: workflow.windowId || tab.windowId,
      openerTabId: workflow.billingTabId || tab.id,
      url,
      active: true
    });
    workflow.usersideTabId = created.id;
    workflows[workflow.key] = workflow;
    await persistWorkflows();
    broadcastWorkflow(workflow, created.id);
  }

  async function executeRoute(message) {
    const tab = await activeTab();
    if (!Number.isInteger(tab?.id)) throw new Error("Активная вкладка не найдена");
    const state = snapshots.get(tab.id) || null;
    const workflow = workflowForTab(tab, state) || await ensureAutomaticOltRoute(tab, state);
    const route = routeStateFor(tab, state, workflow);
    if (!route.active) throw new Error("Активный маршрут отсутствует");

    const requested = message.command || route.action.command || "";
    if (requested === "highlight") {
      if (!route.action.pageMatched || !route.action.target) {
        throw new Error("Нужный элемент находится на другой странице");
      }
      return chrome.tabs.sendMessage(tab.id, {
        type: CORE_COMMAND_MESSAGE,
        action: "highlight",
        target: route.action.target
      });
    }

    if (requested === "refresh") {
      await chrome.tabs.sendMessage(tab.id, { type: CORE_COMMAND_MESSAGE, action: "refresh" }).catch(() => {});
      return { ok: true };
    }

    if (["billing-main", "billing-technical", "return-billing"].includes(requested)) {
      return handleWorkflowCommand({ action: requested });
    }

    if (requested === "userside") {
      await openUserside(tab, state, workflow);
      return { ok: true };
    }

    throw new Error("Неизвестное действие маршрута");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === CORE_STATE_MESSAGE && Number.isInteger(sender?.tab?.id)) {
      window.setTimeout?.(() => {}, 0);
      Promise.resolve().then(() => publishRoute(sender.tab, message.state || null));
      return false;
    }

    if (message?.type === ROUTE_GET) {
      activeTab()
        .then(tab => publishRoute(tab))
        .then(route => sendResponse({ ok: true, route }))
        .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    if (message?.type === ROUTE_COMMAND) {
      executeRoute(message)
        .then(result => sendResponse(result || { ok: true }))
        .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    return false;
  });

  chrome.tabs.onActivated.addListener(activeInfo => {
    chrome.tabs.get(activeInfo.tabId)
      .then(tab => publishRoute(tab))
      .catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.status || changeInfo.status === "complete") {
      publishRoute(tab || { id: tabId }).catch(() => {});
    }
  });

  globalThis.__SIMNET_MENTOR_ROUTE_WORKER__ = {
    version: "0.1.0",
    routeStateFor,
    publishRoute
  };
})();
