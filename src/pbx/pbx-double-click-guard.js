(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  function isBusy(runButton) {
    const tools = runButton?.closest?.('.wb-pbx-manual-tools');
    const result = tools?.querySelector?.('.wb-pbx-manual-result');
    return String(result?.dataset?.state || '') === 'processing';
  }

  document.addEventListener('click', event => {
    const run = event.target?.closest?.('.wb-pbx-manual-run');
    if (!run || !isBusy(run)) return;

    // The first click starts analysis. Any further click while that same call is
    // processing must do nothing — especially not trigger the legacy cancel path.
    event.preventDefault();
    event.stopImmediatePropagation();

    run.title = 'Разбор уже выполняется — дождитесь завершения';
  }, true);
})();
