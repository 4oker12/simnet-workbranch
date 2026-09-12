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
  const REQUIRED = R.requiredCrew;
  let destroyed = false;
  const log = (level,event,details={}) => { try { WB.log?.[level]?.('TASK_FLOW',event,details); } catch {} };

  function selectedCrews(form) {
    const out=[]; const seen=new Set();
    const add=f => { const x={id:String(f.id||'').trim(),uuid:String(f.uuid||'').trim().toLowerCase(),name:R.compact(f.name||'',180)}; const k=x.id||x.uuid||R.normalize(x.name); if(k&&!seen.has(k)){seen.add(k);out.push(x);} };
    for (const input of form.querySelectorAll('input[name^="division_auto_task_staffuuid"],input[name^="division_task_staffuuid"],input[name^="division_auto_task_staffid"],input[name^="division_task_staffid"],[data-simnet-wb-edit-crew-division]')) {
      if(!input.checked||input.disabled) continue;
      const value=String(input.getAttribute('data-simnet-wb-edit-crew-division')||input.value||'').trim();
      const name=R.compact(input.closest?.('.div_space2,label,.item,.erp-object-props__value')?.textContent||input.parentElement?.textContent||'',180);
      add(R.uuidRe.test(value)?{uuid:value,name}:{id:value,name});
    }
    const uc=form.querySelector('select[data-wb-uc-select="1"]'); if(R.uuidRe.test(String(uc?.value||'').trim())) add({uuid:uc.value,name:uc.selectedOptions?.[0]?.textContent||''});
    for(const m of String(form.querySelector('#dummy_pers_id')?.value||'').matchAll(/\*division_([^*]+)\*/g)) add({id:m[1]});
    return out;
  }
  function ensureStyle(){
    if(document.getElementById(STYLE)) return;
    const s=document.createElement('style'); s.id=STYLE; s.dataset.simnetWbOwned='1';
    s.textContent=`[${INFO}]{box-sizing:border-box;max-width:640px;margin:5px 0 8px;padding:5px 8px;border:1px solid #d8cfd3;border-radius:5px;background:#fbf9fa;color:#4d3942;font:12px/1.35 Arial,sans-serif}[${INFO}] b{color:#23171c}[${INFO}][data-state="error"]{border-color:#b88b24;background:#fffaf0;color:#6d5419}[${INFO}][data-state="mismatch"]{border-color:#b0003a;background:#fff5f8;color:#5d1731}`;
    (document.head||document.documentElement).appendChild(s);
  }
  function anchor(form){return form.querySelector('[data-simnet-wb-universal-crew],[data-simnet-wb-edit-crew-picker],#auto_pers_id,#employeeMultiSelectorBodytask_staffId')||form.querySelector('#dummy_pers_id')?.closest?.('.table_block')||form.querySelector('.erp_form_actions,.div_center');}
  function decision(form,context=C.current(form)){return context?R.evaluateCrewRule(context,selectedCrews(form)):{applies:false,pending:true,matched:false,issues:[]};}
  function render(form,context=C.current(form)){
    ensureStyle(); let host=form.querySelector(`[${INFO}]`); const d=decision(form,context);
    if(context?.territory!=='SOVKI'&&context?.status!=='error'){host?.remove();return;}
    if(!host){host=document.createElement('div');host.setAttribute(INFO,'1');host.dataset.simnetWbOwned='1';const at=anchor(form);if(at?.parentNode)at.parentNode.insertBefore(host,at.nextSibling);else form.appendChild(host);}
    if(context.status==='error'){host.dataset.state='error';host.textContent='Не удалось проверить собственника адреса · сохранение не блокируется';return;}
    host.dataset.state=d.matched?'ok':'mismatch';host.innerHTML=`<b>Территория: Совки</b> · Бригада: ${REQUIRED.name}`;
  }
  function evaluate(form){
    if(!C.isTaskForm(form)||!C.isFieldVisit(form)) return {applies:false,matched:false,issues:[]};
    const context=C.current(form); const d=decision(form,context);
    if(context?.territory==='SOVKI') log(d.matched?'info':'warn',d.matched?'required_crew_matched':'required_crew_mismatch',{streetUuid:context.streetUuid,selectedCrew:selectedCrews(form),requiredCrew:REQUIRED});
    return {...d,context};
  }
  function showBlock(form,issue){
    try{WB.taskFormAssistant?.validateAndRender?.(form);}catch{}
    let box=document.querySelector('.simnet-wb-task-validation-summary[data-simnet-wb-owned="1"]');
    if(!box){box=document.createElement('div');box.className='simnet-wb-task-validation-summary';box.dataset.simnetWbOwned='1';(document.body||document.documentElement).appendChild(box);}
    box.hidden=false;box.dataset.level='error';box.setAttribute('role','alert');
    let title=box.querySelector('.wb-task-title');if(!title){title=document.createElement('div');title.className='wb-task-title';box.prepend(title);}title.textContent='Заявка не сохранена';
    let msg=box.querySelector('.wb-task-message');if(!msg){msg=document.createElement('div');msg.className='wb-task-message';box.appendChild(msg);}
    let list=msg.querySelector('.wb-task-list');if(!list){list=document.createElement('ul');list.className='wb-task-list';msg.textContent='';msg.appendChild(list);}
    if(![...list.querySelectorAll('li')].some(li=>R.compact(li.textContent||'',300)===issue.message)){const li=document.createElement('li');li.textContent=issue.message;list.appendChild(li);}
    anchor(form)?.classList?.add('simnet-wb-task-territory-mismatch');
  }
  function resume(form,submitter){form.setAttribute(BYPASS,'1');try{if(typeof form.requestSubmit==='function'){if(submitter?.form===form&&String(submitter.type||'').toLowerCase()==='submit')form.requestSubmit(submitter);else form.requestSubmit();}else HTMLFormElement.prototype.submit.call(form);}finally{form.removeAttribute(BYPASS);}}
  async function onSubmit(event){
    const form=C.isTaskForm(event.target)?event.target:null;if(destroyed||!form||!C.isFieldVisit(form))return;
    if(form.hasAttribute(BYPASS)){form.removeAttribute(BYPASS);return;}
    const s=C.snapshot(form);const hasAddress=R.uuidRe.test(s.streetUuid)||R.uuidRe.test(s.unitUuid)||R.uuidRe.test(s.buildingUuid)||/^\d+$/.test(String(s.buildingId||''));if(!hasAddress)return;
    let context=C.current(form);
    if(!context||context.status==='pending'||context.status==='error'){
      event.preventDefault();event.stopImmediatePropagation();if(form.hasAttribute(BUSY))return;form.setAttribute(BUSY,'1');
      try{context=await C.ensureResolved(form,'submit',{retryError:true});render(form,context);const d=evaluate(form);if(d.issues?.length){showBlock(form,d.issues[0]);return;}resume(form,event.submitter||null);}finally{form.removeAttribute(BUSY);}return;
    }
    const d=evaluate(form);if(d.issues?.length){event.preventDefault();event.stopImmediatePropagation();showBlock(form,d.issues[0]);}
  }
  const crewTarget=t=>t?.matches?.('input[name^="division_auto_task_staffuuid"],input[name^="division_task_staffuuid"],input[name^="division_auto_task_staffid"],input[name^="division_task_staffid"],[data-simnet-wb-edit-crew-division],select[data-wb-uc-select="1"]');
  function onChange(event){const form=event.target?.closest?.('form');if(!destroyed&&C.isTaskForm(form)&&crewTarget(event.target)){render(form);evaluate(form);}}
  function onContext(event){const form=event.detail?.form;if(!destroyed&&C.isTaskForm(form))render(form,event.detail?.context||null);}
  function destroy(){destroyed=true;document.removeEventListener('submit',onSubmit,true);document.removeEventListener('change',onChange,true);window.removeEventListener('simnet-wb-street-context',onContext);document.querySelectorAll(`[${INFO}]`).forEach(n=>n.remove());document.getElementById(STYLE)?.remove();}

  document.addEventListener('submit',onSubmit,true);document.addEventListener('change',onChange,true);window.addEventListener('simnet-wb-street-context',onContext);
  WB.taskStreetOwnerCrewGuard=Object.freeze({evaluate,selectedCrews,refresh(form){C.refresh(form);},destroy,debug(form=null){const target=C.isTaskForm(form)?form:[...document.querySelectorAll('form')].find(C.isTaskForm)||null;return target?{address:C.snapshot(target),context:C.current(target),selectedCrew:selectedCrews(target),decision:evaluate(target)}:null;}});
})();
