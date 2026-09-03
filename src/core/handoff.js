(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const TOKEN_PREFIX = 'simnet_wb_';
  const HASH_KEY = 'simnet-wb-handoff';
  const CLAIM_RETRIES = 5;
  const CLAIM_DELAY_MS = 80;

  const valueOf = fact =>
    fact && typeof fact === 'object' && 'value' in fact
      ? fact.value
      : fact;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function tmcCommandMode(purpose = '') {
    const value = String(purpose || '');
    if (value === 'userside-tmc-focus') return 'focus';
    if (value === 'userside-tmc-scroll') return 'scroll';
    return '';
  }

  function queueTmcCommand({ caseId = '', customerId = '', purpose = '', commandId = '' } = {}) {
    const mode = tmcCommandMode(purpose);
    if (!caseId || !mode || !commandId) return false;
    WB.runtime.pendingTmcCommand = {
      id: String(commandId),
      caseId: String(caseId),
      customerId: String(customerId || '').replace(/\D+/g, ''),
      mode,
      queuedAt: Date.now()
    };
    return true;
  }

  async function resumePendingTmcCommand(reason = 'handoff-resume') {
    const command = WB.runtime.pendingTmcCommand || null;
    if (!command?.id) return { ok: false, reason: 'no-pending-tmc-command' };
    const caseData = WB.store?.activeCase?.() || null;
    if (!caseData?.id || String(caseData.id) !== String(command.caseId)) {
      return { ok: false, reason: 'handoff-case-not-active' };
    }
    const pageCustomerId = currentUsersideCustomerId();
    const expectedCustomerId = String(command.customerId || valueOf(caseData?.identity?.customerId) || '').replace(/\D+/g, '');
    if (!pageCustomerId || (expectedCustomerId && pageCustomerId !== expectedCustomerId)) {
      return { ok: false, reason: 'handoff-customer-mismatch' };
    }
    const action = WB.browser?.actions?.usersideTmc;
    if (!action?.execute) return { ok: false, reason: 'tmc-action-unavailable' };
    const result = await action.execute({
      mode: command.mode,
      commandId: command.id,
      caseId: command.caseId,
      timeoutMs: 1200
    });
    if (result?.ok) WB.runtime.pendingTmcCommand = null;
    return result;
  }

  function createToken() {
    const random = crypto?.randomUUID?.()
      || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

    return `${TOKEN_PREFIX}${random.replace(/[^a-z0-9_-]/gi, '')}`;
  }

  function extractToken() {
    const name = String(window.name || '');
    if (name.startsWith(TOKEN_PREFIX)) return name;

    const hash = String(location.hash || '');
    const params = new URLSearchParams(
      hash.startsWith('#') ? hash.slice(1) : hash
    );
    const token = params.get(HASH_KEY) || '';

    return token.startsWith(TOKEN_PREFIX)
      ? token
      : '';
  }

  function decorateUrl(rawUrl, token) {
    try {
      const url = new URL(rawUrl, location.href);
      const hash = new URLSearchParams(
        url.hash.startsWith('#')
          ? url.hash.slice(1)
          : url.hash
      );

      hash.set(HASH_KEY, token);
      url.hash = hash.toString();
      return url.href;
    } catch {
      return rawUrl;
    }
  }

  function subscriberIpFromLink(anchor) {
    try {
      return new URL(
        anchor.href,
        location.href
      ).searchParams.get('ip') || '';
    } catch {
      return '';
    }
  }

  function extractPageIp() {
    const candidates = [
      location.href,
      document.documentElement?.innerHTML || ''
    ].join('\n');

    const patterns = [
      /(?:gotouser\.php|reload_ping_data)[^"'<>]{0,160}[?&]ip=((?:\d{1,3}\.){3}\d{1,3})/i,
      /(?:^|[^\d])ip\s*[:=]\s*((?:\d{1,3}\.){3}\d{1,3})(?:[^\d]|$)/i
    ];

    for (const pattern of patterns) {
      const match = candidates.match(pattern);
      if (match?.[1]) return match[1];
    }

    return '';
  }

  function currentCaseIdentity() {
    const currentCase = WB.store.activeCase?.()
      || WB.store.state?.cases?.[
        WB.store.localCaseId
        || WB.store.state?.activeCaseId
      ]
      || null;

    return {
      caseId: (
        WB.store.localCaseId
        || WB.store.state?.activeCaseId
        || ''
      ),
      subscriberIp: valueOf(currentCase?.network?.ip) || '',
      login: valueOf(currentCase?.identity?.login) || '',
      contract: valueOf(currentCase?.identity?.contract) || '',
      billingId: valueOf(currentCase?.identity?.billingId) || '',
      customerId: valueOf(currentCase?.identity?.customerId) || ''
    };
  }

  async function prepareFromAnchor(anchor, options = {}) {
    if (!anchor?.href) return null;

    const identity = currentCaseIdentity();
    if (!identity.caseId) return null;

    const token = String(options?.token || createToken());
    const purpose = String(options?.purpose || 'userside-navigation');
    const subscriberIp = (
      subscriberIpFromLink(anchor)
      || identity.subscriberIp
    );

    // Фрагмент не отправляется серверу и служит только резервным каналом.
    anchor.href = decorateUrl(anchor.href, token);

    // Уникальное window.name переживает открытие новой вкладки/окна.
    if (
      !anchor.target
      || anchor.target === '_blank'
    ) {
      anchor.target = token;
    }

    const payload = {
      token,
      purpose,
      targetUrl: anchor.href,
      subscriberIp,
      login: identity.login,
      contract: identity.contract,
      billingId: identity.billingId,
      customerId: identity.customerId
    };

    WB.runtime.pendingHandoff = payload;

    try {
      // Persist the handoff before opening UserSide. Otherwise a very fast target
      // tab can boot before the background state contains the token and must burn
      // retry cycles before it can bind the Case.
      const stored = await WB.store.prepareHandoff(payload);
      const persistedToken = String(stored?.token || token);
      if (persistedToken !== token) {
        payload.token = persistedToken;
        payload.targetUrl = decorateUrl(anchor.href, persistedToken);
        anchor.href = payload.targetUrl;
        if (anchor.target === token) anchor.target = persistedToken;
      }
    } catch (error) {
      return null;
    }

    return payload;
  }

  async function openUsersideForCase(caseData = null, options = {}) {
    const identity = currentCaseIdentity();
    const caseId = String(caseData?.id || identity.caseId || '');
    const command = String(options?.command || '');
    const purpose = command === 'focus-tmc'
      ? 'userside-tmc-focus'
      : command === 'scroll-tmc'
        ? 'userside-tmc-scroll'
        : 'userside-navigation';
    const commandId = createToken();
    const subscriberIp = String(
      valueOf(caseData?.network?.ip)
      || identity.subscriberIp
      || ''
    );
    const customerId = String(
      valueOf(caseData?.identity?.customerId)
      || identity.customerId
      || ''
    );
    if (!subscriberIp && !customerId) {
      return { ok: false, reason: 'userside-identity-missing' };
    }

    // Fastest safe path: if this exact Case is already open in UserSide, focus
    // that tab before creating/persisting a new handoff. This avoids joining the
    // serialized full-State write queue and avoids any UserSide reload.
    if (/^\d+$/.test(customerId) && WB.store?.focusExistingUsersideCase) {
      try {
        const existing = await WB.store.focusExistingUsersideCase({
          caseId,
          customerId,
          purpose,
          commandId
        });
        if (existing?.focused && existing?.caseBound === true) {
          return {
            ok: true,
            reused: true,
            reusedWithoutReload: true,
            existingCaseTab: true,
            fastCaseBound: true,
            targetTabId: existing.targetTabId ?? null,
            customerId
          };
        }
        // If the exact tab was focused but its content script could not prove
        // and bind the requested Case, do not stop on the UserSide card. Fall
        // through to the established token/hash claim path, which rebinds the
        // tab and preserves the one-click TMC transaction.
      } catch (error) {
        // Fast reuse is optional. The proven handoff path below remains the
        // fallback for a missing/stale tab or a temporary messaging failure.
      }
    }

    const anchor = document.createElement('a');
    // Once the Case already knows the exact UserSide customer, skip gotouser.php.
    // The redirect-by-IP is required only for the first discovery. Replays and
    // revisits can open the canonical customer card directly and avoid a full
    // extra server redirect/search hop.
    const useDirectCustomer = /^\d+$/.test(customerId);
    const url = useDirectCustomer
      ? new URL(`/customer/${customerId}`, 'https://userside.simnet.kiev.ua')
      : new URL('/script/gotouser.php', 'https://userside.simnet.kiev.ua');
    if (!useDirectCustomer && subscriberIp) url.searchParams.set('ip', subscriberIp);
    anchor.href = url.href;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);

    const prepared = await prepareFromAnchor(anchor, {
      token: commandId,
      purpose
    });
    if (!prepared) {
      anchor.remove();
      return { ok: false, reason: 'handoff-prepare-failed' };
    }

    try {
      const reused = await WB.store.openHandoffTarget({
        token: prepared.token,
        caseId,
        targetUrl: prepared.targetUrl
      });
      if (reused?.opened) {
        anchor.remove();
        return {
          ok: true,
          token: prepared.token,
          targetUrl: prepared.targetUrl,
          reused: true,
          reusedWithoutReload: Boolean(reused.reusedWithoutReload),
          targetTabId: reused.targetTabId ?? null
        };
      }
    } catch (error) {
      // Reuse is an optimization only. Failure must preserve the proven
      // new-tab handoff path rather than making navigation unavailable.
    }

    // Keep the Billing technical page alive as the source tab. The UserSide
    // card opens in the handoff target tab, so "Обновить технические данные"
    // can return to the exact Billing tab without rebuilding an authenticated URL.
    anchor.click();
    anchor.remove();
    return { ok: true, token: prepared.token, targetUrl: prepared.targetUrl };
  }

  async function claimOnUserside() {
    if (location.hostname !== 'userside.simnet.kiev.ua') {
      return null;
    }

    const token = extractToken();
    const subscriberIp = extractPageIp();

    // Без одноразового токена делаем ровно одну проверку. Повторные полные
    // чтения/записи тяжёлого Case не должны задерживать обычную карточку UserSide.
    const retries = token
      ? CLAIM_RETRIES
      : 1;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const claim = await WB.store.claimHandoff({
          token,
          subscriberIp,
          currentUrl: location.href,
          pageKindHint: /^\/customer\/\d+/i.test(location.pathname)
            ? 'userside_customer'
            : 'userside_other'
        });

        if (claim?.caseId) {
          WB.runtime.handoffClaim = claim;
          WB.store.bindCase?.(claim.caseId);
          queueTmcCommand({
            caseId: claim.caseId,
            customerId: currentUsersideCustomerId(),
            purpose: claim.purpose,
            commandId: claim.token
          });
          WB.store.resume?.();

          // TMC focus/scroll is a direct one-shot DOM command. It does not wait
          // for any presentation orchestrator; the bounded action itself waits
          // for the parser's real PON row.
          queueMicrotask(() => { void resumePendingTmcCommand('claimed-document'); });

          if (typeof WB.runtime.refreshCurrentPage === 'function') {
            queueMicrotask(async () => {
              try { await WB.runtime.refreshCurrentPage('handoff-claimed'); } catch {}
              await resumePendingTmcCommand('claimed-live-document');
            });
          }

          // После подтверждения одноразовый маркер больше не нужен.
          if (token && window.name === token) {
            try {
              window.name = '';
            } catch {}
          }

          if (token && location.hash.includes(HASH_KEY)) {
            try {
              const url = new URL(location.href);
              const hash = new URLSearchParams(
                url.hash.startsWith('#')
                  ? url.hash.slice(1)
                  : url.hash
              );
              hash.delete(HASH_KEY);
              url.hash = hash.toString();
              history.replaceState(
                history.state,
                '',
                url.href
              );
            } catch {}
          }

          return claim;
        }
      } catch (error) {
      }

      if (attempt < retries - 1) await sleep(CLAIM_DELAY_MS);
    }

    return null;
  }

  window.addEventListener('hashchange', () => {
    if (
      location.hostname !== 'userside.simnet.kiev.ua'
      || !extractToken()
    ) {
      return;
    }
    // Reusing an already-open exact customer tab changes only the hash, so no
    // document boot occurs. Claim the fresh handoff explicitly and wake the
    // page reader once; this is not a polling loop.
    void claimOnUserside();
  });

  function currentUsersideCustomerId() {
    if (location.hostname !== 'userside.simnet.kiev.ua') return '';
    return location.pathname.match(/^\/customer\/(\d+)\/?$/i)?.[1] || '';
  }

  async function acceptFastCaseBind(payload = {}) {
    const caseId = String(payload?.caseId || '');
    const requestedCustomerId = String(payload?.customerId || '').replace(/\D+/g, '');
    const pageCustomerId = currentUsersideCustomerId();
    if (!caseId || !requestedCustomerId || !pageCustomerId || pageCustomerId !== requestedCustomerId) {
      return { accepted: false, reason: 'customer-mismatch' };
    }

    const caseData = WB.store?.state?.cases?.[caseId] || null;
    const caseCustomerId = String(valueOf(caseData?.identity?.customerId) || '').replace(/\D+/g, '');
    if (!caseData || !caseCustomerId || caseCustomerId !== requestedCustomerId) {
      return { accepted: false, reason: 'case-identity-not-confirmed' };
    }
    if (!WB.store.bindCase?.(caseId)) {
      return { accepted: false, reason: 'case-bind-failed' };
    }

    WB.runtime.handoffClaim = {
      caseId,
      customerId: requestedCustomerId,
      purpose: String(payload?.purpose || 'userside-fast-focus'),
      fastFocus: true
    };
    queueTmcCommand({
      caseId,
      customerId: requestedCustomerId,
      purpose: String(payload?.purpose || 'userside-navigation'),
      commandId: String(payload?.commandId || '')
    });

    // Exact already-open UserSide tab: execute the same direct command without
    // reload or workflow-session hydration.
    WB.store.resume?.();
    queueMicrotask(() => { void resumePendingTmcCommand('fast-case-bind'); });
    queueMicrotask(() => { void WB.runtime.refreshCurrentPage?.('handoff-fast-case-bind'); });

    return { accepted: true, caseId, customerId: requestedCustomerId };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'HANDOFF_FAST_CASE_BIND') return undefined;
    Promise.resolve(acceptFastCaseBind(message?.payload || {}))
      .then(sendResponse)
      .catch(error => sendResponse({ accepted: false, reason: error?.message || String(error) }));
    return true;
  });

  function isUsersideHandoffLink(anchor) {
    if (!anchor?.href) return false;

    try {
      const url = new URL(anchor.href, location.href);
      return (
        url.hostname === 'userside.simnet.kiev.ua'
        && /\/script\/gotouser\.php$/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  document.addEventListener(
    'click',
    event => {
      if (
        location.hostname !== 'admin.simnet.kiev.ua'
        && location.hostname !== 'admin.looknet.kiev.ua'
      ) {
        return;
      }

      const anchor = event.target.closest?.('a[href]');
      if (!isUsersideHandoffLink(anchor)) return;

      // Не блокируем штатный клик. Claim на целевой странице имеет retry.
      prepareFromAnchor(anchor, { purpose: 'userside-navigation' });
    },
    true
  );

  WB.handoff = {
    init: claimOnUserside,
    prepareFromAnchor,
    openUsersideForCase,
    focusSource: (caseData = null, options = {}) => WB.store.focusHandoffSource({
      token: WB.runtime.handoffClaim?.token || extractToken(),
      caseId: WB.runtime.handoffClaim?.caseId || String(caseData?.id || ''),
      targetUrl: String(options?.targetUrl || ''),
      semanticTargetId: String(options?.semanticTargetId || ''),
      entityId: String(options?.entityId || valueOf(caseData?.identity?.billingId) || '')
    }),
    extractToken,
    extractPageIp,
    isUsersideHandoffLink,
    resumePendingTmcCommand
  };
})();
