(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__operatorCompanionConversationLoaded) return;
  WB.__operatorCompanionConversationLoaded = true;

  const HOST_ID = 'simnet-workbench-operator-companion';
  const state = {
    open: false,
    host: null,
    shadow: null,
    panel: null,
    session: null,
    pending: false,
    loading: false,
    lastFocused: null
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const rich = value => esc(value).replace(/\*\*([^*\n][\s\S]*?)\*\*/g, '<strong>$1</strong>');
  const usage0 = () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 });
  const emptySession = () => ({
    schema: 'simnet-operator-companion-session-v2',
    sessionKey: 'companion:operator',
    messages: [],
    usage: usage0(),
    work: { activeEpisode: null, recentEpisodes: [] }
  });

  const style = () => `<style>
    :host{all:initial;position:fixed;inset:0;z-index:2147483300;font-family:Inter,Arial,sans-serif;color:#2b1720;pointer-events:none}
    :host([hidden]){display:none!important}*{box-sizing:border-box}
    .panel{position:fixed;right:64px;top:88px;width:min(330px,calc(100vw - 72px));height:min(470px,calc(100vh - 96px));display:flex;flex-direction:column;background:#fff;border:1px solid rgba(125,34,73,.18);border-radius:16px;box-shadow:0 20px 58px rgba(55,9,28,.21);overflow:hidden;pointer-events:auto}
    .head{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid #eee3e8;background:linear-gradient(180deg,#fff,#fffafb)}
    .agent{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:#f3e6ec;color:#81133f;flex:0 0 auto}.agent svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .title{min-width:0;flex:1}.title b{display:block;font-size:14px;color:#731139}.title span{display:block;margin-top:1px;font-size:9.5px;color:#8b737e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    button{appearance:none;border:0;cursor:pointer;font:inherit}.close{width:28px;height:28px;border-radius:9px;background:#f7eef2;color:#7f123f;font-size:18px;line-height:1}
    .context{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#fbf7f9;border-bottom:1px solid #f0e7eb;font-size:10px;color:#6e5862}.badge{max-width:170px;padding:3px 7px;border-radius:999px;background:#efe2e8;color:#6d1538;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge.general{background:#f1f1f1;color:#666}.session-usage{margin-left:auto;white-space:nowrap;color:#8c6878;font-size:9px;font-variant-numeric:tabular-nums}.reset{background:transparent;color:#8b5570;padding:3px 4px;font-size:9.5px}
    .messages{flex:1;overflow:auto;padding:11px 10px 12px;background:#fcfafb;scroll-behavior:smooth}.empty{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px;color:#765e69}.empty b{font-size:14px;color:#6f173b}.empty p{font-size:11px;line-height:1.45;max-width:280px;margin:6px 0 0}
    .msg{display:flex;margin:0 0 9px}.msg.user{justify-content:flex-end}.bubble{max-width:90%;padding:8px 10px;border-radius:12px;font-size:12.5px;line-height:1.42;white-space:pre-wrap;word-break:break-word}.bubble strong{font-weight:700;color:#6f1238}.user .bubble{background:#8f1746;color:#fff;border-bottom-right-radius:4px}.user .bubble strong{color:inherit}.assistant .bubble{background:#fff;border:1px solid #eadde3;box-shadow:0 1px 6px rgba(70,20,42,.045)}.error .bubble{background:#fff2f2;border:1px solid #efcccc;color:#8c2626}
    .usage{margin:4px 3px 0;color:#9a818c;font-size:8.5px;font-variant-numeric:tabular-nums}.trace{margin:3px 3px 0;font-size:8.5px;color:#8c6f7b}.trace summary{cursor:pointer;color:#7d4961}.tracebox{margin-top:4px;padding:6px;border:1px solid #eadfe4;border-radius:8px;background:#fff}.tracebox div{margin:2px 0}.ok{color:#37633e}.bad{color:#8c4444}
    .thinking{display:inline-flex;align-items:center;gap:5px;color:#856b76}.dot{width:4px;height:4px;border-radius:50%;background:currentColor;animation:pulse 1s infinite ease-in-out}.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}
    .foot{padding:8px 9px 9px;border-top:1px solid #eee3e8;background:#fff}.status{min-height:14px;padding:0 2px 4px;color:#8a707b;font-size:9px}.composer{display:flex;align-items:flex-end;gap:6px}.composer textarea{flex:1;min-height:40px;max-height:110px;resize:none;border:1px solid #d9c5ce;border-radius:11px;padding:8px 9px;font:12.5px/1.38 Inter,Arial,sans-serif;outline:none;background:#fff}.composer textarea:focus{border-color:#a50046;box-shadow:0 0 0 2px rgba(165,0,70,.08)}.send{width:40px;height:40px;border-radius:11px;background:#8f1746;color:#fff;font-size:17px}.send[disabled]{opacity:.45;cursor:default}.hint{padding:4px 2px 0;color:#a18e96;font-size:8px}
    .quick{display:flex;gap:5px;flex-wrap:wrap;padding:7px 10px 0}.quick button{border:1px solid #ded2d8;background:#fff;color:#6d1538;border-radius:999px;padding:4px 7px;font-size:9px}.quick button:hover{border-color:#a50046}
    @media(max-width:620px){.panel{right:7px;left:7px;top:7px;bottom:7px;width:auto;height:auto}}
  </style>`;

  function session() { return state.session || emptySession(); }
  function activeWork() { return session().work?.activeEpisode || null; }
  function tokenNumber(value) { return Math.round(Number(value || 0)).toLocaleString('ru-RU'); }

  function renderTrace(context) {
    const tools = Array.isArray(context?.tools) ? context.tools : [];
    if (!tools.length) return '';
    return `<details class="trace"><summary>READ-проверки · ${tools.length}</summary><div class="tracebox">${tools.map(row => `<div class="${row.ok ? 'ok' : 'bad'}">${row.ok ? '✓' : '×'} ${esc(row.tool)} · ${esc(row.code || '')}</div>`).join('')}</div></details>`;
  }
  function renderMessage(item) {
    const role = item.role === 'user' ? 'user' : item.role === 'error' ? 'error' : 'assistant';
    const usage = role === 'assistant' && item.usage?.totalTokens
      ? `<div class="usage">↑ ${tokenNumber(item.usage.promptTokens)} · ↓ ${tokenNumber(item.usage.completionTokens)} · Σ ${tokenNumber(item.usage.totalTokens)}</div>` : '';
    return `<div class="msg ${role}"><div><div class="bubble">${rich(item.content || '')}</div>${usage}${role === 'assistant' ? renderTrace(item.context) : ''}</div></div>`;
  }

  function render() {
    if (!state.open || !state.panel) return;
    const current = session();
    const work = activeWork();
    const usage = current.usage || usage0();
    const messages = Array.isArray(current.messages) ? current.messages : [];
    const body = messages.length ? messages.map(renderMessage).join('') : `<div class="empty"><b>AI напарник</b><p>Можно просто общаться. Когда понадобится абонент — напиши, например: «глянь 423525, что с интернетом».</p></div>`;
    const quick = !messages.length ? `<div class="quick"><button data-prompt="глянь по 423525 что с интернетом">Проверить абонента</button><button data-prompt="что такое dying-gasp?">Спросить термин</button><button data-prompt="расскажи короткую шутку">Поболтать</button></div>` : '';
    const pending = state.pending ? `<div class="msg assistant"><div class="bubble thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>думаю</span></div></div>` : '';
    state.panel.innerHTML = `
      <div class="head"><div class="agent" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M6.5 18.5c.7-3.1 2.6-4.8 5.5-4.8s4.8 1.7 5.5 4.8"/><path d="M5.5 10.5v2.8a2 2 0 0 0 2 2H9M18.5 10.5v3.7a2 2 0 0 1-2 2H15"/><path d="M5.5 10.8a6.5 6.5 0 0 1 13 0"/></svg></div><div class="title"><b>AI напарник</b><span>постоянный диалог · рабочие эпизоды по смыслу</span></div><button class="close" data-action="close" aria-label="Закрыть">×</button></div>
      <div class="context"><span class="badge ${work ? '' : 'general'}">${esc(work ? `Абонент ${work.label}` : 'Свободный диалог')}</span><span class="session-usage">Σ ${tokenNumber(usage.totalTokens)} · ${Number(usage.requests || 0)} запр.</span><button class="reset" data-action="reset">Новый диалог</button></div>
      ${quick}<div class="messages" data-role="messages">${body}${pending}</div>
      <div class="foot"><div class="status">${state.loading ? 'Восстанавливаю диалог…' : state.pending ? 'Запрашиваю нужные данные и формирую ответ…' : work ? `Текущий рабочий эпизод: ${esc(work.label)}` : 'CRM-кейс не требуется · можно говорить о чём угодно'}</div><div class="composer"><textarea data-role="input" rows="1" maxlength="1800" spellcheck="true" placeholder="Сообщение…"></textarea><button class="send" data-action="send" ${state.pending || state.loading ? 'disabled' : ''} aria-label="Отправить">➜</button></div><div class="hint">Enter — отправить · Shift+Enter — новая строка</div></div>`;
    queueMicrotask(() => { const box = state.shadow?.querySelector('[data-role="messages"]'); if (box) box.scrollTop = box.scrollHeight; });
  }

  function runtimeRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, response => {
          const error = chrome.runtime.lastError;
          if (error) return reject(new Error(error.message || String(error)));
          if (!response?.success) return reject(new Error(response?.error || `${type} failed`));
          resolve(response.data || {});
        });
      } catch (error) { reject(error); }
    });
  }

  function playbookFor(message) {
    const prior = (session().messages || []).filter(item => item.role === 'user').slice(-4).map(item => item.content);
    return WB.operatorCompanionContent?.forAgent?.([...prior, message].join(' ')) || { revision: 'missing', mode: 'missing', instruction: 'Playbook недоступен; не выдумывай факты.', topics: [] };
  }

  async function load() {
    if (state.loading) return;
    state.loading = true; render();
    try { state.session = await runtimeRequest('COMPANION_CHAT_STATE_GET'); }
    catch (error) { state.session = { ...emptySession(), messages: [{ role: 'error', content: `AI: ${String(error?.message || error)}` }] }; }
    finally { state.loading = false; render(); }
  }

  async function send(preset) {
    if (state.pending || state.loading) return;
    const input = state.shadow?.querySelector('[data-role="input"]');
    const message = String(preset != null ? preset : (input?.value || '')).replace(/\s+/g, ' ').trim().slice(0, 1800);
    if (!message) return;
    const current = session();
    state.session = { ...current, messages: [...(current.messages || []), { role: 'user', content: message, at: new Date().toISOString() }].slice(-30) };
    state.pending = true; render();
    try {
      const result = await runtimeRequest('COMPANION_CHAT_REQUEST', { message, playbook: playbookFor(message) });
      state.session = result.session || { ...current, messages: [...(current.messages || []), { role: 'assistant', content: result.answer || '' }] };
    } catch (error) {
      await load().catch(() => {});
      const fresh = session();
      fresh.messages = [...(fresh.messages || []), { role: 'error', content: `AI: ${String(error?.message || error)}`, at: new Date().toISOString() }].slice(-30);
      state.session = fresh;
    } finally {
      state.pending = false; render();
      queueMicrotask(() => state.shadow?.querySelector('[data-role="input"]')?.focus());
    }
  }

  async function reset() {
    if (state.pending) return;
    state.loading = true; render();
    try { state.session = await runtimeRequest('COMPANION_CHAT_RESET'); }
    catch (error) { state.session = { ...emptySession(), messages: [{ role: 'error', content: `AI: ${String(error?.message || error)}` }] }; }
    finally { state.loading = false; render(); queueMicrotask(() => state.shadow?.querySelector('[data-role="input"]')?.focus()); }
  }

  function handleClick(event) {
    const actionNode = event.composedPath?.().find(node => node?.dataset?.action);
    if (actionNode) {
      const action = String(actionNode.dataset.action || '');
      if (action === 'close') return close();
      if (action === 'reset') return void reset();
      if (action === 'send') return void send();
    }
    const promptNode = event.composedPath?.().find(node => node?.dataset?.prompt);
    if (promptNode?.dataset?.prompt) void send(promptNode.dataset.prompt);
  }
  function handleKeydown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const input = event.composedPath?.().find(node => node?.dataset?.role === 'input');
    if (input && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
  }
  function handleModuleOpen(event) { if (state.open && event.detail?.module !== 'companion') close(); }

  async function open() {
    state.open = true; state.lastFocused = document.activeElement;
    if (state.host) { state.host.hidden = false; state.host.style.setProperty('display', 'block', 'important'); }
    window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'companion' } }));
    render(); await load(); queueMicrotask(() => state.shadow?.querySelector('[data-role="input"]')?.focus());
  }
  function close() {
    const wasOpen = state.open; state.open = false;
    if (state.host) { state.host.hidden = true; state.host.style.setProperty('display', 'none', 'important'); }
    if (wasOpen) window.dispatchEvent(new CustomEvent('simnet-workbench-module-close', { detail: { module: 'companion' } }));
    try { state.lastFocused?.focus?.(); } catch {} state.lastFocused = null;
  }
  function destroy() {
    close(); state.shadow?.removeEventListener('click', handleClick); window.removeEventListener('keydown', handleKeydown, true); window.removeEventListener('simnet-workbench-module-open', handleModuleOpen);
    state.host?.remove(); state.host = state.shadow = state.panel = null; state.session = null;
  }
  function mount() {
    if (state.host?.isConnected || !document.documentElement) return;
    const host = document.createElement('div'); host.id = HOST_ID; host.dataset.simnetWbOwned = 'operator-companion'; host.hidden = true; host.style.setProperty('display', 'none', 'important'); host.style.setProperty('pointer-events', 'none', 'important');
    const shadow = host.attachShadow({ mode: 'open' }); shadow.innerHTML = `${style()}<section class="panel" role="dialog" aria-modal="false" aria-label="AI напарник оператора"></section>`;
    document.documentElement.appendChild(host); state.host = host; state.shadow = shadow; state.panel = shadow.querySelector('.panel');
    shadow.addEventListener('click', handleClick); window.addEventListener('keydown', handleKeydown, true); window.addEventListener('simnet-workbench-module-open', handleModuleOpen);
  }

  WB.operatorCompanion = Object.freeze({ open, close, destroy, reset, isOpen: () => state.open });
  if (document.documentElement) mount(); else window.addEventListener('DOMContentLoaded', mount, { once: true });
})();
