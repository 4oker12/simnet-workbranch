"use strict";

(() => {
  if (window.top !== window.self || globalThis.__SIMNET_ONU_EVIDENCE__) return;

  const baseCore = globalThis.__SIMNET_WORKBENCH_CORE__;
  if (!baseCore?.getState || !baseCore?.subscribe) return;

  const RESULT_SELECTORS = Object.freeze([
    "#dp-results [data-dp-result]",
    "#dp-results .dp-result-row",
    "#dp-results tr",
    "#dp-results details",
    "#dp-results article",
    "#maindiv > table:nth-child(2) > tbody > tr > td:nth-child(2) > div.message"
  ]);

  const safe = (value, max = 80000) => String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

  function uniqueNodes() {
    const seen = new Set();
    const nodes = [];
    for (const selector of RESULT_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!node?.isConnected || seen.has(node)) continue;
        if (node.closest("#simnet-workbench-dock,#simnet-wb-highlight-overlay")) continue;
        seen.add(node);
        nodes.push(node);
      }
    }
    return nodes;
  }

  function resultText() {
    return safe(uniqueNodes()
      .map(node => safe(node.innerText || node.textContent, 12000))
      .filter(Boolean)
      .join(" \n "));
  }

  function strictLineEvidence() {
    const text = resultText();
    if (!text) {
      return {
        polled: false,
        problem: false,
        status: "unverified",
        source: "",
        summary: "Live-опрос ONU ещё не подтверждён",
        signature: []
      };
    }

    const hasEquipment = /\b(?:ONU|ONT)\b/i.test(text);
    const hasStatus = /\b(?:online|offline|up|down|los|dying\s*gasp)\b/i.test(text);
    const hasProblem = /\b(?:offline|down|los|dying\s*gasp)\b|не\s+(?:найден|доступен|зарегистрирован)|критич|плох/i.test(text);
    const hasRxDbm = /\b(?:ONU\s*)?R(?:X|x)(?:\s*(?:power|signal|level|уровень))?\s*[:=]?\s*-?\d+(?:[.,]\d+)?\s*dBm\b/i.test(text);
    const hasTxDbm = /\b(?:ONU\s*)?T(?:X|x)(?:\s*(?:power|signal|level|уровень))?\s*[:=]?\s*-?\d+(?:[.,]\d+)?\s*dBm\b/i.test(text);
    const hasAnyDbm = /-?\d+(?:[.,]\d+)?\s*dBm\b/i.test(text);
    const hasDistance = /(?:distance|расстоян(?:ие|ия))\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:m|м|km|км)\b/i.test(text);
    const hasPonPort = /\b(?:gpon|epon|xgpon|pon)\s*\d+(?:[\/:.-]\d+){1,4}\b/i.test(text);
    const hasIdentity = /\b(?:ONU\s*ID|ONT\s*ID|Serial|SN|MAC)\s*[:=]?\s*[0-9A-F:.\-]{6,}\b/i.test(text);
    const explicitPoll = /(?:live[-\s]?опрос|опрос\s+(?:ONU|ONT)|(?:ONU|ONT)\s+(?:poll|info|status)|результат\s+опроса)/i.test(text);

    const opticalProof = hasAnyDbm && (hasRxDbm || hasTxDbm) && (hasEquipment || hasRxDbm && hasTxDbm);
    const structuredProof = hasEquipment && hasStatus && (hasDistance || hasPonPort || hasIdentity);
    const explicitProof = explicitPoll && hasStatus && (hasAnyDbm || hasDistance || hasIdentity || hasPonPort);
    const polled = Boolean(opticalProof || structuredProof || explicitProof);

    const signature = [
      hasEquipment && "ONU/ONT",
      hasStatus && "status",
      hasRxDbm && "Rx dBm",
      hasTxDbm && "Tx dBm",
      hasDistance && "distance",
      hasPonPort && "PON port",
      hasIdentity && "identity",
      explicitPoll && "poll result"
    ].filter(Boolean);

    return {
      polled,
      problem: Boolean(polled && hasProblem),
      status: polled ? (hasProblem ? "problem" : "received") : "unverified",
      source: polled ? "Результат live-опроса ONU/ONT" : "",
      summary: polled
        ? hasProblem
          ? "Live-опрос выполнен: обнаружено отклонение"
          : "Live-опрос ONU подтверждён результатом"
        : "Live-опрос ONU ещё не подтверждён",
      signature
    };
  }

  function correctState(input) {
    const state = input || {};
    const line = strictLineEvidence();
    return {
      ...state,
      evidence: {
        ...(state.evidence || {}),
        line
      },
      checkpoints: {
        ...(state.checkpoints || {}),
        onuPolled: line.polled
      }
    };
  }

  const correctedCore = {
    ...baseCore,
    version: "0.6.0",
    getState() {
      return correctState(baseCore.getState());
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      return baseCore.subscribe(state => listener(correctState(state)));
    }
  };

  globalThis.__SIMNET_WORKBENCH_CORE__ = correctedCore;
  globalThis.__SIMNET_ONU_EVIDENCE__ = {
    version: "0.1.0",
    strictLineEvidence,
    resultSelectors: RESULT_SELECTORS
  };
})();
