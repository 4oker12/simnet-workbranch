'use strict';

import { protectExport } from './trace-report.js';

// Bulk QA is a bounded user-controlled audit, not a second AI/policy engine.
// All facts originate in the real READ-only Billing preflight. Heuristic answer
// checks below are conservative: unsupported domains produce REVIEW, not PASS.
const STORAGE_KEY = 'simnet_ai_operator_bulk_qa_v1';
const MAX_SUBSCRIBERS = 100;
export const BULK_SCENARIOS = Object.freeze([
  {id:'balance', name:'Текущий баланс', question:'Сколько денег сейчас на моём счету?'},
  {id:'tariff', name:'Тариф и цена', question:'Какой у меня тариф, сколько стоит месяц?'},
  {id:'services', name:'Дополнительные услуги', question:'Какие платные дополнительные услуги у меня подключены?'},
  {id:'topup', name:'Сколько пополнить', question:'Сколько мне сейчас нужно пополнить, чтобы интернет работал?'},
  {id:'charge_date', name:'Дата списания', question:'Когда произойдёт следующее списание и в какое время?'},
  {id:'followup', name:'Удержание контекста', question:'Если пополню счёт через неделю, что изменится?'}
]);
const STARTER = ['balance','tariff','services','topup'];
const EXTENDED = BULK_SCENARIOS.map(x=>x.id);

function clean(value,max=300){return String(value == null ? '' : value).trim().slice(0,max)}
export function parseSubscriberList(value) {
  const lines=String(value || '').replace(/^\uFEFF/,'').split(/[\r\n;]+/);
  const valid=[],invalid=[],seen=new Set();
  for(const line of lines) {
    const cells=line.split(',').map(x=>x.trim().replace(/^["']|["']$/g,''));
    const raw=clean(cells[0],100);
    if(!raw || /^(?:login|логин|догов[іо]р|contract|identifier)$/i.test(raw)) continue;
    const id=raw.toLowerCase();
    if(seen.has(id)) continue;
    seen.add(id);
    if(/^(?:abon\d{3,12}|\d{3,12})$/.test(id)) valid.push(id);
    else invalid.push(raw);
  }
  return {valid,invalid,overLimit:Math.max(0,valid.length-MAX_SUBSCRIBERS),accepted:valid.slice(0,MAX_SUBSCRIBERS)};
}
const money = value => {
  if(value === '' || value == null)return null;
  const n=typeof value==='number'?value:Number(String(value).replace(/[\s\u00a0]/g,'').replace(',','.'));
  return Number.isFinite(n)?Math.round(n*100)/100:null;
};
const normalize = str => String(str || '').toLowerCase().replace(/\s+/g,' ').trim();
const amounts = reply => [...String(reply || '').matchAll(/(-?\d[\d\s\u00a0]*(?:[.,]\d{1,2})?)\s*(?:грн|₴|грив(?:ен|ны|ень|ні))/giu)]
  .map(m=>money(m[1])).filter(x=>x!==null);
const containsAmount=(text,target)=>amounts(text).some(x=>Math.abs(x-target)<0.011);
const dateClaim = reply => /(?:\b(?:[12]?\d|3[01])\s*(?:\.|-|\/|\s+)(?:0?[1-9]|1[0-2]|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|січн|лют|берез|квіт|трав|черв|лип|серп|верес|жовт|листопад|грудн)|\b\d{1,2}:\d{2}\b)/i.test(reply);
const riskyDebt = reply => /(?:долг|борг|задолж|заборгован).{0,55}(?:обязател|сплат|погас|оплат|термінов|срочн)|(?:обязател|погас|сплат|срочн).{0,45}(?:долг|борг|задолж|заборгован)/i.test(reply);

export function gradeBulkAnswer(scenarioId, reply, facts = {}, trace = {}) {
  const text=String(reply||'');
  const numbers=amounts(text);
  const fail=(category,reason)=>({verdict:'FAIL',category,reason});
  const review=(category,reason)=>({verdict:'REVIEW',category,reason});
  const pass=(reason)=>({verdict:'PASS',category:'checked_fact',reason});
  if(!text.trim())return fail('empty_answer','AI не вернул ответ.');
  if(trace.degraded)return review('model_degraded','Модель перешла в деградированный режим: '+clean(trace.degradationReason,120));
  if((text.match(/abon\d{3,12}/gi)||[]).some(login=>login.toLowerCase() !== String(trace.identifier || '').toLowerCase())) {
    return fail('context_leak','В ответе упомянут логин другого абонента.');
  }
  if(riskyDebt(text))return review('finance_policy','Требование погасить долг: проверить источник и финансовую политику.');
  if(scenarioId === 'balance') {
    const target=money(facts.balance);
    if(target===null)return review('control_fact_unknown','В контрольном Billing нет подтверждённого accountBalance.');
    if(containsAmount(text,target))return pass('В ответе присутствует подтверждённый текущий баланс '+target+' грн; семантику других утверждений нужно проверять отдельно.');
    if(numbers.length)return fail('wrong_amount','Названная сумма не совпадает с accountBalance='+target+' грн.');
    return review('missing_amount','Число отсутствует: проверить, объяснил ли AI причину.');
  }
  if(scenarioId === 'tariff') {
    const price=money(facts.tariffPrice), tariff=normalize(facts.tariffName);
    if(!tariff && price===null)return review('control_fact_unknown','Название/цена тарифа не получены из Billing.');
    const hasTariff=tariff && normalize(text).includes(tariff);
    if(price!==null && numbers.length && !containsAmount(text,price))
      return fail('wrong_tariff_price','Озвучена цена, не совпадающая с тарифом '+price+' грн.');
    if(hasTariff && (price===null || containsAmount(text,price)))return pass('Название тарифа и известная цена совпадают со снимком Billing.');
    return review('tariff_semantics','Нужна проверка названия, ценовых условий или неполного ответа.');
  }
  if(scenarioId === 'services') {
    const list=Array.isArray(facts.services)?facts.services:null;
    if(!list || !list.length)return review('services_unknown','Пустой список UI не доказывает отсутствия платных услуг.');
    const names=list.map(x=>normalize(x?.name)).filter(x=>x.length>2);
    if(/(?:нет|нема|відсутн|не подключ|не підключ)/i.test(text) && names.length)return fail('services_contradiction','AI отрицает услуги, присутствующие в контрольном снимке.');
    if(names.length && names.every(name=>normalize(text).includes(name)))return pass('Все наблюдённые названия услуг присутствуют в ответе; цены требуют отдельной проверки.');
    return review('services_partial','Нельзя автоматически подтвердить полный перечень услуг.');
  }
  if(scenarioId === 'charge_date') {
    if(dateClaim(text))return fail('unsupported_date','Названа точная дата/время без контрольного факта расписания списания.');
    return review('charge_date_unknown','Дата списания не входит в текущий контрольный снимок Billing.');
  }
  if(scenarioId === 'topup') {
    return review('payment_rule_review','Нельзя приравнивать разницу между тарифом и балансом к обязательной сумме пополнения. Проверить условия Billing.');
  }
  return review('context_review','Проверить контекст предыдущих ответов и финансовые условия.');
}

function redactId(value){ const s=String(value||'');return s.length>4 ? s.slice(0,4)+'•••'+s.slice(-3) : '[скрыто]'; }
function snapshotForExport(snapshot,includeIdentifiers) {
  if(!snapshot)return null;
  return {observedAt:snapshot.observedAt,source:snapshot.source,facts:snapshot.facts,
    evidence:snapshot.evidence,identity:includeIdentifiers?snapshot.identity:undefined};
}
export function makeBulkReport(batch,includeIdentifiers=false) {
  const cases=(batch?.subscribers||[]).map((s,i)=>({
    index:i+1,subscriber:includeIdentifiers?s.identifier:'#'+String(i+1).padStart(3,'0'),
    status:s.status,sourceError:s.error || null,
    control:snapshotForExport(s.snapshot,includeIdentifiers),
    checks:(s.checks||[]).map(c=>({
      scenario:c.scenario,name:c.name,question:c.question,reply:c.reply,
      verdict:c.verdict,category:c.category,reason:c.reason,
      usage:c.usage,elapsedMs:c.elapsedMs,tools:c.tools,at:c.at
    }))
  }));
  const report={schema:'simnet.bulk-finance-qa.v1',createdAt:batch?.createdAt,
    exportedAt:new Date().toISOString(),mode:batch?.mode,complete:batch?.phase==='completed',
    requiresManualReview:true,totals:bulkTotals(batch),cases};
  const safe=protectExport(report,{includeSensitive:includeIdentifiers});
  if(includeIdentifiers)return safe;
  // Numeric contracts are not covered by generic redaction patterns, and
  // the first question often contains an explicit contract. Mask EVERY
  // occurrence of the provided identifiers, including tool logs/replies.
  const ids=(batch?.subscribers||[]).map(s=>String(s.identifier||'')).filter(Boolean);
  const mask=value=>{
    if(typeof value==='string'){
      let output=value;
      for(const id of ids) output=output.split(id).join('[абонент скрыт]');
      return output;
    }
    if(Array.isArray(value))return value.map(mask);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,val])=>[key,mask(val)]));
    return value;
  };
  return mask(safe);
}
export function bulkTotals(batch) {
  const subscribers=batch?.subscribers||[],checks=subscribers.flatMap(s=>s.checks||[]);
  return {subscribers:subscribers.length,ready:subscribers.filter(s=>s.status==='ready').length,
    blocked:subscribers.filter(s=>s.status==='blocked').length,checks:checks.length,
    pass:checks.filter(x=>x.verdict==='PASS').length,fail:checks.filter(x=>x.verdict==='FAIL').length,
    review:checks.filter(x=>x.verdict==='REVIEW').length,
    usedTokens:checks.reduce((sum,x)=>sum+Number(x.usage?.total_tokens||0),0)};
}

export function initBulkQA({request,downloadLocalFile,isConfigured}) {
  const $=id=>document.getElementById(id);
  const ui={
    toggle:$('bulkQaToggle'),panel:$('bulkQaPanel'),close:$('bulkQaClose'),
    input:$('bulkSubscribers'),file:$('bulkFile'),mode:$('bulkMode'),maxTurns:$('bulkMaxTurns'),budget:$('bulkTokenBudget'),
    validate:$('bulkValidate'),scan:$('bulkScan'),run:$('bulkRun'),stop:$('bulkStop'),
    resume:$('bulkResume'),clear:$('bulkClear'),exportJson:$('bulkExportJson'),exportCsv:$('bulkExportCsv'),
    includeIds:$('bulkIncludeIds'),status:$('bulkStatus'),summary:$('bulkSummary'),
    list:$('bulkTableBody'),detail:$('bulkCaseDetail')
  };
  if(!ui.toggle||!ui.panel)return;
  let batch=null,busy=false,stopRequested=false,selectedIndex=0;
  const n=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e};
  const emit=(str,error=false)=>{ui.status.textContent=String(str);ui.status.classList.toggle('error',error)};
  const scenarioIds=mode=>mode==='extended'?EXTENDED:STARTER;
  const limits=()=>{
    const turns=Math.max(1,Math.min(600,Math.trunc(Number(ui.maxTurns.value)||30)));
    const tokens=Math.max(1000,Math.min(1000000,Math.trunc(Number(ui.budget.value)||100000)));
    return {turns,tokens};
  };
  const persist=async()=>{if(!batch)return;batch.updatedAt=new Date().toISOString();await chrome.storage.local.set({[STORAGE_KEY]:batch})};
  const setBusy=value=>{busy=value;for(const k of ['scan','run','resume','validate','clear'])ui[k].disabled=value;ui.stop.disabled=!value};
  const isStopped=()=>stopRequested;
  const stopReason=reason=>{batch.phase='stopped-'+(batch.phase==='scanning'?'scan':'run');batch.stopReason=reason};
  function render() {
    ui.list.replaceChildren();ui.detail.replaceChildren();
    const totals=bulkTotals(batch);
    ui.summary.textContent=batch ? ('Абонентов: '+totals.subscribers+' · готово: '+totals.ready+
      ' · недоступно: '+totals.blocked+' · проверок: '+totals.checks+
      ' · PASS '+totals.pass+' / FAIL '+totals.fail+' / REVIEW '+totals.review+
      ' · токенов: '+totals.usedTokens+' · '+batch.phase) : 'Список не загружен.';
    if(!batch)return;
    batch.subscribers.forEach((sub,i)=>{
      const tr=n('tr');
      for(const col of [String(i+1),redactId(sub.identifier),sub.status,
        String(sub.checks.length), String(sub.checks.filter(c=>c.verdict==='FAIL').length),
        String(sub.checks.filter(c=>c.verdict==='REVIEW').length)])tr.append(n('td','',col));
      tr.tabIndex=0;tr.className=selectedIndex===i?'selected':'';
      const choose=()=>{selectedIndex=i;render()};
      tr.addEventListener('click',choose);
      tr.addEventListener('keydown',e=>{if(e.key==='Enter')choose()});
      ui.list.append(tr);
    });
    const sub=batch.subscribers[selectedIndex];
    if(!sub)return;
    ui.detail.append(n('h3','','Абонент #'+(selectedIndex+1)+' · '+redactId(sub.identifier)));
    if(sub.error)ui.detail.append(n('p','bulk-error','Источник: '+sub.error.stage+' → '+sub.error.code));
    if(sub.snapshot) {
      const facts=n('pre','bulk-detail-pre',JSON.stringify({observedAt:sub.snapshot.observedAt,
        source:sub.snapshot.source,facts:sub.snapshot.facts},null,2));
      ui.detail.append(facts);
    }
    for(const check of sub.checks) {
      const box=n('details','bulk-check bulk-'+check.verdict.toLowerCase());
      const summary=n('summary','',check.name+' · '+check.verdict+' · '+check.category);
      box.append(summary,n('p','',check.question),n('p','bulk-reply',check.reply || 'Нет ответа'),
        n('p','',check.reason));
      const detail=n('pre','bulk-detail-pre',JSON.stringify({tools:check.tools,usage:check.usage,elapsedMs:check.elapsedMs},null,2));
      box.append(detail);ui.detail.append(box);
    }
  }
  async function scan() {
    if(busy||!batch)return;
    if(batch.subscribers.every(s=>s.status!=='pending')){emit('Все идентификаторы уже обработаны.');return}
    stopRequested=false;setBusy(true);batch.phase='scanning';await persist();
    try {
      for(let i=0;i<batch.subscribers.length;i++) {
        const sub=batch.subscribers[i];if(sub.status!=='pending')continue;
        if(isStopped()){stopReason('STOP запрошен оператором');break}
        emit('READ Billing: абонент '+(i+1)+' / '+batch.subscribers.length);
        try {
          const data=await request('AI_OPERATOR_BULK_PREFLIGHT',{identifier:sub.identifier});
          if(data?.ok) {
            sub.status='ready';sub.snapshot={facts:data.facts,identity:data.identity,
              observedAt:data.observedAt,source:data.source,evidence:data.evidence};sub.toolState=data.toolState;
          } else {sub.status='blocked';sub.error={stage:data?.stage||'preflight',code:data?.code||'UNKNOWN',evidence:{lookup:data?.lookupTrace,summary:data?.summaryTrace}}}
        } catch(error) {
          sub.status='blocked';sub.error={stage:'runtime',code:'REQUEST_FAILED',message:clean(error?.message||error,250)};
          // Authentication/API/infrastructure errors are not evidence that the customer is absent.
        }
        await persist();render();
      }
      if(batch.phase==='scanning')batch.phase='scanned';
      await persist();render();
      emit(batch.phase==='scanned'?'Контрольные READ завершены. Можно запускать AI-проверку.':'Сбор фактов остановлен.');
    }finally{setBusy(false)}
  }
  async function run() {
    if(busy||!batch)return;
    if(batch.subscribers.some(s=>s.status==='pending')){emit('Сначала завершите сбор контрольных данных Billing.',true);return}
    if(!isConfigured()){emit('Сначала настрой DeepSeek API в настройках расширения.',true);return}
    const {turns,tokens}=limits();
    batch.maxTurns=turns;batch.tokenBudget=tokens;
    stopRequested=false;setBusy(true);batch.phase='running';await persist();
    try {
      let halted=false;
      for(let i=0;i<batch.subscribers.length&&!halted;i++) {
        const sub=batch.subscribers[i];
        if(sub.status!=='ready')continue;
        for(const scenario of BULK_SCENARIOS.filter(x=>batch.scenarios.includes(x.id))) {
          if(sub.checks.some(x=>x.scenario===scenario.id))continue;
          if(isStopped()){stopReason('STOP запрошен оператором');halted=true;break}
          const totals=bulkTotals(batch);
          if(totals.checks>=batch.maxTurns || totals.usedTokens>=batch.tokenBudget){
            stopReason('Достигнут лимит AI-ходов или токенов');halted=true;break;
          }
          const question=(scenario.id==='balance' ? (sub.identifier.startsWith('abon')?'Мой логин ':'Мой договор ')+sub.identifier+'. ' : '')+scenario.question;
          emit('AI-проверка: абонент '+(i+1)+' / '+batch.subscribers.length+' · '+scenario.name);
          const transcript=sub.checks.flatMap(c=>[
            {role:'customer',text:c.question},{role:'agent',text:c.reply||''}
          ]).slice(-16);
          try {
            const result=await request('AI_OPERATOR_BULK_TURN',{
              identifier:sub.identifier,question,transcript,toolState:sub.toolState,
              scope:'bulk:'+batch.id+':'+i
            });
            if(result?.ok){
              sub.toolState=result.toolState;
              const grade=gradeBulkAnswer(scenario.id,result.reply,sub.snapshot.facts,{...result,identifier:sub.identifier});
              sub.checks.push({scenario:scenario.id,name:scenario.name,question,reply:result.reply,
                ...grade,tools:result.toolTrace,usage:result.usage,elapsedMs:result.elapsedMs,at:new Date().toISOString()});
            } else {
              sub.checks.push({scenario:scenario.id,name:scenario.name,question,reply:'',
                verdict:'REVIEW',category:'runtime_error',reason:'Нет подтверждённого результата: '+clean(result?.code||'UNKNOWN'),
                tools:[],usage:{},elapsedMs:0,at:new Date().toISOString()});
              stopReason('Ошибка выполнения AI');halted=true;
            }
          } catch(error) {
            sub.checks.push({scenario:scenario.id,name:scenario.name,question,reply:'',
              verdict:'REVIEW',category:'runtime_error',reason:clean(error?.message||error,220),
              tools:[],usage:{},elapsedMs:0,at:new Date().toISOString()});
            stopReason('Ошибка API/Runtime: необходима проверка');halted=true;
          }
          await persist();render();
          if(halted)break;
        }
      }
      if(batch.phase==='running')batch.phase='completed';
      await persist();render();emit(batch.phase==='completed'?'Пакет завершён. Проверь FAIL/REVIEW и экспортируй результаты.':'Пакет остановлен: '+(batch.stopReason||'STOP'));
    }finally{setBusy(false)}
  }
  async function resume() {
    if(!batch||busy)return;
    if(batch.subscribers.some(s=>s.status==='pending'))await scan();
    else await run();
  }
  ui.toggle.addEventListener('click',()=>{ui.panel.hidden=!ui.panel.hidden;document.body.classList.toggle('bulk-open',!ui.panel.hidden);render()});
  ui.close.addEventListener('click',()=>{ui.panel.hidden=true;document.body.classList.remove('bulk-open')});
  ui.file.addEventListener('change',async()=>{
    const file=ui.file.files?.[0];if(!file)return;
    if(file.size>150000){emit('TXT/CSV больше 150 КБ. Сократи список.',true);return}
    ui.input.value=await file.text();emit('Файл прочитан локально. Нажми «Проверить список».');
  });
  ui.validate.addEventListener('click',()=>{
    const parsed=parseSubscriberList(ui.input.value);
    emit('Корректных: '+parsed.valid.length+' · повторные значения удалены · неверных: '+parsed.invalid.length+
      (parsed.overLimit?' · сверх лимита 100: '+parsed.overLimit:'')+(parsed.invalid.length?' · примеры: '+parsed.invalid.slice(0,3).join(', '):''),
      Boolean(parsed.invalid.length||parsed.overLimit));
  });
  ui.scan.addEventListener('click',async()=>{
    if(batch&&batch.subscribers.some(s=>s.status!=='pending')){emit('Существующий пакет уже запущен. Продолжи или очисти его.',true);return}
    const ids=parseSubscriberList(ui.input.value);
    if(ids.invalid.length||ids.overLimit||!ids.accepted.length){emit('Исправь список: нужны 1–100 логинов abonNNN или числовых договоров, без ошибок.',true);return}
    batch={schema:'simnet.bulk-finance-qa.v1',id:'bulk-'+Date.now().toString(36),
      createdAt:new Date().toISOString(),phase:'draft',mode:ui.mode.value,
      scenarios:scenarioIds(ui.mode.value),subscribers:ids.accepted.map(identifier=>({
        identifier,status:'pending',snapshot:null,toolState:null,error:null,checks:[]
      }))};
    selectedIndex=0;await persist();render();await scan();
  });
  ui.run.addEventListener('click',()=>void run());
  ui.stop.addEventListener('click',()=>{stopRequested=true;emit('STOP принят. Текущий запрос завершится; следующий не запустится.')});
  ui.resume.addEventListener('click',()=>void resume());
  ui.clear.addEventListener('click',async()=>{
    if(busy)return;
    if(!confirm('Удалить текущий пакет и весь его локальный журнал? Сначала экспортируйте отчёт, если он нужен.'))return;
    await chrome.storage.local.remove(STORAGE_KEY);batch=null;selectedIndex=0;render();emit('Пакет очищен.');
  });
  function exportData(format){
    if(!batch){emit('Нет сохранённых результатов.',true);return}
    const report=makeBulkReport(batch,ui.includeIds.checked);
    const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
    if(format==='json')downloadLocalFile(JSON.stringify(report,null,2)+'\n','simnet-bulk-qa-'+timestamp+'.json','application/json;charset=utf-8');
    else {
      const quote=value=>'"'+String(value??'').replace(/"/g,'""').replace(/\r?\n/g,' ')+'"';
      const rows=[['case','subscriber','status','scenario','verdict','category','reason','question','reply']];
      for(const c of report.cases){
        if(!c.checks.length)rows.push([c.index,c.subscriber,c.status,'','BLOCKED',c.sourceError?.code||'',c.sourceError?.stage||'','','']);
        for(const x of c.checks)rows.push([c.index,c.subscriber,c.status,x.scenario,x.verdict,x.category,x.reason,x.question,x.reply]);
      }
      downloadLocalFile('\uFEFF'+rows.map(cols=>cols.map(quote).join(',')).join('\r\n')+'\r\n','simnet-bulk-qa-'+timestamp+'.csv','text/csv;charset=utf-8');
    }
    emit('Локальный экспорт создан. Перед передачей проверь персональные данные.');
  }
  ui.exportJson.addEventListener('click',()=>exportData('json'));
  ui.exportCsv.addEventListener('click',()=>exportData('csv'));
  void chrome.storage.local.get(STORAGE_KEY).then(stored=>{
    if(stored?.[STORAGE_KEY]?.schema==='simnet.bulk-finance-qa.v1'){
      batch=stored[STORAGE_KEY];
      if(['scanning','running'].includes(batch.phase)){
        batch.phase=batch.phase==='scanning'?'stopped-scan':'stopped-run';
        batch.stopReason='Вкладка закрывалась; требуется ручное возобновление.';
      }
      emit('Найден сохранённый пакет. Можно продолжить с оставшегося шага.');
      render();
    }else render();
  });
}
