(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const STYLE_ID = 'simnet-wb-direct-tmc-focus-style';
  const ROOT_CLASS = 'simnet-wb-direct-tmc-focus';
  const MARK_ATTR = 'data-simnet-wb-direct-tmc-value';
  const consumed = new Set();
  let active = null;
  let inFlight = null;
  let waitInFlight = null;

  const normalizeMac = value => String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  const normalizeSerial = value => String(value || '').replace(/[^0-9a-z]/gi, '').toUpperCase();

  function remember(commandId) {
    const id = String(commandId || '');
    if (!id) return;
    consumed.add(id);
    while (consumed.size > 64) consumed.delete(consumed.values().next().value);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      .${ROOT_CLASS} {
        position: relative !important;
        outline: 3px solid #A50046 !important;
        outline-offset: 7px !important;
        border-radius: 5px !important;
        box-shadow: 0 0 0 5px rgba(165,0,70,.12) !important;
        scroll-margin: 90px 20px !important;
      }
      [${MARK_ATTR}] {
        display: inline-block !important;
        padding: 1px 4px !important;
        margin: -1px -4px !important;
        border-radius: 3px !important;
        background: #FFEAF2 !important;
        outline: 2px solid rgba(165,0,70,.86) !important;
        box-shadow: 0 0 0 3px rgba(165,0,70,.10) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function unwrapMarks(root = document) {
    root.querySelectorAll?.(`[${MARK_ATTR}]`).forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize?.();
    });
  }

  function clear() {
    active?.controller?.abort?.();
    active?.element?.classList?.remove?.(ROOT_CLASS);
    if (active?.element) unwrapMarks(active.element);
    active = null;
  }

  function parserResult() {
    const block = WB.tmcParser?.findBlocks?.(document)?.[0] || null;
    if (!block?.isConnected) return null;
    const facts = WB.tmcParser?.parseBlock?.(block) || null;
    return { block, facts };
  }

  async function waitForTmcBlock(timeoutMs = 1200) {
    const immediate = parserResult();
    if (immediate) return immediate;
    if (waitInFlight) return waitInFlight;

    const maxWait = Math.max(250, Math.min(1800, Number(timeoutMs || 1200)));
    const promise = new Promise(resolve => {
      let done = false;
      let timer = null;
      const finish = value => {
        if (done) return;
        done = true;
        observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve(value || null);
      };
      const check = () => {
        const result = parserResult();
        if (result) finish(result);
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(() => finish(parserResult()), maxWait);
      queueMicrotask(check);
    }).finally(() => {
      if (waitInFlight === promise) waitInFlight = null;
    });
    waitInFlight = promise;
    return promise;
  }

  function markValues(root, facts = {}) {
    unwrapMarks(root);
    const expected = [
      facts.serial ? { kind: 'serial', test: text => normalizeSerial(text).includes(normalizeSerial(facts.serial)) } : null,
      facts.mac ? { kind: 'mac', test: text => normalizeMac(text).includes(normalizeMac(facts.mac)) } : null,
      facts.oltIp ? { kind: 'olt', test: text => String(text).includes(String(facts.oltIp)) } : null,
      facts.oltName ? { kind: 'olt', test: text => {
        const actual = String(text).trim().toLowerCase();
        const wanted = String(facts.oltName).trim().toLowerCase();
        return actual.length >= 4 && (actual.includes(wanted) || wanted.includes(actual));
      } } : null
    ].filter(Boolean);
    if (!expected.length) return 0;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest?.(`[${MARK_ATTR}],[data-simnet-wb-owned]`)) continue;
      const text = String(node.nodeValue || '');
      const match = expected.find(item => item.test(text));
      if (match) hits.push({ node, kind: match.kind });
    }

    const marks = [];
    for (const hit of hits) {
      const parent = hit.node.parentNode;
      if (!parent) continue;
      const mark = document.createElement('span');
      mark.setAttribute(MARK_ATTR, hit.kind);
      mark.dataset.simnetWbOwned = '1';
      parent.insertBefore(mark, hit.node);
      mark.appendChild(hit.node);
      marks.push(mark);
    }
    return marks.length;
  }

  function showFocus(block, facts) {
    clear();
    ensureStyle();
    block.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    block.classList.add(ROOT_CLASS);
    const marked = markValues(block, facts);
    const controller = new AbortController();
    const dismiss = () => clear();
    block.addEventListener('click', dismiss, { capture: true, once: true, signal: controller.signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') dismiss();
    }, { capture: true, signal: controller.signal });
    active = { element: block, controller };
    return marked;
  }

  async function run({ mode = 'focus', commandId = '', caseId = '', timeoutMs = 2200 } = {}) {
    const id = String(commandId || '');
    if (!['focus', 'scroll'].includes(mode)) return { ok: false, reason: 'unsupported-tmc-command' };
    if (id && consumed.has(id)) return { ok: true, consumed: true, mode };
    const resolved = await waitForTmcBlock(timeoutMs);
    if (!resolved) return { ok: false, reason: 'tmc-target-not-found', mode };

    let marked = 0;
    if (mode === 'focus') marked = showFocus(resolved.block, resolved.facts || {});
    else {
      clear();
      resolved.block.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    }
    remember(id);
    return { ok: true, mode, marked, element: resolved.block };
  }

  function execute(command = {}) {
    const key = `${String(command?.mode || 'focus')}:${String(command?.commandId || '')}`;
    if (inFlight?.key === key) return inFlight.promise;
    const previous = inFlight?.promise || Promise.resolve();
    const promise = previous
      .catch(() => undefined)
      .then(() => run(command))
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
    inFlight = { key, promise };
    return promise;
  }

  WB.browser ||= {};
  WB.browser.actions ||= {};
  WB.browser.actions.usersideTmc = Object.freeze({ execute, clear, waitForTmcBlock });
})();
