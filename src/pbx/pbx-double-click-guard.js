(() => {
  'use strict';

  if (window.top !== window.self || location.hostname !== 'pbx.simnet.kiev.ua') return;

  const lastClickAt = new Map();
  const WINDOW_MS = 900;

  document.addEventListener('click', event => {
    const run = event.target?.closest?.('.wb-pbx-manual-run');
    if (!run) return;

    const recordId = String(run.closest?.('.wb-pbx-manual-tools')?.dataset?.recordId || '');
    const key = recordId || '__unknown__';
    const now = Date.now();
    const previous = Number(lastClickAt.get(key) || 0);

    if (now - previous < WINDOW_MS) {
      event.preventDefault();
      event.stopImmediatePropagation();
      run.title = 'Повторный клик проигнорирован';
      return;
    }

    lastClickAt.set(key, now);
    setTimeout(() => {
      if (Number(lastClickAt.get(key) || 0) === now) lastClickAt.delete(key);
    }, WINDOW_MS + 50);
  }, true);
})();
