"use strict";

(() => {
  if (globalThis.__SIMNET_OPERATOR_OBSERVER_GUARD__) return;

  const NativeMutationObserver = globalThis.MutationObserver;
  if (typeof NativeMutationObserver !== "function") return;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const activeObservers = new Set();

  function panelFingerprint() {
    const panel = document.querySelector("#dp-panel");
    if (!panel) return "no-panel";
    const parts = [
      panel.className,
      panel.dataset.operationMode || "",
      text(panel.querySelector("#dp-operator-context")?.textContent),
      text(panel.querySelector("#dp-live-step-title")?.textContent),
      text(panel.querySelector("#dp-live-axes")?.textContent),
      String(panel.querySelectorAll("#dp-live-entities [data-live-entity]").length),
      String(Boolean(panel.querySelector("#dp-tech-guide-v2")))
    ];
    return parts.join("|");
  }

  class GuardedMutationObserver {
    constructor(callback) {
      if (typeof callback !== "function") throw new TypeError("MutationObserver callback must be a function");
      this.callback = callback;
      this.pending = [];
      this.timer = 0;
      this.disconnected = false;
      this.lastFingerprint = "";
      this.sameFingerprintRuns = 0;
      this.callbackTimes = [];
      this.native = new NativeMutationObserver((records) => this.enqueue(records));
      activeObservers.add(this);
    }

    enqueue(records) {
      if (this.disconnected) return;
      this.pending.push(...records);
      if (this.timer) return;
      this.timer = window.setTimeout(() => this.flush(), 140);
    }

    flush() {
      this.timer = 0;
      if (this.disconnected) return;

      const now = Date.now();
      this.callbackTimes = this.callbackTimes.filter((value) => now - value < 2500);
      this.callbackTimes.push(now);

      const fingerprint = panelFingerprint();
      if (fingerprint === this.lastFingerprint) this.sameFingerprintRuns += 1;
      else {
        this.lastFingerprint = fingerprint;
        this.sameFingerprintRuns = 0;
      }

      if (this.sameFingerprintRuns >= 3 && this.callbackTimes.length >= 5) {
        console.warn("[SIMNET UI] Mutation observer stopped: repeated identical DOM state");
        this.disconnect();
        return;
      }

      const records = this.pending.splice(0);
      try {
        this.callback(records, this);
      } catch (error) {
        console.error("[SIMNET UI] guarded observer callback failed", error);
      }
    }

    observe(target, options) {
      if (this.disconnected) return;
      this.native.observe(target, options);
    }

    disconnect() {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = 0;
      this.pending.length = 0;
      this.disconnected = true;
      this.native.disconnect();
      activeObservers.delete(this);
    }

    takeRecords() {
      return this.native.takeRecords();
    }
  }

  globalThis.__SIMNET_NATIVE_MUTATION_OBSERVER__ = NativeMutationObserver;
  globalThis.__SIMNET_OPERATOR_OBSERVER_GUARD__ = Object.freeze({
    activeCount: () => activeObservers.size,
    disconnectAll: () => [...activeObservers].forEach((observer) => observer.disconnect())
  });
  globalThis.MutationObserver = GuardedMutationObserver;
})();
