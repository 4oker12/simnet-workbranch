"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_SUBSCRIBER_STATE_ENGINE__) return;

  const VERSION = "0.1.0";
  const STORAGE_KEY = "simnet_wb_subscriber_state_v1";
  const ROUTE_STORAGE_KEY = "simnet_wb_basic_diagnostic_route_v1";
  const BASIC_OVERLAY_ID = "simnet-wb-basic-route-overlay";
  const MAX_SNAPSHOTS = 30;
  const SAMPLE_DELAYS_MS = Object.freeze([0, 5_000, 60_000]);
  const subscribers = new Set();
  const timers = new Set();

  let record = null;
  let pendingSample = 0;
  let observer = null;
  let disposed = false;

  const cleanText = (value, max = 1200) => String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

  const clone = value => {
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value ?? null)); }
  };

  function pageContext() {
    const url = new URL(location.href);
    const action = url.searchParams.get("a") || "";
    const host = location.hostname.toLowerCase();
    const billingId = url.searchParams.get("id") || "";
    const isBilling = /^(?:admin\.simnet\.kiev\.ua|admin\.looknet\.kiev\.ua)$/.test(host);
    let kind = "other";
    if (isBilling && action === "user") kind = "billing-user";
    else if (isBilling && action === "252") kind = "billing-juniper";
    else if (isBilling && action === "dopdata") kind = "billing-technical";
    else if (isBilling && ["310", "311", "312", "313"].includes(action)) kind = "billing-poller";
    return { url, action, host, billingId, isBilling, kind };
  }

  function contractFromPage() {
    const text = cleanText(document.body?.textContent, 180_000);
    return (text.match(/\babon\d{3,14}\b/i) || [""])[0].toLowerCase();
  }

  function subscriberKey(context = pageContext()) {
    const identity = context.billingId || contractFromPage();
    return context.isBilling && identity ? `${context.host}|${identity}` : "";
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
    try {
      await chrome.storage.session.set({ [STORAGE_KEY]: value });
      return;
    } catch (_) {}
    try { await chrome.storage.local.set({ [STORAGE_KEY]: value }); } catch (_) {}
  }

  function selectedText(control) {
    if (!control) return "";
    if (control.tagName === "SELECT") {
      return cleanText(control.options?.[control.selectedIndex]?.textContent || control.value, 320);
    }
    return cleanText(control.value || control.textContent, 320);
  }

  function isEmptySelection(value) {
    return !value || /^(?:0|нет|не выбрано|не указано|выберите|—|-|none|null)$/i.test(cleanText(value, 120));
  }

  function smallestEvidence(patterns, selector = "td,div.message,table.table10,table.tbg,tr") {
    const required = Array.isArray(patterns) ? patterns : [patterns];
    return [...document.querySelectorAll(selector)]
      .map(element => {
        const rect = element.getBoundingClientRect();
        const text = cleanText(element.textContent, 12_000);
        return { element, text, area: Math.max(1, rect.width * rect.height) };
      })
      .filter(item => item.text && required.every(pattern => pattern.test(item.text)))
      .filter(item => item.text.length < 10_000)
      .sort((left, right) => left.text.length - right.text.length || left.area - right.area)[0] || null;
  }

  function extractMac(text) {
    const match = String(text || "").toUpperCase().match(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b|\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/);
    if (!match) return null;
    const compact = match[0].replace(/[-.:]/g, "");
    return compact.match(/.{2}/g)?.join(":") || null;
  }

  function extractDbm(text, direction) {
    const label = direction === "rx"
      ? "(?:RX|Rx|receive|received|при[её]м|прийом)"
      : "(?:TX|Tx|transmit|transmitted|передач)";
    const match = String(text || "").match(new RegExp(`${label}[^-+\\d]{0,28}([-+]?\\d+(?:[.,]\\d+)?)\\s*dBm`, "i"));
    if (!match) return null;
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }

  function pollerFrom(oltName, technologyLabel) {
    const text = `${oltName || ""} ${technologyLabel || ""}`.toLowerCase();
    if (/huawei/.test(text)) return { technology: "huawei", action: "313" };
    if (/gcom/.test(text)) return { technology: "gcom", action: "312" };
    if (/gpon/.test(text)) return { technology: "gpon", action: "311" };
    if (/epon|bdcom/.test(text)) return { technology: "epon", action: "310" };
    return { technology: "", action: "" };
  }

  function readObservation(reason = "dom") {
    const context = pageContext();
    const now = Date.now();
    const observation = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      observedAt: now,
      reason,
      pageKind: context.kind,
      pageAction: context.action,
      url: `${location.origin}${location.pathname}?a=${encodeURIComponent(context.action)}&id=${encodeURIComponent(context.billingId)}`,
      sessionStatus: null,
      sessionSummary: "",
      oltPresent: null,
      oltName: "",
      technology: "",
      pollerAction: "",
      pollResultPresent: null,
      onuStatus: null,
      ethernetLink: null,
      opticalAlarm: null,
      rxDbm: null,
      txDbm: null,
      mac: null,
      resultSummary: ""
    };

    if (context.kind === "billing-juniper") {
      const session = smallestEvidence([
        /Статус\s+сес(?:с|і)и/i,
        /BRAS/i,
        /USERNAME/i
      ], "td,div.message,table.table10");
      if (session) {
        observation.sessionSummary = cleanText(session.text, 1200);
        if (/online\s*\/\s*active|Статус\s+сес(?:с|і)и\s*[-:—]?\s*online/i.test(session.text)) {
          observation.sessionStatus = "online";
        } else if (/offline|inactive|not\s+found|сессия\s+не\s+найдена|сесію\s+не\s+знайдено/i.test(session.text)) {
          observation.sessionStatus = "offline";
        } else {
          observation.sessionStatus = "unknown";
        }
        observation.mac = extractMac(session.text);
      }
    }

    if (context.kind === "billing-technical") {
      const oltControl = document.querySelector("select[name='dopfield_29'],input[name='dopfield_29']");
      const technologyControl = document.querySelector("select[name='dopfield_39'],input[name='dopfield_39']");
      if (oltControl) {
        observation.oltName = selectedText(oltControl);
        observation.oltPresent = !isEmptySelection(observation.oltName);
      }
      const technologyLabel = selectedText(technologyControl);
      const poller = pollerFrom(observation.oltName, technologyLabel);
      observation.technology = poller.technology;
      observation.pollerAction = poller.action;
    }

    if (context.kind === "billing-poller") {
      const result = smallestEvidence([
        /(?:ONU|ONT|Serial|Серийн|MAC|оптик|Rx|Tx|dBm|distance|расстоя|порт|status|статус)/i
      ]);
      const text = result?.text || "";
      const waitingOnly = /Данные\s+посланы\.\s*Ждите|Запрос\s+OLT/i.test(text)
        && !/(?:ONU|ONT).{0,100}(?:online|offline|registered|LOS|Dying\s+Gasp)/i.test(text);
      observation.pollResultPresent = Boolean(result && !waitingOnly);
      if (observation.pollResultPresent) {
        observation.resultSummary = cleanText(text, 1600);
        if (/(?:ONU|ONT).{0,100}(?:online|active|registered)|(?:status|статус).{0,40}(?:online|active|registered)/i.test(text)) {
          observation.onuStatus = "online";
        } else if (/(?:ONU|ONT).{0,100}(?:offline|inactive|not\s+found|down)|\bLOS\b|Dying\s+Gasp/i.test(text)) {
          observation.onuStatus = "offline";
        } else {
          observation.onuStatus = "unknown";
        }

        if (/(?:Ethernet|LAN|UNI).{0,45}(?:link\s*)?(?:up|online)/i.test(text)) observation.ethernetLink = "up";
        else if (/(?:Ethernet|LAN|UNI).{0,45}(?:link\s*)?(?:down|offline)/i.test(text)) observation.ethernetLink = "down";

        if (/\bLOS\b|loss\s+of\s+signal|нет\s+оптического\s+сигнала|відсутн(?:ій|я)\s+оптичн/i.test(text)) {
          observation.opticalAlarm = "los";
        } else if (/Dying\s+Gasp|потер[яи]\s+питания|втрата\s+живлення/i.test(text)) {
          observation.opticalAlarm = "dying-gasp";
        } else if (/(?:ONU|ONT).{0,100}(?:online|registered)/i.test(text)) {
          observation.opticalAlarm = "none";
        }

        observation.rxDbm = extractDbm(text, "rx");
        observation.txDbm = extractDbm(text, "tx");
        observation.mac = extractMac(text);
      }
    }

    return observation;
  }

  function blankRecord(key, context = pageContext()) {
    return {
      version: 1,
      key,
      identity: {
        host: context.host,
        billingId: context.billingId,
        contract: contractFromPage()
      },
      facts: {},
      checkpoints: {},
      snapshots: [],
      assessment: {
        code: "collecting",
        severity: "info",
        title: "Собираем состояние",
        detail: "Нужны подтверждённые данные Juniper, технических данных и OLT.",
        operatorAction: "Продолжить базовый маршрут.",
        subscriberMessage: "Оставайтесь, пожалуйста, на линии. Проверяю состояние подключения.",
        confidence: "low"
      },
      updatedAt: Date.now()
    };
  }

  function meaningful(value) {
    return value !== null && value !== undefined && value !== "" && value !== "unknown";
  }

  function mergeFact(previous, value, source, observedAt) {
    if (!meaningful(value)) return previous || null;
    if (!previous) {
      return { value, source, observedAt, confirmedAt: observedAt, contradicted: false };
    }
    if (previous.value === value) {
      return { ...previous, source, observedAt, confirmedAt: previous.confirmedAt || observedAt, contradicted: false };
    }
    return {
      value,
      source,
      observedAt,
      confirmedAt: observedAt,
      contradicted: true,
      previousValue: previous.value,
      previousObservedAt: previous.observedAt || 0
    };
  }

  function mergeObservationFacts(currentFacts, observation) {
    const facts = { ...(currentFacts || {}) };
    const source = observation.pageKind;
    const at = observation.observedAt;
    facts.sessionStatus = mergeFact(facts.sessionStatus, observation.sessionStatus, source, at);
    facts.oltPresent = mergeFact(facts.oltPresent, observation.oltPresent, source, at);
    facts.oltName = mergeFact(facts.oltName, observation.oltName, source, at);
    facts.technology = mergeFact(facts.technology, observation.technology, source, at);
    facts.pollerAction = mergeFact(facts.pollerAction, observation.pollerAction, source, at);
    facts.pollResultPresent = mergeFact(facts.pollResultPresent, observation.pollResultPresent, source, at);
    facts.onuStatus = mergeFact(facts.onuStatus, observation.onuStatus, source, at);
    facts.ethernetLink = mergeFact(facts.ethernetLink, observation.ethernetLink, source, at);
    facts.opticalAlarm = mergeFact(facts.opticalAlarm, observation.opticalAlarm, source, at);
    facts.rxDbm = mergeFact(facts.rxDbm, observation.rxDbm, source, at);
    facts.txDbm = mergeFact(facts.txDbm, observation.txDbm, source, at);
    facts.mac = mergeFact(facts.mac, observation.mac, source, at);
    return facts;
  }

  function observationSignature(observation) {
    return JSON.stringify({
      pageKind: observation.pageKind,
      sessionStatus: observation.sessionStatus,
      oltPresent: observation.oltPresent,
      oltName: observation.oltName,
      technology: observation.technology,
      pollerAction: observation.pollerAction,
      pollResultPresent: observation.pollResultPresent,
      onuStatus: observation.onuStatus,
      ethernetLink: observation.ethernetLink,
      opticalAlarm: observation.opticalAlarm,
      rxDbm: observation.rxDbm,
      txDbm: observation.txDbm,
      mac: observation.mac
    });
  }

  function appendSnapshot(snapshots, observation, force = false) {
    const list = Array.isArray(snapshots) ? snapshots.slice(-MAX_SNAPSHOTS) : [];
    const previous = list[list.length - 1];
    if (!force && previous && observationSignature(previous) === observationSignature(observation)) return list;
    list.push(observation);
    return list.slice(-MAX_SNAPSHOTS);
  }

  function quality(value) {
    if (["online", "up", "none", true].includes(value)) return "good";
    if (["offline", "down", "los", "dying-gasp", false].includes(value)) return "bad";
    return "unknown";
  }

  function transitions(snapshots, field) {
    const values = snapshots
      .map(snapshot => snapshot[field])
      .filter(value => quality(value) !== "unknown");
    let count = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] !== values[index - 1]) count += 1;
    }
    return { count, values };
  }

  function compareSnapshots(snapshots) {
    const recent = (snapshots || []).slice(-3);
    const fields = ["sessionStatus", "onuStatus", "ethernetLink", "opticalAlarm"];
    const comparisons = fields.map(field => ({ field, ...transitions(recent, field) }));
    const flappingField = comparisons.find(item => item.count >= 2);
    if (flappingField) return { code: "flapping", field: flappingField.field, samples: recent.length };

    for (const item of comparisons) {
      const first = item.values[0];
      const last = item.values[item.values.length - 1];
      if (quality(first) === "bad" && quality(last) === "good") return { code: "recovered", field: item.field, samples: recent.length };
      if (quality(first) === "good" && quality(last) === "bad") return { code: "degraded", field: item.field, samples: recent.length };
    }

    const stable = comparisons.find(item => item.values.length >= 3 && new Set(item.values).size === 1);
    if (stable) return { code: "stable", field: stable.field, samples: recent.length };
    return { code: "current-only", field: "", samples: recent.length };
  }

  function latestKnown(snapshots, field) {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const value = snapshots[index]?.[field];
      if (meaningful(value)) return value;
    }
    return null;
  }

  function deriveAssessment(currentRecord) {
    const snapshots = currentRecord.snapshots || [];
    const comparison = compareSnapshots(snapshots);
    const facts = currentRecord.facts || {};
    const fact = name => facts[name]?.value ?? null;
    const latest = name => latestKnown(snapshots, name) ?? fact(name);
    const session = latest("sessionStatus");
    const onu = latest("onuStatus");
    const ethernet = latest("ethernetLink");
    const optical = latest("opticalAlarm");
    const oltPresent = fact("oltPresent");
    const pollResultPresent = latest("pollResultPresent");

    if (comparison.code === "flapping") {
      return {
        code: "flapping",
        severity: "warning",
        title: "Состояние нестабильно",
        detail: "За контрольные снимки состояние менялось и вернулось назад. Одного краткого online недостаточно.",
        operatorAction: "Зафиксировать повторное отпадание, сверить события ONU/Juniper и передать нестабильность дальше, если она подтверждается.",
        subscriberMessage: "Подключение кратковременно восстанавливается, но снова пропадает. Продолжаю проверку нестабильности линии и оборудования.",
        confidence: "high",
        comparison
      };
    }

    if (optical === "los") {
      return {
        code: "optical-los",
        severity: "critical",
        title: "Нет оптического сигнала",
        detail: "OLT/ONU сообщает LOS. Проверка роутера не является первым действием.",
        operatorAction: "Уточнить питание и индикацию ONU, исключить отсоединение оптики и оформить передачу по оптической линии.",
        subscriberMessage: "Оптический терминал не получает сигнал. Проверьте, пожалуйста, питание терминала и не отсоединён ли оптический кабель.",
        confidence: "high",
        comparison
      };
    }

    if (optical === "dying-gasp") {
      return {
        code: "dying-gasp",
        severity: "critical",
        title: "Зафиксирована потеря питания ONU",
        detail: "Событие Dying Gasp указывает на отключение или нестабильное питание терминала.",
        operatorAction: "Проверить блок питания, розетку и индикацию ONU; затем повторить контрольный опрос.",
        subscriberMessage: "Терминал фиксировал потерю питания. Проверьте блок питания, розетку и индикаторы устройства.",
        confidence: "high",
        comparison
      };
    }

    if (comparison.code === "degraded" || onu === "offline") {
      return {
        code: "onu-offline",
        severity: "critical",
        title: "ONU не в сети",
        detail: comparison.code === "degraded" ? "После нормального состояния ONU или сессия перешли в ошибку." : "Текущий опрос не подтверждает online ONU.",
        operatorAction: "Проверить питание и индикацию ONU, события линии и массовость; не объявлять проблему роутера без подтверждения.",
        subscriberMessage: "Оптический терминал сейчас не подтверждается в сети. Проверьте его питание и индикаторы, пока я проверяю линию.",
        confidence: "high",
        comparison
      };
    }

    if (onu === "online" && ethernet === "down") {
      return {
        code: "cpe-link-down",
        severity: "warning",
        title: "ONU online, соединение до роутера down",
        detail: "Оптический участок работает, но Ethernet между ONU и роутером не подтверждён.",
        operatorAction: "Проверить питание роутера, кабель ONU → WAN и правильность WAN-порта; затем повторить контроль.",
        subscriberMessage: "Оптический терминал в сети, но соединение до роутера не поднято. Проверьте кабель между терминалом и WAN-портом роутера.",
        confidence: "high",
        comparison
      };
    }

    if (onu === "online" && ethernet === "up" && session === "online") {
      const stable = comparison.code === "stable";
      return {
        code: stable ? "line-stable" : "line-currently-ok",
        severity: "ok",
        title: stable ? "Линия подтверждена как стабильная" : "Сейчас линия и сессия работают",
        detail: stable
          ? "ONU, Ethernet и Juniper не изменились в контрольных снимках."
          : "Это текущий снимок. Для вывода о стабильности нужен повторный контроль через 5 и 60 секунд.",
        operatorAction: "Переходить к проверке роутера, Wi‑Fi и конкретного устройства; продолжить контроль, если жалоба периодическая.",
        subscriberMessage: "По линии до терминала и соединению сейчас отклонений не видно. Проверим роутер, Wi‑Fi и устройство, на котором возникает проблема.",
        confidence: stable ? "high" : "medium",
        comparison
      };
    }

    if (onu === "online" && session === "offline") {
      return {
        code: "session-missing",
        severity: "warning",
        title: "ONU online, активная сессия не подтверждена",
        detail: "Оптический терминал доступен, но Juniper-сессия отсутствует или завершилась.",
        operatorAction: "Проверить DHCP/авторизацию, MAC, Ethernet-link и события BRAS.",
        subscriberMessage: "Оптический терминал доступен, но интернет-сессия сейчас не поднята. Проверяю авторизацию и соединение до роутера.",
        confidence: "high",
        comparison
      };
    }

    if (oltPresent === true && pollResultPresent !== true) {
      return {
        code: "olt-known-await-poll",
        severity: "info",
        title: "OLT известна — нужен живой опрос",
        detail: "Голова из технических данных определяет правильный poller, но ещё не подтверждает состояние ONU.",
        operatorAction: "Открыть poller соответствующей технологии и выполнить «Запрос OLT →».",
        subscriberMessage: "Оставайтесь, пожалуйста, на линии. Проверяю состояние оптического терминала на оборудовании.",
        confidence: "medium",
        comparison
      };
    }

    return {
      code: comparison.code === "recovered" ? "temporarily-recovered" : "collecting",
      severity: comparison.code === "recovered" ? "warning" : "info",
      title: comparison.code === "recovered" ? "Состояние восстановилось, нужен контроль" : "Собираем состояние",
      detail: comparison.code === "recovered"
        ? "После ошибки состояние стало нормальным, но это ещё не доказывает стабильность."
        : "Пока недостаточно подтверждённых фактов для вывода.",
      operatorAction: comparison.code === "recovered"
        ? "Не завершать диагностику сразу: выполнить контрольные снимки через 5 и 60 секунд."
        : "Продолжить маршрут Juniper → технические данные → OLT → результат.",
      subscriberMessage: comparison.code === "recovered"
        ? "Подключение восстановилось. Я ещё немного проверю, сохраняется ли оно стабильно."
        : "Оставайтесь, пожалуйста, на линии. Продолжаю проверку подключения.",
      confidence: comparison.code === "recovered" ? "medium" : "low",
      comparison
    };
  }

  async function readRouteCheckpoints(key) {
    try {
      const result = await chrome.storage.session.get({ [ROUTE_STORAGE_KEY]: {} });
      const route = result?.[ROUTE_STORAGE_KEY]?.[key] || null;
      if (!route) return {};
      return {
        sessionReviewed: Boolean(route.sessionReviewed),
        technicalReviewed: Boolean(route.technicalReviewed),
        pollerOpened: Boolean(route.pollerOpened),
        askStarted: Boolean(route.askStarted),
        resultReviewed: Boolean(route.resultReviewed),
        completed: Boolean(route.completed)
      };
    } catch (_) {
      return {};
    }
  }

  async function sample(reason = "manual", force = false) {
    if (disposed) return null;
    const context = pageContext();
    const key = subscriberKey(context);
    if (!key) return null;

    const all = await storageGet({});
    const current = all[key] || record || blankRecord(key, context);
    const observation = readObservation(reason);
    current.identity = {
      ...current.identity,
      host: context.host,
      billingId: context.billingId || current.identity?.billingId || "",
      contract: contractFromPage() || current.identity?.contract || ""
    };
    current.facts = mergeObservationFacts(current.facts, observation);
    current.snapshots = appendSnapshot(current.snapshots, observation, force);
    current.checkpoints = {
      ...(current.checkpoints || {}),
      ...(await readRouteCheckpoints(key))
    };
    current.assessment = deriveAssessment(current);
    current.updatedAt = Date.now();
    all[key] = current;
    await storageSet(all);
    record = current;
    notify();
    renderAssessment();
    return clone(current);
  }

  function notify() {
    for (const listener of [...subscribers]) {
      try { listener(clone(record)); } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent("SIMNET_WB_SUBSCRIBER_STATE", { detail: clone(record) }));
  }

  function ensureStyles() {
    if (document.getElementById("simnet-wb-state-engine-style")) return;
    const style = document.createElement("style");
    style.id = "simnet-wb-state-engine-style";
    style.textContent = `
      #${BASIC_OVERLAY_ID} .simnet-state-assessment{margin-top:10px;padding-top:9px;border-top:1px solid rgba(159,176,195,.34);display:grid;gap:5px;font:500 11px/1.38 Segoe UI,Arial,sans-serif}
      #${BASIC_OVERLAY_ID} .simnet-state-assessment strong{font-size:12px;color:#fff}
      #${BASIC_OVERLAY_ID} .simnet-state-assessment [data-tone="ok"]{color:#a8ee24}
      #${BASIC_OVERLAY_ID} .simnet-state-assessment [data-tone="warning"]{color:#ffd166}
      #${BASIC_OVERLAY_ID} .simnet-state-assessment [data-tone="critical"]{color:#ff7b7b}
      #${BASIC_OVERLAY_ID} .simnet-state-assessment small{color:#aab8c7;margin:0}
      #${BASIC_OVERLAY_ID} .simnet-state-assessment q{display:block;color:#dce6f0;font-style:normal}
    `;
    document.documentElement.appendChild(style);
  }

  function renderAssessment() {
    if (!record) return;
    ensureStyles();
    const note = document.querySelector(`#${BASIC_OVERLAY_ID} .route-note`);
    if (!note) return;
    note.querySelector(".simnet-state-assessment")?.remove();

    const assessment = record.assessment || deriveAssessment(record);
    const panel = document.createElement("section");
    panel.className = "simnet-state-assessment";

    const samples = (record.snapshots || []).slice(-3);
    const sampleLabel = samples.length >= 3
      ? `T0/T1/T2: ${samples.length} контрольных снимка`
      : `Контрольные снимки: ${samples.length} из 3`;

    const title = document.createElement("strong");
    title.dataset.tone = assessment.severity || "info";
    title.textContent = assessment.title || "Состояние";

    const detail = document.createElement("span");
    detail.textContent = assessment.detail || "";

    const count = document.createElement("small");
    count.textContent = `${sampleLabel} · уверенность: ${assessment.confidence || "low"}`;

    const action = document.createElement("span");
    action.textContent = `Оператору: ${assessment.operatorAction || "Продолжить проверку."}`;

    const subscriber = document.createElement("q");
    subscriber.textContent = `Абоненту: ${assessment.subscriberMessage || "Продолжаю проверку подключения."}`;

    panel.append(title, detail, count, action, subscriber);
    note.appendChild(panel);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    try { listener(clone(record)); } catch (_) {}
    return () => subscribers.delete(listener);
  }

  function scheduleSample(reason = "dom-change", delay = 700, force = false) {
    window.clearTimeout(pendingSample);
    pendingSample = window.setTimeout(() => {
      pendingSample = 0;
      void sample(reason, force);
    }, delay);
  }

  async function reset() {
    const context = pageContext();
    const key = subscriberKey(context);
    if (!key) return;
    const all = await storageGet({});
    delete all[key];
    await storageSet(all);
    record = blankRecord(key, context);
    notify();
    renderAssessment();
  }

  async function initialize() {
    const context = pageContext();
    const key = subscriberKey(context);
    if (!key) return;
    const all = await storageGet({});
    record = all[key] || blankRecord(key, context);
    notify();

    for (const delay of SAMPLE_DELAYS_MS) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void sample(delay === 0 ? "T0" : delay === 5_000 ? "T1" : "T2", true);
      }, delay);
      timers.add(timer);
    }

    observer = new MutationObserver(records => {
      const external = records.some(change => {
        if (change.target instanceof Element && change.target.closest?.(`#${BASIC_OVERLAY_ID},#simnet-wb-state-engine-style`)) return false;
        return true;
      });
      if (external) scheduleSample("dom-change", 850, false);
      renderAssessment();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "value"] });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!record || !["session", "local"].includes(areaName)) return;
    const change = changes?.[STORAGE_KEY];
    if (!change) return;
    const incoming = change.newValue?.[record.key];
    if (!incoming) return;
    record = incoming;
    notify();
    renderAssessment();
  });

  globalThis.__SIMNET_SUBSCRIBER_STATE_ENGINE__ = {
    version: VERSION,
    getState: () => clone(record),
    sample,
    reset,
    subscribe,
    compareSnapshots,
    deriveAssessment
  };

  window.addEventListener("pagehide", () => {
    disposed = true;
    observer?.disconnect();
    window.clearTimeout(pendingSample);
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    subscribers.clear();
  }, { once: true });

  void initialize();
})();
