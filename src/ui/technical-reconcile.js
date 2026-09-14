(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;
  const id = 'simnet-tmc-technical-reconcile';
  const labels = { olt: 'OLT IP', onuMac: 'ONU MAC', onuSerial: 'Serial' };
  const valueOf = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
  let message = '';

  function context() {
    const current = WB.store?.activeCase?.();
    const page = WB.runtime?.lastContext;
    const billingId = String(valueOf(current?.identity?.billingId) || '');
    if (!current || page?.pageKind !== 'billing_technical' || !billingId
        || !/^admin\.(simnet|looknet)\.kiev\.ua$/.test(location.hostname)
        || new URLSearchParams(location.search).get('id') !== billingId) return null;
    // Never transfer evidence from another subscriber or another billing realm.
    if (current.currentContext?.url) {
      try {
        const host = new URL(current.currentContext.url).hostname;
        if (host.startsWith('admin.') && host !== location.hostname) return null;
      } catch { return null; }
    }
    const details = current.locator?.sourceStatus?.tmc?.details || {};
    if (details.identityCheck?.isMatch === false || details.matchedCurrentSubscriber === false) return null;
    const pon = current.pon || {};
    const expected = {
      oltIp: valueOf(pon.tmcOltIp) || details.oltIp || '',
      onuMac: valueOf(pon.tmcOnuMac) || details.onuMac || '',
      onuSerial: valueOf(pon.tmcOnuSerial) || details.onuSerial || ''
    };
    if (!Object.values(expected).some(Boolean)) return null;
    const parser = WB.parsers?.billing?.technical;
    if (!parser?.planTmcPatch) return null;
    const parsed = parser.parseDocument();
    return { current, parsed, plan: parser.planTmcPatch(parsed, expected) };
  }

  function sync() {
    const ctx = context();
    let box = document.getElementById(id);
    if (!ctx) { box?.remove(); return; }
    const anchor = ctx.parsed.controls.onuSerial || ctx.parsed.controls.olt;
    if (!anchor) return;
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      box.dataset.simnetWbOwned = '1';
      box.style.cssText = 'margin:8px 0;padding:8px;border:1px solid #d0d5dd;background:#fff;font:13px sans-serif';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Подставить отличия из ТМЦ';
      button.addEventListener('click', apply);
      box.append(button, document.createElement('div'));
      anchor.insertAdjacentElement('afterend', box);
    }
    const fields = ctx.plan.changes.map(item => labels[item.field]);
    box.querySelector('button').disabled = !fields.length;
    box.lastElementChild.textContent = message || [
      fields.length ? `Изменятся только: ${fields.join(', ')}. Затем нажмите «Сохранить» в Billing.` : 'Доступные данные ТМЦ совпадают.',
      ctx.plan.unavailable.length ? `Не удалось подобрать поле: ${ctx.plan.unavailable.map(field => labels[field]).join(', ')}. Для OLT нужен единственный вариант с точным IP.` : ''
    ].filter(Boolean).join(' ');
  }

  function apply() {
    // Re-read both case identity and live controls at the actual click.
    const ctx = context();
    if (!ctx) { sync(); return; }
    for (const { control, value } of ctx.plan.changes) {
      control.value = value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    message = ctx.plan.changes.length
      ? `Подставлено: ${ctx.plan.changes.map(item => labels[item.field]).join(', ')}. Нажмите штатную кнопку «Сохранить» в Billing.`
      : 'Нет доступных изменений.';
    if (ctx.plan.unavailable.length) message += ` Не подставлено: ${ctx.plan.unavailable.map(field => labels[field]).join(', ')}.`;
    WB.rail?.toast?.(message);
    sync();
  }

  WB.bus?.on?.('store:state', sync);
  WB.bus?.on?.('context:changed', () => { message = ''; sync(); });
  document.addEventListener('change', event => {
    if (event.target?.matches?.('[name="dopfield_19"],[name="dopfield_29"],[name="dopfield_38"]')) {
      message = '';
      sync();
    }
  });
  sync();
})();
