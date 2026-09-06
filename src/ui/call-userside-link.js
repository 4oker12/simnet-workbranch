(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const rail = WB?.rail;
  if (!WB || !rail || window.top !== window.self || WB.callUsersideLink) return;

  const CALL_RE = /\bCALL\s*#(\d{4,24})\b/i;
  let boundShadow = null;
  let originalSyncAttention = null;

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
    return true;
  }

  const originalDestroy = typeof rail.destroy === 'function' ? rail.destroy.bind(rail) : null;
  if (originalDestroy) {
    rail.destroy = function destroyWithUsersideLinks(...args) {
      if (boundShadow) boundShadow.removeEventListener('click', handleClick, true);
      boundShadow = null;
      return originalDestroy(...args);
    };
  }

  WB.callUsersideLink = Object.freeze({
    install,
    href: usersideCallHref
  });

  install();
})();
