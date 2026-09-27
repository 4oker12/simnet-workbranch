(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  // Compatibility gate for the legacy case-bound session-control script.
  // The new Companion owns one persistent conversation and must not surface
  // manual Start/End controls, but the old script remains loadable for older
  // pages/tests and is explicitly disabled only when the new conversation UI
  // has already been installed in this document.
  if (WB.__operatorCompanionConversationLoaded) {
    WB.__operatorCompanionSessionControlsLoaded = true;
  }
})();
