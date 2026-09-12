(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  const R = WB?.taskStreetOwnerRules;
  if (!WB || !R || window.top !== window.self || WB.__taskStreetOwnerContextLoaded) return;
  WB.__taskStreetOwnerContextLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const FORM_RE = /^\/task\/save\/?$/i;
  const UUID_RE = R.uuidRe;
  const FIELD_UUIDS = new Set([
    '1b34ce66-cd14-4893-a2ec-59c19bcf16dc','3496276b-010a-46ed-a2c5-534c32e8f9e2','378b0972-13b7-4df5-94f0-98ce6a37e9c0','c15aa787-6989-425a-88db-67b902c4ed2c',
    '759de9b3-3b42-4afd-a37f-d3d7f4ea5b55','947410ef-e06a-4e15-8107-cfd2b648b235','d283b923-d58b-48d8-b31f-e440f32858ca','f04549e5-5ae3-406b-84f2-069c52ad88e8',
    '1ff17c41-e4a2-4938-b68d-d9576aac8066','0a7c59e7-a6de-44a3-977f-d90c84e87e5f','c8dd5618-41ea-457d-a23d-dd018d21e77f','d5051f38-a8c6-47ab-a6d6-414a8a7acf0a',
    '614fef14-b1a1-419c-b336-21fc723dd406','cc56250e-7c49-4012-a023-f693ee9ace9c'
  ]);
  const FIELD_IDS = new Set(['1','2','3','9','10','11','12','14','15','17','18','19','26','29','34','38','42','43','50','60','61','65','66','68','126','140','144']);
  const states = new WeakMap();
  const addressStreet = new Map();
  let destroyed = false;

  const log = (level, event, details = {}) => { try { WB.log?.[level]?.('TASK_FLOW', event, details); } catch {} };

  function isTaskForm(form) {
    if (!(form instanceof HTMLFormElement)) return false;
    try { return FORM_RE.test(new URL(form.action || location.href, location.href).pathname); } catch { return false; }
  }

  function taskType(form) {
    return String(
      form.querySelector('select[name="task_type_uuid"]')?.value
      || form.querySelector('input[name="task_type_uuid"]')?.value
      || form.querySelector('#taskTypeId')?.value
      || form.querySelector('select[name="typer"]')?.value
      || form.querySelector('input[name="typer"]')?.value
      || ''
    ).trim();
  }

  function isFieldVisit(form) {
    const type = taskType(form);
    const live = WB.taskCurrentContractGuard?.fieldVisitUuids;
    if (Array.isArray(live) && live.includes(type)) return true;
    if (FIELD_UUIDS.has(type) || FIELD_IDS.has(type)) return true;
    try { return Boolean(WB.taskFormAssistant?.probe?.(form)?.fieldVisit); } catch { return false; }
  }

  function selectedAddress(form) {
    return [...form.querySelectorAll('select[name^="address_unit_selectortask_address"]')]
      .map(s => ({ uuid:String(s.value || '').trim(), label:R.compact(s.selectedOptions?.[0]?.textContent || '', 320) }))
      .filter(x => UUID_RE.test(x.uuid));
  }

  function buildingUuid(form) {
    for (const sel of ['input[name="building_uuidtask_address"]','#buildingUuidtask_addressHidden','#buildingUuidtask_address','input[name="building_uuid"]']) {
      const f = form.querySelector(sel);
      const value = String(f?.value || f?.dataset?.buildingUuid || '').trim();
      if (UUID_RE.test(value)) return value;
    }
    return '';
  }

  function buildingId(form) {
    for (const el of form.querySelectorAll('[id^="buildingId"],[name="building_id"],[data-building-id]')) {
      for (const raw of [el.value, el.dataset?.buildingId]) {
        const v = String(raw || '').trim();
        if (/^\d+$/.test(v) && Number(v) > 0) return v;
      }
    }
    return '';
  }

  function snapshot(form) {
    const items = selectedAddress(form);
    const street = R.resolveStreetSelection(items);
    const unitUuid = items.at(-1)?.uuid || String(form.querySelector('input[name="address_unit_uuid"],input[name="unit_uuid"]')?.value || '').trim();
    const bUuid = buildingUuid(form);
    const cacheKey = UUID_RE.test(unitUuid) ? `unit:${unitUuid}` : UUID_RE.test(bUuid) ? `building:${bUuid}` : '';
    const recovered = cacheKey ? addressStreet.get(cacheKey) : null;
    return {
      streetUuid: street.streetUuid || recovered?.streetUuid || '',
      streetName: street.streetName || recovered?.streetName || '',
      streetSource: street.streetUuid ? street.source : recovered ? recovered.source || 'address-cache' : 'unresolved',
      unitUuid: UUID_RE.test(unitUuid) ? unitUuid : '',
      buildingUuid: bUuid,
      buildingId: buildingId(form),
      taskTypeUuid: taskType(form)
    };
  }

  const keyOf = s => JSON.stringify([s.streetUuid,s.unitUuid,s.buildingUuid,s.buildingId,s.taskTypeUuid]);

  function getState(form) {
    let s = states.get(form);
    if (!s) {
      s = { key:'', streetUuid:'', status:'idle', context:null, promise:null, token:0 };
      states.set(form, s);
    }
    return s;
  }

  async function getHtml(url, xhr = false) {
    const response = await fetch(url, {
      method:'GET',
      credentials:'same-origin',
      cache:'no-store',
      headers:xhr ? {'X-Requested-With':'XMLHttpRequest'} : undefined
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} · ${new URL(url, location.origin).pathname}`);
    return response.text();
  }

  function buildingIdentity(doc, html = '') {
    let id = '';
    let uuid = '';
    for (const el of doc?.querySelectorAll?.('a[href],form[action]') || []) {
      const raw = String(el.getAttribute('href') || el.getAttribute('action') || '');
      const n = raw.match(/^\/building\/(\d+)(?:[/?#]|$)/i);
      if (n && !id) id = n[1];
      const u = raw.match(/^\/building\/([0-9a-f-]{36})(?:[/?#]|$)/i);
      if (u && UUID_RE.test(u[1]) && !uuid) uuid = u[1];
    }
    if (!uuid) {
      const m = String(html).match(/lastBuildingSelectorValue\s*\[\s*["']task_address["']\s*\]\s*=\s*["']([0-9a-f-]{36})["']/i);
      if (m && UUID_RE.test(m[1])) uuid = m[1];
    }
    if (!id) id = String(html).match(/(?:href|action)=["']\/building\/(\d+)(?:[/?#"'])/i)?.[1] || '';
    return { id, uuid };
  }

  async function resolveBuilding(source) {
    let id = /^\d+$/.test(String(source.buildingId || '')) ? String(source.buildingId) : '';
    let uuid = UUID_RE.test(source.buildingUuid) ? source.buildingUuid : '';

    if (!id && UUID_RE.test(source.unitUuid) && UUID_RE.test(source.taskTypeUuid)) {
      const url = new URL('/task/load_building_work_description', location.origin);
      url.searchParams.set('unit_uuid', source.unitUuid);
      url.searchParams.set('task_type_uuid', source.taskTypeUuid);
      const html = await getHtml(url.toString(), true);
      const found = buildingIdentity(new DOMParser().parseFromString(html, 'text/html'), html);
      id = found.id || id;
      uuid = found.uuid || uuid;
    }

    if (!id && UUID_RE.test(uuid)) {
      const html = await getHtml(`/building/${encodeURIComponent(uuid)}/building_level`);
      id = buildingIdentity(new DOMParser().parseFromString(html, 'text/html'), html).id;
    }

    return { id, uuid };
  }

  function addressUnitFromBuildingCard(doc, html = '') {
    for (const anchor of doc?.querySelectorAll?.('a[href*="/settings_address/address_unit_dialog_add_edit"]') || []) {
      const raw = String(anchor.getAttribute('href') || '');
      try {
        const uuid = new URL(raw, location.origin).searchParams.get('uuid') || '';
        if (UUID_RE.test(uuid)) return uuid;
      } catch {}
    }
    const match = String(html).match(/\/settings_address\/address_unit_dialog_add_edit\?[^"'<>]*?uuid=([0-9a-f-]{36})/i)
      || String(html).match(/\/settings_address\/address_unit_dialog_add_edit\?uuid=([0-9a-f-]{36})/i);
    return match && UUID_RE.test(match[1]) ? match[1] : '';
  }

  async function complete(source) {
    const building = await resolveBuilding(source);
    if (!building.id) throw new Error('Не удалось определить ID выбранного дома');

    const html = await getHtml(`/building/${encodeURIComponent(building.id)}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cardOwners = R.parseOwnersDocument(doc);
    const addressUnitUuid = addressUnitFromBuildingCard(doc, html);

    // Current CREATE form exposes only buildingUuid. The read-only building card is the proven source
    // for both the owner row and the native address-unit UUID used by UserSide itself.
    const contextUuid = UUID_RE.test(addressUnitUuid)
      ? addressUnitUuid
      : UUID_RE.test(building.uuid)
        ? building.uuid
        : UUID_RE.test(source.buildingUuid)
          ? source.buildingUuid
          : '';
    if (!UUID_RE.test(contextUuid)) throw new Error('Не удалось определить адресный UUID выбранного дома');

    const result = {
      ...source,
      buildingId: building.id,
      buildingUuid: building.uuid || source.buildingUuid,
      streetUuid: contextUuid,
      streetName: source.streetName || '',
      streetSource: UUID_RE.test(addressUnitUuid) ? 'building-card-address-unit' : 'building-uuid-fallback',
      cardOwners
    };

    const mapped = { streetUuid:result.streetUuid, streetName:result.streetName, source:result.streetSource };
    if (UUID_RE.test(result.unitUuid)) addressStreet.set(`unit:${result.unitUuid}`, mapped);
    if (UUID_RE.test(result.buildingUuid)) addressStreet.set(`building:${result.buildingUuid}`, mapped);
    return result;
  }

  async function loadMetadata(streetUuid, source) {
    let owners = Array.isArray(source.cardOwners) ? source.cardOwners : [];
    let building = { id:source.buildingId || '', uuid:source.buildingUuid || '' };

    if (!owners.length) {
      building = source.buildingId ? building : await resolveBuilding(source);
      if (!building.id) throw new Error('Не удалось определить ID выбранного дома');
      const html = await getHtml(`/building/${encodeURIComponent(building.id)}`);
      owners = R.parseOwnersDocument(new DOMParser().parseFromString(html, 'text/html'));
    }

    const rule = R.classifyTerritory(owners);
    return {
      status:'ready',
      streetUuid,
      streetName:source.streetName || '',
      owners,
      territory:rule.territory,
      requiredCrew:rule.requiredCrew,
      source:'building-card-owner',
      buildingId:String(building.id || source.buildingId || ''),
      buildingUuid:String(building.uuid || source.buildingUuid || '')
    };
  }

  const cache = R.createStreetContextCache(loadMetadata);

  async function ensureResolved(form, reason = 'refresh', { retryError = false } = {}) {
    if (!isTaskForm(form) || !isFieldVisit(form)) return null;
    let source = snapshot(form);
    const hasAddress = UUID_RE.test(source.streetUuid)
      || UUID_RE.test(source.unitUuid)
      || UUID_RE.test(source.buildingUuid)
      || /^\d+$/.test(String(source.buildingId || ''));
    if (!hasAddress) return null;

    const s = getState(form);
    const firstKey = keyOf(source);
    if (s.key === firstKey && s.context?.status === 'ready') return s.context;
    if (s.key === firstKey && s.promise && !retryError) return s.promise;

    const token = ++s.token;
    s.key = firstKey;
    s.status = 'pending';
    log('info','street_address_resolved',{reason,...source});

    const promise = (async () => {
      try {
        source = await complete(source);
        const now = snapshot(form);
        if (token !== s.token || (now.unitUuid && source.unitUuid && now.unitUuid !== source.unitUuid)) {
          log('info','street_resolve_discarded',{reason,streetUuid:source.streetUuid,currentStreetUuid:now.streetUuid});
          return s.context;
        }

        s.streetUuid = source.streetUuid;
        s.key = keyOf(snapshot(form));
        log('info','street_resolved',{
          reason,
          streetUuid:source.streetUuid,
          streetName:source.streetName,
          buildingId:source.buildingId,
          source:source.streetSource
        });

        const context = await cache.get(source.streetUuid, source);
        s.context = context;
        s.status = context.status;
        s.promise = null;
        log('info','street_owners_loaded',{
          streetUuid:context.streetUuid,
          owners:context.owners.map(o => ({id:o.id,uuid:o.uuid,name:o.name}))
        });
        const rule = R.classifyTerritory(context.owners);
        log('info','territory_rule_evaluated',{
          streetUuid:context.streetUuid,
          territory:rule.territory || 'NONE',
          matchedBy:rule.matchedBy || '',
          requiredCrew:rule.requiredCrew || null
        });
        window.dispatchEvent(new CustomEvent('simnet-wb-street-context',{detail:{form,context}}));
        return context;
      } catch (error) {
        if (token !== s.token) return s.context;
        const context = {
          status:'error',
          streetUuid:source.streetUuid || '',
          streetName:source.streetName || '',
          owners:[],
          territory:'',
          requiredCrew:null,
          source:'resolve-error',
          error:R.compact(error?.message || error,240)
        };
        s.context = context;
        s.status = 'error';
        s.promise = null;
        log('warn','street_owner_fetch_failed',{
          reason,
          streetUuid:source.streetUuid || '',
          buildingUuid:source.buildingUuid || '',
          message:context.error,
          failOpen:true
        });
        window.dispatchEvent(new CustomEvent('simnet-wb-street-context',{detail:{form,context}}));
        return context;
      }
    })();

    s.promise = promise;
    return promise;
  }

  function current(form) {
    const s = getState(form);
    const now = snapshot(form);
    if (s.key === keyOf(now) && s.context) return s.context;
    if (UUID_RE.test(now.streetUuid) && s.streetUuid === now.streetUuid) return s.context;
    return null;
  }

  const relevant = target => target?.matches?.(
    'select[name="task_type_uuid"],select[name="typer"],#buildingUuidtask_address,#buildingUuidtask_addressHidden,input[name="building_uuidtask_address"],select[name^="address_unit_selectortask_address"],select[name="customer_uuid"]'
  );

  function onChange(event) {
    const form = event.target?.closest?.('form');
    if (destroyed || !isTaskForm(form) || !relevant(event.target)) return;
    const s = getState(form);
    const now = snapshot(form);
    if (s.streetUuid && now.streetUuid && s.streetUuid !== now.streetUuid) {
      s.context = null;
      s.status = 'idle';
      s.promise = null;
      s.token += 1;
    }
    queueMicrotask(() => { if (!destroyed && form.isConnected) void ensureResolved(form,'form-change'); });
  }

  function onFocus(event) {
    const form = event.target?.closest?.('form');
    if (!destroyed && isTaskForm(form) && getState(form).status === 'idle') {
      queueMicrotask(() => { if (form.isConnected) void ensureResolved(form,'focus'); });
    }
  }

  function refresh(form = null) {
    if (form && isTaskForm(form)) return void ensureResolved(form,'manual-refresh',{retryError:true});
    document.querySelectorAll('form').forEach(f => { if (isTaskForm(f)) void ensureResolved(f,'manual-refresh',{retryError:true}); });
  }

  function destroy() {
    destroyed = true;
    document.removeEventListener('change',onChange,true);
    document.removeEventListener('focusin',onFocus,true);
  }

  document.addEventListener('change',onChange,true);
  document.addEventListener('focusin',onFocus,true);
  queueMicrotask(() => refresh());

  WB.taskStreetOwnerContext = Object.freeze({
    isTaskForm,
    isFieldVisit,
    snapshot,
    current,
    ensureResolved,
    refresh,
    destroy,
    _test:Object.freeze({buildingIdentity,addressUnitFromBuildingCard})
  });
})();
