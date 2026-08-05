"use strict";

(() => {
  if (globalThis.__SIMNET_LIVE_MENTOR_MODEL__) return;

  const PROGRESS_KEY = "wb_live_verified_progress_v1";
  const EVIDENCE_TTL_MS = 30 * 60 * 1000;
  const rawCheckpoints = checkpoints;
  const rawEvidence = evidence;
  const rawRouteDataAllowed = routeDataAllowed;
  let progressByContext = {};
  let persistTimer = 0;

  function modelContextKey() {
    const context = effectiveContext();
    if (workflow?.key) return workflow.key;
    if (context.contract) return `contract:${context.contract}`;
    if (context.billingId) return `billing:${context.billingId}`;
    if (context.customerId) return `userside:${context.customerId}`;
    return "no-context";
  }

  function cleanEvidence(value) {
    if (!value || typeof value !== "object") return {};
    const { cached, observedAt, ...rest } = value;
    return rest;
  }

  function sameEvidence(left, right) {
    return JSON.stringify(cleanEvidence(left)) === JSON.stringify(cleanEvidence(right));
  }

  function isFresh(record) {
    return Boolean(record?.observedAt && Date.now() - record.observedAt <= EVIDENCE_TTL_MS);
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = window.setTimeout(async () => {
      persistTimer = 0;
      try { await chrome.storage.session.set({ [PROGRESS_KEY]: progressByContext }); } catch (_) {}
    }, 50);
  }

  function storeRecord(key, patch) {
    if (!key || key === "no-context" || !Object.keys(patch).length) return;
    const previous = progressByContext[key] || {};
    const next = { ...previous, ...patch };
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    progressByContext = { ...progressByContext, [key]: next };
    schedulePersist();
  }

  function rememberVerified(rawCp, rawEv) {
    const key = modelContextKey();
    if (key === "no-context") return;
    const context = effectiveContext();
    const previous = progressByContext[key] || {};
    const patch = {};

    if (!previous.subscriberOpened && (rawCp.subscriberOpened || context.contract || context.billingId || context.customerId)) {
      patch.subscriberOpened = true;
    }
    if (!previous.oltKnown && rawCp.oltKnown) patch.oltKnown = true;

    if (rawCp.sessionResolved && rawEv.session?.resolved) {
      const nextEvidence = cleanEvidence(rawEv.session);
      if (!sameEvidence(previous.session?.evidence, nextEvidence)) {
        patch.session = { evidence: nextEvidence, observedAt: Date.now() };
      }
    }

    if (rawCp.onuPolled && rawEv.line?.polled) {
      const nextEvidence = cleanEvidence(rawEv.line);
      if (!sameEvidence(previous.line?.evidence, nextEvidence)) {
        patch.line = { evidence: nextEvidence, observedAt: Date.now() };
      }
    }

    storeRecord(key, patch);
  }

  function mergedState() {
    const rawCp = rawCheckpoints() || {};
    const rawEv = rawEvidence() || {};
    rememberVerified(rawCp, rawEv);

    const context = effectiveContext();
    const cached = progressByContext[modelContextKey()] || {};
    const cachedSession = isFresh(cached.session) ? cached.session : null;
    const cachedLine = isFresh(cached.line) ? cached.line : null;
    const currentSession = rawEv.session || {};
    const currentLine = rawEv.line || {};

    const session = currentSession.resolved
      ? currentSession
      : cachedSession
        ? { ...cachedSession.evidence, cached: true, observedAt: cachedSession.observedAt }
        : currentSession;

    const line = currentLine.polled
      ? currentLine
      : cachedLine
        ? { ...cachedLine.evidence, cached: true, observedAt: cachedLine.observedAt }
        : currentLine;

    const subscriberOpened = Boolean(
      rawCp.subscriberOpened
      || cached.subscriberOpened
      || context.contract
      || context.billingId
      || context.customerId
    );
    const sessionResolved = Boolean(rawCp.sessionResolved || cachedSession);
    const onuPolled = Boolean(rawCp.onuPolled || cachedLine);
    const oltKnown = Boolean(
      rawCp.oltKnown
      || cached.oltKnown
      || context.olt?.present
      || context.tmc?.found
      || workflow?.tmc?.found
    );

    return {
      evidence: { ...rawEv, session, line },
      checkpoints: {
        ...rawCp,
        subscriberOpened,
        juniperOpened: Boolean(rawCp.juniperOpened || sessionResolved),
        sessionResolved,
        sessionActive: sessionResolved ? session.status === "active" : Boolean(rawCp.sessionActive),
        onuPolled,
        oltKnown
      }
    };
  }

  evidence = function mergedEvidence() {
    return mergedState().evidence;
  };

  checkpoints = function mergedCheckpoints() {
    return mergedState().checkpoints;
  };

  routeDataAllowed = function canonicalRouteDataAllowed() {
    return hintLevel("line") >= 4 || rawRouteDataAllowed();
  };

  function lineNeedsOlt(context, cp, ev) {
    return Boolean(
      !cp.oltKnown
      && !cp.onuPolled
      && (ev.pon?.isPon || context.olt || workflow?.active)
    );
  }

  function alertStepId(alert) {
    if (!alert) return "subscriber";
    if (alert.id === "missing-olt" || alert.id === "line-problem" || alert.target === "line" || alert.target === "billing-olt-field") return "line";
    if (alert.id === "session-absent" || /^session/.test(alert.id || "") || /^session/.test(alert.target || "")) return "session";
    return "subscriber";
  }

  function severityWeight(value) {
    return ({ critical: 0, warning: 1, info: 2, ok: 3 })[value] ?? 9;
  }

  function normalizedAlerts(context, cp, ev) {
    const alerts = Array.isArray(snapshot?.alerts) ? snapshot.alerts.map(alert => ({ ...alert })) : [];
    const ids = new Set(alerts.map(alert => alert.id));
    const needsOlt = lineNeedsOlt(context, cp, ev);

    if (ev.session?.absent && !ids.has("session-absent")) {
      alerts.push({
        id: "session-absent",
        severity: "critical",
        title: "Juniper: статус offline",
        text: "Активной сессии сейчас нет. Причина ещё не установлена.",
        target: "session-status",
        source: "Juniper NEW"
      });
      ids.add("session-absent");
    }

    if (needsOlt && !ids.has("missing-olt")) {
      alerts.push({
        id: "missing-olt",
        severity: "warning",
        title: "Сначала определи OLT",
        text: "Техническая привязка не подтверждена. Опрос наугад недостоверен.",
        target: context.kind === "billing_technical" ? "billing-olt-field" : "line",
        source: "Billing"
      });
      ids.add("missing-olt");
    }

    if (ev.line?.problem && !ids.has("line-problem")) {
      alerts.push({
        id: "line-problem",
        severity: "warning",
        title: "Live-опрос выявил отклонение",
        text: ev.line.summary || "Результат ONU/ONT требует внимания.",
        target: "line",
        source: ev.line.source || "Live-опрос ONU"
      });
    }

    return alerts
      .map(alert => ({ ...alert, stepId: alertStepId(alert) }))
      .sort((left, right) => severityWeight(left.severity) - severityWeight(right.severity));
  }

  function buildStepsFromState(context, cp, ev, alerts) {
    const accessAlert = alerts.find(alert => alert.stepId === "subscriber");
    const sessionAlert = alerts.find(alert => alert.stepId === "session");
    const lineAlert = alerts.find(alert => alert.stepId === "line");
    const needsOlt = lineNeedsOlt(context, cp, ev);

    return [
      {
        id: "subscriber",
        title: "Абонент и Billing",
        detail: accessAlert
          ? accessAlert.title
          : cp.subscriberOpened
            ? `${context.login || context.contract || "карточка"} определена`
            : "Открой карточку Billing или UserSide",
        complete: Boolean(cp.subscriberOpened),
        attention: Boolean(accessAlert),
        severity: accessAlert?.severity || "info",
        target: accessAlert?.target || "subscriber",
        issueId: accessAlert?.id || ""
      },
      {
        id: "session",
        title: "Сессия / авторизация",
        detail: sessionAlert
          ? sessionAlert.title
          : ev.session?.status === "active"
            ? `Juniper: online${ev.session.cached ? " · сохранено" : ""}`
            : ev.session?.status === "absent"
              ? "Juniper: offline"
              : ev.session?.opened
                ? "Juniper открыт, жду распознавание результата"
                : "Открой Juniper NEW",
        complete: Boolean(cp.sessionResolved),
        attention: Boolean(sessionAlert || ev.session?.status === "unknown"),
        severity: sessionAlert?.severity || (ev.session?.status === "unknown" ? "warning" : "info"),
        target: sessionAlert?.target || "session",
        issueId: sessionAlert?.id || ""
      },
      {
        id: "line",
        title: "Линия и ONU",
        detail: lineAlert
          ? lineAlert.title
          : cp.onuPolled
            ? `Live-опрос выполнен${ev.line?.cached ? " · сохранено" : ""}`
            : needsOlt
              ? "OLT не подтверждена — требуется маршрут через ТМЦ"
              : cp.oltKnown
                ? "OLT определена — выполни live-опрос"
                : "Уточни техническую привязку",
        complete: Boolean(cp.onuPolled),
        attention: Boolean(lineAlert || needsOlt),
        severity: lineAlert?.severity || (needsOlt ? "warning" : "info"),
        target: lineAlert?.target || "line",
        issueId: lineAlert?.id || ""
      }
    ];
  }

  function taskFromAlert(alert, context, ev) {
    const stepId = alert.stepId || alertStepId(alert);
    if (alert.id === "missing-olt") {
      return {
        id: "line",
        issueId: alert.id,
        stepId,
        severity: "warning",
        title: alert.title || "Сначала определи OLT",
        target: alert.target || "line",
        hints: missingOltHints(context),
        route: true
      };
    }

    if (alert.id === "line-problem") {
      return {
        id: "line",
        issueId: alert.id,
        stepId,
        severity: alert.severity || "warning",
        title: alert.title,
        target: alert.target || "line",
        hints: [
          alert.text,
          ev.line?.signature?.length
            ? `Подтверждающие признаки: ${ev.line.signature.join(", ")}.`
            : `Источник: ${alert.source || "live-опрос"}.`,
          "Сверь статус ONU, оптические уровни, порт и идентификатор оборудования."
        ]
      };
    }

    return {
      id: stepId,
      issueId: alert.id,
      stepId,
      severity: alert.severity || "warning",
      title: alert.title,
      target: alert.target || stepId,
      hints: [
        alert.text || alert.title,
        `Источник: ${alert.source || "Billing"}.`,
        "Нажми «Подсветить», чтобы перейти к подтверждающему элементу."
      ]
    };
  }

  function taskForIncompleteStep(step, context, cp, ev) {
    if (step.id === "subscriber") {
      return {
        id: "subscriber",
        stepId: "subscriber",
        severity: "info",
        title: "Открой карточку абонента",
        target: "subscriber",
        hints: ["Live Assistant подхватит договор, IP и доступные данные после открытия карточки Billing или UserSide."],
        skippable: false
      };
    }

    if (step.id === "session") {
      return {
        id: "session",
        stepId: "session",
        severity: step.severity || "info",
        title: ev.session?.opened ? "Juniper открыт, результат не распознан" : "Проверь сессию в Juniper NEW",
        target: "session",
        hints: sessionHints()
      };
    }

    const needsOlt = lineNeedsOlt(context, cp, ev);
    return {
      id: "line",
      stepId: "line",
      severity: needsOlt ? "warning" : "info",
      title: needsOlt ? "Сначала определи OLT" : "Подтверди состояние ONU",
      target: "line",
      hints: needsOlt ? missingOltHints(context) : lineHints(context),
      route: needsOlt
    };
  }

  function buildMentorModel() {
    const context = effectiveContext();
    const cp = checkpoints();
    const ev = evidence();
    const alerts = normalizedAlerts(context, cp, ev);
    const steps = buildStepsFromState(context, cp, ev, alerts);
    const focusCandidates = alerts.map(alert => taskFromAlert(alert, context, ev));

    for (const step of steps) {
      if (!step.complete && !focusCandidates.some(task => task.stepId === step.id)) {
        focusCandidates.push(taskForIncompleteStep(step, context, cp, ev));
      }
    }

    if (!focusCandidates.length) {
      focusCandidates.push({
        id: "checks-complete",
        stepId: "complete",
        severity: "ok",
        title: "Основные чекпоинты пройдены",
        target: "subscriber",
        hints: ["Абонент определён, сессия проверена и live-состояние линии подтверждено."],
        skippable: false
      });
    }

    return { context, checkpoints: cp, evidence: ev, alerts, steps, focusCandidates };
  }

  buildSteps = function buildCanonicalSteps() {
    return buildMentorModel().steps;
  };

  currentTask = function currentCanonicalTask() {
    return buildMentorModel().focusCandidates[0];
  };

  async function loadProgress() {
    try {
      const result = await chrome.storage.session.get({ [PROGRESS_KEY]: {} });
      progressByContext = result?.[PROGRESS_KEY] || {};
    } catch (_) {
      progressByContext = {};
    }
  }

  globalThis.__SIMNET_LIVE_MENTOR_MODEL__ = {
    version: "0.2.0",
    build: buildMentorModel,
    contextKey: modelContextKey,
    progressKey: PROGRESS_KEY,
    ttlMs: EVIDENCE_TTL_MS
  };

  void loadProgress().then(() => render());
})();
