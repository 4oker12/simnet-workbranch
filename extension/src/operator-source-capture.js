"use strict";

(async () => {
  if (globalThis.__SIMNET_OPERATOR_SOURCE_CAPTURE__) return;

  const store = globalThis.__SIMNET_OPERATOR_CONTEXT_STORE__;
  if (!store?.ready) return;
  await store.ready;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const action = () => store.currentAction();

  function normalizeMac(value) {
    const hex = String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return hex.length === 12 ? hex : "";
  }

  function formatMac(value) {
    const hex = normalizeMac(value);
    return hex ? hex.match(/.{2}/g).join(":") : "";
  }

  function bodyTextWithoutWorkbench() {
    const chunks = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest("#dp-panel") || parent.closest("script,style,noscript")) continue;
      const value = text(node.nodeValue);
      if (value) chunks.push(value);
    }
    return chunks.join("\n");
  }

  function directCells(row) {
    return [...row.querySelectorAll(":scope > td, :scope > th")];
  }

  function labeledRows() {
    const result = [];
    for (const row of document.querySelectorAll("tr")) {
      if (row.closest("#dp-panel")) continue;
      const cells = directCells(row);
      if (cells.length < 2) continue;
      const label = text(cells[0]?.innerText || cells[0]?.textContent);
      const value = text(cells.at(-1)?.innerText || cells.at(-1)?.textContent);
      if (label || value) result.push({ row, label, value });
    }
    return result;
  }

  function findRowValue(patterns) {
    const regexes = patterns.map((item) => item instanceof RegExp ? item : new RegExp(item, "i"));
    for (const item of labeledRows()) {
      if (regexes.some((regex) => regex.test(item.label))) return item;
    }
    return null;
  }

  function currentIdentity() {
    const identity = store.resolveIdentity();
    store.activate(identity);
    return identity;
  }

  function captureAccess() {
    const finance = globalThis.__SIMNET_OPERATOR_FINANCE__;
    if (!finance?.read) return false;
    let model;
    try { model = finance.read(); } catch (_) { return false; }
    const entities = model?.entities || {};
    const accessValue = text(entities.access?.value);
    const serviceState = text(entities.serviceState?.value);
    if ((!accessValue || /не найден/i.test(accessValue)) && (!serviceState || /не найден/i.test(serviceState))) return false;

    store.writeSource("access", {
      subscriber: text(model.subscriber),
      access: accessValue,
      serviceState,
      startDay: text(entities.startDay?.value),
      warning: text(entities.disconnectWarning?.value),
      verdict: model.verdict ? {
        status: text(model.verdict.status),
        title: text(model.verdict.title),
        message: text(model.verdict.message)
      } : null,
      accessDenied: Boolean(model.evidence?.accessDenied),
      accessAllowed: Boolean(model.evidence?.accessAllowed)
    }, {
      action: action(),
      parser: "operator-finance",
      confidence: "high",
      identity: currentIdentity()
    });
    return true;
  }

  function captureEquipmentAndTechnology() {
    const rows = labeledRows();
    const controls = [...document.querySelectorAll("input,select,textarea")]
      .filter((node) => !node.closest("#dp-panel"));

    const explicitPon = [];
    const explicitEthernet = [];
    const values = {};

    for (const control of controls) {
      const name = text(control.name || control.id).toLowerCase();
      const value = text(control.tagName === "SELECT"
        ? control.selectedOptions?.[0]?.textContent || control.value
        : control.value);
      if (!value) continue;
      const rowText = text(control.closest("tr")?.innerText || control.closest("tr")?.textContent);
      const combined = `${name} ${rowText} ${value}`;
      if (/(?:onu|ont|olt|gpon|epon|gcom)/i.test(combined)) explicitPon.push(combined);
      if (/(?:fttb|коммутатор|switch|порт подключения|ethernet access)/i.test(combined)) explicitEthernet.push(combined);
      if (/mac/i.test(combined) && /роутер|router|маршрутизатор/i.test(combined)) values.routerMac = formatMac(value) || value;
      if (/mac/i.test(combined) && /onu|ont/i.test(combined)) values.onuMac = formatMac(value) || value;
      if (/sn|serial/i.test(combined) && /onu|ont/i.test(combined)) values.onuSerial = value;
      if (/olt/i.test(combined)) values.olt = value;
    }

    for (const item of rows) {
      const combined = `${item.label} ${item.value}`;
      if (!values.routerMac && /mac/i.test(item.label) && /роутер|router|маршрутизатор/i.test(item.label)) {
        values.routerMac = formatMac(item.value) || item.value;
      }
      if (!values.onuMac && /mac/i.test(item.label) && /onu|ont/i.test(item.label)) {
        values.onuMac = formatMac(item.value) || item.value;
      }
      if (!values.onuSerial && /sn|serial/i.test(item.label) && /onu|ont/i.test(item.label)) values.onuSerial = item.value;
      if (!values.olt && /\bolt\b/i.test(item.label)) values.olt = item.value;
      if (/(?:onu|ont|olt|gpon|epon|gcom)/i.test(combined) && item.value) explicitPon.push(combined);
      if (/(?:fttb|коммутатор|switch|порт подключения)/i.test(combined) && item.value) explicitEthernet.push(combined);
    }

    if (Object.values(values).some(Boolean)) {
      store.writeSource("equipment", values, {
        action: action(),
        parser: "billing-technical-data",
        confidence: "medium",
        identity: currentIdentity()
      });
    }

    if (explicitPon.length) {
      let adapter = "";
      const combined = explicitPon.join(" ");
      if (/huawei/i.test(combined)) adapter = "huawei";
      else if (/gcom/i.test(combined)) adapter = "gcom";
      else if (/gpon/i.test(combined)) adapter = "bdcom-gpon";
      else if (/epon/i.test(combined)) adapter = "bdcom-epon";
      store.writeTechnology({
        id: "pon",
        adapter,
        label: adapter === "huawei" ? "Huawei GPON"
          : adapter === "gcom" ? "GCOM"
            : adapter === "bdcom-gpon" ? "BDCOM GPON"
              : adapter === "bdcom-epon" ? "BDCOM EPON"
                : "PON / оптика",
        confidence: values.onuMac || values.onuSerial || values.olt ? "high" : "medium"
      }, { source: "billing-technical-data", identity: currentIdentity() });
      return true;
    }

    if (explicitEthernet.length) {
      store.writeTechnology({
        id: "ethernet",
        adapter: "",
        label: "Ethernet / FTTB",
        confidence: "medium"
      }, { source: "billing-technical-data", identity: currentIdentity() });
      return true;
    }
    return false;
  }

  function parseJuniper2() {
    if (action() !== "252") return null;

    const fullText = bodyTextWithoutWorkbench();
    const lower = fullText.toLowerCase();
    const noSession = /(?:нет|не найден[ао]?|відсутн[яійе]|отсутствует)\s+(?:активн(?:ой|ої)?\s+)?(?:сесси|сесі)|no\s+active\s+session|session\s+not\s+found|0\s+sessions?/i.test(fullText);

    const loginRow = findRowValue([/логин/i, /login/i, /account/i]);
    const ipRow = findRowValue([/^ip$/i, /ip[-\s]?адрес/i, /address/i]);
    const macRow = findRowValue([/^mac$/i, /mac[-\s]?адрес/i]);
    const durationRow = findRowValue([/длительност/i, /duration/i, /uptime/i, /время сессии/i]);
    const startRow = findRowValue([/начал[оа]\s+сесс/i, /session\s+start/i, /время входа/i]);

    const login = text(loginRow?.value).match(/\babon\d+\b/i)?.[0]
      || fullText.match(/\babon\d+\b/i)?.[0]
      || "";
    const ip = text(ipRow?.value).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0]
      || fullText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0]
      || "";
    const macMatch = text(macRow?.value).match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i)
      || fullText.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}/i);
    const mac = formatMac(macMatch?.[0]);
    const explicitActive = /(?:сесси|сесі|session)[^\n]{0,50}(?:active|активн|online|up)|(?:active|активн|online)[^\n]{0,50}(?:сесси|сесі|session)/i.test(fullText);
    const state = noSession ? "none" : explicitActive || Boolean(login && ip) ? "active" : "unknown";

    if (state === "unknown" && fullText.length < 40) return null;

    return {
      state,
      label: state === "active" ? "Сессия активна" : state === "none" ? "Активной сессии нет" : "Ответ Juniper 2 получен, состояние не распознано",
      login,
      ip,
      mac,
      duration: text(durationRow?.value),
      startedAt: text(startRow?.value),
      evidence: {
        loginLabel: text(loginRow?.label),
        ipLabel: text(ipRow?.label),
        macLabel: text(macRow?.label),
        durationLabel: text(durationRow?.label)
      },
      rawLength: fullText.length
    };
  }

  function captureJuniper2() {
    const parsed = parseJuniper2();
    if (!parsed) return false;
    const identity = currentIdentity();
    store.mergeIdentity({ login: parsed.login || identity.login });
    store.writeSource("session", parsed, {
      action: "252",
      parser: "juniper2-only",
      confidence: parsed.state === "unknown" ? "low" : "high",
      identity: store.resolveIdentity({ ...identity, login: parsed.login || identity.login })
    });
    return true;
  }

  function pollTextCandidate() {
    const candidates = [...document.querySelectorAll("pre,textarea,code,td,div")]
      .filter((node) => !node.closest("#dp-panel"))
      .map((node) => ({ node, value: text(node.innerText || node.value || node.textContent) }))
      .filter((item) => item.value.length >= 120 && /pon_port_by_onu|display\s+(?:ont|onu)|ONU\s+.+\s+is\s+-|optical\s+power|learned[-\s]?mac/i.test(item.value))
      .sort((a, b) => b.value.length - a.value.length);
    return candidates[0]?.value || bodyTextWithoutWorkbench();
  }

  function safeSerializable(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function capturePonPoll() {
    const currentAction = action();
    if (!/^(310|311|312|313)$/.test(currentAction)) return false;
    const analyzer = globalThis.__SIMNET_ONU_ANALYSIS__;
    if (!analyzer?.analyzeOnuPollResult) return false;
    const raw = pollTextCandidate();
    if (!raw || raw.length < 120) return false;

    const identity = currentIdentity();
    const context = store.current();
    const equipment = context.sources?.equipment?.data || {};
    let analysis;
    try {
      analysis = analyzer.analyzeOnuPollResult(raw, {
        action: currentAction,
        expectedRouterMac: normalizeMac(equipment.routerMac),
        expectedOnuMac: normalizeMac(equipment.onuMac),
        expectedOnuSerial: text(equipment.onuSerial)
      });
    } catch (error) {
      console.warn("[SIMNET source capture] ONU analysis failed", error);
      return false;
    }

    const facts = analysis?.facts || {};
    const report = analysis?.report || {};
    const macs = Array.isArray(facts.macTable?.subscriberMacs) ? facts.macTable.subscriberMacs.map(formatMac).filter(Boolean) : [];
    const adapter = text(analysis?.adapter);
    const payload = {
      adapter,
      status: text(facts.status || "unknown"),
      ethernet: {
        link: text(facts.ethernet?.link || "unknown"),
        speedMbps: facts.ethernet?.speedMbps ?? null,
        duplex: text(facts.ethernet?.duplex || "unknown")
      },
      macs,
      macTableSeen: Boolean(facts.macTable?.seen),
      uptime: {
        text: text(facts.uptime?.text),
        seconds: Number(facts.uptime?.seconds || 0)
      },
      optics: {
        onuRxDbm: facts.optics?.onuRxDbm ?? null,
        oltRxDbm: facts.optics?.oltRxDbm ?? null,
        onuTxDbm: facts.optics?.onuTxDbm ?? null
      },
      serial: text(facts.serial),
      distanceMeters: facts.distanceMeters ?? null,
      history: safeSerializable(facts.history) || {},
      report: {
        severity: text(report.severity || "unknown"),
        badge: text(report.badge),
        summary: text(report.summary),
        conclusion: text(report.conclusion),
        deviations: Array.isArray(report.deviations) ? report.deviations.map(text) : [],
        routerMacPresent: Boolean(report.routerMacPresent),
        routerMacMatched: Boolean(report.routerMacMatched),
        routerMacMismatch: Boolean(report.routerMacMismatch),
        strongCurrentChain: Boolean(report.strongCurrentChain)
      }
    };

    store.writeSource("pon", payload, {
      action: currentAction,
      parser: `onu-analysis:${adapter || "unknown"}`,
      confidence: payload.status === "unknown" ? "medium" : "high",
      identity
    });

    const labels = {
      "310": ["bdcom-epon", "BDCOM EPON"],
      "311": ["bdcom-gpon", "BDCOM GPON"],
      "312": ["gcom", "GCOM"],
      "313": ["huawei", "Huawei GPON"]
    }[currentAction];
    store.writeTechnology({
      id: "pon",
      adapter: labels?.[0] || adapter,
      label: labels?.[1] || "PON / оптика",
      confidence: "high"
    }, { source: `live-poll:${currentAction}`, identity });
    return true;
  }

  function captureNow() {
    currentIdentity();
    const results = {
      access: captureAccess(),
      equipment: captureEquipmentAndTechnology(),
      session: false,
      pon: false
    };
    if (action() === "252") results.session = captureJuniper2();
    if (/^(310|311|312|313)$/.test(action())) results.pon = capturePonPoll();
    document.dispatchEvent(new CustomEvent("dp:operator-source-captured", { detail: results }));
    return results;
  }

  function installBoundedObserver() {
    if (!/^(252|310|311|312|313)$/.test(action())) return;
    let lastFingerprint = "";
    let debounce = 0;
    const startedAt = Date.now();
    const observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        const value = action() === "252" ? bodyTextWithoutWorkbench() : pollTextCandidate();
        const fingerprint = `${value.length}:${value.slice(-180)}`;
        if (fingerprint && fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          captureNow();
        }
        if (Date.now() - startedAt > 15000) observer.disconnect();
      }, 160);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 16000);
  }

  globalThis.__SIMNET_OPERATOR_SOURCE_CAPTURE__ = Object.freeze({
    captureNow,
    parseJuniper2,
    captureJuniper2,
    capturePonPoll
  });

  captureNow();
  window.setTimeout(captureNow, 350);
  window.setTimeout(captureNow, 1200);
  installBoundedObserver();
})();
