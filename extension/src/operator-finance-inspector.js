"use strict";
(async()=>{
  if(top!==self)return;
  const compat=globalThis.__SIMNET_EXTENSION_COMPAT__;
  if(!compat?.ready||!compat?.api)return;
  await compat.ready;
  const {GM_addStyle}=compat.api;
  const norm=v=>String(v||"").replace(/\s+/g," ").trim();
  const low=v=>norm(v).toLowerCase();
  const visible=e=>e instanceof Element&&!e.closest("#dp-panel")&&getComputedStyle(e).display!=="none"&&getComputedStyle(e).visibility!=="hidden";
  const number=v=>{
    const m=norm(v).replace(/\s/g,"").replace(",",".").match(/-?\d+(?:\.\d+)?/);
    return m?Number(m[0]):null;
  };
  function rows(){
    const out=[];
    document.querySelectorAll("tr").forEach(tr=>{
      if(!visible(tr))return;
      const cells=[...tr.querySelectorAll(":scope>td,:scope>th")];
      if(!cells.length)return;
      const label=norm(cells[0]?.innerText||cells[0]?.textContent);
      const control=tr.querySelector("select,input:not([type=hidden]),textarea");
      let value="";
      if(control?.tagName==="SELECT")value=norm(control.selectedOptions?.[0]?.textContent||control.value);
      else if(control)value=norm(control.value);
      else value=norm(cells.slice(1).map(c=>c.innerText||c.textContent).join(" "));
      if(label)out.push({label,value,el:tr});
    });
    return out;
  }
  function findRow(terms){
    const all=rows();
    for(const t of terms){
      const n=low(t);
      const exact=all.find(r=>low(r.label)===n);
      if(exact)return exact;
      const starts=all.find(r=>low(r.label).startsWith(n));
      if(starts)return starts;
      const partial=all.find(r=>low(r.label).includes(n));
      if(partial)return partial;
    }
    return null;
  }
  function findText(terms){
    const nodes=[...document.querySelectorAll("a,button,td,th,div,p,span,strong,b")].filter(visible);
    for(const t of terms){
      const n=low(t);
      const hit=nodes.find(e=>low(e.innerText||e.textContent).includes(n));
      if(hit)return hit;
    }
    return null;
  }
  function pick(){
    const state=findRow(["Состояние","Стан","Статус"]);
    const access=findRow(["Доступ","Доступ в Интернет","Доступ до Інтернету"]);
    const startDay=findRow(["День начала потребления услуг","День початку споживання послуг","День начала потребления"]);
    const tariff=findRow(["Тарифы на Интернет","Тарифи на Інтернет","Тариф на Интернет"]);
    const price=findRow(["Цена, грн.","Ціна, грн.","Цена"]);
    const total=findRow(["Разом до сплати, грн.","Всего к оплате, грн.","Разом до сплати"]);
    const adjusted=findRow(["На счете с учетом стоимости тарифного плана, грн.","На рахунку з урахуванням вартості тарифного плану, грн.","На счете с учетом стоимости"]);
    const warning=findText(["при первой авторизации клиента произойдет его отключение","баланс ниже границы отключения","автоматическ","відключення"]);
    const history=findText(["Последние 6 платежей","Платежи и события","останні 6 платежів"]);
    return {state,access,startDay,tariff,price,total,adjusted,warning,history};
  }
  function yes(v){return /(^|\b)(да|є|есть|yes|включен|активен|доступен)(\b|$)/i.test(norm(v))&&!/(нет|немає|неактив|отключ)/i.test(norm(v));}
  function no(v){return /(^|\b)(нет|ні|немає|no|отключен|заблокирован|неактив)(\b|$)/i.test(norm(v));}
  function status(data){
    const adjusted=number(data.adjusted?.value);
    const day=number(data.startDay?.value);
    const accessNo=no(data.access?.value)||no(data.state?.value);
    const accessYes=yes(data.access?.value)||yes(data.state?.value);
    const negative=adjusted!==null&&adjusted<0;
    const dayBad=day!==null&&day<0;
    if(accessNo)return {kind:"bad",title:"Доступ ограничен",text:"По текущим полям Billing доступ уже отсутствует или договор заблокирован."};
    if(negative&&accessYes)return {kind:"warn",title:"Доступ пока есть · ожидается блокировка",text:data.warning?"Баланс отрицательный, но доступ ещё есть. Billing предупреждает о последующем автоматическом отключении.":"Баланс отрицательный, но доступ ещё есть. Возможна автоматическая блокировка на ближайшем цикле обработки."};
    if(negative)return {kind:"warn",title:"Отрицательный остаток",text:"На счёте с учётом тарифа минусовое значение. Нужно проверить доступ и правило автоматической блокировки."};
    if(dayBad)return {kind:"warn",title:"Проверь день начала потребления",text:"Минусовое значение дня начала потребления не соответствует полностью нормальному состоянию."};
    if(accessYes&&(adjusted===null||adjusted>=0)&&(day===null||day>=0))return {kind:"ok",title:"Финансовое состояние без явных отклонений",text:"Доступ есть, остаток не отрицательный, день начала потребления не минусовой."};
    return {kind:"unknown",title:"Состояние требует проверки",text:"Часть ключевых финансовых полей не найдена или имеет неоднозначное значение."};
  }
  function value(row,fallback="Не найдено"){return row&&norm(row.value)?norm(row.value):fallback;}
  function focus(el,label){
    if(!el)return;
    el.scrollIntoView({behavior:"smooth",block:"center"});
    let box=document.getElementById("dp-finance-live-highlight");
    if(!box){box=document.createElement("div");box.id="dp-finance-live-highlight";box.innerHTML="<span></span>";document.documentElement.appendChild(box);}
    box.querySelector("span").textContent=label;
    const draw=()=>{if(!el.isConnected)return;const r=el.getBoundingClientRect(),p=6;Object.assign(box.style,{left:`${r.left+scrollX-p}px`,top:`${r.top+scrollY-p}px`,width:`${r.width+p*2}px`,height:`${r.height+p*2}px`});box.classList.add("show")};
    setTimeout(draw,260);
    setTimeout(()=>box.classList.remove("show"),5000);
  }
  function card(label,row,key){return `<button type="button" data-finance-key="${key}" class="dp-finance-entity"><span>${label}</span><b>${value(row)}</b></button>`;}
  function install(){
    const nav=document.querySelector("#dp-nav");
    if(!nav)return;
    let box=nav.querySelector("#dp-finance-live");
    if(!box){
      box=document.createElement("section");
      box.id="dp-finance-live";
      box.innerHTML=`<header><div><b>Финансовое состояние</b><span>Живые данные текущей карточки Billing</span></div><button type="button" id="dp-finance-refresh">Обновить</button></header><div id="dp-finance-verdict"></div><div id="dp-finance-entities"></div><footer><button type="button" id="dp-finance-history">История платежей</button><small>Минус на счёте не всегда означает, что доступ уже отключён.</small></footer>`;
      const route=nav.querySelector(".route");
      (route||nav.querySelector(".focus"))?.insertAdjacentElement("beforebegin",box);
      box.querySelector("#dp-finance-refresh").addEventListener("click",render);
      box.addEventListener("click",event=>{
        const b=event.target.closest("[data-finance-key]");
        if(!b)return;
        const d=pick();
        const map={state:d.state,access:d.access,startDay:d.startDay,tariff:d.tariff,price:d.price,total:d.total,adjusted:d.adjusted};
        focus(map[b.dataset.financeKey]?.el,b.querySelector("span")?.textContent||"Финансы");
      });
      box.querySelector("#dp-finance-history").addEventListener("click",()=>{
        const d=pick();
        if(!d.history)return;
        focus(d.history,"История платежей");
        if(d.history.matches("a,button"))setTimeout(()=>d.history.click(),450);
      });
    }
    render();
  }
  function render(){
    const box=document.querySelector("#dp-finance-live");if(!box)return;
    const d=pick(),s=status(d),v=box.querySelector("#dp-finance-verdict");
    v.className=s.kind;v.innerHTML=`<b>${s.title}</b><span>${s.text}</span>`;
    box.querySelector("#dp-finance-entities").innerHTML=[
      card("Состояние",d.state,"state"),card("Доступ",d.access,"access"),card("День начала потребления",d.startDay,"startDay"),card("Тарифы на Интернет",d.tariff,"tariff"),card("Цена, грн.",d.price,"price"),card("Разом до сплати, грн.",d.total,"total"),card("На счёте с учётом тарифа",d.adjusted,"adjusted")
    ].join("");
    const h=box.querySelector("#dp-finance-history");h.disabled=!d.history;h.title=d.history?"Перейти к истории платежей":"Блок истории платежей не найден на странице";
  }
  GM_addStyle(`#dp-finance-live{margin:9px 12px;border:1px solid #334155;border-radius:10px;background:#111827;overflow:hidden;color:#e2e8f0}#dp-finance-live>header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid #334155}#dp-finance-live>header div{display:grid;gap:1px}#dp-finance-live>header b{font-size:11px;color:#f8fafc}#dp-finance-live>header span{font-size:9px;color:#94a3b8}#dp-finance-live button{border:1px solid #475569;border-radius:7px;background:#1e293b;color:#e2e8f0;padding:6px 7px;font:700 9px system-ui;cursor:pointer}#dp-finance-verdict{display:grid;gap:2px;margin:8px;padding:8px;border:1px solid #475569;border-radius:8px}#dp-finance-verdict b{font-size:11px}#dp-finance-verdict span{font-size:9px;line-height:1.35;color:#cbd5e1}#dp-finance-verdict.ok{border-color:#10b981;background:#05966920}#dp-finance-verdict.ok b{color:#a7f3d0}#dp-finance-verdict.warn{border-color:#f59e0b;background:#d9770620}#dp-finance-verdict.warn b{color:#fde68a}#dp-finance-verdict.bad{border-color:#ef4444;background:#dc262620}#dp-finance-verdict.bad b{color:#fecaca}#dp-finance-verdict.unknown{border-color:#64748b;background:#33415555}#dp-finance-entities{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:0 8px 8px}.dp-finance-entity{display:grid!important;gap:2px;text-align:left!important;min-width:0}.dp-finance-entity span{font-size:8px;color:#94a3b8}.dp-finance-entity b{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dp-finance-entity:last-child{grid-column:1/-1}#dp-finance-live>footer{display:flex;align-items:center;gap:8px;padding:8px;border-top:1px solid #334155}#dp-finance-live>footer small{font-size:8px;line-height:1.3;color:#94a3b8}#dp-finance-history{background:#1d4ed844!important;border-color:#3b82f6!important;color:#dbeafe!important;white-space:nowrap}#dp-finance-history:disabled{opacity:.45;cursor:not-allowed}#dp-panel.dp-nav-compact #dp-finance-entities{grid-template-columns:1fr}#dp-panel.dp-nav-compact #dp-finance-live>footer small,#dp-panel.dp-nav-compact #dp-finance-live>header span{display:none}#dp-finance-live-highlight{position:absolute;z-index:2147483645;pointer-events:none;opacity:0;border:3px solid #f59e0b;border-radius:8px;background:#f59e0b14;box-shadow:0 0 0 5px #ffffffc2,0 12px 30px #02061747;transition:.18s ease}#dp-finance-live-highlight.show{opacity:1}#dp-finance-live-highlight span{position:absolute;left:6px;top:6px;padding:4px 7px;border-radius:999px;background:#0f172aed;color:#fff;font:800 10px system-ui}`);
  new MutationObserver(()=>setTimeout(install,40)).observe(document.documentElement,{childList:true,subtree:true});
  install();
})();
