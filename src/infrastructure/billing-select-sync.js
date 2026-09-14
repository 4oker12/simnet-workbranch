// Runs in the page's MAIN world so native jQuery select widgets see the update.
export function syncBillingOltWidget(billingId, expectedValue) {
  const url = new URL(location.href);
  if (!['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(url.hostname)
      || url.searchParams.get('a') !== 'dopdata' || url.searchParams.get('id') !== billingId) return { ok: false };
  const select = document.querySelector('select#dopfield_29,select[name="dopfield_29"]');
  if (!select || select.value !== expectedValue || select.multiple) return { ok: false };
  select.size = 1;
  select.blur();
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
  return { ok: true };
}

export async function syncBillingSelect(payload, sender) {
  const url = new URL(sender?.url || 'https://invalid.local');
  const billingId = String(payload?.billingId || '');
  if (!Number.isInteger(sender?.tab?.id) || (sender.frameId != null && sender.frameId !== 0)
      || url.protocol !== 'https:' || !['admin.simnet.kiev.ua', 'admin.looknet.kiev.ua'].includes(url.hostname)
      || url.searchParams.get('a') !== 'dopdata' || url.searchParams.get('id') !== billingId) return { ok: false };
  const results = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [0] }, world: 'MAIN',
    func: syncBillingOltWidget, args: [billingId, String(payload?.value || '')]
  });
  return results[0]?.result || { ok: false };
}
