"use strict";

(() => {
  const NativeMutationObserver = globalThis.__SIMNET_NATIVE_MUTATION_OBSERVER__;
  if (typeof NativeMutationObserver === "function") {
    globalThis.MutationObserver = NativeMutationObserver;
  }
  globalThis.__SIMNET_OPERATOR_OBSERVER_GUARD_RELEASED__ = true;
})();
