(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const rail = WB?.rail;
  if (!WB || !rail || window.top !== window.self || WB.callUsersideLink) return;

  const CALL_RE = /\bCALL\s*#(\d{4,24})\b/i;
  const HASH_RE = /^#audioRecordId(\d{4,24})$/i;
  const HIGHLIGHT_CLASS = 'wb-userside-call-target';
  const HIGHLIGHT_STYLE_ID = 'wb-userside-call-target-style';
  const FOCUS_DELAYS_MS = Object.freeze([0, 80, 200, 500, 1000, 1800]);

  let boundShadow = null;
  let originalSyncAttention = null;
  let focusTimer = 0;

  function usersideCallHref(callId) {
    const id = String(callId || '').replace(/\D+/g, '').slice(0, 24);
    return id
      ? `https://userside.simnet.kiev.ua/message/call_list#audioRecordId${id}`
      : '';
  }

  function linkifyMeta(meta) {
    if (!(meta instanceof Element) || meta.dataset.wbCallLinkified === '1') return;
    const text = String(meta.textContent || '');
    const match = text.match(CALL_RE);
    if (!match) return;

    const callId = match[1];
    const href = usersideCallHref(callId);
    if (!href) return;

    const start = Number(match.index || 0);
    const end = start + match[0].length;
    const before = text.slice(0, start);
    const after = text.slice(end);

    const link = document.createElement('a');
    link.className = 'wb-userside-call-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `CALL #${callId}`;
    link.title = `Открыть CALL #${callId} в журнале звонков UserSide`;
    Object.assign(link.style, {
      color: '#175cd3',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      cursor: 'pointer'
    });

    meta.replaceChildren(
      document.createTextNode(before),
      link,
      document.createTextNode(after)
    );
    meta.dataset.wbCallLinkified = '1';
  }

  function linkifyVisibleCalls() {
    const shadow = rail.shadow;
    if (!shadow) return;
    shadow.querySelectorAll('.call-event-meta').forEach(linkifyMeta);
  }

  function ensureHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      tr.${HIGHLIGHT_CLASS},
      tr.${HIGHLIGHT_CLASS} > td {
        background:#fff3b0 !important;
      }
      tr.${HIGHLIGHT_CLASS} {
        outline:3px solid #a50046 !important;
        outline-offset:-3px !important;
        box-shadow:0 0 0 2px rgba(165,0,70,.14) !important;
      }
      tr.${HIGHLIGHT_CLASS} > td:first-child::before {
        content:'CALL';
        display:inline-block;
        margin-right:5px;
        padding:2px 5px;
        border-radius:999px;
        background:#a50046;
        color:#fff;
        font:700 9px/1.2 Arial,sans-serif;
        vertical-align:middle;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function callIdFromHash() {
    return String(location.hash || '').match(HASH_RE)?.[1] || '';
  }

  function clearHighlightedRows() {
    document.querySelectorAll(`tr.${HIGHLIGHT_CLASS}`).forEach(row => row.classList.remove(HIGHLIGHT_CLASS));
  }

  function findCallRow(callId) {
    const id = String(callId || '').replace(/\D+/g, '').slice(0, 24);
    if (!id) return null;

    const marker = document.getElementById(`audioRecordId${id}`);
    if (marker) return marker.closest('tr');

    const byLoadRecord = Array.from(document.querySelectorAll('tr')).find(row => {
      const links = row.querySelectorAll?.('a[href],a[onclick]') || [];
      return Array.from(links).some(link => {
        const source = `${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`;
        return new RegExp(`loadRecordFile\\(\\s*${id}\\s*,`, 'i').test(source);
      });
    });
    return byLoadRecord || null;
  }

  function focusCallRow(callId, attempt = 0) {
    clearTimeout(focusTimer);
    focusTimer = 0;

    const row = findCallRow(callId);
    if (row) {
      ensureHighlightStyle();
      clearHighlightedRows();
      row.classList.add(HIGHLIGHT_CLASS);
      row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      WB.log?.info?.('CALL', 'Строка звонка UserSide найдена и подсвечена', {
        usersideCallId: String(callId),
        rowId: String(row.id || '')
      });
      return true;
    }

    if (attempt >= FOCUS_DELAYS_MS.length - 1) {
      WB.log?.warn?.('CALL', 'Не удалось найти строку CALL по hash', {
        usersideCallId: String(callId),
        hash: String(location.hash || '')
      });
      return false;
    }

    focusTimer = setTimeout(() => {
      focusTimer = 0;
      focusCallRow(callId, attempt + 1);
    }, FOCUS_DELAYS_MS[attempt + 1]);
    return false;
  }

  function focusHashCall() {
    const callId = callIdFromHash();
    if (!callId || location.pathname !== '/message/call_list') {
      clearHighlightedRows();
      return false;
    }
    return focusCallRow(callId, 0);
  }

  function handleClick(event) {
    const link = event.target?.closest?.('.wb-userside-call-link');
    if (!link) return;
    event.stopPropagation();
    WB.log?.info?.('CALL', 'Переход к звонку UserSide', {
      href: String(link.href || '').replace(/[?#].*$/, ''),
      usersideCallId: String(link.textContent || '').replace(/\D+/g, '')
    });
  }

  function bindShadow() {
    const shadow = rail.shadow;
    if (!shadow || boundShadow === shadow) return;
    if (boundShadow) boundShadow.removeEventListener('click', handleClick, true);
    shadow.addEventListener('click', handleClick, true);
    boundShadow = shadow;
  }

  function install() {
    if (typeof rail.syncAttention !== 'function') return false;
    bindShadow();
    if (!originalSyncAttention) {
      originalSyncAttention = rail.syncAttention.bind(rail);
      rail.syncAttention = function syncAttentionWithUsersideLinks(...args) {
        const result = originalSyncAttention(...args);
        bindShadow();
        linkifyVisibleCalls();
        return result;
      };
    }
    linkifyVisibleCalls();
    focusHashCall();
    return true;
  }

  const originalDestroy = typeof rail.destroy === 'function' ? rail.destroy.bind(rail) : null;
  if (originalDestroy) {
    rail.destroy = function destroyWithUsersideLinks(...args) {
      clearTimeout(focusTimer);
      window.removeEventListener('hashchange', focusHashCall);
      if (boundShadow) boundShadow.removeEventListener('click', handleClick, true);
      boundShadow = null;
      return originalDestroy(...args);
    };
  }

  window.addEventListener('hashchange', focusHashCall);

  WB.callUsersideLink = Object.freeze({
    install,
    href: usersideCallHref,
    focus: focusHashCall,
    findRow: findCallRow
  });

  install();
})();
