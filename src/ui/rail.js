(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';
  const POLL_PENDING_TIMEOUT_MS = 30000;

  const valueOf = fact =>
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact;

  const pollNavigationTarget = pollAction => ({
    '310': 'billing.poll.epon',
    '311': 'billing.poll.gpon',
    '312': 'billing.poll.gcom',
    '313': 'billing.poll.huawei'
  })[String(pollAction || '')] || '';

  const technicalFieldLabels = fields => {
    const labels = { olt: 'OLT', onuSerial: 'Serial ONU', onuMac: 'MAC ONU' };
    return (Array.isArray(fields) ? fields : [])
      .map(field => labels[field] || field)
      .join(', ');
  };


  const normalizedIdentity = value => String(valueOf(value) || '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();

  const tmcTechnicalExpectation = (caseData, fallback = {}) => {
    const pon = caseData?.pon || {};
    const fromTmcFact = (key, fallbackValue) => Object.prototype.hasOwnProperty.call(pon, key)
      ? String(valueOf(pon[key]) || '')
      : String(fallbackValue || '');
    const expected = {
      oltName: fromTmcFact('tmcOltName', fallback.oltName),
      oltIp: fromTmcFact('tmcOltIp', fallback.oltIp),
      onuSerial: fromTmcFact('tmcOnuSerial', fallback.onuSerial),
      onuMac: fromTmcFact('tmcOnuMac', fallback.onuMac)
    };
    const fields = [];
    if (expected.oltName || expected.oltIp) fields.push('olt');
    if (normalizedIdentity(expected.onuSerial)) fields.push('onuSerial');
    if (normalizedIdentity(expected.onuMac).length === 12) fields.push('onuMac');
    return { expected, fields };
  };

  const hasSuccessfulOnuPoll = caseData => {
    if (!caseData) return false;
    if (caseData?.diagnostic?.isPon === true) {
      return String(caseData?.diagnostic?.pollState || '') === 'confirmed';
    }
    if (caseData?.locator?.termination?.status === 'confirmed') return true;
    if (caseData?.live?.oltSnapshot?.status === 'confirmed') return true;
    const evidence = Array.isArray(caseData?.locator?.evidence)
      ? caseData.locator.evidence
      : [];
    return evidence.some(item => {
      if (String(item?.type || '') !== 'POLL_RESULT') return false;
      const result = String(item?.result || item?.details?.outcome || '').toLowerCase();
      return ['confirmed', 'success', 'online', 'up'].includes(result);
    });
  };

  const EXPORT_SECRET_KEY_RE = /(^|_)(pp|password|passwd|pass|token|secret|csrf|cookie|authorization|auth|session|sessionid|sid)(_|$)/i;
  const EXPORT_SECRET_QUERY_RE = /^(pp|password|passwd|pass|token|secret|_csrf|csrf|session|sessionid|sid|auth|authorization)$/i;

  const redactCaseExportString = raw => {
    const text = String(raw == null ? '' : raw);
    if (!text) return text;
    try {
      const url = new URL(text);
      for (const key of [...url.searchParams.keys()]) {
        if (EXPORT_SECRET_QUERY_RE.test(key) || /^pp\d+$/i.test(key) || /^uu\d+$/i.test(key)) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      if (url.username) url.username = '[redacted]';
      if (url.password) url.password = '[redacted]';
      return url.href;
    } catch {
      return text
        .replace(/([?&](?:pp|password|passwd|pass|token|secret|_csrf|csrf|session|sessionid|sid|auth|authorization|pp\d+|uu\d+)=)[^&#\s]*/gi, '$1[redacted]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
    }
  };

  const sanitizeCaseExport = (value, seen = new WeakSet()) => {
    if (typeof value === 'string') return redactCaseExportString(value);
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => sanitizeCaseExport(item, seen));
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (EXPORT_SECRET_KEY_RE.test(key) || /^pp\d+$/i.test(key) || /^uu\d+$/i.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeCaseExport(item, seen);
      }
    }
    return out;
  };

  const esc = value =>
    String(value == null ? '' : value).replace(
      /[&<>"']/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
    );

  const formatTime = iso => {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(iso));
    } catch {
      return '';
    }
  };

  const formatRate = raw => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} Mbit/s`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)} kbit/s`;
    return `${Math.round(value)} bit/s`;
  };

  const icon = name => {
    const paths = {
      live: '<path d="M4 12h3l2-5 4 10 2-5h5"/>',
      facts: '<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
      phone: '<path d="M7.2 3.8 10 7l-2 2.2c1.3 2.6 3.3 4.6 5.9 5.9l2.2-2 3.1 2.8-.9 3.1c-.2.8-1 1.3-1.8 1.2C9.7 19.3 4.7 14.3 3.8 7.5c-.1-.8.4-1.6 1.2-1.8l2.2-.9Z"/>',
      journal: '<path d="M4 7h16M7 4v6M17 4v6M6 11h12v9H6z"/><path d="M9 15h6"/>',
      settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4 13v-2l2-1 .5-1.3-.7-2.1 1.4-1.4 2.1.7L10.6 5l1-2h2l1 2 1.3.9 2.1-.7 1.4 1.4-.7 2.1.9 1.3 2 1v2l-2 1-.9 1.3.7 2.1-1.4 1.4-2.1-.7-1.3.9-1 2h-2l-1-2-1.3-.9-2.1.7-1.4-1.4.7-2.1L6 14z"/>',
      chevron: '<path d="m14 7-5 5 5 5"/>',
      close: '<path d="m7 7 10 10M17 7 7 17"/>',
      copy: '<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
      nextHint: '<circle cx="12" cy="12" r="6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><path d="m10 12 1.4 1.4L14.5 10"/>',
      companion: '<circle cx="12" cy="8" r="3.2"/><path d="M6.5 19c.7-3.3 2.6-5 5.5-5s4.8 1.7 5.5 5"/><path d="M5.5 10.8v2.5a2 2 0 0 0 2 2H9M18.5 10.8v3.5a2 2 0 0 1-2 2H15"/><path d="M5.5 11a6.5 6.5 0 0 1 13 0"/>',
      more: '<rect x="5" y="5" width="5" height="5" rx="1"/><rect x="14" y="5" width="5" height="5" rx="1"/><rect x="5" y="14" width="5" height="5" rx="1"/><rect x="14" y="14" width="5" height="5" rx="1"/>'
    };

    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.live}</svg>`;
  };

  class RailPanel {
    constructor() {
      this.host = null;
      this.shadow = null;
      this.state = null;
      this.drag = null;
      this.toastTimer = null;
      this.pollTimeoutTimer = null;
      this.hoverOpen = false;
      this.hoverCloseTimer = null;
      this.activeView = null;
      this.fullSection = '';
      this.boundModuleOpen = event => {
        const module = String(event?.detail?.module || '');
        if (!['call', 'companion'].includes(module)) return;
        this.activeView = module;
        this.hoverOpen = false;
        this.render();
      };
      this.boundModuleClose = event => {
        const module = String(event?.detail?.module || '');
        if (module && this.activeView !== module) return;
        if (['call', 'companion'].includes(this.activeView)) {
          this.activeView = null;
          this.render();
        }
      };
      this.boundShellKeydown = event => {
        if (event.key !== 'Escape' || !this.activeView || ['call', 'companion'].includes(this.activeView)) return;
        event.preventDefault();
        this.activeView = null;
        this.render();
      };
      window.addEventListener?.('simnet-workbench-module-open', this.boundModuleOpen);
      window.addEventListener?.('simnet-workbench-module-close', this.boundModuleClose);
      globalThis.document?.addEventListener?.('keydown', this.boundShellKeydown, true);
      this.terminalView = {
        active: false,
        blocks: 0,
        interpreted: []
      };
      this.pollAttempt = null;
      this.lastWorkflowPageKind = '';
      this.unsub = WB.bus.on('store:state', state => this.update(state));
      this.unsubTerminalView = WB.bus.on('terminal:result-view', payload => {
        this.terminalView.active = Boolean(payload?.active);
        this.terminalView.blocks = Number(payload?.blocks || this.terminalView.blocks || 0);
        this.render();
      });
      this.unsubTerminalInterpreted = WB.bus.on('terminal:interpreted', payload => {
        this.terminalView.active = true;
        this.terminalView.interpreted = Array.isArray(payload?.blocks)
          ? payload.blocks
          : [];
        this.terminalView.blocks = this.terminalView.interpreted.length;
        this.render();
      });
      this.unsubGuardWarning = WB.bus.on('guard:warning', payload => {
        const reason = String(payload?.reason || '');
        if (reason === 'poll-action-mismatch') {
          const expected = [payload?.expectedTechnology, payload?.expectedAction ? `(${payload.expectedAction})` : ''].filter(Boolean).join(' ');
          const actual = [payload?.actualTechnology, payload?.actualAction ? `(${payload.actualAction})` : ''].filter(Boolean).join(' ');
          const source = payload?.expectedSource === 'tmc' ? 'по ТМЦ' : 'по сохранённым техданным Billing';
          this.toast(`Конфликт технологии: ${source} ожидается ${expected || 'другой тип опроса'}, выбран ${actual || 'другой раздел'}.`, 3600, 'warning');
          return;
        }
        if (reason === 'poll-olt-mismatch') {
          const source = payload?.expectedSource === 'tmc' ? 'ТМЦ показывает' : 'в Billing сохранена';
          this.toast(`Конфликт OLT: ${source} ${payload?.expectedOltIp || 'другую OLT'}, ссылка ведёт на ${payload?.actualOltIp || 'другую OLT'}.`, 3600, 'warning');
          return;
        }
        if (reason === 'poll-billing-mismatch') {
          this.toast('Конфликт абонента: ссылка опроса относится к другому Billing ID.', 3600, 'warning');
          return;
        }
      });
      this.unsubPollStarted = WB.bus.on('poll:attempt-started', payload => {
        this.pollAttempt = payload || null;
        this.schedulePollTimeoutCheck();
        this.render();
      });
      this.unsubPollResolved = WB.bus.on('poll:attempt-resolved', payload => {
        this.pollAttempt = payload || null;
        this.schedulePollTimeoutCheck();
        this.render();
        if (payload?.failureReason === 'native-navigation-cancelled') {
          this.toast('Запрос не запустился — можно нажать ещё раз');
        }
      });
      this.unsubClickDebug = WB.bus.on('debug:click', () => {
        if (this.activeView === 'full' && this.fullSection === 'journal') {
          this._lastPanelKey = '';
          this.render();
        }
      });
      this.unsubJunctionDebug = WB.bus.on('debug:junction', () => {
        if (this.activeView === 'full' && this.fullSection === 'journal') {
          this._lastPanelKey = '';
          this.render();
        }
      });
          }

    mount() {
      if (document.getElementById(HOST_ID)) return;

      this.host = document.createElement('div');
      this.host.id = HOST_ID;
      Object.assign(this.host.style, {
        position: 'fixed',
        right: '10px',
        top: '72px',
        bottom: 'auto',
        width: 'auto',
        height: 'auto',
        transform: 'none',
        zIndex: '2147483646'
      });
      this.attentionOpen = false;

      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `
        ${this.styles()}
        ${this.plumStyles()}
        <div class="view-backdrop" data-action="close"></div>
        <div class="attention-wrap">
          <button type="button" class="attention-bell" data-action="toggle-attention" title="Требует внимания" aria-label="Требует внимания">
            <svg viewBox="0 0 24 24"><path d="M6.7 9.5a5.3 5.3 0 0 1 10.6 0c0 6 2.2 6 2.2 7.3H4.5c0-1.3 2.2-1.3 2.2-7.3Z"/><path d="M9.7 19a2.6 2.6 0 0 0 4.6 0"/></svg>
            <span class="attention-badge" hidden>0</span>
          </button>
          <div class="attention-popup" hidden></div>
        </div>
        <div class="shell">
          <aside class="drawer"><div class="panel"></div></aside>
          <nav class="rail"></nav>
        </div>
        <div class="toast"></div>
      `;

      document.documentElement.appendChild(this.host);
      this.state = WB.store.state || this.state;
      if (this.state) {
        this.state.ui = {
          ...(this.state.ui || {}),
          open: false
        };
        this.fullSection = this.normalizeFullSection(this.state.ui.section);
      }
      this.bind();
      this.render();
    }

    styles() {
      return WB.railStyles?.base || '<style></style>';
    }

    plumStyles() {
      return WB.railStyles?.plum || '<style></style>';
    }

    bind() {
      this.shadow.addEventListener('click', event => {
        const debugActionNode = event.target.closest?.('[data-action]');
        const debugSectionNode = event.target.closest?.('[data-section]');
        WB.clickDebug?.mark?.(
          event,
          'rail',
          'allowed',
          debugActionNode?.dataset?.action
            ? `rail-action:${debugActionNode.dataset.action}`
            : debugSectionNode?.dataset?.section
              ? `rail-section:${debugSectionNode.dataset.section}`
              : 'rail-click'
        );

        const sectionButton = event.target.closest('[data-section]');
        if (sectionButton) {
          const section = this.normalizeFullSection(sectionButton.dataset.section);
          this.activeView = 'full';
          this.hoverOpen = false;
          this.selectFullSection(section);
          return;
        }

        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        if (action === 'view-live') {
          this.activeView = this.activeView === 'live' ? null : 'live';
          this.hoverOpen = false;
          this.state.ui = { ...(this.state.ui || {}), section: 'live', open: false };
          if (this.activeView === 'live') {
            window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'live' } }));
          }
          this.render();
          return;
        }
        if (action === 'view-full') {
          this.activeView = this.activeView === 'full' ? null : 'full';
          this.hoverOpen = false;
          if (this.activeView === 'full') {
            this.fullSection = this.normalizeFullSection(this.fullSection || this.state?.ui?.section);
            if (this.state) this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false };
            window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'full' } }));
          }
          this.render();
          return;
        }
        if (action === 'view-companion') {
          this.activeView = 'companion';
          this.hoverOpen = false;
          this.render();
          void WB.operatorCompanion?.open?.();
          return;
        }

        if (action === 'live-open-technical') {
          void this.openTechnicalDirect();
          return;
        }
        if (action === 'live-go-tmc') {
          void this.goToTmcDirect();
          return;
        }
        if (action === 'live-search-mac') {
          void this.openMacSearchDirect();
          return;
        }
        if (action === 'live-open-ethernet-device') {
          void this.openEthernetTarget('device');
          return;
        }
        if (action === 'live-open-ethernet-fdb') {
          void this.openEthernetTarget('fdb');
          return;
        }
        if (action === 'live-open-ethernet-errors') {
          void this.openEthernetTarget('errors');
          return;
        }
        if (action === 'live-open-poll') {
          void this.requestPollReveal();
          return;
        }
        if (action === 'live-replay') {
          const key = String(event.target.closest('[data-evidence-key]')?.dataset.evidenceKey || '');
          if (key) void this.replayEvidence(key);
          return;
        }

        if (action === 'call-registration') {
          const currentCase = this.activeCase() || null;
          if (!WB.callRegistration?.open) {
            this.toast('Модуль регистрации звонка не загружен');
            return;
          }
          this.hoverOpen = false;
          this.activeView = 'call';
          this.render();
          void WB.callRegistration.open(currentCase).then(result => {
            if (!result?.ok && this.activeView === 'call') {
              this.activeView = null;
              this.render();
            }
          }).catch(error => {
            if (this.activeView === 'call') {
              this.activeView = null;
              this.render();
            }
            this.toast(`Регистрация звонка не открылась: ${String(error?.message || error || 'ошибка загрузки')}`);
          });
          return;
        }

        if (action === 'toggle-attention') {
          this.attentionOpen = !this.attentionOpen;
          this.syncAttention();
          return;
        }
        if (action === 'close-attention') {
          this.attentionOpen = false;
          this.syncAttention();
          return;
        }
        if (action === 'close') {
          this.hoverOpen = false;
          this.activeView = null;
          this.attentionOpen = false;
          this.render();
        }
        if (action === 'copy-contract') {
          this.copy(
            valueOf(this.activeCase()?.identity?.contract)
            || valueOf(this.activeCase()?.identity?.login)
            || ''
          );
        }
        if (action === 'export') void this.exportCase();
        if (action === 'reset') this.resetCase();
        if (action === 'clear-workbench-data') void this.clearWorkbenchData();
        if (action === 'clear-click-debug') {
          WB.clickDebug?.clear?.();
          this._lastPanelKey = '';
          this.render();
        }
        if (action === 'compact') {
          const compact = !Boolean(this.state?.ui?.compact);
          WB.store.patchUi({ compact });
          this.state.ui = { ...this.state.ui, compact };
          this.render();
        }
      });


    }

    activeCase() {
      return WB.store.activeCase();
    }

    normalizeFullSection(section) {
      return ['facts', 'journal', 'settings'].includes(String(section || ''))
        ? String(section)
        : 'facts';
    }

    selectFullSection(section) {
      const next = this.normalizeFullSection(section);
      this.fullSection = next;
      if (this.state) {
        this.state.ui = { ...(this.state.ui || {}), section: next, open: false };
      }
      this.render();
      Promise.resolve(WB.store.patchUi?.({ section: next })).catch(() => {
        this.toast('Не удалось сохранить выбранный раздел');
      });
    }

    update(state) {
      this.state = state || this.state || { ui: {}, cases: {} };
      if (this.state?.callModule?.config?.enabled === false && this.activeView === 'call') {
        this.activeView = null;
      }
      const persisted = this.normalizeFullSection(this.state?.ui?.section);
      if (this.activeView === 'full' && this.fullSection) {
        this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false };
      } else {
        this.fullSection = persisted;
      }
      this.schedulePollTimeoutCheck();
      this.render();
    }

    render() {
      if (!this.shadow) return;
      if (this._renderRaf) {
        this._renderDirty = true;
        return;
      }
      this._renderRaf = globalThis.requestAnimationFrame?.(() => {
        this._renderRaf = 0;
        const again = this._renderDirty;
        this._renderDirty = false;
        this.renderNow();
        if (again) this.render();
      }) || 0;
      if (!this._renderRaf) this.renderNow();
    }

    renderNow() {
      if (!this.shadow) return;

      this.state ||= WB.store.state || {
        ui: { open: false, section: 'live' },
        cases: {}
      };

      const shell = this.shadow.querySelector('.shell');
      const drawerOpen = ['live', 'full'].includes(this.activeView);
      shell.classList.toggle('open', drawerOpen);
      shell.classList.toggle('full', this.activeView === 'full');
      shell.classList.toggle('compact', Boolean(this.state.ui?.compact));

      const backdrop = this.shadow.querySelector('.view-backdrop');
      if (backdrop) {
        backdrop.className = `view-backdrop ${this.activeView === 'live' ? 'live' : this.activeView === 'full' ? 'full' : ''}${drawerOpen ? ' show' : ''}`;
      }

      let section = this.state.ui?.section || 'facts';
      if (this.activeView === 'live') section = 'live';
      if (this.activeView === 'full') {
        section = this.normalizeFullSection(this.fullSection || section);
        this.fullSection = section;
      }

      const currentCase = this.activeCase();
      const currentDecision = WB.caseView?.decision?.(currentCase) || {};
      const quickPlan = this.nextStep(currentCase);
      const quickReady = this.directActionable(quickPlan);
      const active = this.activeView;

      this.syncRailButtons(active, quickReady);
      this.syncAttention();

      // Compact rail: drawer closed — do not rebuild LIVE/Full panel HTML on every store tick.
      const panel = this.shadow.querySelector('.panel');
      if (!drawerOpen) {
        this._lastPanelKey = '';
        return;
      }

      // Skip panel DOM rewrite when visible content identity is unchanged.
      const panelKey = [
        active || '',
        section || '',
        currentCase?.id || '',
        currentCase?.updatedAt || '',
        currentCase?.caseVersion || '',
        currentCase?.complaint?.updatedAt || '',
        currentCase?.diagnostic?.stage || '',
        currentDecision.action || 'wait_context',
        currentDecision.completionKey || '',
        (currentCase?.diagnostic?.billingMissingTechnical || []).join(','),
        currentCase?.live?.oltSnapshot?.status || '',
        'direct'
      ].join('|');
      if (panelKey === this._lastPanelKey && panel?.querySelector?.('.body')) {
        return;
      }
      this._lastPanelKey = panelKey;

      const nav = this.activeView === 'full' ? this.fullNav(section) : '';
      this.setHtml(panel, this.header(section) + `<div class="body">${nav}${this.section(section)}</div>`);
      this.syncPonTechnicalFieldHints();
    }

    /**
     * Parse HTML into a DocumentFragment (via template) and swap children in one op.
     * Avoids intermediate live-DOM thrash of incremental innerHTML appends.
     */
    setHtml(node, html) {
      if (!node) return;
      const template = this._htmlTemplate || (this._htmlTemplate = document.createElement('template'));
      template.innerHTML = String(html || '');
      node.replaceChildren(template.content.cloneNode(true));
    }

    /**
     * Update rail chrome without full innerHTML when buttons already exist.
     * Avoids destroying listeners/focus and reduces DOM thrash on store ticks.
     */
    syncRailButtons(active, quickReady) {
      const rail = this.shadow?.querySelector?.('.rail');
      if (!rail) return;
      const callEnabled = this.state?.callModule?.config?.enabled !== false;
      const existing = rail.querySelector('[data-view="live"]');
      if (!existing) {
        this.setHtml(rail, `
        <div class="rail-stack">
          ${this.viewButton('call', 'call-registration', 'phone', 'Регистрация звонка', active === 'call', 'call-quick')}
          ${this.viewButton('live', 'view-live', 'live', 'LIVE помощник', active === 'live', quickReady ? 'live-ready' : '')}
          ${this.viewButton('companion', 'view-companion', 'companion', 'AI помощник', active === 'companion')}
          ${this.viewButton('full', 'view-full', 'more', 'Все функции', active === 'full', 'more')}
        </div>
      `);
        return;
      }
      for (const btn of rail.querySelectorAll('.rail-btn[data-view]')) {
        const view = btn.getAttribute('data-view');
        if (view === 'call') btn.hidden = !callEnabled;
        btn.classList.toggle('active', view === active);
        if (view === 'live') btn.classList.toggle('live-ready', Boolean(quickReady));
      }
    }

    viewButton(view, action, iconName, title, active = false, extraClass = '') {
      return `<button class="rail-btn ${extraClass} ${active ? 'active' : ''}" data-action="${action}" data-view="${view}" title="${esc(title)}" aria-label="${esc(title)}">${icon(iconName)}<span class="rail-label">${esc(title)}</span></button>`;
    }

    attentionItems(currentCase = this.activeCase()) {
      const items = [];
      if (!currentCase) return items;
      const diagnostic = currentCase.diagnostic || {};
      const conflicts = Array.isArray(diagnostic.conflicts) ? diagnostic.conflicts : [];
      for (const c of conflicts) {
        const label = String(c?.label || c?.field || c?.type || 'Конфликт данных').trim();
        const detail = String(c?.detail || c?.message || c?.summary || '').trim();
        items.push({ level: 'warn', title: label, detail });
      }
      const pon = diagnostic.ponWorkflowDetails || {};
      const prefill = Array.isArray(pon.prefillFields) ? pon.prefillFields : [];
      if (prefill.length && !items.some(i => /тмц/i.test(i.title))) {
        items.push({
          level: 'unk',
          title: 'ТМЦ не сверено',
          detail: 'Данные ONU есть, Billing ещё не сверен'
        });
      }
      if (Number(diagnostic.conflictCount || 0) > 0 && !items.length) {
        items.push({
          level: 'warn',
          title: 'Конфликт источников',
          detail: String(diagnostic.conflictSummary || 'Billing и ТМЦ расходятся')
        });
      }
      // MAC mismatch heuristic from existing evidence rows when present
      const evidence = Array.isArray(currentCase?.locator?.evidence) ? currentCase.locator.evidence : [];
      for (const row of evidence) {
        const t = String(row?.type || row?.key || '').toLowerCase();
        const r = String(row?.result || row?.level || '').toLowerCase();
        if ((t.includes('mac') || String(row?.label || '').toLowerCase().includes('mac')) &&
            (r.includes('mismatch') || r.includes('conflict') || r === 'warn' || r === 'attention')) {
          const title = String(row?.label || 'MAC Billing ≠ ONU');
          if (!items.some(i => i.title === title)) {
            items.push({ level: 'warn', title, detail: String(row?.detail || row?.summary || '').slice(0, 80) });
          }
        }
      }
      return items.slice(0, 6);
    }

    syncAttention() {
      if (!this.shadow) return;
      const items = this.attentionItems();
      const badge = this.shadow.querySelector('.attention-badge');
      const popup = this.shadow.querySelector('.attention-popup');
      const bell = this.shadow.querySelector('.attention-bell');
      if (badge) {
        const n = items.length;
        badge.hidden = n === 0;
        badge.textContent = String(n);
        if (bell) bell.classList.toggle('has-items', n > 0);
      }
      if (!popup) return;
      if (!this.attentionOpen || !items.length) {
        popup.hidden = true;
        popup.innerHTML = '';
        return;
      }
      const rows = items.map(item => {
        const mark = item.level === 'warn' ? '!' : '?';
        const cls = item.level === 'warn' ? 'warn' : 'unk';
        return `<div class="attention-issue"><span class="${cls}">${mark}</span><div><b>${esc(item.title)}</b>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</div></div>`;
      }).join('');
      popup.innerHTML = `
        <div class="attention-head">
          <b>Требует внимания · ${items.length}</b>
          <button type="button" class="attention-x" data-action="close-attention" aria-label="Закрыть">×</button>
        </div>
        ${rows}`;
      popup.hidden = false;
    }

    fullNav(section) {
      const items = [
        ['facts', 'facts', 'Абонент'],
        ['journal', 'journal', 'Журнал'],
        ['settings', 'settings', 'Настройки']
      ];
      return `<div class="full-nav">${items.map(([id, iconName, label]) => `<button class="${section === id ? 'active' : ''}" data-section="${id}" title="${esc(label)}">${icon(iconName)}<span>${esc(label)}</span></button>`).join('')}</div>`;
    }

    railButton(section, title) {
      return `<button class="rail-btn" data-section="${section}" title="${title}">${icon(section)}</button>`;
    }

    header(section) {
      const currentCase = this.activeCase();
      const context = WB.runtime.lastContext || currentCase?.currentContext;
      const diagnostic = currentCase?.diagnostic || {};
      const title = {
        live: 'LIVE · снимок',
        facts: 'Профиль абонента',
        journal: 'Журнал кейса',
        settings: 'Настройки'
      }[section] || 'Workbench';

      return `
        <header class="head">
          <span class="dot ${diagnostic.conflictCount ? 'warn' : ''}"></span>
          <div class="head-title">
            <b>${title}</b>
            <small>${esc(
              context
                ? this.contextLabel(context)
                : 'Ожидание контекста'
            )}</small>
          </div>
          <button class="icon-btn" data-action="close" title="Свернуть">${icon('close')}</button>
        </header>
      `;
    }

    section(section) {
      if (section === 'facts') return this.factsView();
      if (section === 'journal') return this.journalView();
      if (section === 'settings') return this.settingsView();
      return this.liveView();
    }

    planCacheKey(currentCase) {
      const projected = WB.caseView?.decision?.(currentCase) || {};
      return [
        currentCase?.id || '',
        currentCase?.caseVersion || '',
        projected.action || 'wait_context',
        projected.completionKey || '',
        projected.semanticTargetId || '',
        projected.reason || ''
      ].join('|');
    }

    nextStep(currentCase) {
      const key = this.planCacheKey(currentCase);
      if (key && key === this._planCacheKey && this._planCache) return this._planCache;
      const d = WB.caseView?.decision?.(currentCase) || { action: 'wait_context', reason: '' };
      const labels = {
        open_technical: ['Перейти в технические данные', 'Проверить нативные Technical-поля Billing.'],
        check_tmc: ['Перейти в ТМЦ', 'Открыть текущего абонента UserSide и показать строку PON.'],
        manual_fill_billing: ['Заполнить Billing вручную', 'Данные найдены в ТМЦ, но ещё не сохранены в Billing.'],
        poll_current_binding: ['Перейти к опросу ONU', 'Открыть правильную нативную вкладку OLT.'],
        poll_candidate: ['Перейти к опросу ONU', 'Открыть правильную нативную вкладку OLT.'],
        retry_poll: ['Повторить опрос ONU', 'Вернуться в правильную нативную вкладку OLT.'],
        search_mac: ['Проверить MAC в UserSide', 'Открыть штатный поиск MAC текущего абонента.'],
        switch_port: ['Открыть коммутатор абонента', 'Перейти к Ethernet-точке подключения.'],
        check_ethernet_fdb: ['Открыть FDB-таблицу', 'Проверить, где изучен MAC на коммутаторе.'],
        check_ethernet_errors: ['Проверить ошибки интерфейса', 'Открыть страницу ошибок порта.'],
        wait_context: ['Ожидание данных', 'Workbench ждёт подтверждённый факт.']
      };
      const pair = labels[String(d.action || '')] || ['Продолжить диагностику', String(d.reason || '')];
      const plan = {
        id: String(d.action || 'wait_context'),
        action: String(d.action || 'wait_context'),
        semanticAction: String(d.action || 'wait_context'),
        semanticTargetId: String(d.semanticTargetId || ''),
        completionKey: String(d.completionKey || ''),
        title: pair[0],
        text: String(d.reason || pair[1] || ''),
        kind: 'direct'
      };
      this._planCacheKey = key;
      this._planCache = plan;
      return plan;
    }

    contextLabel(context = {}) {
      const system = String(context.system || '');
      const pageKind = String(context.pageKind || '');
      const systems = {
        billing: 'Billing',
        'looknet-billing': 'Billing',
        userside: 'UserSide'
      };
      const pages = {
        billing_user: 'карточка абонента',
        billing_juniper: 'интернет-сессия',
        billing_technical: 'технические данные',
        billing_onu_poll: 'опрос ONU',
        userside_customer: 'карточка абонента',
        userside_tmc: 'ТМЦ',
        userside_device: 'оборудование',
        device_poller: 'данные коммутатора',
        device_interface_errors: 'ошибки интерфейсов',
        device_interface_list: 'список интерфейсов',
        userside_interface: 'интерфейс'
      };
      return [systems[system] || system, pages[pageKind] || pageKind]
        .filter(Boolean)
        .join(' · ');
    }

    stageLabel(stage = '') {
      return ({
        empty: 'Собираем контекст',
        'juniper-session': 'Проверяем интернет-сессию',
        'need-technical-data': 'Читаем технические данные',
        'ethernet-route': 'Ищем порт коммутатора',
        'ethernet-fdb': 'Сверяем MAC и VLAN в FDB',
        'ethernet-errors': 'Проверяем ошибки порта',
        'ethernet-complete': 'Ethernet-путь проверен',
        'need-billing-save': 'Данные ТМЦ не внесены в Billing',
        'ready-for-poll': 'Готово к живому опросу',
        polling: 'Ждём ответ OLT',
        confirmed: 'Диагностика завершена'
      })[String(stage || '')] || 'Диагностика продолжается';
    }

    learningForPlan(plan) {
      return WB.knowledge?.resolve?.(plan)?.simple || '';
    }

    pollAttemptTimedOut(attempt) {
      return Boolean(
        attempt
        && attempt.pending !== false
        && Number(attempt.startedAt || 0)
        && Date.now() - Number(attempt.startedAt || 0) >= POLL_PENDING_TIMEOUT_MS
      );
    }

    schedulePollTimeoutCheck() {
      clearTimeout(this.pollTimeoutTimer);
      this.pollTimeoutTimer = null;
      const currentCase = WB.store?.activeCase?.() || null;
      const attempt = this.pollAttemptFor(currentCase);
      if (!attempt || !this.pollAttemptPending(currentCase)) return;
      const remainingMs = Math.max(0, POLL_PENDING_TIMEOUT_MS - (Date.now() - Number(attempt.startedAt || 0)));
      // Presentation never finishes a poll. The interaction guard/parser and
      // background Case normalization own lifecycle transitions. This timer only
      // repaints near the fallback deadline in case the store update arrived just
      // before/after a render.
      this.pollTimeoutTimer = setTimeout(() => {
        this.pollTimeoutTimer = null;
        this.render();
      }, Math.max(250, remainingMs + 80));
    }

    pollAttemptFor(currentCase) {
      const stored = currentCase?.operations?.poll?.current || null;
      const local = this.pollAttempt?.caseId === currentCase?.id ? this.pollAttempt : null;
      if (!stored) return local;
      if (!local) return stored;

      const storedTerminal = stored.pending === false
        || ['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(String(stored.stage || '').toUpperCase());
      const localTerminal = local.pending === false
        || ['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(String(local.stage || '').toUpperCase());
      if (String(stored.pollAttemptId || '') === String(local.pollAttemptId || '')) {
        if (storedTerminal && !localTerminal) return stored;
        if (localTerminal && !storedTerminal) return local;
      }
      return Number(stored.startedAt || 0) >= Number(local.startedAt || 0) ? stored : local;
    }

    pollAttemptPending(currentCase) {
      if (!currentCase) return false;
      if (currentCase?.diagnostic?.isPon === true) {
        return String(currentCase?.diagnostic?.pollState || '') === 'pending';
      }
      const attempt = this.pollAttemptFor(currentCase);
      if (!attempt) return false;
      if (this.pollAttemptTimedOut(attempt)) return false;
      const stage = String(attempt.stage || '').toUpperCase();
      return attempt.pending !== false && !['CONFIRMED', 'FAILED', 'TIMEOUT'].includes(stage);
    }

    pollAttemptCard(currentCase) {
      const attempt = this.pollAttemptFor(currentCase);
      if (!attempt) return '';
      const stage = String(attempt.stage || '');
      const pollState = String(currentCase?.diagnostic?.pollState || '');
      const pending = this.pollAttemptPending(currentCase);
      if (pending) {
        const value = stage === 'INTENT_RECORDED'
          ? 'Фиксирую запуск запроса…'
          : stage === 'REQUEST_STARTED'
            ? 'Запрос OLT отправляется…'
            : 'OLT обрабатывает запрос…';
        return `
          <div class="section">
            <div class="card pending">
              <div class="label">OLT · запрос выполняется</div>
              <div class="value">${esc(value)}</div>
              <div class="source">Повторный клик не нужен.</div>
            </div>
          </div>
        `;
      }
      if (pollState === 'superseded') return '';
      const timedOut = pollState === 'timeout' || this.pollAttemptTimedOut(attempt) || stage === 'TIMEOUT';
      const failed = pollState === 'failed' || stage === 'FAILED';
      if ((failed || timedOut) && currentCase?.locator?.termination?.status !== 'confirmed') {
        const failureReason = String(attempt?.failureReason || '');
        const timedOutText = failureReason === 'poll-request-document-not-opened'
          ? 'Страница ответа не открылась'
          : 'Нет ответа более 30 секунд';
        return `
          <div class="section">
            <div class="card warn">
              <div class="label">OLT · запрос не завершён</div>
              <div class="value">${timedOut ? timedOutText : 'Запрос был отменён страницей'}</div>
              <div class="source">Запрос можно повторить.</div>
            </div>
          </div>
        `;
      }
      return '';
    }

    directActionable(next) {
      return Boolean(next && !['wait_context', 'complete_confirmed', 'no_case', 'manual_fill_billing', 'manual_review'].includes(String(next.action || next.semanticAction || next.id || '')));
    }

    directActions(next) {
      const action = String(next?.action || next?.semanticAction || next?.id || '');
      const map = {
        open_technical: ['live-open-technical', 'Перейти'],
        check_tmc: ['live-go-tmc', 'Перейти в ТМЦ'],
        poll_current_binding: ['live-open-poll', 'Перейти к опросу ONU'],
        poll_candidate: ['live-open-poll', 'Перейти к опросу ONU'],
        retry_poll: ['live-open-poll', 'Повторить опрос'],
        search_mac: ['live-search-mac', 'Открыть поиск MAC'],
        switch_port: ['live-open-ethernet-device', 'Открыть коммутатор'],
        check_ethernet_fdb: ['live-open-ethernet-fdb', 'Открыть FDB'],
        check_ethernet_errors: ['live-open-ethernet-errors', 'Открыть ошибки']
      };
      const spec = map[action];
      return spec ? `<button class="action primary" data-action="${spec[0]}">${spec[1]}</button>` : '';
    }

    terminalEvidenceRows(snapshot = null) {
      const transient = Array.isArray(this.terminalView.interpreted)
        ? this.terminalView.interpreted
        : [];
      const blocks = transient.length
        ? transient
        : (Array.isArray(snapshot?.evidence) ? snapshot.evidence : []);
      const find = predicate => blocks.find(predicate);
      const historyBlock = find(block => block.family === 'history')
        || find(block => ['diagnostic', 'history'].includes(block.visualPriority))
        || null;
      const offlineSince = String(snapshot?.offlineSince || historyBlock?.facts?.currentOfflineSince || historyBlock?.facts?.latestAt || '');
      let offlineDuration = String(snapshot?.offlineDuration || historyBlock?.facts?.currentOfflineDuration || '');
      if (!offlineDuration && /offline/i.test(String(snapshot?.onuStatus || '')) && offlineSince) {
        const downAt = WB.pollTerminal?.parseDateish?.(offlineSince);
        const capturedAt = Date.parse(snapshot?.capturedAt || snapshot?.updatedAt || '');
        if (Number.isFinite(downAt) && Number.isFinite(capturedAt) && capturedAt >= downAt) {
          offlineDuration = WB.pollTerminal?.formatElapsed?.(capturedAt - downAt) || '';
        }
      }
      const normalizeHistory = value => {
        let text = String(value || '').replace(/7\s*д(?:ней|ня)?\s*:\s*[×x]?\s*(\d+)/gi, 'событий за 7 дней: $1');
        if (offlineDuration && !/\boffline\b/i.test(text)) {
          text = [`OFFLINE ${offlineDuration}`, offlineSince ? `с ${offlineSince}` : '', text].filter(Boolean).join(' · ');
        }
        return text;
      };
      const selected = [
        ['MAC', find(block => block.family === 'mac_address')],
        ['Линк', find(block => block.family === 'ont_port_state')],
        ['События', historyBlock]
      ];

      const rows = selected
        .filter(([, block]) => block && (block.summary || block.diagnosticNote))
        .map(([name, block]) => {
          const state = block.relation === 'conflict' ? 'conflict' : (block.state || 'neutral');
          return {
            name,
            state,
            signal: ['attention', 'conflict'].includes(state) ? '!' : state === 'normal' ? '✓' : '•',
            value: name === 'События'
              ? normalizeHistory(block.summary || block.diagnosticNote)
              : (block.summary || block.diagnosticNote)
          };
        });
      const has = name => rows.some(row => row.name === name);
      const learnedMac = snapshot?.observedSubscriberMac || snapshot?.learnedMacs?.[0] || '';
      if (!has('MAC') && learnedMac) {
        rows.push({ name: 'MAC', state: 'normal', signal: '✓', value: `MAC ИЗУЧЕН · ${learnedMac}` });
      }
      if (!has('Линк') && snapshot?.linkState) {
        const speed = Number(snapshot.speedMbps);
        const slow = Number.isFinite(speed) && speed > 0 && speed <= 10;
        const linkUp = String(snapshot.linkState).toLowerCase() === 'up';
        const link = [
          `LINK ${String(snapshot.linkState).toUpperCase()}`,
          Number.isFinite(speed) ? `${speed} Мбит/с` : '',
          slow ? 'медленно' : '',
          snapshot.duplex ? `${snapshot.duplex[0].toUpperCase()}${snapshot.duplex.slice(1)}-Duplex` : ''
        ].filter(Boolean).join(' · ');
        rows.push({
          name: 'Линк',
          state: linkUp && !slow ? 'normal' : 'attention',
          signal: linkUp && !slow ? '✓' : '!',
          value: link
        });
      }
      if (!has('События') && snapshot?.historySummary) {
        rows.push({ name: 'События', state: offlineDuration ? 'attention' : 'neutral', signal: offlineDuration ? '!' : '•', value: normalizeHistory(snapshot.historySummary) });
      }
      if (offlineDuration && !rows.some(row => /offline/i.test(String(row.value || '')))) {
        rows.push({
          name: 'ONU offline',
          state: 'attention',
          signal: '!',
          value: `${offlineDuration}${offlineSince ? ` · с ${offlineSince}` : ''}`
        });
      }
      return rows;
    }

    snapshotFact(label, value) {
      return `
        <div class="snapshot-fact">
          <span>${esc(label)}</span>
          <strong class="${value ? '' : 'empty'}">${esc(value || '—')}</strong>
        </div>
      `;
    }

    liveCaseCard(currentCase, context = {}, diagnostic = {}, completed = false) {
      const login = valueOf(currentCase?.identity?.login);
      const contract = valueOf(currentCase?.identity?.contract);
      const identity = contract ? `Договор ${contract}` : (login || currentCase?.id || 'Абонент');
      const juniper = currentCase?.locator?.sourceStatus?.juniper?.details
        || currentCase?.juniper?.details
        || {};
      const session = String(
        currentCase?.locator?.sourceStatus?.juniper?.result
        || currentCase?.juniper?.result
        || juniper?.status
        || ''
      ).toLowerCase();
      const state = session === 'online' ? 'online' : ['offline', 'no_session'].includes(session) ? 'offline' : 'unknown';
      const stateLabel = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Статус не определён';
      const rx = formatRate(juniper?.rxBps);
      const tx = formatRate(juniper?.txBps);
      const speedRaw = String(juniper?.speedRaw || '').trim();
      const captured = juniper?.lastEventTime || juniper?.startTime || currentCase?.juniper?.updatedAt || currentCase?.updatedAt || '';
      return `
        <div class="live-case compact-identity">
          <div class="live-identity-row">
            <div class="live-identity-main">
              <div class="value">${esc(identity)}</div>
              <div class="source">${esc([login, this.contextLabel(context)].filter(Boolean).join(' · '))}</div>
            </div>
            <span class="live-connectivity ${state}"><i></i>${esc(stateLabel)}</span>
          </div>
          ${(rx || tx || speedRaw || captured) ? `<div class="live-traffic-row">
            ${rx ? `<b>↓ ${esc(rx)}</b>` : ''}
            ${tx ? `<b>↑ ${esc(tx)}</b>` : ''}
            ${!rx && !tx && speedRaw ? `<b>↕ ${esc(speedRaw)}</b>` : ''}
            ${captured ? `<time>${esc(captured)}</time>` : ''}
          </div>` : ''}
        </div>
      `;
    }

    evidenceHistory(currentCase) {
      const summary = WB.evidenceNavigator?.progressSummary?.(currentCase)
        || { items: WB.evidenceNavigator?.trail?.(currentCase) || [], total: 0, done: 0, attention: 0, percent: 0 };
      const items = Array.isArray(summary.items) ? summary.items : [];
      if (!items.length) return '';
      const total = Number(summary.total) || items.length;
      const done = Number(summary.done) || items.filter(item => item.level !== 'pending').length;
      const percent = Number.isFinite(Number(summary.percent))
        ? Number(summary.percent)
        : (total ? Math.round((done / total) * 100) : 0);
      const ponDetails = currentCase?.diagnostic?.ponWorkflowDetails || {};
      const tmcPrefillFields = Array.isArray(ponDetails.prefillFields) ? ponDetails.prefillFields : [];
      const tmcConflicts = Array.isArray(ponDetails.conflicts) ? ponDetails.conflicts : [];
      const tmcNeedsBilling = tmcPrefillFields.length > 0 || tmcConflicts.length > 0;
      return `
        <div class="section">
          <div class="evidence-history">
            <div class="evidence-history-head">
              <span>Прогресс</span>
              <span>${done}/${total}</span>
            </div>
            <div class="progress live-progress" title="${done} из ${total} · ${percent}%">
              <span style="width:${percent}%"></span>
            </div>
            ${items.map(item => {
              const pending = item.level === 'pending';
              const pendingBilling = !pending && item.key === 'tmc' && tmcNeedsBilling;
              const status = pending
                ? 'ожидает'
                : pendingBilling
                  ? `${item.status || 'просмотрено'} · данные Billing не совпадают`
                  : (item.status || 'выполнено');
              const title = pendingBilling
                ? 'ТМЦ уже прочитан, но Billing ещё не содержит те же данные. Успешный OLT poll это состояние не меняет. Стрелка вернёт в ТМЦ для ручной сверки.'
                : '';
              const signal = pending ? '○' : (pendingBilling ? '?' : '✓');
              const rowClass = [
                item.level || '',
                pendingBilling ? 'attention' : '',
                pending ? 'pending' : ''
              ].filter(Boolean).join(' ');
              return `
              <div class="evidence-row ${esc(rowClass)}"${title ? ` title="${esc(title)}"` : ''}>
                <span class="check">${signal}</span>
                <div class="evidence-row-main">
                  <b>${esc(item.label)}</b>
                  <span>${esc(status)}${!pending && item.at ? ` · ${esc(formatTime(item.at))}` : ''}</span>
                </div>
                ${!pending && item.replay ? `<button class="evidence-replay" data-action="live-replay" data-evidence-key="${esc(item.key)}" title="Показать это место ещё раз" aria-label="Показать ${esc(item.label)} ещё раз">→</button>` : '<span class="evidence-spacer"></span>'}
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    }

    juniperCard(juniper = null, diagnostic = {}, prefetch = {}) {
      if (!juniper) {
        const status = String(prefetch?.dataStatus || 'missing');
        const reading = status === 'loading' || diagnostic?.locatorAction === 'check_juniper';
        const failed = status === 'error' || status === 'stale';
        return `
          <div class="section">
            <div class="live-fingerprint">
              <div class="fingerprint-head">
                <div class="fingerprint-state">
                  <span class="snapshot-light ${failed ? 'error' : ''}"></span>
                  <strong>${reading ? 'Считываю Juniper…' : failed ? 'Juniper не прочитан' : 'Снимка Juniper пока нет'}</strong>
                </div>
                <small>${failed ? 'можно открыть вручную для проверки' : 'a=252 · только чтение'}</small>
              </div>
            </div>
          </div>
        `;
      }

      const details = juniper.details || {};
      const result = String(juniper.result || details.status || 'unknown');
      const online = result === 'online' || details.status === 'online';
      const offline = result === 'offline' || details.status === 'offline';
      const state = online
        ? 'Online'
        : offline
          ? (details.staleRadius ? 'Нет сессии на BRAS' : 'Offline')
          : result === 'no_session'
            ? 'Нет активной сессии'
            : result === 'error'
              ? 'Ошибка чтения'
              : 'Снимок получен';
      const traffic = details.hasTraffic === true
        ? (details.speedRaw || 'Есть')
        : details.hasTraffic === false
          ? 'Нет сейчас'
          : '—';
      const timeValue = details.lastEventTime || details.startTime || '';
      const timeLabel = details.lastEventTime ? 'Событие' : 'С начала';
      const foot = [
        details.lastEvent || '',
        details.preview ? 'предварительный снимок' : ''
      ].filter(Boolean).join(' · ');
      const cardClass = online ? 'ready' : (offline || result === 'error' ? 'warn' : '');
      const lightClass = online ? 'ready' : (result === 'error' ? 'error' : '');

      return `
        <div class="section">
          <div class="live-fingerprint ${cardClass}">
            <div class="fingerprint-head">
              <div class="fingerprint-state">
                <span class="snapshot-light ${lightClass}"></span>
                <strong>${esc(state)}</strong>
              </div>
              <small>Juniper · только чтение</small>
            </div>
            <div class="fingerprint-facts juniper-essential">
              ${this.snapshotFact('Трафик', traffic)}
              ${this.snapshotFact(timeLabel, timeValue)}
            </div>
            ${foot ? `<div class="fingerprint-foot" title="${esc(foot)}">${esc(foot)}</div>` : ''}
          </div>
        </div>
      `;
    }

    lineSnapshot(currentCase, diagnostic = {}) {
      if (!diagnostic.isEthernet) return '';
      const link = [
        valueOf(currentCase.network?.accessLinkState),
        valueOf(currentCase.network?.accessSpeedMbps)
          ? `${valueOf(currentCase.network?.accessSpeedMbps)} Мбит/с`
          : ''
      ].filter(Boolean).join(' · ');
      const complete = (diagnostic.locatorStage || diagnostic.stage) === 'ethernet-complete';
      const state = link || (complete ? 'Порт проверен' : 'Нужно проверить порт');
      const facts = [
        valueOf(currentCase.network?.accessDeviceName),
        valueOf(currentCase.network?.accessInterface) || valueOf(currentCase.network?.accessPort),
        valueOf(currentCase.network?.accessVlan) ? `VLAN ${valueOf(currentCase.network?.accessVlan)}` : '',
        valueOf(currentCase.network?.mac)
      ];
      const summary = facts.filter(Boolean).join(' · ') || 'Данные порта ещё не собраны';
      return `
        <div class="section">
          <div class="line-snapshot ${complete ? 'ready' : ''}">
            <div class="label">Линия · Ethernet</div>
            <div class="line-state">${esc(state)}</div>
            <div class="line-facts" title="${esc(summary)}">${esc(summary)}</div>
          </div>
        </div>
      `;
    }

    liveNavHelp(text = '') {
      return text
        ? `<span class="live-nav-help" data-help="${esc(text)}" title="${esc(text)}" aria-label="${esc(text)}" tabindex="0">?</span>`
        : '';
    }

    ponContextCard(currentCase, diagnostic = {}, locator = {}, next = {}) {
      const liveView = WB.caseView?.live?.(currentCase) || {};
      const semanticAction = String(liveView.decision?.action || 'wait_context');
      if (diagnostic.isEthernet || liveView.decision?.terminal) return '';
      if (this.pollAttemptPending(currentCase)) return '';
      if (hasSuccessfulOnuPoll(currentCase) && ['poll_current_binding', 'poll_candidate', 'retry_poll'].includes(semanticAction)) return '';

      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      const missing = Array.isArray(diagnostic.billingMissingTechnical) ? diagnostic.billingMissingTechnical : [];
      const missingText = technicalFieldLabels(missing);
      const onTechnical = page.pageKind === 'billing_technical';
      const onUserside = page.pageKind === 'userside_customer';

      if (['poll_current_binding', 'poll_candidate', 'retry_poll'].includes(semanticAction)) {
        if (page.pageKind === 'billing_onu_poll') {
          return `<div class="section">
              <div class="live-context-card final-step" data-live-final-step="ask-olt">
                <div class="live-nav-title"><span>Финальный шаг · Запрос OLT</span></div>
                <div class="source">Нажми штатный «Запрос OLT» в строке ONU. Workbench только выделяет нужную ссылку.</div>
              </div>
            </div>
          `;
        }
        return `<div class="section">
            <div class="live-context-card ready">
              <div class="live-nav-title"><span>Готово к живому опросу</span>${this.liveNavHelp('PON workflow подтвердил достаточную привязку для штатного живого опроса. Workbench откроет нужный раздел, но сам запрос не выполняет.')}</div>
              <div class="actions" style="margin-top:8px"><button class="action primary" data-action="live-open-poll">Перейти к опросу ONU</button></div>
            </div>
          </div>
        `;
      }

      if (semanticAction === 'open_technical') {
        return `
          <div class="section">
            <div class="live-context-card">
              <div class="live-nav-title"><span>Перейти в технические данные</span>${this.liveNavHelp('Подсказка существует только пока Technical ещё не проверен. Самостоятельный вход оператора также завершает этот шаг.')}</div>
              <div class="source">Проверим поля, от которых зависит точная привязка ONU и выбор штатного типа опроса.</div>
              <div class="actions" style="margin-top:8px"><button class="action primary" data-action="live-open-technical">Перейти в технические данные</button></div>
            </div>
          </div>
        `;
      }

      if (semanticAction === 'check_tmc') {
        const directCommand = WB.runtime?.pendingTmcCommand || null;
        const directFocusPending = Boolean(
          directCommand?.mode === 'focus'
          && String(directCommand.caseId || '') === String(currentCase?.id || '')
        );
        if (onUserside) {
          // Manual arrival is deliberately silent: page detection/DOM readers
          // may satisfy TMC progress, but they cannot start teaching Focus.
          return directFocusPending
            ? `<div class="section"><div class="live-context-card attention"><div class="live-nav-title"><span>Ищем ТМЦ…</span></div><div class="source">Прямая команда ждёт реальную строку PON и подсветит её один раз.</div></div></div>`
            : `<div class="section"><div class="live-context-card"><div class="live-nav-title"><span>Читаем ТМЦ…</span></div><div class="source">Ты пришёл в UserSide своим ходом. Workbench ничего не подсвечивает и ждёт evidence от нативного блока.</div></div></div>`;
        }
        const billingReady = diagnostic.billingTechnicalComplete === true;
        return `
          <div class="section">
            <div class="live-context-card attention">
              <div class="live-nav-title"><span>${billingReady ? 'Сверить ТМЦ' : 'Перейти в ТМЦ'}</span>${this.liveNavHelp('ТМЦ — независимый источник. Его отсутствие в текущем Case нельзя заменить успешным OLT poll. Переход открывает текущего абонента UserSide и ждёт реальную строку PON.')}</div>
              <div class="source">${billingReady
                ? 'Billing Technical заполнен, но ТМЦ текущего абонента ещё не прочитано. Сверка остаётся актуальной независимо от результата OLT.'
                : `В Billing не хватает: ${esc(missingText || 'данных ONU')}. Следующий независимый источник — ТМЦ текущего Case.`}</div>
              <div class="actions" style="margin-top:8px"><button class="action primary" data-action="live-go-tmc">Перейти в ТМЦ</button></div>
            </div>
          </div>
        `;
      }

      if (semanticAction === 'manual_fill_billing') {
        const expected = tmcTechnicalExpectation(currentCase).expected;
        const fields = Array.isArray(diagnostic.ponWorkflowDetails?.fields)
          ? diagnostic.ponWorkflowDetails.fields
          : missing;
        const tmcOlt = [expected.oltName, expected.oltIp].filter(Boolean).join(' · ');
        const details = [
          tmcOlt ? `OLT: ${esc(tmcOlt)}` : '',
          expected.onuMac ? `ONU MAC: ${esc(expected.onuMac)}` : '',
          expected.onuSerial ? `Serial: ${esc(expected.onuSerial)}` : ''
        ].filter(Boolean).join('<br>');
        return `<div class="section">
            <div class="live-context-card attention" data-live-manual-billing-fill="1">
              <div class="live-nav-title"><span>ТМЦ просмотрен · данные не внесены в Billing</span>${this.liveNavHelp('Workbench сохранил факты ТМЦ независимо от Billing. Он ничего не копирует и не нажимает Save. Опрос появится только после того, как новая страница Billing подтвердит сохранённые обязательные поля.')}</div>
              <div class="source">${details || 'ТМЦ содержит данные для текущего абонента.'}</div>
              <div class="source" style="margin-top:6px">Не хватает в Billing: ${esc(technicalFieldLabels(fields) || missingText || 'обязательных техданных')}. Скопируй нужные значения из ТМЦ и заполни Technical вручную. После штатного «Сохранить» Workbench перечитает уже серверное состояние.</div>
            </div>
          </div>`;
      }

      // wait_context, supporting reads and completed steps do not invent a
      // second LIVE route. The next action comes only from case-view.
      return '';
    }

    clearPonPageHints() {
      document.querySelectorAll?.('[data-simnet-live-missing-field]').forEach(el => {
        el.removeAttribute('data-simnet-live-missing-field');
        el.classList.remove('simnet-live-missing-field', 'simnet-live-missing-attention', 'simnet-live-missing-reminder');
      });
      document.querySelectorAll?.('.simnet-live-field-help').forEach(node => node.remove());
      document.getElementById('simnet-live-legacy-banner')?.remove();
    }

    ensurePonPageHintStyles() {
      if (document.getElementById('simnet-live-page-hint-style')) return;
      const style = document.createElement('style');
      style.id = 'simnet-live-page-hint-style';
      style.textContent = `
        /* Highlight only the control (input/select), not the whole table row. */
        .simnet-live-missing-field,
        input.simnet-live-missing-field,
        select.simnet-live-missing-field,
        textarea.simnet-live-missing-field {
          background:rgba(255,247,237,.85)!important;
          outline:1.5px solid rgba(247,144,9,.5)!important;
          outline-offset:1px!important;
          border-color:#f0b44c!important;
          border-radius:4px!important;
          box-shadow:0 0 0 2px rgba(247,144,9,.1)!important;
        }
        .simnet-live-missing-attention,
        input.simnet-live-missing-attention,
        select.simnet-live-missing-attention,
        textarea.simnet-live-missing-attention {
          background:rgba(255,237,213,.95)!important;
          outline:2px solid rgba(247,144,9,.65)!important;
          outline-offset:1px!important;
          border-color:#f59e0b!important;
          box-shadow:0 0 0 3px rgba(247,144,9,.14)!important;
        }
        .simnet-live-missing-reminder,
        input.simnet-live-missing-reminder,
        select.simnet-live-missing-reminder,
        textarea.simnet-live-missing-reminder {
          background:rgba(255,247,237,.7)!important;
          outline:1px solid rgba(247,144,9,.4)!important;
          outline-offset:1px!important;
          border-color:#f0b44c!important;
          box-shadow:none!important;
        }
        .simnet-live-field-help { position:relative!important;display:inline-grid!important;place-items:center!important;width:18px!important;height:18px!important;margin-left:7px!important;border:1px solid rgba(165,0,70,.28)!important;border-radius:50%!important;background:#fff!important;color:#7A123D!important;font:700 11px/1 Arial,sans-serif!important;cursor:help!important;vertical-align:middle!important;opacity:.72!important;outline:none!important;transition:opacity .14s ease,border-color .14s ease,box-shadow .14s ease!important; }
        .simnet-live-field-help:hover,.simnet-live-field-help:focus-visible { opacity:1!important;border-color:rgba(165,0,70,.62)!important;box-shadow:0 0 0 3px rgba(165,0,70,.08)!important; }
        .simnet-live-field-help:after { content:attr(data-simnet-help);position:absolute!important;left:calc(100% + 8px)!important;top:50%!important;width:270px!important;max-width:min(270px,60vw)!important;padding:8px 10px!important;border:1px solid #E4E7EC!important;border-radius:9px!important;background:#fff!important;color:#344054!important;box-shadow:0 10px 28px rgba(16,24,40,.18)!important;font:500 11px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif!important;text-align:left!important;white-space:normal!important;opacity:0!important;visibility:hidden!important;transform:translateY(-50%) translateX(-4px)!important;transition:opacity .12s ease,transform .12s ease,visibility .12s ease!important;pointer-events:none!important;z-index:2!important; }
        .simnet-live-field-help:hover:after,.simnet-live-field-help:focus-visible:after { opacity:1!important;visibility:visible!important;transform:translateY(-50%) translateX(0)!important; }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    syncPonTechnicalFieldHints() {
      this.clearPonPageHints();
      const currentCase = this.activeCase();
      const page = WB.runtime.lastContext || currentCase?.currentContext || {};
      if (!currentCase || page.pageKind !== 'billing_technical') return;

      const missing = Array.isArray(currentCase?.diagnostic?.billingMissingTechnical)
        ? currentCase.diagnostic.billingMissingTechnical
        : [];
      const tmc = tmcTechnicalExpectation(currentCase);
      const fields = missing.filter(field => tmc.fields.includes(field));
      if (!fields.length) return;

      this.ensurePonPageHintStyles();
      const selectors = {
        olt: 'select#dopfield_29,select[name="dopfield_29"]',
        onuSerial: 'input#dopfield_38,input[name="dopfield_38"]',
        onuMac: 'input#dopfield_19,input[name="dopfield_19"]'
      };
      for (const field of fields) {
        const control = document.querySelector(selectors[field]);
        if (!control) continue;
        control.setAttribute('data-simnet-live-missing-field', field);
        control.classList.add('simnet-live-missing-field');
        const help = document.createElement('span');
        help.className = 'simnet-live-field-help';
        help.dataset.simnetHelp = 'Данные есть в ТМЦ, но не сохранены в Billing. Заполни поле вручную и нажми штатную кнопку «Сохранить».';
        help.dataset.simnetWbOwned = '1';
        help.textContent = '?';
        control.insertAdjacentElement('afterend', help);
      }
    }

    async navigateToBillingForAction(currentCase = this.activeCase(), semanticTargetId = 'billing.user') {
      if (!currentCase) return { ok: false, reason: 'case-missing' };
      const page = WB.runtime.lastContext || currentCase.currentContext || {};
      const target = semanticTargetId || 'billing.user';
      if (page.pageKind === 'billing_user' && target === 'billing.user') {
        return { ok: true, method: 'already-billing-card' };
      }
      if (page.pageKind === 'billing_juniper' && target === 'billing.juniper') {
        return { ok: true, method: 'already-juniper' };
      }
      if (WB.billingNavigation?.navigate) {
        const result = await WB.billingNavigation.navigate({
          caseId: currentCase.id,
          semanticTargetId: target,
          entityId: String(valueOf(currentCase?.identity?.billingId) || ''),
          intent: 'DIRECT_REPLAY',
          sourceAction: 'navigate-billing-target'
        });
        if (!result?.ok) {
          return { ok: false, reason: result?.reason || 'navigation-rejected', code: result?.code };
        }
        return result;
      }
      return { ok: false, reason: 'billing-navigation-unavailable' };
    }

    async openTechnicalDirect() {
      this.collapseForNavigation();
      return this.runNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        return this.navigateToBillingForAction(currentCase, 'billing.technical');
      });
    }

    async goToTmcDirect() {
      this.collapseForNavigation();
      return this.runNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const result = await WB.handoff?.openUsersideForCase?.(currentCase, {
          command: 'focus-tmc'
        }) || { ok: false, reason: 'userside-navigation-unavailable' };
        if (!result?.ok) this.toast('Не удалось открыть ТМЦ текущего абонента');
        return result;
      });
    }

    async runNavigation(task) {
      // Navigation actions are intentionally not serialized. A second operator
      // click is a new explicit intent and must not be dropped as "busy".
      try {
        return await task();
      } catch (error) {
        return this.handleNavigationError(error);
      }
    }

    handleNavigationError(error) {
      const message = String(error?.message || error || 'navigation-failed');
      if (/Extension context invalidated/i.test(message)) {
        WB.runtime?.invalidateExtensionContext?.(message);
      } else {
        this.toast('Не удалось выполнить переход');
      }
      return { ok: false, reason: message };
    }

    async openMacSearchDirect() {
      this.collapseForNavigation();
      return this.runNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        if (page.pageKind !== 'userside_customer') {
          const result = await WB.handoff?.openUsersideForCase?.(currentCase);
          if (!result?.ok) this.toast('Не удалось вернуть UserSide текущего абонента');
          return result || { ok: false, reason: 'userside-open-failed' };
        }
        const preferred = normalizedIdentity(valueOf(currentCase?.network?.mac) || valueOf(currentCase?.network?.routerMac) || '');
        const links = [...document.querySelectorAll('a[href*="find_typer=machistory"][href*="search="]')];
        const anchor = links.find(link => {
          try { return preferred && normalizedIdentity(new URL(link.href, location.href).searchParams.get('search') || '') === preferred; } catch { return false; }
        }) || links[0] || null;
        if (!anchor?.href) {
          this.toast('Ссылка поиска по MAC сейчас не найдена');
          return { ok: false, reason: 'mac-search-link-missing' };
        }
        location.assign(anchor.href);
        return { ok: true, method: 'mac-search-url' };
      });
    }

    async openEthernetTarget(kind = 'device') {
      this.collapseForNavigation();
      return this.runNavigation(async () => {
        const currentCase = this.activeCase();
        if (!currentCase) return { ok: false, reason: 'case-missing' };
        const deviceId = String(valueOf(currentCase?.network?.accessDeviceId) || '');
        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        if (!/^\d+$/.test(deviceId)) {
          if (page.system !== 'userside') return WB.handoff?.openUsersideForCase?.(currentCase) || { ok: false, reason: 'userside-navigation-unavailable' };
          this.toast('Не найден ID коммутатора текущего абонента');
          return { ok: false, reason: 'ethernet-device-id-missing' };
        }
        let url = new URL(`/device/${deviceId}`, 'https://userside.simnet.kiev.ua');
        if (kind === 'errors') url = new URL(`/device/error_iface_list?device_id=${deviceId}`, 'https://userside.simnet.kiev.ua');
        if (kind === 'fdb') {
          const link = [...document.querySelectorAll('a[href*="device_poller_data"]')].find(anchor => {
            try { const u = new URL(anchor.href, location.href); return u.searchParams.get('data_type') === 'fdb_table'; } catch { return false; }
          });
          if (link?.href) url = new URL(link.href, location.href);
        }
        location.assign(url.href);
        return { ok: true, method: `ethernet-${kind}-direct`, url: url.href };
      });
    }

    async replayEvidence(key) {
      this.collapseForNavigation();
      const currentCase = this.activeCase();
      if (!currentCase || !WB.evidenceNavigator?.achieved?.(currentCase, key)) {
        this.toast('Этот этап ещё не зафиксирован в текущем Case');
        return { ok: false, reason: 'step-not-completed' };
      }
      try {
        if (key === 'tmc') {
          return await WB.handoff?.openUsersideForCase?.(currentCase, { command: 'scroll-tmc' })
            || { ok: false, reason: 'userside-navigation-unavailable' };
        }
        const pollTarget = pollNavigationTarget(String(currentCase?.diagnostic?.pollAction || ''));
        if (key === 'technical') return await this.navigateToBillingForAction(currentCase, 'billing.technical');
        if (key === 'juniper') return await this.navigateToBillingForAction(currentCase, 'billing.juniper');
        if (key === 'poll' && pollTarget) return await this.navigateToBillingForAction(currentCase, pollTarget);
        return { ok: false, reason: 'replay-navigation-unavailable' };
      } catch (error) {
        return this.handleNavigationError(error);
      }
    }

    async requestPollReveal() {
      this.collapseForNavigation();
      try {
        const currentCase = this.activeCase();
        const projected = WB.caseView?.decision?.(currentCase) || null;
        const semanticAction = String(projected?.action || '');
        const pollActions = new Set(['poll_current_binding', 'poll_candidate', 'retry_poll']);
        if (semanticAction === 'complete_confirmed' || hasSuccessfulOnuPoll(currentCase)) {
          this.toast('Опрос ONU уже успешно выполнен для текущего Case');
          return { ok: false, reason: 'poll-already-confirmed' };
        }
        if (!currentCase || !pollActions.has(semanticAction)) {
          const blockReason = 'poll-not-ready';
          this.toast('Опрос ONU пока не является следующим смысловым действием для этого Case');
          return { ok: false, reason: blockReason };
        }
        const diagnostic = currentCase?.diagnostic || {};
        const workflowDetails = diagnostic.ponWorkflowDetails || {};
        const sourceConflicts = Array.isArray(workflowDetails.conflicts) ? workflowDetails.conflicts : [];
        const prefillFields = Array.isArray(workflowDetails.prefillFields) ? workflowDetails.prefillFields : [];
        if (diagnostic.billingTechnicalComplete !== true) {
          this.toast('Опрос ONU недоступен: необходимые данные ещё не сохранены в Billing');
          return { ok: false, reason: 'billing-technical-not-saved' };
        }
        if (workflowDetails.tmcChecked !== true) {
          this.toast('Опрос ONU недоступен: сначала сверить ТМЦ текущего абонента');
          return { ok: false, reason: 'tmc-not-checked' };
        }
        if (sourceConflicts.length || prefillFields.length) {
          this.toast('Опрос ONU недоступен: Billing и ТМЦ ещё не согласованы');
          return { ok: false, reason: 'billing-tmc-not-reconciled' };
        }
        if (this.pollAttemptPending(currentCase)) {
          this.toast('Запрос OLT уже выполняется');
          return { ok: false, reason: 'poll-already-pending' };
        }
        const pollAction = String(diagnostic.pollAction || '');
        const pollTarget = pollNavigationTarget(pollAction);
        if (!pollTarget) {
          this.toast('Не удалось определить нативную вкладку опроса ONU для текущей OLT');
          return { ok: false, reason: 'poll-action-unresolved' };
        }

        // Direct route: the click resolves the
        // authoritative poll page and commits navigation immediately. The native
        // «Запрос OLT» remains an explicit operator click on the destination page.
        const billingId = String(valueOf(currentCase?.identity?.billingId) || '');
        const page = WB.runtime.lastContext || currentCase.currentContext || {};
        const currentPollAction = (() => {
          try { return new URL(location.href).searchParams.get('a') || ''; } catch { return ''; }
        })();
        if (page.pageKind === 'billing_onu_poll' && currentPollAction === pollAction) {
          return { ok: true, method: 'already-poll-page' };
        }
        return await WB.billingNavigation?.navigate?.({
          caseId: currentCase.id,
          semanticTargetId: pollTarget,
          entityId: billingId,
          intent: 'DIRECT_NAVIGATION',
          sourceAction: 'live-poll-direct'
        }) || { ok: false, reason: 'billing-navigation-unavailable' };
      } catch (error) {
        return this.handleNavigationError(error);
      }
    }

    liveView() {
      const currentCase = this.activeCase();
      const terminalVisible = Boolean(this.terminalView.active || WB.pollTerminal?.hasResult?.());
      if (!currentCase) {
        return terminalVisible
          ? `<div class="card ready"><div class="label">OLT · ответ получен</div><div class="value">Сверить результат на странице</div></div>`
          : `<div class="card"><div class="label">LIVE</div><div class="value">Абонент не определён</div><div class="source">Открой карточку абонента — снимок появится автоматически.</div></div>`;
      }

      const context = WB.runtime.lastContext || currentCase.currentContext || {};
      const diagnostic = currentCase.diagnostic || {};
      const locator = currentCase.locator || {};
      const termination = locator.termination || null;
      const oltSnapshot = currentCase.live?.oltSnapshot || null;
      const terminalConfirmed = termination?.status === 'confirmed' || oltSnapshot?.status === 'confirmed';
      const terminalAvailable = terminalConfirmed || oltSnapshot?.status === 'observed';
      const completed = terminalConfirmed || diagnostic.stage === 'ethernet-complete';
      const next = this.nextStep(currentCase);
      const terminalReady = terminalConfirmed;
      const interpretedCount = Number(this.terminalView.blocks || oltSnapshot?.evidence?.length || 0);
      const evidenceRows = this.terminalEvidenceRows(oltSnapshot);
      const contract = valueOf(currentCase.identity?.contract);
      const login = valueOf(currentCase.identity?.login);
      // next-step action buttons intentionally not rendered in LIVE (checkpoints only)
      const sourceConflicts = Array.isArray(diagnostic.ponWorkflowDetails?.conflicts)
        ? diagnostic.ponWorkflowDetails.conflicts
        : [];
      const tmcPrefillFields = Array.isArray(diagnostic.ponWorkflowDetails?.prefillFields)
        ? diagnostic.ponWorkflowDetails.prefillFields
        : [];
      const conflictLabels = { olt: 'OLT', onuMac: 'ONU MAC', onuSerial: 'ONU Serial' };
      const tmcExpected = tmcTechnicalExpectation(currentCase).expected;
      const missingFromBilling = tmcPrefillFields.map(field => ({
        field,
        billing: '—',
        tmc: field === 'olt'
          ? ([tmcExpected.oltName, tmcExpected.oltIp].filter(Boolean).join(' · ') || 'есть в ТМЦ')
          : field === 'onuMac'
            ? (tmcExpected.onuMac || 'есть в ТМЦ')
            : (tmcExpected.onuSerial || 'есть в ТМЦ'),
        missingInBilling: true
      }));
      const reconciliationIssues = [...sourceConflicts, ...missingFromBilling.filter(missing => (
        !sourceConflicts.some(conflict => String(conflict?.field || '') === String(missing.field || ''))
      ))];
      const conflictSummary = reconciliationIssues.map(item => {
        const label = conflictLabels[String(item?.field || '')] || String(item?.field || 'Поле');
        return `${label}: Billing ${item?.billing || '—'} · ТМЦ ${item?.tmc || '—'}`;
      }).join(' | ');
      const persistentConflictCard = !diagnostic.isEthernet && reconciliationIssues.length
        ? `<div class="section"><div class="live-context-card attention"><div class="live-nav-title"><span>Конфликт данных · источники не совпадают</span></div><div class="source">${esc(conflictSummary)}. Это состояние вычисляется только из значений Billing и ТМЦ. Успешный OLT poll, переходы и клики его не гасят. Оно исчезнет только после фактического совпадения данных.</div></div></div>`
        : '';

      const snapshotSource = oltSnapshot?.capturedAt ? `обновлено ${formatTime(oltSnapshot.capturedAt)}` : '';
      const terminalState = terminalReady ? [
        diagnostic.pollResponded ? 'OLT ответила' : '',
        diagnostic.bindingVerified ? 'Привязка ONU подтверждена' : 'Привязка ONU не подтверждена',
        diagnostic.accessReachable
          ? 'ONU/линия отвечает'
          : diagnostic.serviceState && diagnostic.serviceState !== 'unknown'
            ? `ONU: ${diagnostic.serviceState}`
            : ''
      ].filter(Boolean).join(' · ') : '';
      const terminalSummary = terminalAvailable ? `
        <div class="section">
          <div class="card ${terminalConfirmed ? 'ready' : 'warn'} live-onu-result">
            <div class="label">${terminalConfirmed ? 'Живой опрос ONU' : 'Ответ OLT на странице'}</div>
            <div class="value">${esc(oltSnapshot?.onuStatus ? `ONU ${oltSnapshot.onuStatus}` : terminalConfirmed ? 'Ответ оборудования получен' : 'Результат прочитан, привязка ещё не подтверждена')}</div>
            ${evidenceRows.length ? `<div class="terminal-evidence">${evidenceRows.map(row => `<div class="terminal-evidence-row ${esc(row.state)}"><span class="signal">${esc(row.signal)}</span><span class="evidence-name">${esc(row.name)}</span><span class="evidence-value">${esc(row.value)}</span></div>`).join('')}</div>` : ''}
            ${terminalState ? `<div class="source">${esc(terminalState)}</div>` : ''}
            <div class="source">${esc([snapshotSource, interpretedCount ? `разобрано блоков: ${interpretedCount}` : terminalConfirmed ? 'живые данные подтверждены' : 'прочитано со страницы Billing'].filter(Boolean).join(' · '))}</div>
          </div>
        </div>` : '';

      // Hand-holding "next step / go there" cards removed.
      // LIVE shows status + important checkpoints only; arrows on checkpoint rows still navigate.

      return `
        ${this.liveCaseCard(currentCase, context, diagnostic, completed)}
        ${diagnostic.isEthernet ? this.lineSnapshot(currentCase, diagnostic, locator) : ''}
        ${persistentConflictCard}
        ${this.pollAttemptCard(currentCase)}
        ${terminalSummary}
        ${this.evidenceHistory(currentCase)}
        ${(contract || login) ? `<div class="section compact-actions"><div class="actions"><button class="action" data-action="copy-contract">${icon('copy')} Договор</button></div></div>` : ''}
      `;
    }

    factsView() {
      const currentCase = this.activeCase();
      if (!currentCase) {
        return `<div class="card"><div class="empty">Нет активного кейса.</div></div>`;
      }
      const isEthernet = Boolean(currentCase.diagnostic?.isEthernet)
        || String(valueOf(currentCase.network?.connectionFamily) || '').toLowerCase() === 'ethernet';

      const groups = [
        [
          'Идентификация',
          currentCase.identity,
          [
            ['Логин', 'login'],
            ['Договор', 'contract'],
            ['Billing ID', 'billingId'],
            ['Customer ID', 'customerId']
          ]
        ],
        [
          'Сеть',
          currentCase.network,
          [
            ['IP', 'ip'],
            ['MAC абонента', 'mac'],
            ['Тип подключения', 'connectionFamily'],
            ['Исходное значение', 'connectionRaw'],
            ['Коммутатор ID', 'accessDeviceId'],
            ['Коммутатор', 'accessDeviceName'],
            ['IP коммутатора', 'accessDeviceIp'],
            ['Порт', 'accessPort'],
            ['Интерфейс', 'accessInterface'],
            ['Линк', 'accessLinkState'],
            ['Скорость, Мбит/с', 'accessSpeedMbps'],
            ['MAC в FDB', 'accessFdbMac'],
            ['Интерфейс FDB', 'accessFdbInterface'],
            ['VLAN', 'accessVlan'],
            ['Ошибки порта', 'accessErrorsStatus'],
            ['Ошибки in', 'accessErrorsIn'],
            ['Ошибки out', 'accessErrorsOut']
          ]
        ],
        ...(isEthernet ? [] : [[
          'PON / ONU',
          currentCase.pon,
          [
            ['ONU Serial', 'onuSerial'],
            ['ONU MAC', 'onuMac'],
            ['OLT', 'oltName'],
            ['OLT ID', 'oltId'],
            ['OLT IP', 'oltIp'],
            ['ТМЦ ONU Serial', 'tmcOnuSerial'],
            ['ТМЦ ONU MAC', 'tmcOnuMac'],
            ['ТМЦ OLT', 'tmcOltName'],
            ['ТМЦ OLT IP', 'tmcOltIp'],
            ['ТМЦ OLT device ID', 'tmcOltDeviceId'],
            ['ТМЦ Interface', 'tmcPort'],
            ['Найденное оборудование', 'locatedDeviceName'],
            ['Найденное устройство ID', 'locatedDeviceId'],
            ['Подтверждённый интерфейс', 'locatedInterface'],
            ['Найденная OLT', 'locatedOltName'],
            ['Найденная OLT IP', 'locatedOltIp'],
            ['Найденный тип опроса', 'locatedPollType'],
            ['Тип OLT / опроса', 'pollType'],
            ['Действие Billing', 'pollAction'],
            ['Порт', 'port'],
            ['Статус', 'status'],
            ['RX', 'rx'],
            ['TX', 'tx'],
            ['Расстояние', 'distance']
          ]
        ]]),
        [
          'Профиль',
          currentCase.profile,
          [
            ['ФИО', 'fullName'],
            ['Адрес', 'address'],
            ['Тариф', 'tariff'],
            ['Баланс', 'balance']
          ]
        ]
      ];

      const junctionReport = WB.junctionDebug?.analyze?.(currentCase) || null;
      const junctionCard = junctionReport
        ? `
          <div class="card ${junctionReport.metrics.active ? 'warn' : ''}">
            <div class="label">Стыки данных</div>
            <div class="value">${junctionReport.metrics.active ? `${junctionReport.metrics.active} активн.` : 'активных нет'}</div>
            <div class="source">${junctionReport.metrics.errors ? `критичных: ${junctionReport.metrics.errors} · ` : ''}${junctionReport.metrics.warnings ? `предупреждений: ${junctionReport.metrics.warnings} · ` : ''}история: ${junctionReport.metrics.history} · эквивалентные форматы: ${junctionReport.metrics.equivalent}. Подробности: Журнал → Debug стыков.</div>
          </div>
        `
        : '';

      return junctionCard + groups.map(
        ([title, group, fields]) => `
          <div class="section">
            <div class="eyebrow">${title}</div>
            <div class="grid">
              ${fields.map(([label, key]) => this.factCard(label, group?.[key])).join('')}
            </div>
          </div>
        `
      ).join('');
    }

    junctionDebugView() {
      const currentCase = this.activeCase();
      const report = WB.junctionDebug?.analyze?.(currentCase) || null;
      if (!report || !currentCase) return '';

      const statusLabel = status => ({
        active: 'ACTIVE',
        needs_action: 'ACTION',
        observed: 'OBSERVED',
        resolved: 'RESOLVED',
        historical: 'HISTORY',
        equivalent: 'EQUIVALENT'
      }[String(status || '')] || String(status || 'INFO').toUpperCase());

      const row = item => {
        const left = item?.left || {};
        const right = item?.right || {};
        const comparison = (left.value || right.value)
          ? `<div><b>${esc(left.label || 'A')}:</b> ${esc(left.value || '—')}</div><div><b>${esc(right.label || 'B')}:</b> ${esc(right.value || '—')}</div>`
          : '';
        const fields = Array.isArray(item?.fields) && item.fields.length
          ? `<div><b>Поля:</b> ${esc(item.fields.join(', '))}</div>`
          : '';
        const count = Number(item?.count || 1) > 1
          ? `<div><b>Событий внутри:</b> ${esc(String(item.count))}</div>`
          : '';
        const detail = [
          comparison,
          fields,
          count,
          item?.reason ? `<div><b>Почему:</b> ${esc(item.reason)}</div>` : '',
          item?.contour ? `<div><b>Где разбирать:</b> ${esc(item.contour)}</div>` : ''
        ].filter(Boolean).join('');
        return `
          <div class="event junction_${esc(item?.severity || 'info')}">
            <div class="time">${item?.at ? `${formatTime(item.at)} · ` : ''}${esc(statusLabel(item?.status))} · ${esc(item?.joint || 'стык')}</div>
            <div class="message">${esc(item?.title || '')}</div>
            ${detail ? `<div class="trace-detail">${detail}</div>` : ''}
          </div>`;
      };

      const activeRows = report.active.length
        ? report.active.map(row).join('')
        : '<div class="empty">Активных расхождений между контролируемыми точками сейчас не найдено.</div>';
      const historyRows = report.history.length
        ? report.history.slice(0, 12).map(row).join('')
        : '<div class="empty">Истории изменений на стыках пока нет.</div>';

      return `
        <div class="card ${report.metrics.active ? 'warn' : ''}">
          <div class="eyebrow">Debug стыков · агрегировано</div>
          <div class="value">${report.metrics.active} активных · ${report.metrics.junctions} стыков</div>
          <div class="source">Показывает не цепочку функций, а границу расхождения: источник/state → решение/poll/UI. Исторические изменения не считаются активным конфликтом.</div>
        </div>
        <div class="section">
          <div class="eyebrow">Активные расхождения</div>
          <div class="journal">${activeRows}</div>
        </div>
        <div class="section">
          <div class="eyebrow">История / уже устранённое</div>
          <div class="journal">${historyRows}</div>
        </div>
      `;
    }

    journalEventDetail(event) {
      const type = String(event?.type || '');
      const details = event?.details || {};
      if (type === 'route_guard') {
        const blocked = Array.isArray(details.blockedFacts)
          ? details.blockedFacts.map(item => `${item.group || ''}.${item.key || ''}`).filter(Boolean)
          : [];
        const observations = Array.isArray(details.observations) ? details.observations : [];
        const lines = [
          `<div><b>NEXT:</b> ${esc(details.requiredAction || 'none')}</div>`,
          `<div><b>Связь:</b> ${esc(details.relation || 'unknown')}</div>`,
          details.pageKind ? `<div><b>Страница:</b> ${esc(details.pageKind)}</div>` : '',
          blocked.length ? `<div><b>Не допущено в route-state:</b> ${esc(blocked.join(', '))}</div>` : '',
          observations.length ? `<div><b>Observations:</b> ${esc(observations.map(item => `${item.type}:${item.relation || ''}${item.passive ? ':passive' : ''}`).join(' · '))}</div>` : ''
        ].filter(Boolean);
        return `<div class="trace-detail">${lines.join('')}</div>`;
      }
      if (type === 'juniper') {
        const lines = [
          details.summary ? `<div><b>Смысл:</b> ${esc(details.summary)}</div>` : '',
          details.status ? `<div><b>Статус:</b> ${esc(details.status)}</div>` : '',
          details.subscriberIp || details.subscriberMac ? `<div><b>Абонент:</b> ${esc([details.subscriberIp, details.subscriberMac].filter(Boolean).join(' · '))}</div>` : '',
          details.bras ? `<div><b>BRAS:</b> ${esc(details.bras)}</div>` : '',
          details.sessionId || details.source ? `<div><b>Сессия:</b> ${esc([details.source, details.sessionId ? `#${details.sessionId}` : ''].filter(Boolean).join(' · '))}</div>` : '',
          details.speedRaw ? `<div><b>Обмен:</b> ${esc(details.speedRaw)}${details.hasTraffic === true ? ' · есть' : details.hasTraffic === false ? ' · нет в момент снимка' : ''}</div>` : '',
          details.lastEvent ? `<div><b>Последнее событие:</b> ${esc(details.lastEvent)}</div>` : '',
          details.vlan ? `<div><b>VLAN:</b> ${esc(details.vlan)}</div>` : '',
          '<div><b>Режим:</b> read-only</div>'
        ].filter(Boolean);
        return `<div class="trace-detail">${lines.join('')}</div>`;
      }
      if (type === 'interaction_guard' || type === 'interaction_warning') {
        const target = details.target || {};
        const lines = [
          details.reason ? `<div><b>Предупреждение:</b> ${esc(details.reason)}</div>` : '',
          target.text || target.tag ? `<div><b>Цель:</b> ${esc(target.text || target.tag)}</div>` : '',
          details.action ? `<div><b>Poll:</b> ${esc(details.action)}</div>` : '',
          details.ageMs != null ? `<div><b>Повтор через:</b> ${esc(String(details.ageMs))} ms</div>` : ''
        ].filter(Boolean);
        return lines.length ? `<div class="trace-detail">${lines.join('')}</div>` : '';
      }
      if (!type.startsWith('operator_')) return '';
      const semantic = details.semantic || {};
      const target = details.target || {};
      const navigation = details.navigation || {};
      const dom = details.dom || {};
      const lines = [];
      if (semantic.hint) lines.push(`<div><b>Смысл:</b> ${esc(semantic.hint)}</div>`);
      if (target.text || target.tag) lines.push(`<div><b>Цель:</b> ${esc(target.text || target.tag)}${target.tag ? ` · &lt;${esc(target.tag)}&gt;` : ''}</div>`);
      if (details.section) lines.push(`<div><b>Раздел:</b> ${esc(details.section)}</div>`);
      if (navigation.method || navigation.to || navigation.url) lines.push(`<div><b>Переход:</b> ${esc(navigation.method || 'GET')} ${esc(navigation.to || navigation.url || '')}</div>`);
      if (dom.cssPath || details.selection?.commonPath) lines.push(`<div class="trace-dom"><b>DOM:</b> ${esc(dom.cssPath || details.selection?.commonPath || '')}</div>`);
      if (details.selectedText) lines.push(`<div><b>Выделено:</b> ${esc(String(details.selectedText).slice(0, 260))}</div>`);
      if (details.value) lines.push(`<div><b>Значение:</b> ${esc(details.value)}</div>`);
      return lines.length ? `<div class="trace-detail">${lines.join('')}</div>` : '';
    }

    clickDebugView() {
      const clicks = WB.clickDebug?.recent?.(20) || [];
      const rows = clicks.length
        ? clicks.map(item => {
            const target = item.target || {};
            const targetText = [target.action ? `action=${target.action}` : '', target.section ? `section=${target.section}` : '', target.text || '', target.href || '']
              .filter(Boolean)
              .join(' · ');
            const prevented = item.defaultPrevented === true;
            return `
              <div class="event debug_click">
                <div class="time">${formatTime(item.at)} · ${esc(item.owner || 'native/page')} · ${prevented ? 'PREVENTED' : 'ALLOWED'}</div>
                <div class="message">${esc(item.reason || item.decision || 'click')}</div>
                ${targetText ? `<div class="trace-detail"><div><b>Target:</b> ${esc(targetText.slice(0, 420))}</div></div>` : ''}
              </div>`;
          }).join('')
        : '<div class="empty">Кликов в текущем документе ещё нет.</div>';
      return `
        <div class="card">
          <div class="eyebrow">Click debug · только текущая вкладка</div>
          <div class="source">Ничего не блокирует. Показывает, какой обработчик видел клик и был ли вызван preventDefault.</div>
          <div class="actions" style="margin-top:8px"><button class="action" data-action="clear-click-debug">Очистить click debug</button></div>
        </div>
        <div class="journal">${rows}</div>
      `;
    }

    journalView() {
      const events = this.activeCase()?.journal || [];
      const caseJournal = events.length
        ? `
          <div class="journal">
            ${events.map(event => `
              <div class="event ${esc(event.type)}">
                <div class="time">${formatTime(event.at)} · ${esc(event.type)}</div>
                <div class="message">${esc(event.message)}</div>
                ${this.journalEventDetail(event)}
              </div>
            `).join('')}
          </div>`
        : `
          <div class="card">
            <div class="empty">Журнал кейса пуст. События появятся при смене страницы и обнаружении новых фактов.</div>
          </div>`;

      return `${this.junctionDebugView()}${this.clickDebugView()}<div class="section"><div class="eyebrow">Журнал Case</div>${caseJournal}</div>`;
    }

    settingsView() {
      const ui = this.state?.ui || {};
      return `
        <div class="card">
          <div class="toggle"><div><div class="value">Компактный режим</div><div class="label">Уменьшенная ширина панели</div></div><button class="switch ${ui.compact ? 'on' : ''}" data-action="compact"><span></span></button></div>
        </div>
        <div class="section"><div class="eyebrow">Кейс</div><div class="actions"><button class="action primary" data-action="export">${icon('download')} Экспорт JSON</button><button class="action danger" data-action="reset">${icon('trash')} Очистить</button></div></div>
        <div class="section">
          <div class="eyebrow">Хранилище Workbench</div>
          <div class="card">
            <div class="value">Очистка данных WB</div>
            <div class="source">Удаляет Case, CALL evidence/snapshots, AI-сессии, CRM-кэш и локальный Audit DB. Cookies и авторизацию UserSide/Billing не трогает.</div>
            <div class="actions" style="margin-top:8px"><button class="action danger" data-action="clear-workbench-data">${icon('trash')} Полный сброс WB</button></div>
          </div>
        </div>
        <div class="section"><div class="card"><div class="label">Версия</div><div class="value">SIMNET Workbench ${WB.version}</div><div class="source">CALL-хранилище ограничено retention/лимитами; старые evidence и snapshots очищаются автоматически.</div></div></div>
      `;
    }

    collapseForNavigation() {
      const wasOpen = Boolean(this.activeView || this.hoverOpen);
      this.activeView = null;
      this.hoverOpen = false;
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
      if (wasOpen) this.render();
      return wasOpen;
    }

    openView(view) {
      const target = String(view || '').toLowerCase();
      if (target === 'call') {
        const currentCase = this.activeCase() || null;
        this.activeView = 'call';
        this.render();
        return WB.callRegistration?.open?.(currentCase) || Promise.resolve({ ok: false, reason: 'call-module-missing' });
      }
      if (target === 'companion') {
        this.activeView = 'companion';
        this.render();
        WB.operatorCompanion?.open?.();
        return Promise.resolve({ ok: true });
      }
      if (target === 'live') {
        this.activeView = 'live';
        this.state.ui = { ...(this.state.ui || {}), section: 'live', open: false };
        window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'live' } }));
        this.render();
        return Promise.resolve({ ok: true });
      }
      if (target === 'full') {
        this.activeView = 'full';
        this.fullSection = this.normalizeFullSection(this.fullSection || this.state?.ui?.section);
        if (this.state) this.state.ui = { ...(this.state.ui || {}), section: this.fullSection, open: false };
        window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'full' } }));
        this.render();
        return Promise.resolve({ ok: true });
      }
      this.closeView();
      return Promise.resolve({ ok: true });
    }

    closeView() {
      if (this.activeView === 'call') WB.callRegistration?.close?.();
      if (this.activeView === 'companion') WB.operatorCompanion?.close?.();
      this.activeView = null;
      this.hoverOpen = false;
      this.render();
    }

    uiState() {
      return {
        activeView: this.activeView,
        railCount: document.querySelectorAll(`#${HOST_ID}`).length,
        backdropCount: this.shadow?.querySelectorAll('.view-backdrop.show').length || 0,
        drawerOpen: Boolean(this.shadow?.querySelector('.shell.open')),
        callOpen: Boolean(document.getElementById('simnet-workbench-call-registration-host')),
        companionOpen: Boolean(WB.operatorCompanion?.isOpen?.())
      };
    }

    chip(label, value) {
      return value
        ? `<span class="chip"><strong>${esc(label)}:</strong> ${esc(value)}</span>`
        : '';
    }

    factCard(label, fact) {
      const value = valueOf(fact);
      const source = fact?.source || '';
      const confidence = Number(fact?.confidence);

      return `
        <div class="fact">
          <div class="label">${esc(label)}</div>
          <div class="value ${value ? '' : 'empty'}">${esc(value || '—')}</div>
          <div class="source">
            ${esc(source || 'не найдено')}
            ${Number.isFinite(confidence) ? `<span class="confidence"> · ${Math.round(confidence * 100)}%</span>` : ''}
          </div>
        </div>
      `;
    }

    async copy(text) {
      if (!text) return this.toast('Нечего копировать');

      try {
        await navigator.clipboard.writeText(String(text));
        this.toast('Скопировано');
      } catch {
        this.toast('Буфер обмена недоступен');
      }
    }

    async exportCase() {
      const currentCase = this.activeCase();
      if (!currentCase) return this.toast('Нет активного кейса');

      let aiChat = null;
      let callAudit = null;
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'AI_CHAT_STATE_GET',
          payload: {
            caseId: String(currentCase.id || ''),
            episodeId: String(currentCase.episodeId || '')
          }
        });
        if (response?.success && response?.data) aiChat = response.data;
      } catch {}
      try {
        callAudit = await WB.store?.getCallCorrelationAudit?.(String(currentCase.id || ''));
      } catch {}

      const exportPayload = {
        ...currentCase,
        ...(aiChat ? { aiChat } : {}),
        ...(callAudit ? { callAudit } : {})
      };
      const blob = new Blob(
        [JSON.stringify(sanitizeCaseExport(exportPayload), null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download =
        `simnet-workbench-${String(currentCase.id).replace(/[^a-z0-9_-]+/gi, '_')}.json`;
      anchor.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast(callAudit
        ? (aiChat ? 'Кейс + AI + CALL-аудит экспортированы' : 'Кейс + CALL-аудит экспортированы')
        : (aiChat ? 'Кейс + AI-диалог экспортированы' : 'Кейс экспортирован'));
    }

    async resetCase() {
      if (!confirm('Очистить текущий кейс Workbench?')) return;

      await WB.store.resetActiveCase();
      this.toast('Кейс очищен и будет создан заново');
    }

    async clearWorkbenchData() {
      const confirmed = confirm(
        'Полностью очистить данные Workbench?\n\n'
        + 'Будут удалены Case, CALL evidence/snapshots, AI-сессии, CRM-кэш и Audit DB.\n'
        + 'Авторизация и cookies UserSide/Billing останутся нетронутыми.'
      );
      if (!confirmed) return;
      try {
        const result = await WB.store.clearWorkbenchData();
        this.state = result?.state || WB.store.state || this.state;
        this._lastPanelKey = '';
        this.render();
        const freed = Math.max(0, Number(result?.storageBytesBefore || 0) - Number(result?.storageBytesAfter || 0));
        const kb = Math.round(freed / 1024);
        this.toast(kb > 0 ? `Workbench очищен · освобождено ~${kb} КБ` : 'Workbench очищен', 2800, 'success');
      } catch (error) {
        this.toast(`Сброс WB не выполнен: ${String(error?.message || error)}`, 3500, 'error');
      }
    }

    toast(message, durationMs = 1800, kind = '') {
      const node = this.shadow?.querySelector?.('.toast');
      if (!node) return false;
      node.textContent = message;
      node.dataset.kind = String(kind || '');
      node.classList.add('show');

      clearTimeout(this.toastTimer);
      const duration = Math.max(800, Math.min(5000, Number(durationMs || 1800)));
      this.toastTimer = setTimeout(
        () => {
          node?.classList?.remove?.('show');
          if (node?.dataset) node.dataset.kind = '';
        },
        duration
      );
      return true;
    }

    destroy() {
      clearTimeout(this.toastTimer);
      clearTimeout(this.hoverCloseTimer);
      clearTimeout(this.pollTimeoutTimer);
      this.unsub?.();
      this.unsubTerminalView?.();
      this.unsubTerminalInterpreted?.();
      this.unsubGuardWarning?.();
      this.unsubPollStarted?.();
      this.unsubPollResolved?.();
      this.unsubClickDebug?.();
      this.unsubJunctionDebug?.();
      window.removeEventListener?.('simnet-workbench-module-open', this.boundModuleOpen);
      window.removeEventListener?.('simnet-workbench-module-close', this.boundModuleClose);
      globalThis.document?.removeEventListener?.('keydown', this.boundShellKeydown, true);
      this.host?.remove();
    }
  }

  WB.rail = new RailPanel();
})();
