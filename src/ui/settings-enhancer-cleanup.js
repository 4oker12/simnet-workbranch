(() => {
  'use strict';

  if (window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';
  const SETTINGS_ID = 'wb-human-settings';
  const CLEAN_ATTR = 'data-ai-settings-clean-v2';
  let observedRoot = null;
  let observer = null;

  function apply(root) {
    const settings = root?.querySelector?.(`#${SETTINGS_ID}`);
    if (!settings) return;

    root.querySelectorAll('.wb-token-total').forEach(node => { node.hidden = true; });

    const legacyKey = settings.querySelector('[data-ai-key]');
    const card = legacyKey?.closest?.('.wb-set-card');
    if (!card || card.hasAttribute(CLEAN_ATTR)) return;
    card.setAttribute(CLEAN_ATTR, '1');
    card.innerHTML = `
      <div class="wb-set-head">
        <div>
          <div class="wb-set-title">AI</div>
          <div class="wb-set-sub">Провайдер, API key и модель настраиваются в единой странице AI Lab.</div>
        </div>
      </div>
      <button class="wb-btn secondary" data-ai-open-settings type="button">Открыть AI Lab / настройки</button>
    `;
    card.querySelector('[data-ai-open-settings]')?.addEventListener('click', event => {
      event.stopPropagation();
      try { chrome.runtime.openOptionsPage(); } catch {}
    });
  }

  function attach() {
    const host = document.getElementById(HOST_ID);
    const root = host?.shadowRoot;
    if (!root) return;
    if (observedRoot !== root) {
      observer?.disconnect();
      observedRoot = root;
      observer = new MutationObserver(() => apply(root));
      observer.observe(root, { childList: true, subtree: true });
    }
    apply(root);
  }

  const documentObserver = new MutationObserver(attach);
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  attach();
})();
