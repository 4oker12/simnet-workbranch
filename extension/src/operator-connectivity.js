"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_CONNECTIVITY__) return;

  const listeners = new Set();
  let latestModel = null;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const lower = (value) => text(value).toLowerCase();
  const normalize = (value) => lower(value)
    .replace(/[іi]/g, "и")
    .replace(/ё/g, "е")
    .replace(/[.,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    if (element.closest("#dp-panel")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function documents() {
    const result = [document];
    for (const iframe of document.querySelectorAll("iframe")) {
      try {
        if (iframe.contentDocument?.documentElement) result.push(iframe.contentDocument);
      } catch (_) {}
    }
    return [...new Set(result)];
  }

  function all(selector) {
    const result = [];
    for (const doc of documents()) {
      try { result.push(...doc.querySelectorAll(selector)); } catch (_) {}
    }
    return result;
  }

  function entity(key, label, value, element, status = "unknown", meaning = "") {
    return {
      key,
      label,
      value: text(value) || "Не получено",
      element: element || null,
      status,
      meaning
    };
  }

  function rowCells(row) {
    return [...row.querySelectorAll(":scope > td, :scope > th")];
  }

  function rowText(row) {
    return text(row?.innerText || row?.textContent);
  }

  function findElementByText(patterns, selector = "tr,td,th,div,p,span,b,strong,a,button,label") {
    const regexes = patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(pattern, "i"));
    let best = null;
    let bestScore = -1;
    for (const element of all(selector)) {
      if (!isVisible(element)) continue;
      const value = text(element.innerText || element.textContent);
      if (!value || value.length > 800) continue;
      for (const regex of regexes) {
        if (!regex.test(value)) continue;
        let score = value.length < 90 ? 60 : value.length < 220 ? 30 : 8;
        if (["TR", "TD", "TH", "A", "BUTTON", "LABEL"].includes(element.tagName)) score += 20;
        if (score > bestScore) {
          best = element;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function nearestUseful(element, selectors = ["tr", "table", "fieldset", "section", "div"]) {
    if (!element) return null;
    for (const selector of selectors) {
      const candidate = element.closest(selector);
      if (!candidate || candidate.closest("#dp-panel")) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 60 && rect.height > 18 && rect.height < innerHeight * 0.75) return candidate;
    }
    return element;
  }

  function findControl(selector) {
    for (const doc of documents()) {
      const control = doc.querySelector(selector);
      if (control) return control;
    }
    return null;
  }

  function selectedValue(control) {
    if (!control) return "";
    if (control.tagName === "SELECT") return text(control.selectedOptions?.[0]?.textContent || control.value);
    return text(control.value || control.textContent);
  }

  function financeModel() {
    try { return globalThis.__SIMNET_OPERATOR_FINANCE__?.read?.() || null; } catch (_) { return null; }
  }

  function detectTechnology() {
    const ponEvidence = [];
    const ethernetEvidence = [];
    let ponScore = 0;
    let ethernetScore = 0;

    const ponControl = findControl('[name*="onu" i],[name*="ont" i],[name*="olt" i],[name*="epon" i],[name*="gpon" i]');
    if (ponControl) {
      ponScore += 8;
      ponEvidence.push(ponControl.closest("tr") || ponControl);
    }

    const ponTerms = [
      /\b(?:sn|serial)\s*(?:onu|ont)\b/i,
      /\bmac\s*(?:onu|ont)\b/i,
      /\b(?:gpon|epon|xgpon|gcom)\b/i,
      /\b(?:olt|onu|ont)\b/i,
      /pon[-\s]?(?:порт|интерфейс)/i,
      /найдено\s+на\s+olt/i
    ];
    for (const pattern of ponTerms) {
      const element = findElementByText([pattern]);
      if (!element) continue;
      ponScore += pattern.source.includes("gpon") || pattern.source.includes("sn") || pattern.source.includes("mac") ? 3 : 2;
      ponEvidence.push(nearestUseful(element, ["tr", "td", "div", "section"]));
    }

    const ethernetTerms = [
      /\bfttb\b/i,
      /коммутатор\s*(?:доступа|абонента)?/i,
      /switch\s*(?:port|interface)?/i,
      /порт\s+(?:коммутатора|подключения|абонента)/i,
      /ethernet\s*(?:port|interface|линк|link)/i,
      /mac\s+на\s+порту/i
    ];
    for (const pattern of ethernetTerms) {
      const element = findElementByText([pattern]);
      if (!element) continue;
      ethernetScore += pattern.source.includes("fttb") || pattern.source.includes("коммутатор") ? 4 : 2;
      ethernetEvidence.push(nearestUseful(element, ["tr", "td", "div", "section"]));
    }

    let id = "unknown";
    if (ponScore >= 6 && ponScore >= ethernetScore + 2) id = "pon";
    else if (ethernetScore >= 5 && ethernetScore > ponScore) id = "ethernet";

    return {
      id,
      label: id === "pon" ? "PON / оптика" : id === "ethernet" ? "Ethernet / FTTB" : "Не определена",
      confidence: id === "unknown" ? "low" : Math.max(ponScore, ethernetScore) >= 10 ? "high" : "medium",
      evidence: id === "pon" ? ponEvidence : id === "ethernet" ? ethernetEvidence : [...ponEvidence, ...ethernetEvidence],
      scores: { pon: ponScore, ethernet: ethernetScore }
    };
  }

  function parseSession() {
    let table = null;
    for (const candidate of all("table.usrlist")) {
      if (candidate.closest("#dp-panel")) continue;
      table = candidate;
      break;
    }

    if (!table) {
      const iframe = all('iframe[src*="juniper" i]')[0] || document.querySelector('iframe[src*="juniper" i]');
      return {
        state: "unknown",
        label: "Сессия не прочитана",
        table: iframe || null,
        login: "",
        ip: "",
        last: "",
        authorized: false,
        historyKnown: false
      };
    }

    const rows = [...table.querySelectorAll("tbody tr")].filter((row) => rowCells(row).length >= 2);
    const row = rows.find((candidate) => candidate.querySelector("a[href*='a=user'], img")) || rows[0] || null;
    if (!row) {
      return { state: "none", label: "Активной сессии нет", table, login: "", ip: "", last: "", authorized: false, historyKnown: false };
    }

    const cells = rowCells(row);
    const image = row.querySelector("img");
    const imageTitle = text(image?.getAttribute("title"));
    const imageSrc = String(image?.getAttribute("src") || "");
    const authorized = /авторизован|доступ\s+разрешен|доступ\s+дозволено/i.test(imageTitle)
      || /\/on\.(?:gif|png|svg)$/i.test(imageSrc)
      || /\bавторизован\b/i.test(rowText(row));
    const loginLink = row.querySelector("a[href*='a=user']") || row.querySelector("a");
    const login = text(loginLink?.textContent);
    const ip = text(cells.at(-1)?.textContent).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "";
    const last = cells.map((cell) => text(cell.textContent)).find((value) => /\b\d{1,2}\.\d{1,2}\.\d{2,4}\s+\d{1,2}:\d{2}\b/.test(value)) || "";

    return {
      state: authorized ? "active" : "inactive",
      label: authorized ? "Сессия активна" : "Активной сессии нет",
      table,
      row,
      login,
      ip,
      last,
      authorized,
      historyKnown: Boolean(last)
    };
  }

  function parsePonLine() {
    const source = findElementByText([
      /onu\s*(?:status|state|состояние|статус)/i,
      /(?:online|offline|los)\s*(?:onu|ont)?/i,
      /оптическ(?:ий|ие)\s+уров/i,
      /rx\s*power/i
    ], "tr,table,div,pre,code,td");
    const scope = nearestUseful(source, ["tr", "table", "pre", "div"]);
    const value = text(scope?.innerText || scope?.textContent);
    const offline = /\boffline\b|\blos\b|не\s+зарегистр/i.test(value);
    const online = !offline && /\bonline\b|зарегистрирован/i.test(value);
    const opticsMatch = value.match(/(?:rx|receive|при[её]м)[^\d-]{0,20}(-?\d+(?:[.,]\d+)?)\s*d?bm/i)
      || text(document.body?.innerText).match(/(?:onu\s*rx|rx\s*power)[^\d-]{0,30}(-?\d+(?:[.,]\d+)?)\s*d?bm/i);
    const clientPortMatch = value.match(/(?:ethernet|lan)[^\n]{0,30}\b(up|down)\b/i);
    const uptimeMatch = value.match(/(?:uptime|online\s*duration|длительность)[^\d]{0,20}([\w:\s.-]{2,40})/i);

    return {
      state: offline ? "down" : online ? "up" : "unknown",
      label: offline ? "ONU offline / LOS" : online ? "ONU online" : "Результат ONU не получен",
      element: scope || source || null,
      optics: opticsMatch ? `${opticsMatch[1].replace(",", ".")} dBm` : "",
      clientPort: clientPortMatch ? clientPortMatch[1].toUpperCase() : "",
      uptime: uptimeMatch ? text(uptimeMatch[1]) : ""
    };
  }

  function parseEthernetLine() {
    const source = findElementByText([
      /(?:порт|interface|ethernet)[^\n]{0,50}\b(?:up|down)\b/i,
      /(?:link|линк)[^\n]{0,30}\b(?:up|down)\b/i,
      /mac\s+на\s+порту/i
    ], "tr,table,div,pre,td");
    const scope = nearestUseful(source, ["tr", "table", "pre", "div"]);
    const value = text(scope?.innerText || scope?.textContent);
    const down = /\b(?:link\s*)?down\b|нет\s+линка/i.test(value);
    const up = !down && /\b(?:link\s*)?up\b|линк\s+есть/i.test(value);
    const vlan = value.match(/\bvlan\D{0,10}(\d{1,4})\b/i)?.[1] || "";
    const learnedMac = value.match(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i)?.[0] || "";
    return {
      state: down ? "down" : up ? "up" : "unknown",
      label: down ? "Порт down" : up ? "Порт up" : "Данные порта не получены",
      element: scope || source || null,
      clientPort: up ? "UP" : down ? "DOWN" : "",
      vlan,
      learnedMac
    };
  }

  function findLabeledValue(patterns) {
    const element = findElementByText(patterns, "tr,td,div,label");
    if (!element) return { value: "", element: null };
    const row = element.closest("tr");
    if (row) {
      const cells = rowCells(row);
      return { value: text(cells.at(-1)?.textContent), element: row };
    }
    return { value: text(element.textContent), element };
  }

  function navigationTarget(stepId, technology) {
    const candidates = {
      access: [/карточк(?:а|у)\s+клиента/i, /основн(?:ая|ую)\s+карточк/i],
      session: [/juniper/i, /сесси/i, /авторизаци/i],
      "pon-line": [/опрос\s+(?:onu|ont)/i, /pon[-\s]?порт/i, /olt/i],
      "ethernet-port": [/тех(?:нические)?\s+данные/i, /коммутатор/i, /порт\s+подключения/i],
      "detect-technology": [/тех(?:нические)?\s+данные/i, /оборудовани/i],
      equipment: [/тех(?:нические)?\s+данные/i, /оборудовани/i],
      history: [/истори/i, /событи/i, /изменени/i]
    }[stepId] || [];

    const links = all("a[href],button,[role='button']").filter((element) => !element.closest("#dp-panel"));
    for (const pattern of candidates) {
      const byText = links.find((element) => pattern.test(text(element.textContent)));
      if (byText) return byText;
    }

    if (stepId === "session") return links.find((element) => /juniper\.php/i.test(String(element.getAttribute("href") || ""))) || null;
    if (["detect-technology", "ethernet-port", "equipment"].includes(stepId)) {
      return links.find((element) => /[?&]a=dopdata\b/i.test(String(element.getAttribute("href") || ""))) || null;
    }
    if (stepId === "pon-line" && technology === "pon") {
      return links.find((element) => /[?&]a=31[0-3]\b/i.test(String(element.getAttribute("href") || ""))) || null;
    }
    return null;
  }

  function buildHypothesis(access, session, technology, line) {
    const denied = access?.evidence?.accessDenied || access?.entities?.access?.status === "error";
    if (denied) {
      return {
        status: "error",
        title: "Разрыв на уровне доступа",
        message: "Billing показывает запрещённый или ограниченный доступ. Сначала устрани административную или финансовую причину."
      };
    }

    if (technology.id === "unknown") {
      return {
        status: "info",
        title: "Сначала определи технологию",
        message: "PON не подтверждён, поэтому ONU-ветка не запускается. Открой технические данные абонента."
      };
    }

    if (line.state === "down") {
      return {
        status: "error",
        title: technology.id === "pon" ? "Проблема в линии PON" : "Нет физического link на порту",
        message: technology.id === "pon"
          ? "Доступ разрешён, но ONU offline или обнаружен LOS. Проверяй оптику, ONU и PON-порт."
          : "Доступ разрешён, но порт Ethernet находится down. Проверяй кабель, питание и порт оборудования."
      };
    }

    if (!session.authorized && line.state === "up") {
      return {
        status: "warning",
        title: "Линия работает, сессии нет",
        message: "Проверь авторизацию, привязку MAC и WAN-настройки роутера."
      };
    }

    if (session.authorized && line.state === "up") {
      return {
        status: "ok",
        title: "Сеть провайдера видит подключение",
        message: "Сессия активна и физическая ветка работает. Рабочая гипотеза смещается к роутеру, Wi‑Fi или конкретному устройству."
      };
    }

    if (session.authorized) {
      return {
        status: "ok",
        title: "Активная сессия подтверждена",
        message: "Для локализации разрыва не хватает результата технологической ветки."
      };
    }

    return {
      status: "unknown",
      title: "Недостаточно подтверждённых данных",
      message: "Проверь сессию и открой соответствующий технологии раздел линии."
    };
  }

  function read() {
    const access = financeModel();
    const technology = detectTechnology();
    const session = parseSession();
    const line = technology.id === "pon" ? parsePonLine() : technology.id === "ethernet" ? parseEthernetLine() : {
      state: "unknown",
      label: "Технология не определена",
      element: technology.evidence[0] || null,
      clientPort: "",
      optics: "",
      uptime: "",
      vlan: "",
      learnedMac: ""
    };

    const routerMacFound = findLabeledValue([/mac\s+(?:роутера|маршрутизатора)/i, /router\s+mac/i]);
    const historyFound = findLabeledValue([/история\s+(?:включений|отключений|событий)/i, /последн(?:ий|ие)\s+(?:los|событи)/i]);
    const route = globalThis.__SIMNET_OPERATOR_ROUTES__?.buildNoInternet?.(technology.id) || null;
    const accessEntity = access?.entities?.access || entity("access", "Доступ", "Не прочитан", null);
    const stateEntity = access?.entities?.serviceState || entity("serviceState", "Состояние услуги", "Не прочитано", null);
    const warningEntity = access?.entities?.disconnectWarning || entity("disconnectWarning", "Предупреждение Billing", "Не прочитано", null);
    const accessSummaryValue = [stateEntity.value, accessEntity.value].filter((value) => value && value !== "Не найдено").join(" · ") || "Не прочитано";
    const accessSummaryStatus = accessEntity.status === "error" ? "error"
      : warningEntity.status === "warning" || stateEntity.status === "warning" ? "warning"
        : accessEntity.status === "ok" && stateEntity.status === "ok" ? "ok" : "unknown";

    const lineStatus = line.state === "up" ? "ok" : line.state === "down" ? "error" : "unknown";
    const sessionStatus = session.state === "active" ? "ok" : session.state === "inactive" || session.state === "none" ? "warning" : "unknown";

    const entities = {
      accessSummary: entity("accessSummary", "Доступ и состояние", accessSummaryValue, accessEntity.element || stateEntity.element, accessSummaryStatus),
      serviceState: stateEntity,
      access: accessEntity,
      disconnectWarning: warningEntity,
      technology: entity(
        "technology",
        "Технология подключения",
        technology.label,
        technology.evidence[0] || navigationTarget("detect-technology", technology.id),
        technology.id === "unknown" ? "warning" : "ok",
        technology.id === "unknown" ? "PON-опрос не запускается, пока технология не подтверждена." : "Технология подтверждена признаками текущей страницы."
      ),
      sessionState: entity("sessionState", "Сессия", session.label, session.row || session.table, sessionStatus),
      sessionLogin: entity("sessionLogin", "Логин", session.login, session.row || session.table, session.login ? "info" : "unknown"),
      sessionIp: entity("sessionIp", "IP", session.ip, session.row || session.table, session.ip ? "info" : "unknown"),
      lastAuthorization: entity("lastAuthorization", "Последняя авторизация", session.last, session.row || session.table, session.last ? "info" : "unknown"),
      lineState: entity(
        "lineState",
        technology.id === "pon" ? "ONU и линия" : technology.id === "ethernet" ? "Порт доступа" : "Технологическая ветка",
        line.label,
        line.element || navigationTarget(technology.id === "pon" ? "pon-line" : technology.id === "ethernet" ? "ethernet-port" : "detect-technology", technology.id),
        lineStatus
      ),
      optics: entity("optics", "Оптический уровень", line.optics, line.element, line.optics ? "info" : "unknown"),
      clientPort: entity("clientPort", technology.id === "pon" ? "Ethernet-порт ONU" : "Физический порт", line.clientPort, line.element, line.clientPort === "UP" ? "ok" : line.clientPort === "DOWN" ? "error" : "unknown"),
      uptime: entity("uptime", "Uptime", line.uptime, line.element, line.uptime ? "info" : "unknown"),
      learnedMac: entity("learnedMac", "Изученный MAC", line.learnedMac, line.element, line.learnedMac ? "info" : "unknown"),
      vlan: entity("vlan", "VLAN", line.vlan, line.element, line.vlan ? "info" : "unknown"),
      routerMac: entity("routerMac", "MAC роутера", routerMacFound.value, routerMacFound.element, routerMacFound.value ? "info" : "unknown"),
      historySummary: entity("historySummary", "Короткая история", historyFound.value, historyFound.element || navigationTarget("history", technology.id), historyFound.value ? "info" : "unknown")
    };

    latestModel = {
      readAt: Date.now(),
      subscriber: access?.subscriber || session.login || "текущий абонент",
      technology,
      session,
      line,
      entities,
      route,
      hypothesis: buildHypothesis(access, session, technology, line),
      navigation: Object.fromEntries((route?.steps || []).map((item) => [item.id, navigationTarget(item.id, technology.id)]))
    };
    return latestModel;
  }

  function elementForStep(stepId) {
    const model = latestModel || read();
    const step = model.route?.steps?.find((item) => item.id === stepId);
    return model.entities[step?.focusKey]?.element || model.navigation[stepId] || null;
  }

  function openStep(stepId) {
    const model = latestModel || read();
    const target = model.navigation[stepId];
    if (!target) return false;
    if (target.tagName === "A" && target.href && !/^javascript:/i.test(target.href)) {
      location.href = target.href;
      return true;
    }
    target.click();
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function refresh() {
    const model = read();
    for (const listener of listeners) {
      try { listener(model); } catch (error) { console.warn("[SIMNET connectivity] listener failed", error); }
    }
    document.dispatchEvent(new CustomEvent("dp:operator-connectivity-refresh", { detail: model }));
    return model;
  }

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.('select[name="cstate"],select[name="state"],input[name="start_day"],select[name="paket"]')) refresh();
  }, true);

  globalThis.__SIMNET_OPERATOR_CONNECTIVITY__ = Object.freeze({
    read,
    refresh,
    subscribe,
    elementForStep,
    openStep,
    isVisible
  });
})();
