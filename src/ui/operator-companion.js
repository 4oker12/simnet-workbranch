(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__operatorCompanionLoaded) return;
  WB.__operatorCompanionLoaded = true;

  const HOST_ID = 'simnet-workbench-operator-companion';
  const NO_CASE_KEY = '__no_case__';

  const state = {
    open: false,
    host: null,
    shadow: null,
    panel: null,
    sessions: new Map(),
    activeSessionKey: '',
    pendingKeys: new Set(),
    loadingKeys: new Set(),
    lastFocused: null,
    unsubStore: null,
    forceTopics: false,
    showMoreTopics: false
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const rich = value => esc(value)
    .replace(/\*\*([^*\n][\s\S]*?)\*\*/g, '<strong>$1</strong>');

  const emptyUsage = () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 });
  const emptySession = identity => ({
    schema: 'simnet-ai-dialog-session-v1',
    caseId: identity.caseId,
    episodeId: identity.episodeId,
    sessionKey: identity.key,
    dialogMemory: {},
    messages: [],
    usage: emptyUsage()
  });

  const style = () => `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483300;font-family:Inter,Arial,sans-serif;color:#2b1720;pointer-events:none}
    :host([hidden]){display:none!important}
    *{box-sizing:border-box}
    .panel{position:fixed;right:74px;top:50%;transform:translateY(-50%);width:min(300px,calc(100vw - 72px));height:min(420px,calc(100vh - 90px));top:88px;transform:none;right:64px;display:flex;flex-direction:column;background:#fff;border:1px solid rgba(125,34,73,.18);border-radius:16px;box-shadow:0 20px 58px rgba(55,9,28,.21);overflow:hidden;pointer-events:auto}
    .head{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid #eee3e8;background:linear-gradient(180deg,#fff,#fffafb)}
    .agent{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:#f3e6ec;color:#81133f;flex:0 0 auto}.agent svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .title{min-width:0;flex:1}.title b{display:block;font-size:14px;color:#731139}.title span{display:block;margin-top:1px;font-size:9.5px;color:#8b737e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .head button,.composer button,.reset{appearance:none;border:0;cursor:pointer;font:inherit}
    .close{width:28px;height:28px;border-radius:9px!important;background:#f7eef2;color:#7f123f;font-size:18px!important;line-height:1}
    .context{display:flex;gap:6px;align-items:center;padding:6px 10px;background:#fbf7f9;border-bottom:1px solid #f0e7eb;font-size:10px;color:#6e5862}
    .badge{max-width:145px;min-width:0;padding:3px 7px;border-radius:999px;background:#efe2e8;color:#6d1538;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge.no-case{background:#f1f1f1;color:#666}
    .session-usage{margin-left:auto;white-space:nowrap;color:#8c6878;font-size:9px;font-variant-numeric:tabular-nums}.reset{background:transparent;color:#8b5570;padding:3px 4px;font-size:9.5px}
    .messages{flex:1;overflow:auto;padding:11px 10px 12px;background:#fcfafb;scroll-behavior:smooth}
    .empty{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px;color:#765e69}.empty b{font-size:14px;color:#6f173b}.empty p{font-size:11px;line-height:1.45;max-width:285px;margin:6px 0 0}
    .msg{display:flex;margin:0 0 9px}.msg.user{justify-content:flex-end}.bubble{max-width:90%;padding:8px 10px;border-radius:12px;font-size:12.5px;line-height:1.42;white-space:pre-wrap;word-break:break-word}.bubble strong{font-weight:700;color:#6f1238}.user .bubble strong{color:inherit}
    .assistant .bubble{background:#fff;border:1px solid #eadde3;box-shadow:0 1px 6px rgba(70,20,42,.045)}.user .bubble{background:#8f1746;color:#fff;border-bottom-right-radius:4px}.error .bubble{background:#fff2f2;border:1px solid #efcccc;color:#8c2626}
    .usage{margin:4px 3px 0;color:#9a818c;font-size:8.5px;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap}.usage b{font-weight:600;color:#856270}
    .ctx{margin:3px 3px 0;max-width:350px;font-size:8.5px;color:#8c6f7b}.ctx summary{cursor:pointer;user-select:none;color:#7d4961;list-style:none}.ctx summary::-webkit-details-marker{display:none}.ctx summary:before{content:'▸ ';font-size:8px}.ctx[open] summary:before{content:'▾ '}.ctxbox{margin-top:4px;padding:6px 7px;border:1px solid #eadfe4;border-radius:8px;background:#fff;font-size:8.5px;line-height:1.35;color:#755f69}.ctxgrid{display:grid;grid-template-columns:auto 1fr;gap:2px 7px}.ctxlabel{color:#9b7e8a}.ctxfacts{margin-top:5px;padding-top:5px;border-top:1px solid #f0e7eb}.ctxfacts div{margin:1px 0;word-break:break-word}.ctxcard{color:#73314e}.ctxexcluded{color:#a18c95}
    .thinking{display:inline-flex;align-items:center;gap:5px;color:#856b76}.dot{width:4px;height:4px;border-radius:50%;background:currentColor;animation:pulse 1s infinite ease-in-out}.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}
    .foot{padding:8px 9px 9px;border-top:1px solid #eee3e8;background:#fff}.status{min-height:14px;padding:0 2px 4px;color:#8a707b;font-size:9px}.composer{display:flex;align-items:flex-end;gap:6px}.composer textarea{flex:1;min-height:38px;max-height:104px;resize:none;border:1px solid #d9c5ce;border-radius:11px;padding:8px 9px;font:12.5px/1.38 Inter,Arial,sans-serif;outline:none;background:#fff}.composer textarea:focus{border-color:#a50046;box-shadow:0 0 0 2px rgba(165,0,70,.08)}
    .send{width:38px;height:38px;border-radius:11px!important;background:#8f1746;color:#fff;font-size:17px!important}.send[disabled]{opacity:.45;cursor:default}.hint{padding:4px 2px 0;color:#a18e96;font-size:8px}
    .topics-wrap{padding:10px 10px 6px}.topics-title{font-size:11px;font-weight:800;color:#4A1630;margin:0 0 8px}
    .topics{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .topic{border:1px solid #d5d9de;background:#fff;border-radius:6px;padding:7px 6px;font-size:10px;cursor:pointer;text-align:left;color:#1D2939;min-height:33px}
    .topic:hover{border-color:#a50046;color:#a50046}
    .topics-more{width:100%;margin-top:6px;border:1px solid #dedfe2;background:#f7f8f9;border-radius:6px;padding:6px;font-size:10px;cursor:pointer;color:#475467}
    .topics-back{border:0;background:transparent;color:#6c7580;font-size:9.5px;cursor:pointer;padding:2px 0 6px;text-align:left}

    @media(max-width:620px){.panel{right:7px;left:7px;top:7px;bottom:7px;transform:none;width:auto;height:auto}}
  </style>`;

  function activeCase() {
    return WB.store?.activeCase?.() || null;
  }

  function currentIdentity() {
    const caseData = activeCase();
    const caseId = String(caseData?.id || '');
    const episodeId = String(caseData?.episodeId || '');
    return {
      caseData,
      caseId,
      episodeId,
      key: caseId ? `${caseId}::${episodeId || 'episode-current'}` : NO_CASE_KEY
    };
  }

  function normalizedUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const promptTokens = Math.max(0, Number(usage.promptTokens || 0));
    const completionTokens = Math.max(0, Number(usage.completionTokens || 0));
    const totalTokens = Math.max(0, Number(usage.totalTokens || promptTokens + completionTokens));
    if (!promptTokens && !completionTokens && !totalTokens) return null;
    return { promptTokens, completionTokens, totalTokens };
  }

  function tokenNumber(value) {
    return Math.round(Number(value || 0)).toLocaleString('ru-RU');
  }

  function sessionFor(identity = currentIdentity()) {
    return state.sessions.get(identity.key) || emptySession(identity);
  }

  function setSession(identity, session) {
    const key = String(session?.sessionKey || identity.key || NO_CASE_KEY);
    const next = {
      ...emptySession({ ...identity, key }),
      ...(session || {}),
      sessionKey: key,
      messages: Array.isArray(session?.messages) ? session.messages : [],
      dialogMemory: session?.dialogMemory && typeof session.dialogMemory === 'object' ? session.dialogMemory : {},
      usage: { ...emptyUsage(), ...(session?.usage || {}) }
    };
    state.sessions.set(key, next);
    if (key !== identity.key && identity.key !== NO_CASE_KEY) state.sessions.set(identity.key, next);
    return next;
  }

  function renderUsage(usage) {
    const row = normalizedUsage(usage);
    if (!row) return '';
    return `<div class="usage" title="Фактический usage этого запроса по ответу Groq">Запрос: ↑ ${tokenNumber(row.promptTokens)} input · ↓ ${tokenNumber(row.completionTokens)} output · <b>Σ ${tokenNumber(row.totalTokens)}</b></div>`;
  }

  function renderContextInspector(context) {
    if (!context || typeof context !== 'object') return '';
    const sections = context.sections && typeof context.sections === 'object' ? context.sections : {};
    const sectionRows = Object.entries(sections).map(([key, row]) =>
      `<span class="ctxlabel">${esc(key)}</span><span>~${tokenNumber(Number(row?.approxTokens || 0))} tok · ${tokenNumber(Number(row?.chars || 0))} chars</span>`
    ).join('');
    const selected = (Array.isArray(context.selectedSnapshot) ? context.selectedSnapshot : []).slice(0, 18);
    const cards = (Array.isArray(context.playbookCards) ? context.playbookCards : []).slice(0, 6);
    const excluded = (Array.isArray(context.excludedSnapshot) ? context.excludedSnapshot : []).slice(0, 12);
    const freshness = context.freshness || {};
    const budget = context.budget || {};
    return `<details class="ctx"><summary>Контекст</summary><div class="ctxbox"><div class="ctxgrid"><span class="ctxlabel">actual input</span><span>${tokenNumber(Number(context.actualPromptTokens || 0))} tokens</span><span class="ctxlabel">budget</span><span>${esc(budget.status || '—')} · ${tokenNumber(Number(budget.dynamicChars || 0))}/${tokenNumber(Number(budget.totalDynamicChars || 0))} chars</span><span class="ctxlabel">ONU freshness</span><span>${esc(freshness.state || 'unknown')}${Number.isFinite(Number(freshness.ageMinutes)) && freshness.state !== 'unknown' ? ` · ${tokenNumber(Number(freshness.ageMinutes))} min` : ''}</span><span class="ctxlabel">history</span><span>${Number(context.historyMessages || 0)} сообщений</span>${sectionRows}</div>${selected.length ? `<div class="ctxfacts"><b>Передано:</b>${selected.map(row => row && typeof row === 'object' ? `<div>✓ ${esc(row.path)}=${esc(row.value)} <span class="ctxlabel">— ${esc(row.reason || '')}</span></div>` : `<div>✓ ${esc(row)}</div>`).join('')}</div>` : ''}${cards.length ? `<div class="ctxfacts"><b>Playbook:</b>${cards.map(card => `<div class="ctxcard">• ${esc(card.id)} — ${esc(card.reason || '')}</div>`).join('')}</div>` : ''}${excluded.length ? `<div class="ctxfacts ctxexcluded"><b>Не передаётся по умолчанию:</b> ${excluded.map(esc).join(', ')}</div>` : ''}</div></details>`;
  }

  function renderMessage(item) {
    const role = item.role === 'user' ? 'user' : item.role === 'error' ? 'error' : 'assistant';
    return `<div class="msg ${role}"><div><div class="bubble">${rich(item.content || '')}</div>${role === 'assistant' ? `${renderUsage(item.usage)}${renderContextInspector(item.context)}` : ''}</div></div>`;
  }

  function caseLabel(caseData) {
    return String(
      caseData?.identity?.login?.value
      || caseData?.identity?.contract?.value
      || caseData?.profile?.fullName?.value
      || caseData?.id
      || 'Текущий кейс'
    );
  }

  function render() {
    if (!state.open || !state.panel) return;
    const identity = currentIdentity();
    state.activeSessionKey = identity.key;
    const session = sessionFor(identity);
    const pending = state.pendingKeys.has(identity.key);
    const loading = state.loadingKeys.has(identity.key);
    const usage = session.usage || emptyUsage();
    const hasMessages = Boolean(session.messages?.length);
    const showTopics = (!hasMessages && !pending && !loading) || state.forceTopics;
    const topicPrimary = [
      ['Нет интернета', 'У абонента нет интернета. Помоги диагностировать.'],
      ['Низкая скорость', 'У абонента низкая скорость. Помоги диагностировать.'],
      ['Частые обрывы', 'У абонента частые обрывы связи. Помоги диагностировать.'],
      ['Не открывается сайт', 'У абонента не открывается сайт. Помоги диагностировать.'],
      ['Wi‑Fi', 'У абонента проблема с Wi‑Fi. Помоги диагностировать.'],
      ['Удалёнка / VPN', 'У абонента проблема с удалёнкой или VPN. Помоги диагностировать.']
    ];
    const topicExtra = [
      ['Оборудование / ONU', 'Проблема с оборудованием или ONU. Помоги диагностировать.'],
      ['IPTV / ТВ', 'Проблема с IPTV или телевидением. Помоги диагностировать.'],
      ['Биллинг / оплата', 'Вопрос по биллингу или оплате. Помоги разобраться.']
    ];
    const topicsList = state.showMoreTopics ? topicPrimary.concat(topicExtra) : topicPrimary;
    const topicsHtml = showTopics ? `
      <div class="topics-wrap">
        ${hasMessages ? '<button type="button" class="topics-back" data-action="topics-back">← Темы</button>' : ''}
        <div class="topics-title">С чем проблема?</div>
        <div class="topics">${topicsList.map(([label, prompt]) =>
          `<button type="button" class="topic" data-action="topic" data-prompt="${esc(prompt)}">${esc(label)}</button>`
        ).join('')}</div>
        ${state.showMoreTopics
          ? ''
          : '<button type="button" class="topics-more" data-action="topics-more">Ещё ▾</button>'}
      </div>` : '';
    const messages = hasMessages && !state.forceTopics
      ? session.messages.map(renderMessage).join('')
      : (showTopics ? topicsHtml : `<div class="empty"><b>AI напарник</b><p>Напиши симптом или где упёрся.</p></div>`);
    const pendingRow = pending
      ? `<div class="msg assistant"><div class="bubble thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>думаю</span></div></div>`
      : '';
    const backBar = hasMessages && !state.forceTopics
      ? `<button type="button" class="topics-back" data-action="topics-show" style="margin:6px 10px 0">← Темы</button>`
      : '';

    state.panel.innerHTML = `
      <div class="head"><div class="agent" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M6.5 18.5c.7-3.1 2.6-4.8 5.5-4.8s4.8 1.7 5.5 4.8"/><path d="M5.5 10.5v2.8a2 2 0 0 0 2 2H9M18.5 10.5v3.7a2 2 0 0 1-2 2H15"/><path d="M5.5 10.8a6.5 6.5 0 0 1 13 0"/></svg></div><div class="title"><b>AI напарник</b><span>${showTopics ? 'быстрый старт' : 'живой диалог'}</span></div><button type="button" class="close" data-action="close" aria-label="Закрыть">×</button></div>
      <div class="context"><span class="badge ${identity.caseData ? '' : 'no-case'}">${esc(identity.caseData ? caseLabel(identity.caseData) : 'Кейс не определён')}</span><span class="session-usage" title="Фактический usage этого обращения">Σ ${tokenNumber(usage.totalTokens)} · ${Number(usage.requests || 0)} запр.</span><button type="button" class="reset" data-action="reset">Новый диалог</button></div>
      ${backBar}
      <div class="messages" data-role="messages">${messages}${pendingRow}</div>
      <div class="foot"><div class="status" data-role="status">${loading ? 'Восстанавливаю диалог…' : pending ? 'Запрос отправлен; факты Case берутся на момент сообщения.' : identity.caseData ? 'Диалог привязан к текущему обращению.' : 'Можно задать общий вопрос, но контекста абонента нет.'}</div><div class="composer"><textarea data-role="input" rows="1" maxlength="1800" spellcheck="true" placeholder="${showTopics ? 'Задайте свой вопрос…' : 'Сообщение…'}"></textarea><button type="button" class="send" data-action="send" ${pending || loading ? 'disabled' : ''} aria-label="Отправить">➜</button></div><div class="hint">Enter — отправить · Shift+Enter — новая строка</div></div>`;
    queueMicrotask(() => {
      const box = state.shadow?.querySelector('[data-role="messages"]');
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  function runtimeRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, response => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) return reject(new Error(runtimeError.message || String(runtimeError)));
          if (!response?.success) return reject(new Error(response?.error || `${type} failed`));
          resolve(response.data || {});
        });
      } catch (error) { reject(error); }
    });
  }

  async function loadSession(identity = currentIdentity(), { force = false } = {}) {
    if (!force && state.sessions.has(identity.key)) return state.sessions.get(identity.key);
    if (state.loadingKeys.has(identity.key)) return sessionFor(identity);
    state.loadingKeys.add(identity.key);
    if (state.open) render();
    try {
      const session = await runtimeRequest('AI_CHAT_STATE_GET', { caseId: identity.caseId, episodeId: identity.episodeId });
      return setSession(identity, session);
    } catch (error) {
      const current = sessionFor(identity);
      if (!current.messages?.length) current.messages = [{ role: 'error', content: `AI: ${String(error?.message || error)}`, at: new Date().toISOString() }];
      setSession(identity, current);
      return current;
    } finally {
      state.loadingKeys.delete(identity.key);
      if (state.open && currentIdentity().key === identity.key) render();
    }
  }

  function playbookFor(message, session) {
    const prior = (session?.messages || []).filter(item => item.role === 'user').slice(-4).map(item => item.content);
    const query = [...prior, message].join(' ');
    return WB.operatorCompanionContent?.forAgent?.(query) || {
      revision: 'operator-companion-playbook-fallback',
      mode: 'missing',
      instruction: 'Диагностический playbook недоступен; не выдумывай факты.',
      topics: []
    };
  }

  async function send(presetMessage) {
    const identity = currentIdentity();
    if (state.pendingKeys.has(identity.key) || state.loadingKeys.has(identity.key)) return;
    const input = state.shadow?.querySelector('[data-role="input"]');
    const message = String(presetMessage != null ? presetMessage : (input?.value || '')).replace(/\s+/g, ' ').trim().slice(0, 1800);
    if (!message) return;
    state.forceTopics = false;
    state.showMoreTopics = false;

    const session = sessionFor(identity);
    const playbook = playbookFor(message, session);
    const optimistic = {
      ...session,
      messages: [...(session.messages || []), { role: 'user', content: message, at: new Date().toISOString() }].slice(-16)
    };
    setSession(identity, optimistic);
    state.pendingKeys.add(identity.key);
    render();

    try {
      const result = await runtimeRequest('AI_CHAT_REQUEST', {
        caseId: identity.caseId,
        episodeId: identity.episodeId,
        message,
        playbook
      });
      if (result?.session) setSession(identity, result.session);
    } catch (error) {
      await loadSession(identity, { force: true }).catch(() => {});
      const current = sessionFor(identity);
      if (!current.messages?.some(item => item.role === 'error' && String(item.content || '').includes(String(error?.message || error)))) {
        current.messages = [...(current.messages || []), { role: 'error', content: `AI: ${String(error?.message || error || 'ошибка запроса')}`, at: new Date().toISOString() }].slice(-16);
        setSession(identity, current);
      }
    } finally {
      state.pendingKeys.delete(identity.key);
      if (state.open && currentIdentity().key === identity.key) {
        render();
        queueMicrotask(() => state.shadow?.querySelector('[data-role="input"]')?.focus());
      }
    }
  }

  async function reset() {
    const identity = currentIdentity();
    if (state.pendingKeys.has(identity.key)) return;
    state.loadingKeys.add(identity.key);
    render();
    try {
      const session = await runtimeRequest('AI_CHAT_RESET', { caseId: identity.caseId, episodeId: identity.episodeId });
      setSession(identity, session);
    } catch (error) {
      const session = emptySession(identity);
      session.messages = [{ role: 'error', content: `AI: ${String(error?.message || error)}`, at: new Date().toISOString() }];
      setSession(identity, session);
    } finally {
      state.loadingKeys.delete(identity.key);
      render();
      queueMicrotask(() => state.shadow?.querySelector('[data-role="input"]')?.focus());
    }
  }

  function handleClick(event) {
    const target = event.composedPath?.().find(node => node?.dataset?.action) || event.target?.closest?.('[data-action]');
    if (!target) return;
    const action = String(target.dataset.action || '');
    if (action === 'close') return close();
    if (action === 'reset') {
      state.forceTopics = false;
      state.showMoreTopics = false;
      return void reset();
    }
    if (action === 'send') return void send();
    if (action === 'topic') {
      const prompt = String(target.dataset.prompt || '').trim();
      if (prompt) void send(prompt);
      return;
    }
    if (action === 'topics-more') {
      state.showMoreTopics = true;
      render();
      return;
    }
    if (action === 'topics-show') {
      state.forceTopics = true;
      render();
      return;
    }
    if (action === 'topics-back') {
      state.forceTopics = false;
      state.showMoreTopics = false;
      render();
      return;
    }
  }

  function handleKeydown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const input = event.composedPath?.().find(node => node?.dataset?.role === 'input');
    if (input && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function handleStoreState() {
    if (!state.open) return;
    const identity = currentIdentity();
    if (identity.key === state.activeSessionKey) return;
    state.activeSessionKey = identity.key;
    render();
    void loadSession(identity);
  }

  async function open() {
    state.open = true;
    state.forceTopics = false;
    state.showMoreTopics = false;
    state.lastFocused = document.activeElement;
    const identity = currentIdentity();
    state.activeSessionKey = identity.key;
    if (state.host) {
      state.host.hidden = false;
      state.host.style.setProperty('display', 'block', 'important');
      state.host.style.setProperty('pointer-events', 'none', 'important');
    }
    window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'companion' } }));
    render();
    await loadSession(identity);
    queueMicrotask(() => state.shadow?.querySelector('[data-role="input"]')?.focus());
  }

  function close() {
    const wasOpen = state.open;
    state.open = false;
    if (state.host) {
      state.host.hidden = true;
      state.host.style.setProperty('display', 'none', 'important');
      state.host.style.setProperty('pointer-events', 'none', 'important');
    }
    if (wasOpen) window.dispatchEvent(new CustomEvent('simnet-workbench-module-close', { detail: { module: 'companion' } }));
    try { state.lastFocused?.focus?.(); } catch {}
    state.lastFocused = null;
  }

  function handleModuleOpen(event) {
    if (state.open && event.detail?.module !== 'companion') close();
  }

  function destroy() {
    close();
    state.shadow?.removeEventListener('click', handleClick);
    window.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('simnet-workbench-module-open', handleModuleOpen);
    state.unsubStore?.();
    state.unsubStore = null;
    state.sessions.clear();
    state.pendingKeys.clear();
    state.loadingKeys.clear();
    state.host?.remove();
    state.host = state.shadow = state.panel = null;
  }

  function mount() {
    if (state.host?.isConnected || !document.documentElement) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.dataset.simnetWbOwned = 'operator-companion';
    host.hidden = true;
    host.style.setProperty('display', 'none', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `${style()}<section class="panel" role="dialog" aria-modal="false" aria-label="AI напарник оператора"></section>`;
    document.documentElement.appendChild(host);
    state.host = host;
    state.shadow = shadow;
    state.panel = shadow.querySelector('.panel');
    shadow.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('simnet-workbench-module-open', handleModuleOpen);
    state.unsubStore = WB.bus?.on?.('store:state', handleStoreState) || null;
  }

  WB.operatorCompanion = Object.freeze({ open, close, destroy, reset, isOpen: () => state.open });
  if (document.documentElement) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });
})();
