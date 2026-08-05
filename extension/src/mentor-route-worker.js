"use strict";

(() => {
  const ROUTE_GET = "SIMNET_WB_MENTOR_ROUTE_GET";
  const ROUTE_COMMAND = "SIMNET_WB_MENTOR_ROUTE_COMMAND";
  const ROUTE_STATE = "SIMNET_WB_MENTOR_ROUTE_STATE";
  const CORE_STATE_MESSAGE = "SIMNET_WB_CORE_STATE";
  const CORE_COMMAND_MESSAGE = "SIMNET_WB_CORE_COMMAND";
  const revisions = new Map();
  const starting = new Set();

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

  function currentWorkflow(tab, state) {
    try { return workflowFor(state, tab?.id) || null; } catch (_) { return null; }
  }

  function proofFor(state, workflow) {
    const context = state?.context || {};
    const checkpoints = state?.checkpoints || {};
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
    return {
      context,
      checkpoints,
      billingOlt,
      tmc,
      tmcFound: Boolean(tmc?.found),
      oltKnown: Boolean(billingOlt?.present || checkpoints.oltKnown),
      onuPolled: Boolean(checkpoints.onuPolled),
      poller: billingOlt?.poller || pollerFrom(`${billingOlt?.name || ""} ${billingOlt?.technology || ""}`)
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

  function stepsFor(stage, proof) {
    const steps = [
      { id: "detect", label: "OLT", detail: "отсутствие обнаружено" },
      { id: "billing-main", label: "Billing", detail: "основная карточка" },
      { id: "userside", label: "UserSide", detail: "ТМЦ и найденная OLT" },
      { id: "fill", label: "Привязка", detail: "поле OLT" },
      { id: "poll", label: "Опрос", detail: "правильный poller" },
      { id: "result", label: "Результат", detail: "статус и оптика" }
    ];
    const rank = ({
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
    })[stage] ?? 1;
    return steps.map((step, index) => ({
      ...step,
      complete: index < rank || (step.id === "fill" && proof.oltKnown),
      active: index === Math.min(rank, steps.length - 1) && stage !== "complete"
    }));
  }

  function action(id, type, command, target, title, detail, label, pageMatched) {
    return { id, type, command, target, title, detail, label, pageMatched };
  }

  function routeStateFor(tab, state, workflow = currentWorkflow(tab, state)) {
    if (!workflow?.active || workflow.type !== "olt-discovery") return inactiveRoute(tab, state);

    const proof = proofFor(state, workflow);
    const currentPage = pageKind(tab, state);
    let stage = "go-billing-main";
    let expectedPage = "billing-user";
    let next = action(
      "billing-main",
      "navigate",
      "billing-main",
      "",
      "Перейди на основную карточку Billing",
      "Нужный элемент находится на другой странице. Сначала открой карточку абонента.",
      "На карточку Billing",
      false
    );

    if (proof.onuPolled) {
      stage = "complete";
      expectedPage = currentPage;
      next = action("complete", "complete", "", "", "Маршрут OLT и опрос ONU завершены", "Получен структурированный результат live-опроса ONU.", "Готово", true);
    } else if (currentPage === "billing-poller") {
      stage = "wait-poll-result";
      expectedPage = "billing-poller";
      next = action("wait-poll-result", "wait", "refresh", "", "Дождись результата опроса ONU", "Чекпоинт закроется только после структурированного результата: статус, порт, идентификатор или оптика.", "Обновить", true);
    } else if (currentPage === "billing-technical") {
      if (proof.billingOlt?.present) {
        stage = "return-for-poll";
        expectedPage = "billing-user";
        next = action("billing-main", "navigate", "billing-main", "", "OLT подтверждена — вернись к способам опроса", "На основной карточке Workbench подсветит нужный poller.", "К способам опроса", false);
      } else if (proof.tmcFound) {
        stage = "fill-olt";
        expectedPage = "billing-technical";
        next = action("fill-olt", "highlight", "highlight", "billing-olt-field", "Заполни поле OLT в технических данных", "Подсвечивается только точное поле OLT на текущей странице.", "Подсветить OLT", true);
      } else {
        stage = "go-billing-main";
        expectedPage = "billing-user";
        next = action("billing-main", "navigate", "billing-main", "", "Для поиска OLT вернись на карточку Billing", "После возврата система подсветит переход в UserSide.", "На карточку Billing", false);
      }
    } else if (currentPage === "billing-user") {
      if (proof.billingOlt?.present) {
        stage = "poll-onu";
        expectedPage = "billing-user";
        next = action("poll-onu", "highlight", "highlight", proof.poller || "line", "Запусти live-опрос ONU", proof.poller ? "Подсвечен poller подтверждённой технологии OLT." : "Технология OLT не распознана — уточни тип подключения.", "Подсветить опрос", true);
      } else if (proof.tmcFound) {
        stage = "open-technical";
        expectedPage = "billing-user";
        next = action("billing-technical", "page-action", "billing-technical", "billing-technical", "Открой технические данные", "На этой странице подсвечивается точная вкладка. После перехода будет выделено поле OLT.", "Открыть техданные", true);
      } else {
        stage = "open-userside";
        expectedPage = "billing-user";
        next = action("userside", "page-action", "userside", "billing-userside", "Перейди в UserSide и проверь ТМЦ", "На текущей карточке подсвечивается только точный переход в UserSide.", "Открыть UserSide", true);
      }
    } else if (currentPage === "userside-customer") {
      if (proof.tmcFound) {
        stage = "return-billing";
        expectedPage = "billing-user";
        next = action("return-billing", "navigate", "return-billing", "", "OLT найдена — вернись в Billing", "После возврата система направит в технические данные.", "Вернуться в Billing", false);
      } else {
        stage = "find-tmc";
        expectedPage = "userside-customer";
        next = action("find-tmc", "highlight", "highlight", "userside-tmc", "Открой ТМЦ и найди «Найдено на OLT»", "Подсвечивается только раздел ТМЦ текущей карточки UserSide.", "Подсветить ТМЦ", true);
      }
    }

    const revisionKey = `${subscriberKey(state)}:${stage}:${currentPage}:${next.target}:${next.command}`;
    if (!revisions.has(revisionKey)) revisions.set(revisionKey, Date.now());
    const steps = stepsFor(stage, proof);
    const progressCurrent = stage === "complete"
      ? steps.length
      : Math.min(steps.length, Math.max(1, steps.filter(step => step.complete).length + 1));

    return {
      active: true,
      revision: revisions.get(revisionKey),
      subscriberKey: subscriberKey(state),
      management: {
        routeId: "olt-discovery",
        stage,
        currentPage,
        expectedPage,
        progress: { current: progressCurrent, total: steps.length },
        steps
      },
      action: next,
      ui: {
        severity: stage === "complete" ? "ok" : stage === "wait-poll-result" ? "info" : "warning",
        autoHighlight: Boolean(next.pageMatched && next.target),
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

  async function ensureAutomaticRoute(tab, state) {
    const context = state?.context || {};
    const evidence = state?.evidence || {};
    const key = subscriberKey(state);
    const existing = currentWorkflow(tab, state);
    if (existing?.active || key === "no-context" || starting.has(key)) return existing;

    const shouldStart = context.kind === "billing_technical"
      && evidence.pon?.isPon
      && context.olt?.status === "missing"
      && !state?.checkpoints?.onuPolled;
    if (!shouldStart) return existing;

    starting.add(key);
    try { return await startOltWorkflow(tab); }
    catch (_) { return null; }
    finally { starting.delete(key); }
  }

  async function publishRoute(tab, suppliedState = null) {
    if (!Number.isInteger(tab?.id)) return inactiveRoute(tab, suppliedState);
    const state = suppliedState || snapshots.get(tab.id) || null;
    const workflow = await ensureAutomaticRoute(tab, state) || currentWorkflow(tab, state);
    const route = routeStateFor(tab, state, workflow);
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
    const workflow = currentWorkflow(tab, state) || await ensureAutomaticRoute(tab, state);
    const route = routeStateFor(tab, state, workflow);
    if (!route.active) throw new Error("Активный маршрут отсутствует");

    const command = message.command || route.action.command || "";
    if (command === "highlight") {
      if (!route.action.pageMatched || !route.action.target) throw new Error("Нужный элемент находится на другой странице");
      return chrome.tabs.sendMessage(tab.id, {
        type: CORE_COMMAND_MESSAGE,
        action: "highlight",
        target: route.action.target
      });
    }
    if (command === "refresh") {
      await chrome.tabs.sendMessage(tab.id, { type: CORE_COMMAND_MESSAGE, action: "refresh" }).catch(() => {});
      return { ok: true };
    }
    if (["billing-main", "billing-technical", "return-billing"].includes(command)) {
      return handleWorkflowCommand({ action: command });
    }
    if (command === "userside") {
      await openUserside(tab, state, workflow);
      return { ok: true };
    }
    throw new Error("Неизвестное действие маршрута");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === CORE_STATE_MESSAGE && Number.isInteger(sender?.tab?.id)) {
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
    chrome.tabs.get(activeInfo.tabId).then(tab => publishRoute(tab)).catch(() => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.status || changeInfo.status === "complete") publishRoute(tab || { id: tabId }).catch(() => {});
  });

  globalThis.__SIMNET_MENTOR_ROUTE_WORKER__ = {
    version: "0.1.1",
    routeStateFor,
    publishRoute
  };
})();
