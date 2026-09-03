(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.clickDebug) return;

  const MAX_EVENTS = 40;
  const events = [];
  const byEvent = new WeakMap();
  const lifecycle = typeof AbortController === 'function' ? new AbortController() : null;
  let seq = 0;

  const compact = (value, max = 180) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function targetInfo(event) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    const elements = path.filter(node => node instanceof Element);
    const actionable = elements.find(el => el.matches?.('[data-action],[data-section],a[href],button,input,select'))
      || (event?.target instanceof Element ? event.target : null);
    const hrefNode = elements.find(el => el.matches?.('a[href]')) || actionable?.closest?.('a[href]') || null;
    const dataActionNode = elements.find(el => el.hasAttribute?.('data-action')) || actionable?.closest?.('[data-action]') || null;
    const dataSectionNode = elements.find(el => el.hasAttribute?.('data-section')) || actionable?.closest?.('[data-section]') || null;
    return {
      tag: String(actionable?.tagName || '').toLowerCase(),
      id: String(actionable?.id || ''),
      text: compact(actionable?.innerText || actionable?.textContent || actionable?.value || ''),
      action: String(dataActionNode?.dataset?.action || ''),
      section: String(dataSectionNode?.dataset?.section || ''),
      href: hrefNode?.href ? compact(hrefNode.href, 260) : ''
    };
  }

  function emit(record) {
    WB.bus?.emit?.('debug:click', { ...record });
  }

  function start(event) {
    const record = {
      id: `click_${++seq}`,
      at: new Date().toISOString(),
      eventType: String(event?.type || 'click'),
      target: targetInfo(event),
      owner: 'native/page',
      decision: 'observed',
      reason: '',
      defaultPrevented: Boolean(event?.defaultPrevented),
      details: null
    };
    events.unshift(record);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    byEvent.set(event, record);

    queueMicrotask(() => {
      record.defaultPrevented = Boolean(event?.defaultPrevented);
      if (record.defaultPrevented && record.decision === 'observed') {
        record.decision = 'prevented';
        record.reason = 'preventDefault outside Workbench marker';
      } else if (!record.defaultPrevented && record.decision === 'observed') {
        record.decision = 'allowed';
      }
      emit(record);
    });
  }

  function mark(event, owner, decision, reason = '', details = null) {
    const record = byEvent.get(event);
    if (!record) return false;
    record.owner = compact(owner || record.owner, 80) || record.owner;
    record.decision = compact(decision || record.decision, 60) || record.decision;
    record.reason = compact(reason, 220);
    record.details = details && typeof details === 'object' ? { ...details } : null;
    return true;
  }

  function recent(limit = 20) {
    return events.slice(0, Math.max(1, Math.min(MAX_EVENTS, Number(limit || 20)))).map(item => ({
      ...item,
      target: { ...(item.target || {}) },
      details: item.details ? { ...item.details } : null
    }));
  }

  function clear() {
    events.length = 0;
    WB.bus?.emit?.('debug:click', { cleared: true });
  }

  // Capture runs before Workbench's later document click handlers. Even if a
  // later handler calls stopImmediatePropagation, the microtask can still show
  // whether the native click was prevented. This debugger never changes events.
  document.addEventListener('click', start, lifecycle ? { capture: true, signal: lifecycle.signal } : true);

  function destroy() {
    lifecycle?.abort?.();
    events.length = 0;
  }

  WB.clickDebug = Object.freeze({ mark, recent, clear, destroy });
})();
