(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const trim = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  function first(root, selectors) {
    for (const selector of selectors) {
      const control = root.querySelector?.(selector);
      if (control) return control;
    }
    return null;
  }

  function isEmptySelect(select) {
    if (!select) return true;
    const value = trim(select.value);
    const label = trim(select.options?.[select.selectedIndex]?.textContent);
    return !value || value === '0' || /выбер|оберіть|не\s+указ|нет\s+данн/i.test(label);
  }

  function normalizeMac(value) {
    const hex = trim(value).replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex.match(/.{2}/g).join(':') : '';
  }

  function parseDocument(root = document) {
    const controls = {
      olt: first(root, ['select#dopfield_29', 'select[name="dopfield_29"]']),
      onuSerial: first(root, ['input#dopfield_38', 'input[name="dopfield_38"]']),
      onuMac: first(root, ['input#dopfield_19', 'input[name="dopfield_19"]'])
    };
    const selected = controls.olt?.options?.[controls.olt.selectedIndex] || null;
    const oltEmpty = isEmptySelect(controls.olt);
    const oltLabel = oltEmpty ? '' : trim(selected?.textContent);
    const oltId = oltEmpty ? '' : trim(controls.olt?.value);
    const oltIp = oltLabel.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '';
    const oltName = oltLabel
      .replace(oltIp, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      parserVersion: 'billing-technical-v3',
      controls,
      values: {
        oltName,
        oltIp,
        oltId,
        onuSerial: trim(controls.onuSerial?.value).toUpperCase(),
        onuMac: normalizeMac(controls.onuMac?.value)
      },
      empty: {
        olt: oltEmpty,
        onuSerial: !trim(controls.onuSerial?.value),
        onuMac: !trim(controls.onuMac?.value)
      }
    };
  }

  WB.parsers ||= {};
  WB.parsers.billing ||= {};
  WB.parsers.billing.technical = { version: '3.0.0', parseDocument };
})();
