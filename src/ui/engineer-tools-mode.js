(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';
  const STYLE_ID = 'wb-engineer-tools-mode-style';
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

  const engineerEnabled = () => Boolean(WB.store?.state?.ui?.engineerTools);

  function installStyle(root) {
    if (!root || root.getElementById?.(STYLE_ID) || root.querySelector?.(`#${STYLE_ID}`)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .evidence-row.pending.engineer-ready{background:#fff;border-color:#ead7df}
      .evidence-row.pending.engineer-ready .evidence-row-main b{color:#344054}
      .evidence-row.pending.engineer-ready .evidence-replay{color:#a50046;background:#fff5f8;border-color:#e9c2d2;cursor:pointer}
      .evidence-row.pending.engineer-ready .evidence-replay:hover{background:#fbeaf1;border-color:#d8a4ba}
      #wb-human-settings .wb-engineer-note{margin-top:5px;color:#98a2b3;font-size:8.8px;line-height:1.35}
    `;
    root.appendChild(style);
  }

  function currentProgressItems() {
    const currentCase = WB.store?.activeCase?.() || null;
    const summary = WB.evidenceNavigator?.progressSummary?.(currentCase) || null;
    return Array.isArray(summary?.items) ? summary.items : [];
  }

  function makeSpacer(root) {
    const spacer = document.createElement('span');
    spacer.className = 'evidence-spacer';
    return spacer;
  }

  function makeEngineerButton(root, item) {
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
    const enabled = engineerEnabled();
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
          spacer.replaceWith(makeEngineerButton(root, item));
        }
      } else if (existing) {
        existing.replaceWith(makeSpacer(root));
      }
    });
  }

  function syncSettingsSwitch(root) {
    const button = root.querySelector('#wb-human-settings [data-action="engineer-tools"]');
    if (!button) return;
    const enabled = engineerEnabled();
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

  async function saveEngineerMode(enabled) {
    const state = await WB.store?.patchUi?.({ engineerTools: Boolean(enabled) });
    if (state && WB.rail) WB.rail.state = state;
    if (WB.rail) {
      WB.rail._lastPanelKey = '';
      WB.rail.render?.();
    }
    queueEnhance();
    return state;
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
        void saveEngineerMode(!engineerEnabled()).catch(error => {
          WB.rail?.toast?.(`Не удалось сохранить режим: ${String(error?.message || error || 'ошибка')}`);
        });
        return;
      }

      const tool = event.target?.closest?.('.wb-engineer-open[data-engineer-key]');
      if (!tool) return;
      event.preventDefault();
      event.stopPropagation();
      const key = String(tool.dataset.engineerKey || '');
      if (!key || !engineerEnabled()) return;
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

  WB.bus?.on?.('store:state', () => queueEnhance());
  discover();
})();
