(() => {
  "use strict";

  const GUARD = "__SIMNET_WORKBENCH_DEV_RELOAD_PAGE_HOOK__";
  const EVENT_NAME = "simnet-workbench:dev-reload-page";

  if (window[GUARD]) return;
  window[GUARD] = true;

  window.addEventListener(EVENT_NAME, () => {
    window.setTimeout(() => window.location.reload(), 300);
  });
})();
