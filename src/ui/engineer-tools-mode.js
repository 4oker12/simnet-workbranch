(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';
  const STYLE_ID = 'wb-engineer-tools-mode-style';
  const STORAGE_KEY = 'simnet_workbench_ui_engineer_tools_v1';
  const POLL_TARGETS = Object.freeze({
    '310': 'billing.poll.epon',
    '311': 'billing.poll.gpon',
    '312': 'billing.poll.gcom',
    '313': 'billing.poll.huawei'
  });

  let documentObserver = null;
  let rootObserver = null;
  let attachedRoot = null;
  let enhanceQueued = false;
  let enabled = false;

  const engineerEnabled = () => enabled;

  function installStyle(root) {
    if (!root || root.getElementById?.(STYLE_ID) || root.querySelector?.(`#${STYLE_ID}`)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .evidence-row.pending.engineer-ready{background:#fff;border-color:#ead7df}
      .evidence-row.pending.engineer-ready .evidence-row-main b{color:#344054}
      .evidence-row.pending.engineer-ready .evidence-replay{color:#a50046;background:#fff5f8;border-color:#e9c2d2;cursor:pointer}
      .evidence-row.pending.engineer-ready .evidence-replay:hover{background:#fbeaf1;border-color:#d8a4ba}
    `;
    root.appendChild(style);
  }

  function currentProgressItems() {
    const currentCase = WB.store?.activeCase?.() || null;
    const summary = WB.evidenceNavigator?.progressSummary?.(currentCase) || null;
    return Array.isArray(summary?.items) ? summary.items : [];
  }

  function makeSpacer() {
    const spacer = document.createElement('span');
    spacer.className = 'evidence-spacer';
    return spacer;
  }

  function makeEngineerButton(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'evidence-replay wb-engineer-open';
    button.dataset.engineerKey = String(item?.key || '');
    button.title = `Открыть ${String(item?.label || 'инструмент')} напрямую`;
    button.setAttribute('aria-label', button.title);
    button.textContent = '→';
    return button;
  }

  function syncPendingTools(root) {
    const items = currentProgressItems();
    const rows = [...root.querySelectorAll('.evidence-history .evidence-row')];

    rows.forEach((row, index) => {
      const item = items[index] || null;
      const pending = item?.level === 'pending';
      const existing = row.querySelector('.wb-engineer-open');
      const spacer = row.querySelector('.evidence-spacer');

      row.classList.toggle('engineer-ready', Boolean(enabled && pending));

      if (enabled && pending && item?.key) {
        if (existing) {
          existing.dataset.engineerKey = String(item.key);
          existing.title = `Открыть ${String(item.label || 'инструмент')} напрямую`;
          existing.setAttribute('aria-label', existing.title);
        } else if (spacer) {
          spacer.replaceWith(makeEngineerButton(item));
        }
      } else if (existing) {
        existing.replaceWith(makeSpacer());
      }
    });
  }

  function syncSettingsSwitch(root) {
    const button = root.querySelector('#wb-human-settings [data-action="engineer-tools"]');
    if (!button) return;
    button.classList.toggle('on', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.title = enabled ? 'Инструменты инженера включены' : 'Инструменты инженера выключены';
  }

  function enhance(root = attachedRoot) {
    if (!root) return;
    installStyle(root);
    syncSettingsSwitch(root);
    syncPendingTools(root);
  }

  function queueEnhance(root = attachedRoot) {
    if (!root || enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(() => {
      enhanceQueued = false;
      enhance(root);
    });
  }

  async function saveEngineerMode(nextEnabled) {
    enabled = Boolean(nextEnabled);
    await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
    queueEnhance();
    WB.rail?._lastPanelKey && (WB.rail._lastPanelKey = '');
    WB.rail?.render?.();
    return enabled;
  }

  async function loadEngineerMode() {
    try {
      enabled = Boolean((await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY]);
    } catch {
      enabled = false;
    }
    queueEnhance();
    return enabled;
  }

  async function openEngineerPoll(currentCase) {
    const rail = WB.rail;
    if (!rail || !currentCase) return { ok: false, reason: 'case-missing' };

    if (currentCase?.diagnostic?.isEthernet === true) {
      return rail.openEthernetTarget?.('device') || { ok: false, reason: 'ethernet-navigation-unavailable' };
    }

    const pollAction = String(currentCase?.diagnostic?.pollAction || '');
    const target = POLL_TARGETS[pollAction] || '';
    if (!target) {
      rail.toast?.('Технология опроса ещё не определена — открываю техданные');
      return rail.openTechnicalDirect?.() || { ok: false, reason: 'technical-navigation-unavailable' };
    }

    rail.collapseForNavigation?.();
    return rail.runNavigation?.(() => rail.navigateToBillingForAction?.(currentCase, target))
      || { ok: false, reason: 'poll-navigation-unavailable' };
  }

  async function openEngineerTool(key) {
    const rail = WB.rail;
    const currentCase = WB.store?.activeCase?.() || null;
    if (!rail || !currentCase) return { ok: false, reason: 'case-missing' };

    if (key === 'technical') return rail.openTechnicalDirect?.() || { ok: false, reason: 'technical-navigation-unavailable' };
    if (key === 'tmc') return rail.goToTmcDirect?.() || { ok: false, reason: 'tmc-navigation-unavailable' };
    if (key === 'poll') return openEngineerPoll(currentCase);
    if (key === 'juniper') {
      rail.collapseForNavigation?.();
      return rail.runNavigation?.(() => rail.navigateToBillingForAction?.(currentCase, 'billing.juniper'))
        || { ok: false, reason: 'juniper-navigation-unavailable' };
    }
    return { ok: false, reason: 'engineer-tool-unknown' };
  }

  function bindRoot(root) {
    if (!root || root === attachedRoot) return;
    attachedRoot = root;
    installStyle(root);

    root.addEventListener('click', event => {
      const toggle = event.target?.closest?.('[data-action="engineer-tools"]');
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        void saveEngineerMode(!enabled).catch(error => {
          WB.rail?.toast?.(`Не удалось сохранить режим: ${String(error?.message || error || 'ошибка')}`);
        });
        return;
      }

      const tool = event.target?.closest?.('.wb-engineer-open[data-engineer-key]');
      if (!tool) return;
      event.preventDefault();
      event.stopPropagation();
      const key = String(tool.dataset.engineerKey || '');
      if (!key || !enabled) return;
      void openEngineerTool(key).catch(error => {
        WB.rail?.toast?.(`Переход не выполнен: ${String(error?.message || error || 'ошибка')}`);
      });
    }, true);

    rootObserver?.disconnect();
    rootObserver = new MutationObserver(() => queueEnhance(root));
    rootObserver.observe(root, { childList: true, subtree: true });
    queueEnhance(root);
  }

  function discover() {
    const host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) {
      bindRoot(host.shadowRoot);
      documentObserver?.disconnect();
      documentObserver = null;
      return;
    }
    if (documentObserver) return;
    documentObserver = new MutationObserver(discover);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    enabled = Boolean(changes[STORAGE_KEY].newValue);
    queueEnhance();
  });

  WB.engineerTools = Object.freeze({
    enabled: engineerEnabled,
    setEnabled: saveEngineerMode,
    openTool: openEngineerTool,
    storageKey: STORAGE_KEY
  });

  WB.bus?.on?.('store:state', () => queueEnhance());
  discover();
  void loadEngineerMode();
})();
