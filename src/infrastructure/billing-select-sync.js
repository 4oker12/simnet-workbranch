// Runs in the page's MAIN world so native jQuery select widgets see the update.
export function syncBillingOltWidget(billingId, expectedValue, expectedIp = '') {
  const url = new URL(location.href);
  if (!['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(url.hostname)
      || url.searchParams.get('a') !== 'dopdata' || url.searchParams.get('id') !== billingId) return { ok: false };
  const select = document.querySelector('select#dopfield_29,select[name="dopfield_29"]');
  if (!select || select.value !== expectedValue || select.multiple) return { ok: false };
  const selectize = select.selectize;
  let changed = false;
  if (expectedIp) {
    const ipOf = text => String(text || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || '';
    const options = selectize
      ? Object.entries(selectize.options || {}).map(([key, option]) => ({
        value: String(option[selectize.settings?.valueField || 'value'] ?? key),
        label: option[selectize.settings?.labelField || 'text'], disabled: option.disabled
      }))
      : [...select.options].map(option => ({ value: option.value, label: option.textContent, disabled: option.disabled }));
    const matches = options.filter(option => option.value && option.value !== '0' && !option.disabled && ipOf(option.label) === expectedIp);
    if (matches.length !== 1) return { ok: false, reason: matches.length ? 'olt-ip-ambiguous' : 'olt-ip-not-found' };
    const value = matches[0].value;
    changed = select.value !== value;
    if (changed) {
      if (select.disabled || selectize?.isDisabled || selectize?.isLocked) return { ok: false, reason: 'olt-disabled' };
      if (selectize) selectize.setValue(value);
      else { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }
      if (select.value !== value) return { ok: false, reason: 'olt-selection-failed' };
    }
  }
  select.size = 1;
  select.blur();
  if (selectize) {
    selectize.close();
    selectize.blur();
    return { ok: true, changed };
  }
  const $ = window.jQuery;
  if ($) {
    const widget = $(select);
    widget.trigger('change');
    if (widget.data('select2') && typeof widget.select2 === 'function') widget.select2('close');
    if (widget.data('chosen')) widget.trigger('chosen:updated').trigger('chosen:close');
    if (widget.data('selectpicker') && typeof widget.selectpicker === 'function') {
      widget.selectpicker('refresh');
      if (select.closest('.bootstrap-select')?.classList.contains('open')) widget.selectpicker('toggle');
    }
  }
  return { ok: true, changed };
}

export async function syncBillingSelect(payload, sender) {
  const url = new URL(sender?.url || 'https://invalid.local');
  const billingId = String(payload?.billingId || '');
  if (!Number.isInteger(sender?.tab?.id) || (sender.frameId != null && sender.frameId !== 0)
      || url.protocol !== 'https:' || !['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(url.hostname)
      || url.searchParams.get('a') !== 'dopdata' || url.searchParams.get('id') !== billingId) return { ok: false };
  const results = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [0] }, world: 'MAIN',
    func: syncBillingOltWidget, args: [billingId, String(payload?.value || ''), String(payload?.oltIp || '')]
  });
  return results[0]?.result || { ok: false };
}
