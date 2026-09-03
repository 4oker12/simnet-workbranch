(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;
  if (!['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(location.hostname)) return;

  const foldMap = new Map([
    ['ё', 'е'],
    ['є', 'е'],
    ['і', 'и'],
    ['ї', 'и'],
    ['ґ', 'г']
  ]);

  function normalizeText(value) {
    return String(value || '')
      .toLocaleLowerCase('uk-UA')
      .replace(/[ёєіїґ]/g, char => foldMap.get(char) || char)
      .replace(/[’'`´]/g, '')
      .replace(/[^a-zа-я0-9]+/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function queryTerms(value) {
    return [...new Set(normalizeText(value).split(' ').filter(Boolean))];
  }

  function matchesTerms(text, terms) {
    if (!terms.length) return true;
    const haystack = normalizeText(text);
    return terms.every(term => haystack.includes(term));
  }

  function mount() {
    if (document.getElementById('simnet-wb-billing-group-search')) return true;

    const form = document.querySelector('form#formedit');
    const select = form?.querySelector('select[name="grp"]');
    if (!select || select.dataset.simnetWbWordSearch === '1') return false;

    const parent = select.parentElement;
    if (!parent) return false;

    const originalOptions = Array.from(select.options);
    if (originalOptions.length < 20) return false;

    const optionIndex = originalOptions.map((option, index) => ({
      option,
      index,
      text: String(option.textContent || option.label || ''),
      normalized: normalizeText(option.textContent || option.label || '')
    }));

    const host = document.createElement('div');
    host.id = 'simnet-wb-billing-group-search';
    host.dataset.simnetWbOwned = '1';
    host.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:4px',
      'width:100%',
      'min-width:0'
    ].join(';');

    const searchWrap = document.createElement('span');
    searchWrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;flex:0 0 220px;min-width:140px';

    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Поиск по группам');
    input.placeholder = 'поиск: соф бор уютный';
    input.title = 'Поиск по словам в любом порядке. Точки, скобки, дефисы и подчёркивания не мешают поиску.';
    input.style.cssText = [
      'box-sizing:border-box',
      'width:100%',
      'height:20px',
      'padding:1px 42px 1px 4px',
      'border:1px solid #9a9a9a',
      'background:#fff',
      'color:#111',
      'font:12px Arial,sans-serif',
      'outline:none'
    ].join(';');

    const count = document.createElement('span');
    count.setAttribute('aria-hidden', 'true');
    count.style.cssText = [
      'position:absolute',
      'right:18px',
      'top:50%',
      'transform:translateY(-50%)',
      'pointer-events:none',
      'font:10px Arial,sans-serif',
      'color:#666',
      'background:#fff',
      'padding-left:2px'
    ].join(';');

    searchWrap.append(input, count);

    const previousInlineWidth = select.style.width;
    const previousInlineMinWidth = select.style.minWidth;
    const previousInlineFlex = select.style.flex;
    select.style.width = 'auto';
    select.style.minWidth = '0';
    select.style.flex = '1 1 auto';
    select.dataset.simnetWbWordSearch = '1';

    parent.insertBefore(host, select);
    host.append(searchWrap, select);

    let lastMatches = optionIndex;

    function restoreAll() {
      const selectedValue = select.value;
      const fragment = document.createDocumentFragment();
      for (const item of optionIndex) fragment.appendChild(item.option);
      select.replaceChildren(fragment);
      select.value = selectedValue;
      lastMatches = optionIndex;
      count.textContent = '';
      input.style.borderColor = '#9a9a9a';
    }

    function applyFilter() {
      const selectedValue = select.value;
      const terms = queryTerms(input.value);
      if (!terms.length) {
        restoreAll();
        return;
      }

      const matches = optionIndex.filter(item => terms.every(term => item.normalized.includes(term)));
      lastMatches = matches;

      const selectedItem = optionIndex.find(item => String(item.option.value) === String(selectedValue)) || null;
      const selectedMatches = selectedItem && matches.includes(selectedItem);
      const visible = selectedMatches
        ? matches
        : [selectedItem, ...matches].filter(Boolean);

      const fragment = document.createDocumentFragment();
      for (const item of visible) fragment.appendChild(item.option);
      select.replaceChildren(fragment);
      select.value = selectedValue;

      count.textContent = String(matches.length);
      input.style.borderColor = matches.length ? '#777' : '#b53b3b';
      input.title = matches.length
        ? `Найдено групп: ${matches.length}. Все введённые слова должны встречаться в названии.`
        : 'Совпадений нет. Текущая группа оставлена в списке, чтобы случайно не изменить абонента.';
    }

    input.addEventListener('input', applyFilter);
    input.addEventListener('search', applyFilter);
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && input.value) {
        event.preventDefault();
        input.value = '';
        restoreAll();
        return;
      }
      if (event.key === 'ArrowDown' && lastMatches.length) {
        event.preventDefault();
        select.focus();
      }
    });

    select.addEventListener('change', () => {
      if (!input.value) return;
      input.value = '';
      queueMicrotask(restoreAll);
    });

    // Expose only pure helpers/state for diagnostics and contract tests.
    WB.billingGroupWordSearch = {
      normalizeText,
      queryTerms,
      matchesTerms,
      refresh: applyFilter,
      destroy() {
        restoreAll();
        select.style.width = previousInlineWidth;
        select.style.minWidth = previousInlineMinWidth;
        select.style.flex = previousInlineFlex;
        delete select.dataset.simnetWbWordSearch;
        parent.insertBefore(select, host);
        host.remove();
        delete WB.billingGroupWordSearch;
      }
    };

    return true;
  }

  // Billing user pages are server-rendered; document_idle is enough. One bounded
  // retry covers rare pages where the form is appended just after the content script.
  if (!mount()) {
    setTimeout(() => { mount(); }, 180);
  }
})();
