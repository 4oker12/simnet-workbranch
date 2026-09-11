(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__taskCurrentLiveRecoveryLoaded) return;
  WB.__taskCurrentLiveRecoveryLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_ACTION_RE = /^\/task\/save\/?$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BRIGADE_RE = /(?:^|\s)бр\.\s*/iu;
  const STAFF_PANEL_ATTR = 'data-simnet-wb-current-staff-transition';
  const STAFF_BYPASS_ATTR = 'data-simnet-wb-current-staff-bypass';
  const CREW_HOST_ATTR = 'data-simnet-wb-live-crew-recovery';
  const CREW_INPUT_ATTR = 'data-simnet-wb-recovery-crew-input';
  const MODAL_ID = 'simnet-wb-live-special-recovery';
  const STYLE_ID = 'simnet-wb-live-recovery-style';
  const AUDIT_KEY = 'simnet_crm_constraint_ack_v1';
  const MAX_AUDIT = 500;
  const MAX_ACTIONABLE = 3;

  const stateByForm = new WeakMap();
  const replayBypass = new WeakSet();
  let documentObserver = null;

  const compact = (value, max = 4000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 5000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9]+/giu, ' ').trim();

  function log(level, event, details = {}) {
    try {
      const method = WB.log?.[level];
      if (typeof method === 'function') return method.call(WB.log, 'TASK_FLOW', event, details);
    } catch {}
    try {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
      fn(`[SIMNET WB][TASK_FLOW] ${event}`, details);
    } catch {}
    return null;
  }

  function isTaskForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    try { return FORM_ACTION_RE.test(new URL(String(form.action || location.href), location.href).pathname); }
    catch { return false; }
  }

  function getState(form) {
    let state = stateByForm.get(form);
    if (state) return state;
    state = {
      resolvedBuildingUuid: '',
      resolveSignature: '',
      resolvePromise: null,
      infoRows: [],
      crewSignature: '',
      crewPromise: null,
      approvedSignature: ''
    };
    stateByForm.set(form, state);
    return state;
  }

  function taskTypeUuid(form) {
    return String(
      form.querySelector('select[name="task_type_uuid"]')?.value
      || form.querySelector('input[name="task_type_uuid"]')?.value
      || form.querySelector('#taskTypeId')?.value
      || ''
    ).trim();
  }

  function directBuildingUuid(form) {
    const fields = [
      form.querySelector('input[name="building_uuidtask_address"]'),
      form.querySelector('#buildingUuidtask_addressHidden'),
      form.querySelector('#buildingUuidtask_address'),
      form.querySelector('input[name="building_uuid"]'),
      form.querySelector('[id*="buildingUuid"]')
    ];
    for (const field of fields) {
      const value = String(field?.value || field?.dataset?.buildingUuid || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    const customer = form.querySelector('select[name="customer_uuid"]');
    const fromCustomer = String(customer?.selectedOptions?.[0]?.dataset?.buildingUuid || '').trim();
    return UUID_RE.test(fromCustomer) ? fromCustomer : '';
  }

  function addressUnitUuid(form) {
    const selects = Array.from(form.querySelectorAll('select[name="address_unit_selectortask_address[]"]'));
    for (let i = selects.length - 1; i >= 0; i -= 1) {
      const value = String(selects[i]?.value || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    const hidden = String(form.querySelector('input[name="address_unit_uuid"], input[name="unit_uuid"]')?.value || '').trim();
    return UUID_RE.test(hidden) ? hidden : '';
  }

  function customerUuid(form) {
    const value = String(form.querySelector('select[name="customer_uuid"]')?.value || form.querySelector('input[name="customer_uuid"]')?.value || '').trim();
    return UUID_RE.test(value) ? value : '';
  }

  function dateValue(form) {
    return compact(form.querySelector('#datedo_id, input[name="datedo"], input[name="date"]')?.value || '', 32);
  }

  function hourValue(form) {
    return compact(form.querySelector('#timedo_id, select[name="timedo"], input[name="timedo"], input[name="time"]')?.value || '', 8);
  }

  function currentAddress(form) {
    const direct = compact(form.querySelector('#fastSearchInputtask_address, #inputAddressFastFindtask_addressId')?.value || '', 320);
    if (direct) return direct;
    const building = form.querySelector('#buildingUuidtask_address');
    const buildingText = compact(building?.selectedOptions?.[0]?.textContent || '', 320);
    if (buildingText) return buildingText;
    const parts = Array.from(form.querySelectorAll('select[name="address_unit_selectortask_address[]"]'))
      .map(select => compact(select.selectedOptions?.[0]?.textContent || '', 120))
      .filter(Boolean)
      .filter(text => !/^[-—]?$/.test(text));
    if (parts.length) return compact(parts.join(' → '), 320);
    const customer = form.querySelector('select[name="customer_uuid"]');
    return compact(customer?.selectedOptions?.[0]?.getAttribute('title') || '', 420) || 'Текущий адрес заявки';
  }

  function parseBuildingUuidFromScripts(root) {
    if (!root?.querySelectorAll) return '';
    const scripts = Array.from(root.querySelectorAll('script')).reverse();
    for (const script of scripts) {
      const text = String(script.textContent || '');
      const match = text.match(/lastBuildingSelectorValue\s*\[\s*["']task_address["']\s*\]\s*=\s*["']([0-9a-f-]{36})["']/i);
      if (match && UUID_RE.test(match[1])) return match[1];
    }
    return '';
  }

  function noteRowsFrom(root) {
    if (!root?.querySelector) return [];
    const rows = [];
    const seen = new Set();
    for (const [selector, label] of [
      ['#buildingTaskCommentId', 'Рабочая заметка дома'],
      ['#buildingTaskInfoId', 'Заметки дома']
    ]) {
      const text = compact(root.querySelector(selector)?.textContent || '', 5000);
      const key = fold(text);
      if (!text || key.length < 4 || seen.has(key)) continue;
      seen.add(key);
      rows.push({ key: selector.slice(1), label, text });
    }
    if (!rows.length) {
      const container = root.querySelector('#buildingWorkDescriptionId');
      const clone = container?.cloneNode?.(true);
      clone?.querySelectorAll?.('script,style,#buildingTimeIntervalId').forEach(node => node.remove());
      const text = compact(clone?.textContent || '', 5000);
      if (text && fold(text).length >= 4) rows.push({ key: 'buildingWorkDescriptionId', label: 'Информация по дому', text });
    }
    return rows;
  }

  function mergeRows(...groups) {
    const out = [];
    const seen = new Set();
    for (const rows of groups) {
      for (const row of rows || []) {
        const key = fold(row?.text || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out;
  }

  function phoneDigits(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('38')) return digits.slice(2);
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    return '';
  }

  function formatPhone(raw) {
    const digits = phoneDigits(raw);
    if (!digits) return compact(raw, 32);
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  }

  function extractPhones(text) {
    const matches = String(text || '').match(/(?:\+?38\s*)?0\d{2}(?:[\s()\-]*\d){7}/gu) || [];
    const out = [];
    const seen = new Set();
    for (const raw of matches) {
      const digits = phoneDigits(raw);
      if (!digits || seen.has(digits)) continue;
      seen.add(digits);
      out.push({ raw, digits, formatted: formatPhone(raw), index: String(text).indexOf(raw) });
    }
    return out;
  }

  function findContactName(text, phone) {
    const source = String(text || '');
    const idx = Number(phone?.index ?? -1);
    if (idx < 0) return '';
    const before = source.slice(Math.max(0, idx - 55), idx);
    const after = source.slice(idx + String(phone.raw || '').length, idx + String(phone.raw || '').length + 55);
    const stop = /^(?:мастер|диспетчер|бухгалтерия|начальник|жека|жек|осбб|ключи|ключ|тел|телефон|звонить|набирать)$/iu;
    const afterWords = after.match(/[А-ЯЁІЇЄ][а-яёіїєґ]{2,}/gu) || [];
    for (const word of afterWords) if (!stop.test(word)) return word;
    const beforeWords = before.match(/[А-ЯЁІЇЄ][а-яёіїєґ]{2,}/gu) || [];
    for (let i = beforeWords.length - 1; i >= 0; i -= 1) if (!stop.test(beforeWords[i])) return beforeWords[i];
    return '';
  }

  function formatClock(hour, minute = '00') {
    const h = Math.max(0, Math.min(23, Number(hour)));
    const m = Math.max(0, Math.min(59, Number(minute || 0)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function addActionItem(items, item) {
    if (!item?.text) return;
    const key = `${item.type}|${fold(item.text)}`;
    if (items.some(existing => `${existing.type}|${fold(existing.text)}` === key)) return;
    items.push({
      type: item.type || 'operational',
      severity: item.severity === 'critical' ? 'critical' : 'warning',
      title: compact(item.title || 'Важно перед сохранением', 100),
      text: compact(item.text, 500),
      sourceKeys: Array.isArray(item.sourceKeys) ? item.sourceKeys : []
    });
  }

  function interpretSpecialInfo(rows) {
    const rawRows = mergeRows(rows);
    const sourceKeys = rawRows.map(row => row.key);
    const raw = compact(rawRows.map(row => row.text).join(' • '), 12000);
    const normalized = fold(raw);
    const items = [];

    if (!normalized) return [];

    const entranceBlock = raw.match(/(?:перв\w*|1\s*[-–]?\s*(?:й|ый|ий)?)[^.!?]{0,45}(?:подъезд|під.?їзд)[^.!?]{0,60}(?:не\s*(?:подключ|підключ)|не\s*включ)/iu);
    if (entranceBlock) {
      addActionItem(items, {
        type: 'entrance_scope', severity: 'critical', title: 'Ограничение подключения',
        text: '1-й подъезд не подключаем. Проверь адрес/подъезд до сохранения заявки.', sourceKeys
      });
    }

    const capacityBlocked = /(?:труб\w*|канал\w*|бокс\w*|стояк\w*)[^.!?]{0,45}(?:забит|зайнят|занят|переполн|нет\s+мест|нема\s+місц)/iu.test(raw);
    const connectionBlocked = /(?:нет|нема|відсутн\w*)\s+(?:технич\w*\s+)?(?:возможност|можливост)[^.!?]{0,80}(?:подключ|підключ|включ)|(?:не\s*(?:подключаем|підключаємо|подключать|підключати))|комунікац\w*[^.!?]{0,35}замурован/iu.test(raw);
    if (capacityBlocked || connectionBlocked) {
      addActionItem(items, {
        type: capacityBlocked ? 'infrastructure_capacity' : 'connection_block',
        severity: 'critical', title: 'Ограничение подключения',
        text: capacityBlocked
          ? 'Каналы/трубки/боксы заняты или забиты — подключение может быть невозможно. Проверь возможность до оформления.'
          : 'По дому есть ограничение или запрет на подключение. Проверь возможность до оформления заявки.',
        sourceKeys
      });
    }

    const speed = raw.match(/(?:не\s+более|макс(?:имум)?|до)\s*(\d{2,4})\s*(?:мбит|мб\/с|mbit|mbps)/iu);
    if (speed) {
      addActionItem(items, {
        type: 'speed_limit', severity: 'critical', title: 'Ограничение тарифа',
        text: `Максимальная скорость по дому: ${speed[1]} Мбит/с. Проверь выбранный тариф.`, sourceKeys
      });
    }

    const requestUntil = raw.match(/заявк\w*\s+(?:только|лише)\s+до\s*(\d{1,2})(?:[:.]([0-5]\d))?/iu);
    if (requestUntil) {
      addActionItem(items, {
        type: 'access_window', severity: 'warning', title: 'Ограничение по времени',
        text: `Заявки по этому дому оформлять только до ${formatClock(requestUntil[1], requestUntil[2])}.`, sourceKeys
      });
    }

    if (/(?:в\s+выходн|у\s+вихідн)[^.!?]{0,65}ключ\w*[^.!?]{0,35}(?:не\s*(?:дают|выдают|видають)|нет|немає)/iu.test(raw)) {
      addActionItem(items, {
        type: 'access_window', severity: 'warning', title: 'Доступ к дому',
        text: 'В выходные ключи не выдают. Не ставь выезд без предварительного согласования доступа.', sourceKeys
      });
    }

    const keyReturn = raw.match(/ключ\w*[^.!?]{0,30}(?:вернуть|повернути)\s+до\s*(\d{1,2})(?:[:.]([0-5]\d))?/iu);
    if (keyReturn) {
      addActionItem(items, {
        type: 'access_window', severity: 'warning', title: 'Доступ к дому',
        text: `Ключи нужно вернуть до ${formatClock(keyReturn[1], keyReturn[2])}.`, sourceKeys
      });
    }

    const accessSignal = /ключ|доступ|договар|согласов|узгод|предупред|поперед|звонить|дзвонити|набирать|подготов\w*\s+ключ|тамбур|щитк\w*\s+закрыт|тех.?этаж\w*\s+закрыт/iu.test(raw);
    const phones = extractPhones(raw);
    if (accessSignal && phones.length) {
      const phone = phones[0];
      const name = findContactName(raw, phone);
      const range = raw.match(/(?:звонить|дзвонити|набирать)[^0-9]{0,20}(?:с|з)\s*(\d{1,2})(?::([0-5]\d))?\s*(?:-|–|до)\s*(\d{1,2})(?::([0-5]\d))?/iu);
      const prepareKeys = /(?:заранее|заздалегідь|утром|вранці)[^.!?]{0,60}(?:подготов\w*|підгот\w*)[^.!?]{0,35}ключ|(?:подготов\w*|підгот\w*)[^.!?]{0,35}ключ/iu.test(raw);
      const agree = /договар|согласов|узгод|набирать|звонить|дзвонити|предупред|поперед/iu.test(raw);
      let text = name
        ? `Перед выездом ${agree ? 'согласовать доступ' : 'связаться'} с ${name} — ${phone.formatted}.`
        : `Перед выездом ${agree ? 'согласовать доступ' : 'связаться'}: ${phone.formatted}.`;
      if (range) text += ` Звонить ${formatClock(range[1], range[2])}–${formatClock(range[3], range[4])}.`;
      if (prepareKeys) text += ' Позвонить заранее, чтобы подготовили ключи.';
      addActionItem(items, { type: 'access_coordination', severity: 'warning', title: 'Доступ к дому', text, sourceKeys });
    } else if (accessSignal && /ключ/iu.test(raw) && /(?:взять|получить|забрать|у\s+[А-ЯЁІЇЄ]|ключ\s+в\s+кв|ключ\s+у|ключі\s+у)/u.test(raw)) {
      addActionItem(items, {
        type: 'access_coordination', severity: 'warning', title: 'Доступ к дому',
        text: 'Для доступа нужны ключи. Проверь, где и у кого их получить, до назначения выезда.', sourceKeys
      });
    }

    if (/(?:предупред|поперед)[^.!?]{0,55}(?:осбб|жек|жек|управля|керуюч)|(?:абонент|клиент)[^.!?]{0,55}(?:открыть|відкрити)[^.!?]{0,35}(?:тамбур|двер|доступ)/iu.test(raw)) {
      addActionItem(items, {
        type: 'precondition', severity: 'warning', title: 'Перед выездом',
        text: 'Нужно заранее согласовать доступ/предупредить ответственную сторону. Проверь это до сохранения заявки.', sourceKeys
      });
    }

    const noTv = /(?:без\s+(?:тв|tv|ктв)|тв\s+не\s+подключ)/iu.test(raw);
    const onlyTech = /(?:только|лише)\s+(?:по\s+)?(?:gpon|pon|epon|вит\w*\s+пар|ethernet)/iu.test(raw);
    if (noTv || onlyTech) {
      const parts = [];
      if (onlyTech) parts.push('Есть ограничение по технологии подключения.');
      if (noTv) parts.push('ТВ по этому подключению не предоставляется.');
      addActionItem(items, {
        type: 'technology_restriction', severity: 'warning', title: 'Условия подключения',
        text: `${parts.join(' ')} Проверь выбранную услугу перед оформлением.`, sourceKeys
      });
    }

    const rank = { critical: 0, warning: 1 };
    return items
      .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
      .slice(0, MAX_ACTIONABLE);
  }

  async function resolveAddressContext(form, reason = 'resolve') {
    if (!isTaskForm(form)) return { buildingUuid: '', rows: [] };
    const state = getState(form);
    const typeUuid = taskTypeUuid(form);
    const unitUuid = addressUnitUuid(form);
    const direct = directBuildingUuid(form);
    const scriptBuilding = parseBuildingUuidFromScripts(document);
    const domRows = noteRowsFrom(document);
    const signature = `${typeUuid}|${direct}|${unitUuid}|${scriptBuilding}`;

    if (UUID_RE.test(direct)) {
      state.resolvedBuildingUuid = direct;
      state.infoRows = mergeRows(domRows, state.infoRows);
      state.resolveSignature = signature;
      return { buildingUuid: direct, rows: state.infoRows };
    }
    if (UUID_RE.test(scriptBuilding)) {
      state.resolvedBuildingUuid = scriptBuilding;
      state.infoRows = mergeRows(domRows, state.infoRows);
      state.resolveSignature = signature;
      return { buildingUuid: scriptBuilding, rows: state.infoRows };
    }
    if (!UUID_RE.test(typeUuid) || !UUID_RE.test(unitUuid)) {
      state.infoRows = mergeRows(domRows, state.infoRows);
      return { buildingUuid: state.resolvedBuildingUuid, rows: state.infoRows };
    }
    if (state.resolvePromise && state.resolveSignature === signature) return state.resolvePromise;
    if (state.resolveSignature === signature && UUID_RE.test(state.resolvedBuildingUuid)) {
      return { buildingUuid: state.resolvedBuildingUuid, rows: mergeRows(domRows, state.infoRows) };
    }

    state.resolveSignature = signature;
    log('info', 'address_context_resolve_start', { reason, taskTypeUuid: typeUuid, addressUnitUuid: unitUuid, address: currentAddress(form), domNoteCount: domRows.length });
    state.resolvePromise = (async () => {
      try {
        const url = new URL('/task/load_building_work_description', location.origin);
        url.searchParams.set('unit_uuid', unitUuid);
        url.searchParams.set('task_type_uuid', typeUuid);
        const response = await fetch(url.toString(), { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const resolved = parseBuildingUuidFromScripts(doc);
        const remoteRows = noteRowsFrom(doc);
        if (UUID_RE.test(resolved)) state.resolvedBuildingUuid = resolved;
        state.infoRows = mergeRows(domRows, remoteRows, state.infoRows);
        log('info', 'address_context_resolve_result', {
          reason, taskTypeUuid: typeUuid, addressUnitUuid: unitUuid,
          buildingUuid: state.resolvedBuildingUuid, remoteNoteCount: remoteRows.length, noteCount: state.infoRows.length
        });
        return { buildingUuid: state.resolvedBuildingUuid, rows: state.infoRows };
      } catch (error) {
        state.infoRows = mergeRows(domRows, state.infoRows);
        log('warn', 'address_context_resolve_failed', { reason, taskTypeUuid: typeUuid, addressUnitUuid: unitUuid, message: compact(error?.message || error, 180) });
        return { buildingUuid: state.resolvedBuildingUuid, rows: state.infoRows };
      } finally {
        state.resolvePromise = null;
      }
    })();
    return state.resolvePromise;
  }

  function nativeBrigadeInputs(form) {
    return Array.from(form.querySelectorAll('input[name^="division_auto_task_staffuuid"], input[name^="division_task_staffuuid"]'))
      .filter(input => !input.hasAttribute(CREW_INPUT_ATTR))
      .filter(input => BRIGADE_RE.test(compact(input.closest('.div_space2,label,.item,.erp-object-props__value')?.textContent || input.parentElement?.textContent || '', 180)));
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.simnetWbOwned = '1';
    style.textContent = `
      [${CREW_HOST_ATTR}]{margin-top:7px;padding-top:7px;border-top:1px solid #d8e1e8;color:#40505e;font:12px/1.35 Arial,sans-serif}
      [${CREW_HOST_ATTR}] .wb-live-crew-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      [${CREW_HOST_ATTR}] label{font-weight:600;color:#4a6070}
      [${CREW_HOST_ATTR}] select{min-width:260px;max-width:100%;height:26px;border:1px solid #aebdca;border-radius:3px;background:#fff;color:#40505e;padding:2px 24px 2px 6px;font:12px Arial,sans-serif}
      [${CREW_HOST_ATTR}] .wb-live-crew-hint{margin-top:4px;color:#687783;font-size:11px}
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:18px;background:rgba(38,49,59,.34);font-family:Arial,sans-serif}
      #${MODAL_ID} .wb-live-card{box-sizing:border-box;width:min(620px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 36px));overflow:auto;background:#fff;border:1px solid #c6d2dc;border-radius:3px;box-shadow:0 10px 30px rgba(40,55,70,.24);color:#111}
      #${MODAL_ID} .wb-live-head{padding:10px 12px 8px;border-bottom:1px solid #d8e1e8;background:#f3f6f8}
      #${MODAL_ID} .wb-live-title{font-size:14px;font-weight:700;color:#111}
      #${MODAL_ID} .wb-live-address{margin-top:3px;font-size:11px;color:#687783}
      #${MODAL_ID} .wb-live-body{padding:10px 12px}
      #${MODAL_ID} .wb-live-note{margin-bottom:7px;font-size:11px;color:#65737e}
      #${MODAL_ID} .wb-live-item{padding:8px 9px;margin:6px 0;border:1px solid #d8e1e8;border-left:4px solid #c18b3b;border-radius:3px;background:#fffdf7}
      #${MODAL_ID} .wb-live-item[data-severity="critical"]{border-left-color:#b42318;background:#fff8f7}
      #${MODAL_ID} .wb-live-item-title{font-size:12px;font-weight:800;color:#111}
      #${MODAL_ID} .wb-live-item-text{margin-top:3px;font-size:12px;line-height:1.4;font-weight:700;color:#111;white-space:pre-wrap}
      #${MODAL_ID} .wb-live-checks{display:grid;gap:6px;margin-top:9px;padding:8px;border:1px solid #d8e1e8;border-radius:3px;background:#f7f9fb}
      #${MODAL_ID} .wb-live-checks label{display:flex;gap:7px;align-items:flex-start;font-size:11px;line-height:1.35;color:#33414c}
      #${MODAL_ID} .wb-live-foot{display:flex;gap:7px;justify-content:flex-end;padding:8px 12px 10px;border-top:1px solid #d8e1e8;background:#f8fafb}
      #${MODAL_ID} button{border-radius:3px;padding:5px 9px;font:600 11px/1.2 Arial,sans-serif;cursor:pointer}
      #${MODAL_ID} .wb-live-cancel{border:1px solid #aebdca;background:#fff;color:#405a70}
      #${MODAL_ID} .wb-live-confirm{border:1px solid #3f6f93;background:#4c7da1;color:#fff}
      #${MODAL_ID} .wb-live-confirm[disabled]{opacity:.45;cursor:default}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearSyntheticCrew(form) {
    form.querySelectorAll(`[${CREW_INPUT_ATTR}]`).forEach(node => node.remove());
  }

  function setSyntheticCrew(form, uuid, label) {
    clearSyntheticCrew(form);
    if (!UUID_RE.test(uuid)) return;
    const holder = document.createElement('label');
    holder.hidden = true;
    holder.textContent = label || uuid;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'division_auto_task_staffuuids[]';
    input.value = uuid;
    input.checked = true;
    input.setAttribute(CREW_INPUT_ATTR, '1');
    holder.prepend(input);
    form.appendChild(holder);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderCrewPicker(form, crews, hint = '') {
    const panel = form.querySelector(`[${STAFF_PANEL_ATTR}]`);
    if (!panel || panel.hidden || nativeBrigadeInputs(form).length) {
      panel?.querySelector?.(`[${CREW_HOST_ATTR}]`)?.remove();
      if (nativeBrigadeInputs(form).length) clearSyntheticCrew(form);
      return;
    }
    ensureStyles();
    let host = panel.querySelector(`[${CREW_HOST_ATTR}]`);
    if (!host) {
      host = document.createElement('div');
      host.setAttribute(CREW_HOST_ATTR, '1');
      host.innerHTML = '<div class="wb-live-crew-row"><label>Бригада</label><select data-wb-live-crew-select="1"><option value="">— выбрать бригаду —</option></select></div><div class="wb-live-crew-hint"></div>';
      panel.appendChild(host);
      host.querySelector('select')?.addEventListener('change', event => {
        const select = event.currentTarget;
        const option = select.selectedOptions?.[0];
        setSyntheticCrew(form, String(select.value || ''), compact(option?.textContent || '', 180));
        log('info', 'crew_recovery_selected', { taskTypeUuid: taskTypeUuid(form), crewUuid: select.value, crewLabel: compact(option?.textContent || '', 180) });
      });
    }
    const select = host.querySelector('select');
    const current = String(form.querySelector(`[${CREW_INPUT_ATTR}]`)?.value || '');
    select.innerHTML = '<option value="">— выбрать бригаду —</option>';
    for (const crew of crews || []) {
      const option = document.createElement('option');
      option.value = crew.uuid;
      option.textContent = crew.label;
      option.selected = crew.uuid === current;
      select.appendChild(option);
    }
    host.querySelector('.wb-live-crew-hint').textContent = hint || ((crews || []).length ? 'Список загружен из текущего UserSide.' : 'Бригады пока не загружены.');
  }

  async function refreshCrews(form, reason = 'refresh') {
    if (!isTaskForm(form)) return [];
    const panel = form.querySelector(`[${STAFF_PANEL_ATTR}]`);
    if (!panel || panel.hidden) return [];
    if (nativeBrigadeInputs(form).length) {
      renderCrewPicker(form, []);
      return [];
    }

    const typeUuid = taskTypeUuid(form);
    const date = dateValue(form);
    const time = hourValue(form);
    if (!UUID_RE.test(typeUuid) || !date || !time) {
      renderCrewPicker(form, [], 'Сначала укажи дату и время выезда.');
      return [];
    }

    renderCrewPicker(form, [], 'Загружаю доступные бригады…');
    const context = await resolveAddressContext(form, `crew:${reason}`);
    const bUuid = context.buildingUuid;
    if (!UUID_RE.test(bUuid)) {
      log('warn', 'crew_recovery_context_missing', { reason, taskTypeUuid: typeUuid, addressUnitUuid: addressUnitUuid(form), date, time });
      renderCrewPicker(form, [], 'Не удалось определить дом. Измени адрес или обнови форму.');
      return [];
    }

    const state = getState(form);
    const signature = [typeUuid, bUuid, customerUuid(form), date, time].join('|');
    if (state.crewPromise && state.crewSignature === signature) return state.crewPromise;
    if (state.crewSignature === signature && panel.querySelector(`[${CREW_HOST_ATTR}] select`)?.options?.length > 1) return [];
    state.crewSignature = signature;

    log('info', 'crew_recovery_load_start', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, customerUuid: customerUuid(form), date, time });
    state.crewPromise = (async () => {
      try {
        const url = new URL('/task/reload_auto_staff', location.origin);
        url.searchParams.set('task_type_uuid', typeUuid);
        url.searchParams.set('building_uuid', bUuid);
        const customer = customerUuid(form);
        if (customer) url.searchParams.set('customer_uuid', customer);
        url.searchParams.set('date', date);
        url.searchParams.set('time', time);
        const response = await fetch(url.toString(), { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const crews = Array.from(doc.querySelectorAll('input[name="division_auto_task_staffuuids[]"], input[name="division_task_staffuuids[]"]'))
          .map(input => ({
            uuid: String(input.value || '').trim(),
            label: compact(input.closest('.div_space2,label,.item,.erp-object-props__value')?.textContent || input.parentElement?.textContent || '', 180)
          }))
          .filter(item => UUID_RE.test(item.uuid) && BRIGADE_RE.test(item.label));
        renderCrewPicker(form, crews, crews.length ? `Доступно бригад: ${crews.length}.` : 'UserSide не вернул доступных бригад.');
        log('info', 'crew_recovery_load_result', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, crewCount: crews.length, crews: crews.slice(0, 12).map(item => item.label) });
        return crews;
      } catch (error) {
        log('warn', 'crew_recovery_load_failed', { reason, taskTypeUuid: typeUuid, buildingUuid: bUuid, message: compact(error?.message || error, 180) });
        renderCrewPicker(form, [], `Ошибка загрузки бригад: ${compact(error?.message || error, 120)}`);
        return [];
      } finally {
        state.crewPromise = null;
      }
    })();
    return state.crewPromise;
  }

  function specialSignature(form, items) {
    return `${taskTypeUuid(form)}|${getState(form).resolvedBuildingUuid}|${items.map(item => `${item.type}:${fold(item.text)}`).join('|')}`;
  }

  function writeAudit(form, rows, items) {
    try {
      chrome.storage.local.get(AUDIT_KEY, stored => {
        const current = stored?.[AUDIT_KEY];
        const entries = Array.isArray(current?.entries) ? current.entries : [];
        entries.unshift({
          id: `ack_live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          source: 'userside-live-recovery',
          buildingUuid: getState(form).resolvedBuildingUuid || directBuildingUuid(form),
          addressUnitUuid: addressUnitUuid(form),
          address: currentAddress(form),
          taskTypeUuid: taskTypeUuid(form),
          acknowledged: true,
          actionable: items.map(item => ({ type: item.type, severity: item.severity, title: item.title, text: item.text })),
          rawSources: rows.map(row => row.key),
          rawNotes: rows.map(row => compact(row.text, 800))
        });
        chrome.storage.local.set({ [AUDIT_KEY]: { ...(current || {}), schema: 'simnet-crm-constraint-ack-v1', updatedAt: new Date().toISOString(), entries: entries.slice(0, MAX_AUDIT) } });
      });
    } catch {}
  }

  function replay(form, submitter) {
    replayBypass.add(form);
    form.setAttribute(STAFF_BYPASS_ATTR, '1');
    queueMicrotask(() => {
      try {
        if (submitter instanceof HTMLElement && submitter.form === form) form.requestSubmit(submitter);
        else form.requestSubmit();
      } catch {
        try { HTMLFormElement.prototype.submit.call(form); } catch {}
      } finally {
        queueMicrotask(() => form.removeAttribute(STAFF_BYPASS_ATTR));
      }
    });
  }

  function showSpecialModal(form, rows, items, submitter) {
    document.getElementById(MODAL_ID)?.remove();
    ensureStyles();
    const state = getState(form);
    const signature = specialSignature(form, items);
    const host = document.createElement('div');
    host.id = MODAL_ID;
    host.dataset.simnetWbOwned = '1';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.innerHTML = '<section class="wb-live-card"><div class="wb-live-head"><div class="wb-live-title">Важно перед сохранением</div><div class="wb-live-address"></div></div><div class="wb-live-body"><div class="wb-live-note">Показано только то, что может повлиять на выполнение заявки.</div><div data-wb-live-items="1"></div><div class="wb-live-checks"><label><input type="checkbox" data-role="customer-warned"> <span>Абонент предупреждён / условия уже оговорены</span></label><label><input type="checkbox" data-role="ack"> <span><b>Ознакомлен.</b> Учту это при оформлении заявки.</span></label></div></div><div class="wb-live-foot"><button type="button" class="wb-live-cancel" data-action="cancel">Вернуться</button><button type="button" class="wb-live-confirm" data-action="confirm" disabled>Подтвердить и сохранить</button></div></section>';
    host.querySelector('.wb-live-address').textContent = currentAddress(form);
    const container = host.querySelector('[data-wb-live-items="1"]');
    items.slice(0, MAX_ACTIONABLE).forEach(item => {
      const node = document.createElement('div');
      node.className = 'wb-live-item';
      node.dataset.severity = item.severity;
      node.innerHTML = '<div class="wb-live-item-title"></div><div class="wb-live-item-text"></div>';
      node.querySelector('.wb-live-item-title').textContent = item.title;
      node.querySelector('.wb-live-item-text').textContent = item.text;
      container.appendChild(node);
    });
    const ack = host.querySelector('[data-role="ack"]');
    const confirm = host.querySelector('[data-action="confirm"]');
    ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });
    host.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action || '';
      if (action === 'cancel') {
        log('info', 'special_info_recovery_cancelled', { actionableCount: items.length });
        host.remove();
        return;
      }
      if (action !== 'confirm' || !ack.checked) return;
      state.approvedSignature = signature;
      writeAudit(form, rows, items);
      log('info', 'special_info_recovery_confirmed', {
        buildingUuid: state.resolvedBuildingUuid,
        actionableCount: items.length,
        actionableTypes: items.map(item => item.type)
      });
      host.remove();
      replay(form, submitter);
    });
    (document.body || document.documentElement).appendChild(host);
    log('warn', 'special_info_recovery_shown', {
      taskTypeUuid: taskTypeUuid(form), buildingUuid: state.resolvedBuildingUuid,
      address: currentAddress(form), rawNoteCount: rows.length,
      actionableCount: items.length, actionableTypes: items.map(item => item.type)
    });
  }

  async function onSubmit(event) {
    const form = isTaskForm(event.target) ? event.target : null;
    if (!form) return;
    if (replayBypass.has(form)) {
      replayBypass.delete(form);
      return;
    }
    if (event.defaultPrevented || document.getElementById('simnet-wb-current-task-special-info')) return;

    const state = getState(form);
    let rows = mergeRows(noteRowsFrom(document), state.infoRows);
    let paused = false;
    if (!rows.length || !UUID_RE.test(state.resolvedBuildingUuid)) {
      event.preventDefault();
      event.stopPropagation();
      paused = true;
      const context = await resolveAddressContext(form, 'submit-confirm');
      rows = mergeRows(noteRowsFrom(document), context.rows);
    }

    const items = interpretSpecialInfo(rows);
    log('info', 'special_info_interpreted', {
      taskTypeUuid: taskTypeUuid(form), buildingUuid: state.resolvedBuildingUuid,
      rawNoteCount: rows.length, actionableCount: items.length,
      actionableTypes: items.map(item => item.type),
      suppressedRawCount: Math.max(0, rows.length - items.length)
    });

    const signature = specialSignature(form, items);
    log('info', 'special_info_recovery_evaluated', {
      taskTypeUuid: taskTypeUuid(form), buildingUuid: state.resolvedBuildingUuid,
      rawNoteCount: rows.length, actionableCount: items.length,
      actionableTypes: items.map(item => item.type)
    });

    if (!items.length || state.approvedSignature === signature) {
      if (paused) replay(form, event.submitter || null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    showSpecialModal(form, rows, items, event.submitter || null);
  }

  function scheduleRefresh(form, reason) {
    if (!isTaskForm(form)) return;
    queueMicrotask(async () => {
      await resolveAddressContext(form, reason);
      await refreshCrews(form, reason);
    });
  }

  function resetForChange(form) {
    const state = getState(form);
    state.resolveSignature = '';
    state.crewSignature = '';
    state.approvedSignature = '';
  }

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (!isTaskForm(form)) return;
    const target = event.target;
    if (target?.matches?.('select[name="task_type_uuid"], #buildingUuidtask_address, input[name="building_uuidtask_address"], select[name="address_unit_selectortask_address[]"], select[name="customer_uuid"], #datedo_id, #timedo_id, #timedo_id2')) {
      resetForChange(form);
      scheduleRefresh(form, 'form-change');
    }
  }

  function scan(reason = 'scan') {
    document.querySelectorAll('form').forEach(form => {
      if (isTaskForm(form)) scheduleRefresh(form, reason);
    });
  }

  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  scan('init');

  documentObserver = new MutationObserver(records => {
    const relevant = records.some(record => Array.from(record.addedNodes || []).some(node => node instanceof Element && (
      node.matches?.('form,[data-simnet-wb-current-staff-transition],#buildingWorkDescriptionId')
      || node.querySelector?.('form,[data-simnet-wb-current-staff-transition],#buildingWorkDescriptionId')
    )));
    if (relevant) queueMicrotask(() => scan('dom-mutation'));
  });
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });

  WB.taskCurrentLiveRecovery = Object.freeze({
    refresh() { scan('manual-refresh'); },
    interpretSpecialInfo,
    async debug(form = null) {
      const target = isTaskForm(form) ? form : Array.from(document.querySelectorAll('form')).find(isTaskForm) || null;
      if (!target) return null;
      const context = await resolveAddressContext(target, 'debug');
      const rows = mergeRows(noteRowsFrom(document), context.rows);
      return {
        taskTypeUuid: taskTypeUuid(target),
        directBuildingUuid: directBuildingUuid(target),
        addressUnitUuid: addressUnitUuid(target),
        resolvedBuildingUuid: context.buildingUuid,
        customerUuid: customerUuid(target),
        address: currentAddress(target),
        noteRows: rows,
        actionableItems: interpretSpecialInfo(rows),
        nativeBrigadeCount: nativeBrigadeInputs(target).length,
        syntheticCrewUuid: target.querySelector(`[${CREW_INPUT_ATTR}]`)?.value || ''
      };
    },
    destroy() {
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      documentObserver?.disconnect();
      documentObserver = null;
      document.getElementById(MODAL_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      document.querySelectorAll(`[${CREW_HOST_ATTR}], [${CREW_INPUT_ATTR}]`).forEach(node => node.remove());
    }
  });
})();