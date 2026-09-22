'use strict';
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const compact=(v,m=1200)=>{const s=String(v??'').replace(/\s+/g,' ').trim();return s.length>m?`${s.slice(0,m-1)}…`:s};
const iso=()=>new Date().toISOString();
const rid=()=>`scenario_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const transcript=v=>(Array.isArray(v)?v:[]).map(x=>({role:x?.role==='agent'?'agent':'customer',text:compact(x?.text,5000),at:x?.at||iso()})).filter(x=>x.text).slice(-80);

export function validateScenario(s={}){
  const id=compact(s.id,120),title=compact(s.title||id,240),src=Array.isArray(s.turns)?s.turns:[];
  if(!id||!title||!src.length||src.length>30) throw new Error(`Invalid scenario ${id||'<missing>'}`);
  return {id,title,description:compact(s.description,800),tags:(s.tags||[]).map(x=>compact(x,80)).filter(Boolean).slice(0,20),turns:src.map((t,i)=>{const user=compact(typeof t==='string'?t:t?.user,4000);if(!user)throw new Error(`${id}: empty turn ${i+1}`);return{id:compact(t?.id||`turn_${i+1}`,100),user,note:compact(t?.note,500),tags:(t?.tags||[]).slice(0,10)}})};
}
const variant=e=>{const a=Array.isArray(e?.variants)?e.variants:[];return a.find(x=>x?.label===e?.activeVariant)||a[0]||{}};
const state=t=>{const d=t?.domainContext?.dialogue||{}, intents=Array.isArray(t?.conversationState?.activeIntents)?t.conversationState.activeIntents:(t?.activeIntents||[]);return{confirmedSubscriber:clone(t?.confirmedSubscriber||t?.conversationState?.confirmedSubscriber||null),activeSubscriberId:compact(t?.domainContext?.activeSubscriberId,160),activeBuildingId:compact(t?.domainContext?.activeBuildingId,160),activeRequests:clone(d.activeRequests||[]),activeRequiredFacts:clone(d.activeRequiredFacts||[]),activeIntents:clone((intents||[]).filter(x=>!x?.status||x.status==='unresolved').slice(0,12)),alreadyExplainedFacts:clone(d.alreadyExplainedFacts||t?.alreadyExplainedFacts||[]),offeredActions:clone(d.offeredActions||t?.offeredActions||[]),lastDiscourseAct:compact(d.lastDiscourseAct||t?.conversationState?.lastDiscourseAct,80)}};
const trace=a=>(Array.isArray(a)?a:[]).map(x=>({tool:compact(x?.tool,120),ok:Boolean(x?.ok),code:compact(x?.code,120),source:compact(x?.source,160),requestedFacts:clone(x?.requestedFacts||[]),requestedBy:clone(x?.requestedBy||null)})).slice(0,30);
const evidence=a=>(Array.isArray(a)?a:[]).map(x=>({path:compact(x?.path,220),status:compact(x?.status,40),value:x?.value===undefined?undefined:clone(x.value),source:compact(x?.source,160),derived:Boolean(x?.derived)})).slice(0,80);

export function compactTurnOutcome({outcome={},user='',turnIndex=0,checkpointBefore=null,elapsedMs=0}={}){
  const e=outcome.experiment||{},p=e.analysis?.probe||{},k=e.analysis?.knowledge||{},v=variant(e),fe=evidence(v.factEvidence||v.canonicalFactEvidence||[]),fd=v.factDiagnostics||{};
  const required=p.requiredFacts||p.required_facts||[];
  const requiredSet=new Set(required);
  const allReturned=Array.isArray(fd.returnedFacts)?fd.returnedFacts:fe.filter(x=>x.status==='known'||x.status==='absent').map(x=>x.path);
  const allUnknown=Array.isArray(fd.unknownFacts)?fd.unknownFacts:fe.filter(x=>x.status==='unknown').map(x=>x.path);
  const returned=allReturned.filter(path=>requiredSet.size===0||requiredSet.has(path));
  const unknown=allUnknown.filter(path=>requiredSet.has(path));
  const supportUnknownFacts=allUnknown.filter(path=>!requiredSet.has(path));
  const reply=compact(v.reply||outcome.decision?.reply,6000), tr=trace(v.toolTrace||[]), police=v.dialoguePolice||outcome.decision?.dialoguePolice||{}, unresolved=p.unresolvedRequests||[], degraded=Boolean(v.degraded);
  const status=!reply?'failed':degraded||unknown.length||(police.violations||[]).includes('NON_ANSWER')?'incomplete':'complete';
  return{index:turnIndex,user:compact(user,4000),reply,status,degraded,degradationReason:compact(v.degradationReason,1000),semantic:{whatUserWants:compact(p.whatUserWants,1000),latestMessageMeans:compact(p.latestMessageMeans,1000),underlyingGoal:compact(p.underlyingGoal,1000),discourseAct:compact(p.dialoguePolicy?.discourseAct||p.discourseAct||p.speechAct,80),unresolvedRequests:clone(unresolved),confidence:Number(p.confidence||0)||0},requiredFacts:clone(required),returnedFacts:clone(returned),unknownFacts:clone(unknown),supportUnknownFacts:clone(supportUnknownFacts),factEvidence:fe,toolTrace:tr,knowledgeArticles:(k.usedArticles||[]).map(x=>x?.id).filter(Boolean).slice(0,30),dialoguePolice:{violations:clone(police.violations||[]),changed:Boolean(police.changed),notes:clone(police.notes||[])},usage:clone(e.usage||outcome.decision?.usage||{}),elapsedMs:Number(e.elapsedMs||elapsedMs||0)||0,stateBefore:clone(checkpointBefore?.stateSummary||{}),stateAfter:state(outcome.toolState||{}),checkpointBefore:checkpointBefore?{transcript:clone(checkpointBefore.transcript),toolState:clone(checkpointBefore.toolState)}:null,rawExperimentId:compact(e.id,160)};
}
function summary(turns,status){const ms=turns.reduce((s,x)=>s+Number(x.elapsedMs||0),0),viol={};for(const t of turns)for(const c of t.dialoguePolice?.violations||[])viol[c]=(viol[c]||0)+1;return{turns:turns.length,complete:turns.filter(x=>x.status==='complete').length,incomplete:turns.filter(x=>x.status==='incomplete').length,failed:turns.filter(x=>x.status==='failed').length,toolCalls:turns.reduce((s,x)=>s+(x.toolTrace?.length||0),0),totalTokens:turns.reduce((s,x)=>s+Number(x.usage?.total_tokens||0),0),totalElapsedMs:ms,averageLatencyMs:turns.length?Math.round(ms/turns.length):0,dialoguePolice:viol,status}}

export async function runScenario({scenario,runTurn,signal=null,onProgress=null,startIndex=0,endIndex=null,seedTranscript=[],seedToolState={},existingTurns=[],runId=''}={}){
  const s=validateScenario(scenario);if(typeof runTurn!=='function')throw new Error('Scenario runner requires runTurn callback.');
  const first=Math.max(0,Math.min(s.turns.length,Number(startIndex||0))),last=endIndex==null?s.turns.length:Math.max(first,Math.min(s.turns.length,Number(endIndex)));let tx=transcript(seedTranscript),ts=clone(seedToolState||{}),turns=clone(existingTurns||[]),status='running';const startedAt=iso();
  for(let i=first;i<last;i++){
    if(signal?.aborted){status='stopped';break}const t=s.turns[i],cp={transcript:clone(tx),toolState:clone(ts),stateSummary:state(ts)},started=Date.now();
    try{const out=await runTurn({text:t.user,transcript:clone(tx),toolState:clone(ts),turnIndex:i,scenario:s}),r=compactTurnOutcome({outcome:out,user:t.user,turnIndex:i,checkpointBefore:cp,elapsedMs:Date.now()-started});turns.push(r);ts=clone(out?.toolState||ts);tx.push({role:'customer',text:t.user,at:iso()});if(r.reply)tx.push({role:'agent',text:r.reply,at:iso()});tx=transcript(tx);if(onProgress)await onProgress({turn:clone(r),completed:turns.length,total:last})}
    catch(error){turns.push({index:i,user:t.user,reply:'',status:'failed',degraded:true,error:compact(error?.message||error,1400),semantic:{},requiredFacts:[],returnedFacts:[],unknownFacts:[],supportUnknownFacts:[],factEvidence:[],toolTrace:[],knowledgeArticles:[],dialoguePolice:{violations:[],changed:false,notes:[]},usage:{},elapsedMs:Date.now()-started,stateBefore:clone(cp.stateSummary),stateAfter:state(ts),checkpointBefore:{transcript:clone(cp.transcript),toolState:clone(cp.toolState)}});status='failed';break}
    if(signal?.aborted){status='stopped';break}
  }
  if(status==='running')status=turns.some(x=>x.status==='failed')?'failed':turns.length<last?'stopped':turns.some(x=>x.status==='incomplete')?'incomplete':'complete';
  return{version:1,id:runId||rid(),scenarioId:s.id,scenarioTitle:s.title,scenarioTags:clone(s.tags),startedAt,finishedAt:iso(),status,turns,finalTranscript:clone(tx),finalToolState:clone(ts),summary:summary(turns,status)};
}
export const firstRetryableTurn=run=>{const x=(run?.turns||[]).find(t=>t?.status==='failed'||t?.status==='incomplete');return x?Number(x.index):-1};
export function checkpointForTurn(run={},i=0){const t=(run.turns||[]).find(x=>Number(x?.index)===Number(i));if(!t?.checkpointBefore)throw new Error(`Checkpoint for turn ${Number(i)+1} is not available.`);return clone(t.checkpointBefore)}
const comparable=t=>({reply:t?.reply||'',requiredFacts:t?.requiredFacts||[],returnedFacts:t?.returnedFacts||[],unknownFacts:t?.unknownFacts||[],tools:(t?.toolTrace||[]).map(x=>`${x.tool}:${x.code}:${x.ok?1:0}`),violations:t?.dialoguePolice?.violations||[],tokens:Number(t?.usage?.total_tokens||0),elapsedMs:Number(t?.elapsedMs||0),stateAfter:t?.stateAfter||{}});
export function compareScenarioRuns(a={},b={}){const n=Math.max(a.turns?.length||0,b.turns?.length||0),turns=[];for(let i=0;i<n;i++){const x=comparable(a.turns?.[i]),y=comparable(b.turns?.[i]),changed=[];for(const k of ['reply','requiredFacts','returnedFacts','unknownFacts','tools','violations','tokens','elapsedMs','stateAfter'])if(JSON.stringify(x[k])!==JSON.stringify(y[k]))changed.push(k);turns.push({index:i,changed,left:x,right:y})}return{leftRunId:a.id||'',rightRunId:b.id||'',scenarioId:a.scenarioId||b.scenarioId||'',changedTurns:turns.filter(x=>x.changed.length).length,turns}}
