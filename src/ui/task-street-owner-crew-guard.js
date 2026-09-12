(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  const R = WB?.taskStreetOwnerRules;
  const C = WB?.taskStreetOwnerContext;
  if (!WB || !R || !C || window.top !== window.self || WB.__taskStreetOwnerCrewGuardLoaded) return;
  WB.__taskStreetOwnerCrewGuardLoaded = true;
  if (location.hostname !== 'userside.simnet.kiev.ua') return;

  const INFO = 'data-simnet-wb-street-owner-info';
  const BYPASS = 'data-simnet-wb-street-owner-bypass';
  const BUSY = 'data-simnet-wb-street-owner-busy';
  const STYLE = 'simnet-wb-street-owner-style';
  const BLOCKED = 'data-wb-street-crew-blocked';
  const REQUIRED = R.requiredCrew;
  let destroyed = false;
  const log = (level,event,details={}) => { try { WB.log?.[level]?.('TASK_FLOW',event,details); } catch {} };

  function selectedCrews(form) {
    const out=[]; const seen=new Set();
    const add=f => {
      const x={id:String(f.id||'').trim(),uuid:String(f.uuid||'').trim().toLowerCase(),name:R.compact(f.name||'',180)};
      const k=x.id||x.uuid||R.normalize(x.name);
      if(k&&!seen.has(k)){seen.add(k);out.push(x);}
    };
    for (const input of form.querySelectorAll('input[name^="division_auto_task_staffuuid"],input[name^="division_task_staffuuid"],input[name^="division_auto_task_staffid"],input[name^="division_task_staffid"],[data-simnet-wb-edit-crew-division]')) {
      if(!input.checked||input.disabled) continue;
      const value=String(input.getAttribute('data-simnet-wb-edit-crew-division')||input.value||'').trim();
      const name=R.compact(input.closest?.('.div_space2,label,.item,.erp-object-props__value')?.textContent||input.parentElement?.textContent||'',180);
      add(R.uuidRe.test(value)?{uuid:value,name}:{id:value,name});
    }
    const uc=form.querySelector('select[data-wb-uc-select="1"]');
    if(R.uuidRe.test(String(uc?.value||'').trim())) add({uuid:uc.value,name:uc.selectedOptions?.[0]?.textContent||''});
    for(const m of String(form.querySelector('#dummy_pers_id')?.value||'').matchAll(/\*division_([^*]+)\*/g)) add({id:m[1]});
    return out;
  }

  function ensureStyle(){
    if(document.getElementById(STYLE)) return;
    const s=document.createElement('style');
    s.id=STYLE;
    s.dataset.simnetWbOwned='1';
    s.textContent=`
      [${INFO}]{box-sizing:border-box;max-width:640px;margin:6px 0 9px;padding:8px 10px 8px 11px;border:1px solid #b8d3e2;border-left:4px solid #1871a5;border-radius:4px;background:#f4f9fc;color:#294552;font:12px/1.4 Arial,sans-serif}
      [${INFO}] .wb-street-owner-main{font-weight:700;color:#17394b}
      [${INFO}] .wb-street-owner-meta{margin-top:2px;color:#607783}
      [${INFO}][data-state="mismatch"]{border-color:#e1b2c3;border-left-color:#af013c;background:#fff8fa}
      [${INFO}][data-state="mismatch"] .wb-street-owner-main{color:#7c1843}
      [${INFO}][data-state="ok"]{border-left-color:#1871a5;background:#f4f9fc}
      [${INFO}][data-state="error"]{border-color:#b8d3e2;border-left-color:#1871a5;background:#f7fafc;color:#49636f}
      .simnet-wb-task-territory-mismatch{outline:2px solid #af013c!important;outline-offset:1px!important;background:#fff8fa!important}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"]{width:min(720px,calc(100vw - 36px));padding:13px 16px 14px 18px;border:1px solid #b8d3e2;border-left:6px solid #af013c;background:#fff;color:#263943;box-shadow:0 12px 34px rgba(22,63,87,.22)}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-task-title{margin:0 0 8px;color:#7c1843;font-size:15px;font-weight:800}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-task-message{color:#263943}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-rule-card{margin:2px 0 8px;padding:10px 12px;border:1px solid #b8d3e2;border-left:4px solid #1871a5;border-radius:4px;background:#f4f9fc}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-rule-kicker{margin-bottom:3px;color:#1871a5;font-size:11px;font-weight:800;letter-spacing:.35px;text-transform:uppercase}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-rule-head{color:#17394b;font-size:14px;font-weight:800}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-rule-head strong{display:inline-block;margin-left:3px;padding:1px 6px;border-radius:3px;background:#1871a5;color:#fff;font-weight:800}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-rule-meta{margin-top:5px;color:#58707c;font-size:12px}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-rule-current{margin-top:5px;color:#7c1843;font-size:12px;font-weight:700}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-street-other-errors{margin-top:7px;color:#607783;font-size:11px;font-weight:800;text-transform:uppercase}
      .simnet-wb-task-validation-summary[${BLOCKED}="1"] .wb-task-list{margin-top:3px}
    `;
    (document.head||document.documentElement).appendChild(s);
  }

  function anchor(form){
    return form.querySelector('[data-simnet-wb-universal-crew],[data-simnet-wb-edit-crew-picker],#auto_pers_id,#employeeMultiSelectorBodytask_staffId')
      ||form.querySelector('#dummy_pers_id')?.closest?.('.table_block')
      ||form.querySelector('.erp_form_actions,.div_center');
  }

  function territoryMeta(context){return R.territoryMeta?.(context?.territory)||null;}
  function ownerName(context){
    const owner=R.findTerritoryOwner?.(context?.owners||[],context?.territory);
    return owner?.name||territoryMeta(context)?.label||'';
  }
  function decision(form,context=C.current(form)){
    return context?R.evaluateCrewRule(context,selectedCrews(form)):{applies:false,pending:true,matched:false,issues:[]};
  }

  function clearStreetBlock(form){
    anchor(form)?.classList?.remove('simnet-wb-task-territory-mismatch');
    const box=document.querySelector(`.simnet-wb-task-validation-summary[${BLOCKED}="1"]`);
    if(!box) return;
    box.querySelector('.wb-street-rule-card')?.remove();
    box.querySelector('.wb-street-other-errors')?.remove();
    box.removeAttribute(BLOCKED);
  }

  function render(form,context=C.current(form)){
    ensureStyle();
    let host=form.querySelector(`[${INFO}]`);
    const d=decision(form,context);
    const meta=territoryMeta(context);
    if(!meta&&context?.status!=='error'){
      host?.remove();
      clearStreetBlock(form);
      return;
    }
    if(!host){
      host=document.createElement('div');
      host.setAttribute(INFO,'1');
      host.dataset.simnetWbOwned='1';
      const at=anchor(form);
      if(at?.parentNode)at.parentNode.insertBefore(host,at.nextSibling);else form.appendChild(host);
    }
    host.innerHTML='';
    if(context?.status==='error'){
      host.dataset.state='error';
      host.textContent='Не удалось проверить собственника адреса · сохранение не блокируется';
      return;
    }
    host.dataset.state=d.matched?'ok':'mismatch';
    const main=document.createElement('div');
    main.className='wb-street-owner-main';
    main.textContent=d.matched
      ? `${meta.label} · ${REQUIRED.name} выбрана ✓`
      : `${meta.label} · только ${REQUIRED.name}`;
    const sub=document.createElement('div');
    sub.className='wb-street-owner-meta';
    sub.textContent=`Собственник: ${ownerName(context)||meta.label}`;
    host.append(main,sub);
    if(d.matched){
      clearStreetBlock(form);
      try{WB.taskFormAssistant?.validateAndRender?.(form);}catch{}
    }
  }

  function evaluate(form){
    if(!C.isTaskForm(form)||!C.isFieldVisit(form)) return {applies:false,matched:false,issues:[]};
    const context=C.current(form);
    const d=decision(form,context);
    const meta=territoryMeta(context);
    if(meta){
      log(d.matched?'info':'warn',d.matched?'required_crew_matched':'required_crew_mismatch',{
        streetUuid:context.streetUuid,
        territory:context.territory,
        territoryLabel:meta.label,
        selectedCrew:selectedCrews(form),
        requiredCrew:REQUIRED
      });
    }
    return {...d,context};
  }

  function showBlock(form,issue){
    try{WB.taskFormAssistant?.validateAndRender?.(form);}catch{}
    ensureStyle();
    let box=document.querySelector('.simnet-wb-task-validation-summary[data-simnet-wb-owned="1"]');
    if(!box){
      box=document.createElement('div');
      box.className='simnet-wb-task-validation-summary';
      box.dataset.simnetWbOwned='1';
      (document.body||document.documentElement).appendChild(box);
    }
    box.hidden=false;
    box.dataset.level='error';
    box.setAttribute(BLOCKED,'1');
    box.setAttribute('role','alert');

    let title=box.querySelector('.wb-task-title');
    if(!title){title=document.createElement('div');title.className='wb-task-title';box.prepend(title);}
    title.textContent='Заявка не сохранена';

    let msg=box.querySelector('.wb-task-message');
    if(!msg){msg=document.createElement('div');msg.className='wb-task-message';box.appendChild(msg);}

    msg.querySelector('.wb-street-rule-card')?.remove();
    msg.querySelector('.wb-street-other-errors')?.remove();
    const list=msg.querySelector('.wb-task-list');
    if(list){
      [...list.querySelectorAll('li')].forEach(li=>{
        const text=R.compact(li.textContent||'',400);
        if(/(?:Для этого адреса требуется бригада|На этом адресе работает только)/u.test(text)) li.remove();
      });
    }

    const context=C.current(form);
    const meta=territoryMeta(context);
    const selected=selectedCrews(form).map(x=>x.name||x.id||x.uuid).filter(Boolean);
    const card=document.createElement('div');
    card.className='wb-street-rule-card';
    const kicker=document.createElement('div');
    kicker.className='wb-street-rule-kicker';
    kicker.textContent='Особое условие адреса';
    const head=document.createElement('div');
    head.className='wb-street-rule-head';
    head.append(document.createTextNode('На этом адресе работает только '));
    const crew=document.createElement('strong');
    crew.textContent=REQUIRED.name;
    head.appendChild(crew);
    const metaLine=document.createElement('div');
    metaLine.className='wb-street-rule-meta';
    metaLine.textContent=`Территория: ${meta?.label||issue?.territoryLabel||''} · Собственник: ${ownerName(context)||issue?.ownerLabel||meta?.label||''}`;
    const current=document.createElement('div');
    current.className='wb-street-rule-current';
    current.textContent=selected.length?`Сейчас выбрано: ${selected.join(', ')}`:'Сейчас бригада не выбрана';
    card.append(kicker,head,metaLine,current);
    msg.insertBefore(card,msg.firstChild);

    const actualList=msg.querySelector('.wb-task-list');
    if(actualList?.querySelector('li')){
      const other=document.createElement('div');
      other.className='wb-street-other-errors';
      other.textContent='Другие ошибки';
      actualList.before(other);
    }
    anchor(form)?.classList?.add('simnet-wb-task-territory-mismatch');
  }

  function resume(form,submitter){
    form.setAttribute(BYPASS,'1');
    try{
      if(typeof form.requestSubmit==='function'){
        if(submitter?.form===form&&String(submitter.type||'').toLowerCase()==='submit')form.requestSubmit(submitter);
        else form.requestSubmit();
      }else HTMLFormElement.prototype.submit.call(form);
    }finally{form.removeAttribute(BYPASS);}
  }

  async function onSubmit(event){
    const form=C.isTaskForm(event.target)?event.target:null;
    if(destroyed||!form||!C.isFieldVisit(form))return;
    if(form.hasAttribute(BYPASS)){form.removeAttribute(BYPASS);return;}
    const s=C.snapshot(form);
    const hasAddress=R.uuidRe.test(s.streetUuid)||R.uuidRe.test(s.unitUuid)||R.uuidRe.test(s.buildingUuid)||/^\d+$/.test(String(s.buildingId||''));
    if(!hasAddress)return;
    let context=C.current(form);
    if(!context||context.status==='pending'||context.status==='error'){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(form.hasAttribute(BUSY))return;
      form.setAttribute(BUSY,'1');
      try{
        context=await C.ensureResolved(form,'submit',{retryError:true});
        render(form,context);
        const d=evaluate(form);
        if(d.issues?.length){showBlock(form,d.issues[0]);return;}
        resume(form,event.submitter||null);
      }finally{form.removeAttribute(BUSY);}
      return;
    }
    const d=evaluate(form);
    if(d.issues?.length){
      event.preventDefault();
      event.stopImmediatePropagation();
      showBlock(form,d.issues[0]);
    }
  }

  const crewTarget=t=>t?.matches?.('input[name^="division_auto_task_staffuuid"],input[name^="division_task_staffuuid"],input[name^="division_auto_task_staffid"],input[name^="division_task_staffid"],[data-simnet-wb-edit-crew-division],select[data-wb-uc-select="1"]');
  function onChange(event){
    const form=event.target?.closest?.('form');
    if(!destroyed&&C.isTaskForm(form)&&crewTarget(event.target)){render(form);evaluate(form);}
  }
  function onContext(event){
    const form=event.detail?.form;
    if(!destroyed&&C.isTaskForm(form))render(form,event.detail?.context||null);
  }
  function destroy(){
    destroyed=true;
    document.removeEventListener('submit',onSubmit,true);
    document.removeEventListener('change',onChange,true);
    window.removeEventListener('simnet-wb-street-context',onContext);
    document.querySelectorAll(`[${INFO}]`).forEach(n=>n.remove());
    document.getElementById(STYLE)?.remove();
  }

  document.addEventListener('submit',onSubmit,true);
  document.addEventListener('change',onChange,true);
  window.addEventListener('simnet-wb-street-context',onContext);
  WB.taskStreetOwnerCrewGuard=Object.freeze({
    evaluate,
    selectedCrews,
    refresh(form){C.refresh(form);},
    destroy,
    debug(form=null){
      const target=C.isTaskForm(form)?form:[...document.querySelectorAll('form')].find(C.isTaskForm)||null;
      return target?{address:C.snapshot(target),context:C.current(target),selectedCrew:selectedCrews(target),decision:evaluate(target)}:null;
    }
  });
})();
