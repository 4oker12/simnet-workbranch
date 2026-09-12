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

  const fold = value => compact(value, 1200)
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
      #${MODAL_ID}{background:rgba(19,32,41,.52)!important}
      #${MODAL_ID} .wb-sp-card{width:min(620px,calc(100vw - 32px))!important;border:1px solid #c8d6df!important;border-top:4px solid #a50046!important;border-radius:8px!important;box-shadow:0 18px 48px rgba(15,38,52,.25)!important}
      #${MODAL_ID} .wb-sp-head{padding:14px 16px 11px!important;border-bottom:1px solid #d7e2e8!important}
      #${MODAL_ID} .wb-sp-kicker{font-size:10px!important;color:#a50046!important;letter-spacing:.075em!important}
      #${MODAL_ID} .wb-sp-title{margin-top:4px!important;font-size:17px!important;line-height:1.22!important;color:#132f40!important}
      #${MODAL_ID} .wb-sp-purpose{display:none!important}
      #${MODAL_ID} .wb-sp-address{margin-top:6px!important;color:#657985!important;font-size:11px!important}
      #${MODAL_ID} .wb-sp-body{padding:12px 16px 7px!important;background:#f4f8fa!important}
      #${MODAL_ID} .wb-sp-item{margin-bottom:10px!important;padding:12px 13px 11px!important;border:1px solid #cddce5!important;border-left:4px solid #1871a5!important;border-radius:6px!important;background:#fff!important}
      #${MODAL_ID} .wb-sp-item[data-severity="blocker"],#${MODAL_ID} .wb-sp-item[data-severity="review"]{border-left-color:#a50046!important}
      #${MODAL_ID} .wb-sp-item-top{display:block!important}
      #${MODAL_ID} .wb-sp-tag{display:inline-block!important;margin:0 0 6px!important;padding:3px 6px!important;background:#e9f3f8!important;color:#14658f!important;border:1px solid #c6e0ed!important;border-radius:3px!important;font-size:9px!important}
      #${MODAL_ID} .wb-sp-summary{display:block!important;font-size:17px!important;line-height:1.28!important;font-weight:800!important;color:#102c3b!important}
      #${MODAL_ID} .wb-sp-severity{display:none!important}
      #${MODAL_ID} .wb-sp-item[data-severity="blocker"] .wb-sp-severity,#${MODAL_ID} .wb-sp-item[data-severity="review"] .wb-sp-severity{display:block!important;margin-top:6px!important;color:#a50046!important;font-size:10px!important}
      #${MODAL_ID} .wb-sp-impact{display:none!important}
      #${MODAL_ID} .wb-sp-action{margin-top:8px!important;padding:7px 9px!important;background:#eef5f8!important;border-left:3px solid #1871a5!important;border-radius:3px!important;color:#183d50!important;font-size:12px!important;line-height:1.35!important}
      #${MODAL_ID} .wb-sp-action strong{color:#14658f!important}
      #${MODAL_ID} .wb-sp-review{display:block!important;margin-top:8px!important;color:#415661!important}
      #${MODAL_ID} .wb-sp-review>summary{display:none!important}
      #${MODAL_ID} .wb-sp-evidence{margin-top:0!important;padding:8px 9px!important;border:0!important;border-radius:4px!important;background:#f7f9fa!important;color:#2f414b!important;font-size:12px!important;line-height:1.42!important}
      #${MODAL_ID} .wb-sp-evidence:before{content:'ИЗ USERSIDE';display:block;margin-bottom:4px;color:#778a94;font-size:9px;font-weight:800;letter-spacing:.06em}
      #${MODAL_ID} .wb-sp-review[data-wb-duplicate="1"]{display:none!important}
      #${MODAL_ID} .wb-sp-check{padding:10px 16px!important;color:#253b47!important}
      #${MODAL_ID} .wb-sp-check label{font-weight:600!important}
      #${MODAL_ID} .wb-sp-foot{padding:10px 16px 12px!important}
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
    if (tag === 'ДОСТУП') return 'Передать бригаде данные доступа.';
    if (tag === 'ТЕХНОЛОГИЯ') return 'Сверить технологию заявки.';
    if (tag === 'СКОРОСТЬ') return 'Сверить тариф и обещанную скорость.';
    if (tag === 'ПОДКЛЮЧЕНИЕ') return 'Не обещать подключение до проверки возможности.';
    if (tag === 'РЕСУРС') return 'Проверить доступный ресурс до назначения.';
    if (tag === 'ПОДЪЕЗД / СЕКЦИЯ') return 'Сверить подъезд / секцию заявки.';
    if (tag === 'ВРЕМЯ НА РАБОТЫ') return 'Учесть длительность при назначении.';
    if (tag === 'УСЛУГА') return 'Сверить доступность услуги.';
    if (tag === 'УСЛОВИЯ / СТОИМОСТЬ') return 'Сверить условие до согласования с абонентом.';
    if (tag === 'ОСОБОЕ ДЕЙСТВИЕ') return 'Передать требование исполнителю.';
    if (tag === 'ПРОВЕРИТЬ') return 'Проверить исходную заметку до сохранения.';
    return compact(current, 180) || 'Учесть условие при оформлении заявки.';
  }

  function cleanEvidence(value) {
    return compact(value, 500)
      .replace(/^(?:заметк(?:а|и)|примечани[ея])\s*:\s*/iu, '')
      .trim();
  }

  function polishItem(node) {
    const tag = compact(node.querySelector('.wb-sp-tag')?.textContent, 80);
    const summaryNode = node.querySelector('.wb-sp-summary');
    const summary = compact(summaryNode?.textContent, 240);

    const action = node.querySelector('.wb-sp-action');
    if (action) {
      const current = compact(action.textContent.replace(/^Что сделать:\s*/iu, ''), 240);
      action.textContent = '';
      const label = document.createElement('strong');
      label.textContent = 'Учесть: ';
      action.append(label, document.createTextNode(conciseAction(tag, summary, current)));
    }

    const details = node.querySelector('.wb-sp-review');
    const evidenceNode = node.querySelector('.wb-sp-evidence');
    if (details && evidenceNode) {
      const evidence = cleanEvidence(evidenceNode.textContent);
      evidenceNode.textContent = evidence;
      details.open = true;

      const a = fold(summary);
      const b = fold(evidence);
      if (!b || (a && (a === b || a.includes(b) || b.includes(a)))) details.dataset.wbDuplicate = '1';
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
