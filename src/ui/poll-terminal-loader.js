(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || (WB.pollTerminal && !WB.pollTerminal.__lazy)) return;

  let loadPromise = null;

  function injectFeature(feature, force = false) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'INJECT_FEATURE_SCRIPTS', payload: { feature, force: Boolean(force) } },
          response => {
            const err = chrome.runtime.lastError;
            if (err) return reject(new Error(err.message || String(err)));
            if (!response?.success) return reject(new Error(response?.error || 'inject failed'));
            resolve(response.data || {});
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  function waitFor(timeoutMs = 10000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (WB.__pollTerminalLoaded && WB.pollTerminal && !WB.pollTerminal.__lazy && typeof WB.pollTerminal.scan === 'function') {
          return resolve(WB.pollTerminal);
        }
        if (Date.now() - started > timeoutMs) return reject(new Error('poll-terminal did not register'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  function ensure() {
    if (WB.__pollTerminalLoaded && WB.pollTerminal && !WB.pollTerminal.__lazy) {
      return Promise.resolve(WB.pollTerminal);
    }
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        await injectFeature('poll', false);
        return await waitFor(4000);
      } catch {
        await injectFeature('poll', true);
        return waitFor(8000);
      }
    })().catch(err => {
      loadPromise = null;
      WB.fail?.(err, 'Не удалось загрузить разбор ответа OLT');
      throw err;
    });
    return loadPromise;
  }

  WB.pollTerminal = {
    __lazy: true,
    ensure,
    scan(...a) {
      // fire-and-forget after ensure; bootstrap may call sync
      return ensure().then(api => api.scan?.(...a)).catch(() => {});
    },
    snapshot(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return [];
      try { return WB.pollTerminal.snapshot?.(...a) || []; } catch { return []; }
    },
    hasResult(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return false;
      try { return Boolean(WB.pollTerminal.hasResult?.(...a)); } catch { return false; }
    },
    hasSuccessfulAnalysis(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return false;
      try { return Boolean(WB.pollTerminal.hasSuccessfulAnalysis?.(...a)); } catch { return false; }
    },
    enterPassiveResultView(...a) {
      return ensure().then(api => api.enterPassiveResultView?.(...a)).catch(() => {});
    },
    parseDateish(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return null;
      try { return WB.pollTerminal.parseDateish?.(...a); } catch { return null; }
    },
    formatElapsed(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return '';
      try { return WB.pollTerminal.formatElapsed?.(...a) || ''; } catch { return ''; }
    },
    analyzeCommandBlockText(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return null;
      return WB.pollTerminal.analyzeCommandBlockText?.(...a);
    },
    interpretAnalyses(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return [];
      return WB.pollTerminal.interpretAnalyses?.(...a) || [];
    },
    terminalExpectations(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return null;
      return WB.pollTerminal.terminalExpectations?.(...a);
    },
    parserKeyFromAction(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return '';
      return WB.pollTerminal.parserKeyFromAction?.(...a) || '';
    },
    normalizeMac(v) {
      const hex = String(v || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
      return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
    },
    normalizeSerial(v) {
      return String(v || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
    },
    historySummary(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return '';
      return WB.pollTerminal.historySummary?.(...a) || '';
    },
    appendSummaryUnique(...a) {
      if (!WB.__pollTerminalLoaded || WB.pollTerminal?.__lazy) return;
      return WB.pollTerminal.appendSummaryUnique?.(...a);
    }
  };
})();
