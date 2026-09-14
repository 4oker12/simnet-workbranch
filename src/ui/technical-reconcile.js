(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;
  const id = 'simnet-tmc-technical-reconcile';
  const labels = { olt: 'OLT IP', onuMac: 'ONU MAC', onuSerial: 'Serial' };
  const valueOf = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
  let message = '';
  let applying = false;

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
    const anchor = ctx.parsed.controls.olt || ctx.parsed.controls.onuSerial;
    if (!anchor) return;
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      box.dataset.simnetWbOwned = '1';
      box.style.cssText = 'display:flex;align-items:center;gap:8px;margin:5px 0;font:12px sans-serif';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Подставить из ТМЦ';
      button.style.cssText = 'padding:4px 9px;border:1px solid #a50046;border-radius:4px;background:#a50046;color:#fff;cursor:pointer;font:12px sans-serif';
      button.addEventListener('click', apply);
      box.append(button, document.createElement('div'));
      anchor.insertAdjacentElement('afterend', box);
    }
    const fields = ctx.plan.changes.map(item => labels[item.field]);
    const button = box.querySelector('button');
    button.disabled = applying || !fields.length;
    button.style.opacity = button.disabled ? '.55' : '1';
    button.title = fields.length ? `Изменятся только: ${fields.join(', ')}. Сохранение — штатной кнопкой Billing.` : 'Совпадающие поля не перезаписываются';
    box.lastElementChild.textContent = message || (ctx.plan.unavailable.length
      ? `Не найдено: ${ctx.plan.unavailable.map(field => labels[field]).join(', ')}`
      : fields.length ? fields.join(', ') : 'Совпадает');
  }

  async function apply() {
    if (applying) return;
    // Re-read both case identity and live controls at the actual click.
    const ctx = context();
    if (!ctx) { sync(); return; }
    applying = true;
    sync();
    for (const { control, value } of ctx.plan.changes) {
      control.value = value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const olt = ctx.parsed.controls.olt;
    let widgetFailed = false;
    if (olt && !olt.multiple) {
      olt.size = 1;
      olt.blur();
      try {
        const response = await chrome.runtime.sendMessage({ type: 'BILLING_SELECT_SYNC', payload: {
          billingId: String(valueOf(ctx.current.identity.billingId)), value: olt.value
        } });
        widgetFailed = response?.success !== true || response?.data?.ok !== true;
      } catch { widgetFailed = true; }
    }
    message = ctx.plan.changes.length
      ? `Подставлено: ${ctx.plan.changes.map(item => labels[item.field]).join(', ')}. Нажмите штатную кнопку «Сохранить» в Billing.`
      : 'Нет доступных изменений.';
    if (ctx.plan.unavailable.length) message += ` Не подставлено: ${ctx.plan.unavailable.map(field => labels[field]).join(', ')}.`;
    if (widgetFailed) message += ' Проверьте отображение выбранной OLT.';
    applying = false;
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
  document.addEventListener('input', event => {
    if (!applying && event.target?.matches?.('[name="dopfield_19"],[name="dopfield_38"]')) { message = ''; sync(); }
  });
  sync();
})();
