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
  const normalizeSerial = value => trim(value).replace(/[^0-9a-z]/gi, '').toUpperCase();

  function planTmcPatch(parsed, expected) {
    const changes = [];
    const unavailable = [];
    const serial = normalizeSerial(expected.onuSerial);
    const mac = normalizeMac(expected.onuMac);
    const add = (field, value) => {
      const control = parsed.controls[field];
      if (!control || control.disabled || control.readOnly) unavailable.push(field);
      else changes.push({ field, control, value });
    };
    if (serial && serial !== normalizeSerial(parsed.values.onuSerial)) {
      add('onuSerial', /^[A-Z]{4}[0-9A-F]{8}$/.test(serial) ? `${serial.slice(0, 4)}:${serial.slice(4)}` : serial);
    }
    if (mac && mac !== normalizeMac(parsed.values.onuMac)) add('onuMac', mac);
    const ip = trim(expected.oltIp);
    if (ip && ip !== parsed.values.oltIp) {
      const matches = [...(parsed.controls.olt?.options || [])].filter(option => (
        !option.disabled && trim(option.value) && trim(option.value) !== '0'
        && trim(option.textContent).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] === ip
      ));
      if (matches.length === 1) add('olt', matches[0].value);
      else unavailable.push('olt');
    }
    return { changes, unavailable };
  }

  WB.parsers.billing.technical = { version: '3.1.0', parseDocument, planTmcPatch };
})();
