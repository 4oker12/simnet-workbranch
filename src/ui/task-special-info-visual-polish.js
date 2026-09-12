(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskSpecialInfoVisualPolishLoaded) return;
  WB.__taskSpecialInfoVisualPolishLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const MODAL_ID = 'simnet-wb-task-special-policy-v3';
  const STYLE_ID = 'simnet-wb-task-special-info-visual-polish-style';
  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const WATCH_TTL_MS = 6000;

  let observer = null;
  let watcherTimer = 0;

  const compact = (value, max = 1000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 1600)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .trim();

  function isTaskSaveForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    try { return FORM_ACTION_RE.test(new URL(String(form.action || location.href), location.href).pathname); }
    catch { return false; }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      #${MODAL_ID}{background:rgba(19,32,41,.50)!important}
      #${MODAL_ID} .wb-sp-card{width:min(570px,calc(100vw - 32px))!important;max-height:min(680px,calc(100vh - 32px))!important;border:1px solid #c8d6df!important;border-top:4px solid #a50046!important;border-radius:8px!important;box-shadow:0 18px 48px rgba(15,38,52,.25)!important}
      #${MODAL_ID} .wb-sp-head{padding:12px 15px 10px!important;border-bottom:1px solid #d7e2e8!important}
      #${MODAL_ID} .wb-sp-kicker{font-size:9px!important;color:#a50046!important;letter-spacing:.075em!important}
      #${MODAL_ID} .wb-sp-title{margin-top:3px!important;font-size:16px!important;line-height:1.2!important;color:#132f40!important}
      #${MODAL_ID} .wb-sp-purpose{display:none!important}
      #${MODAL_ID} .wb-sp-address{margin-top:5px!important;color:#657985!important;font-size:11px!important}
      #${MODAL_ID} .wb-sp-body{padding:10px 15px 5px!important;background:#f4f8fa!important}
      #${MODAL_ID} .wb-sp-item{margin-bottom:7px!important;padding:10px 11px 9px!important;border:1px solid #cddce5!important;border-left:3px solid #1871a5!important;border-radius:6px!important;background:#fff!important}
      #${MODAL_ID} .wb-sp-item[data-severity="blocker"],#${MODAL_ID} .wb-sp-item[data-severity="review"]{border-left-color:#a50046!important}
      #${MODAL_ID} .wb-sp-item-top{display:block!important}
      #${MODAL_ID} .wb-sp-tag{display:none!important}
      #${MODAL_ID} .wb-sp-summary{display:block!important;font-size:15px!important;line-height:1.28!important;font-weight:750!important;color:#102c3b!important}
      #${MODAL_ID} .wb-sp-severity{display:none!important}
      #${MODAL_ID} .wb-sp-item[data-severity="blocker"] .wb-sp-severity,#${MODAL_ID} .wb-sp-item[data-severity="review"] .wb-sp-severity{display:block!important;margin-top:4px!important;color:#a50046!important;font-size:9px!important}
      #${MODAL_ID} .wb-sp-impact{display:none!important}
      #${MODAL_ID} .wb-sp-action{margin-top:6px!important;padding:0!important;background:transparent!important;border:0!important;color:#263f4d!important;font-size:12px!important;line-height:1.35!important}
      #${MODAL_ID} .wb-sp-action strong{color:#102c3b!important}
      #${MODAL_ID} .wb-sp-review{margin-top:6px!important;color:#667984!important}
      #${MODAL_ID} .wb-sp-review>summary{cursor:pointer!important;font-size:10px!important;font-weight:600!important;color:#71838d!important}
      #${MODAL_ID} .wb-sp-evidence{margin-top:5px!important;padding:6px 8px!important;border:0!important;border-radius:4px!important;background:#f7f9fa!important;color:#566a75!important;font-size:11px!important;line-height:1.38!important}
      #${MODAL_ID} .wb-sp-review[data-wb-duplicate="1"]{display:none!important}
      #${MODAL_ID} .wb-sp-item[data-wb-secondary="1"]{padding:8px 10px!important;border-left-color:#7f9faf!important;background:#fbfcfd!important}
      #${MODAL_ID} .wb-sp-item[data-wb-secondary="1"] .wb-sp-summary{font-size:12px!important;font-weight:400!important;color:#5f717b!important}
      #${MODAL_ID} .wb-sp-item[data-wb-secondary="1"] .wb-sp-summary:before{content:'Стоимость: ';font-weight:800;color:#344f5d}
      #${MODAL_ID} .wb-sp-item[data-wb-secondary="1"] .wb-sp-summary strong{font-weight:800!important;color:#2f4b59!important}
      #${MODAL_ID} .wb-sp-item[data-wb-secondary="1"] .wb-sp-action,#${MODAL_ID} .wb-sp-item[data-wb-secondary="1"] .wb-sp-severity{display:none!important}
      #${MODAL_ID} .wb-sp-item[data-wb-secondary="1"] .wb-sp-review>summary{font-size:9px!important}
      #${MODAL_ID} .wb-sp-check{padding:9px 15px!important;color:#253b47!important}
      #${MODAL_ID} .wb-sp-check label{font-weight:600!important;font-size:11px!important}
      #${MODAL_ID} .wb-sp-foot{padding:9px 15px 11px!important}
      #${MODAL_ID} .wb-sp-cancel{border-color:#9eb5c2!important;color:#24475a!important}
      #${MODAL_ID} .wb-sp-confirm{border-color:#1871a5!important;background:#1871a5!important}
      #${MODAL_ID} .wb-sp-confirm:not([disabled]):hover{background:#155f8a!important}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function conciseAction(tag, summary, current) {
    const source = `${summary} ${current}`;
    const until = source.match(/до\s*(\d{1,2}:\d{2})/iu);
    if (tag === 'ДОСТУП / ВРЕМЯ' && until) return `Выезд — до ${until[1]}.`;
    if (tag === 'ДОСТУП / ВРЕМЯ') return 'Учесть допустимое время выезда.';
    if (tag === 'ДОСТУП') return 'Передать бригаде подтверждённые данные доступа.';
    if (tag === 'ТЕХНОЛОГИЯ') return 'Сверить технологию заявки.';
    if (tag === 'СКОРОСТЬ') return 'Сверить тариф и обещанную скорость.';
    if (tag === 'ПОДКЛЮЧЕНИЕ') return 'Не обещать подключение до проверки возможности.';
    if (tag === 'РЕСУРС') return 'Проверить доступный ресурс до назначения.';
    if (tag === 'ПОДЪЕЗД / СЕКЦИЯ') return 'Сверить подъезд / секцию заявки.';
    if (tag === 'ВРЕМЯ НА РАБОТЫ') return 'Учесть длительность при назначении.';
    if (tag === 'УСЛУГА') return 'Сверить доступность услуги.';
    if (tag === 'ОСОБОЕ ДЕЙСТВИЕ') return 'Передать требование исполнителю.';
    if (tag === 'ПРОВЕРИТЬ') return 'Проверить исходную заметку до сохранения.';
    return compact(current, 180) || 'Учесть условие при оформлении заявки.';
  }

  function cleanEvidence(value) {
    return compact(value, 700)
      .replace(/^(?:заметк(?:а|и)|примечани[ея])\s*:\s*/iu, '')
      .trim();
  }

  function emphasizePrices(node) {
    if (!(node instanceof HTMLElement)) return;
    const text = compact(node.textContent, 500);
    if (!text) return;
    const re = /(\b(?:от\s+)?\d{1,5}\s*(?:грн|₴)(?:\s*\/\s*м)?\b)/giu;
    let cursor = 0;
    let match;
    node.textContent = '';
    while ((match = re.exec(text))) {
      if (match.index > cursor) node.append(document.createTextNode(text.slice(cursor, match.index)));
      const strong = document.createElement('strong');
      strong.textContent = match[0];
      node.append(strong);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) node.append(document.createTextNode(text.slice(cursor)));
  }

  function polishItem(node) {
    const tag = compact(node.querySelector('.wb-sp-tag')?.textContent, 80);
    const summaryNode = node.querySelector('.wb-sp-summary');
    const summary = compact(summaryNode?.textContent, 420);
    const secondary = tag === 'СТОИМОСТЬ' || tag === 'ДОПОЛНИТЕЛЬНО' || tag === 'УСЛОВИЯ / СТОИМОСТЬ';
    if (secondary) {
      node.dataset.wbSecondary = '1';
      emphasizePrices(summaryNode);
    }

    const action = node.querySelector('.wb-sp-action');
    if (action) {
      if (secondary) {
        action.remove();
      } else {
        const current = compact(action.textContent.replace(/^Что сделать:\s*/iu, ''), 240);
        action.textContent = '';
        const label = document.createElement('strong');
        label.textContent = 'Действие: ';
        action.append(label, document.createTextNode(conciseAction(tag, summary, current)));
      }
    }

    const details = node.querySelector('.wb-sp-review');
    const evidenceNode = node.querySelector('.wb-sp-evidence');
    if (details && evidenceNode) {
      const evidence = cleanEvidence(evidenceNode.textContent);
      evidenceNode.textContent = evidence;
      details.open = false;
      const detailsSummary = details.querySelector(':scope > summary');
      if (detailsSummary) detailsSummary.textContent = 'Исходная заметка';

      const a = fold(summary);
      const b = fold(evidence);
      if (!b || (a && (a === b || a.includes(b) || b.includes(a)))) details.dataset.wbDuplicate = '1';
    }
  }

  function dedupeCards(host) {
    const seen = new Set();
    for (const node of host.querySelectorAll('.wb-sp-item')) {
      const summary = fold(node.querySelector('.wb-sp-summary')?.textContent);
      const evidence = fold(node.querySelector('.wb-sp-evidence')?.textContent);
      const key = `${summary}|${evidence}`;
      if (!summary || seen.has(key)) {
        node.remove();
        continue;
      }
      seen.add(key);
    }
  }

  function polishModal(host) {
    if (!(host instanceof HTMLElement) || host.id !== MODAL_ID) return false;
    if (host.dataset.wbVisualPolished === '1') return true;
    host.dataset.wbVisualPolished = '1';
    ensureStyles();

    const kicker = host.querySelector('.wb-sp-kicker');
    const title = host.querySelector('.wb-sp-title');
    const ackText = host.querySelector('.wb-sp-check label span');
    const cancel = host.querySelector('[data-action="cancel"]');
    if (kicker) kicker.textContent = 'Особые условия по адресу';
    if (title) title.textContent = 'Проверь перед сохранением';
    if (ackText) ackText.textContent = 'Ознакомлен. Условия учтены в заявке.';
    if (cancel) cancel.textContent = 'Вернуться';

    host.querySelectorAll('.wb-sp-item').forEach(polishItem);
    dedupeCards(host);
    return true;
  }

  function stopWatcher() {
    if (observer) observer.disconnect();
    observer = null;
    if (watcherTimer) clearTimeout(watcherTimer);
    watcherTimer = 0;
  }

  function armWatcher() {
    const existing = document.getElementById(MODAL_ID);
    if (existing && polishModal(existing)) return;
    if (observer || !document.body) return;

    observer = new MutationObserver(() => {
      const host = document.getElementById(MODAL_ID);
      if (!host) return;
      polishModal(host);
      stopWatcher();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    watcherTimer = setTimeout(stopWatcher, WATCH_TTL_MS);
  }

  document.addEventListener('click', event => {
    const control = event.target?.closest?.('button,input[type="submit"],input[type="button"],a');
    const form = control?.form || control?.closest?.('form');
    if (isTaskSaveForm(form)) armWatcher();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const form = event.target?.closest?.('form');
    if (isTaskSaveForm(form)) armWatcher();
  }, true);

  document.addEventListener('submit', event => {
    if (isTaskSaveForm(event.target)) armWatcher();
  }, true);

  ensureStyles();
  polishModal(document.getElementById(MODAL_ID));
})();
