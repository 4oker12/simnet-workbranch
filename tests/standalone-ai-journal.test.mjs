import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDecisionExport, decisionExportText } from '../standalone-ai/trace-report.js';
import { buildTopicMap } from '../standalone-ai/topic-map.js';

const read = file => readFileSync(new URL('../'+file, import.meta.url), 'utf8');
function turn(i, input, toolTrace = []) {
  return {
    customerMessageId: 'm'+i, input, at: '2026-10-28T12:00:00Z',
    decision: { intent: input, reply: 'Ответ #'+i, confidence: 0.9 },
    experiment: { customerMessageId: 'm'+i, at: '2026-10-28T12:00:00Z', activeVariant: 'v',
      analysis: { probe: { whatUserWants: input } },
      variants: [{label:'v',reply:'Ответ #'+i,toolTrace}] }
  };
}
test('journal UI contains real tab contents and their working event handlers', () => {
  const html=read('standalone-ai/chat.html');
  const js=read('standalone-ai/chat.js');
  const css=read('standalone-ai/chat.css');
  for (const id of ['viewMap','viewHistory','viewRead','viewExport','turnHistory','readTimeline','exportTurnJson','exportTurnTxt','exportSessionJson','exportSessionTxt','expandInspector','journalProgress']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/showJournalTab\(tabId\)/);
  assert.match(js,/renderHistory\(state/);
  assert.match(js,/renderRead\(state/);
  assert.match(js,/inspector-expanded/);
  assert.match(js,/selectedTurnId/);
  assert.match(js,/turnId: mode === 'last'/);
  assert.match(js,/exportTrace\('session', 'txt'\)/);
  assert.match(css,/\.inspector-view\[hidden\]/);
  assert.match(css,/body\.inspector-expanded \.workspace/);
  assert.doesNotMatch(js,/innerHTML|eval\(/);
});
test('selected old turn JSON/TXT must not silently revert to last turn', () => {
  const lab={id:'test',turnRecords:[
    turn(1,'что по балансу?', [{tool:'billing.balance',ok:true,code:'OK',source:'billing-live-read-only',data:{accountBalance:0}}]),
    turn(2,'а когда списание?', []) ],
    lastExperiment:turn(2,'а когда списание?').experiment,
    lastDecision:turn(2,'а когда списание?').decision
  };
  const selected=buildDecisionExport(lab,{mode:'last',turnId:'m1'});
  assert.equal(selected.turns.length,1);
  assert.equal(selected.turns[0].turnId,'m1');
  assert.equal(selected.turns[0].reads[0].data.accountBalance,0);
  assert.match(decisionExportText(selected),/billing\.balance/);
  const session=buildDecisionExport(lab,{mode:'session'});
  assert.equal(session.turns.length,2);
  assert.equal(session.turns[1].reads.length,0);
});
test('completed history exceeds 24 without being dropped by normalization', () => {
  const lab=read('src/features/ai-operator/lab-background.js');
  assert.doesNotMatch(lab,/MAX_TURN_RECORDS|turnRecords: .*\.slice\(|lab\.turnRecords = .*\.slice\(/);
  assert.match(lab,/lab\.turnRecords = \[\.\.\./);
  const manifest=JSON.parse(read('standalone-ai/manifest.json'));
  assert.equal(manifest.version,'0.2.0');
  assert.ok(manifest.permissions.includes('unlimitedStorage'));
  const many={turnRecords:Array.from({length:30},(_,i)=>turn(i+1,i%2?'какой тариф?':'какой баланс?'))};
  assert.equal(buildTopicMap(many).flatMap(g=>g.episodes).length,30);
  assert.equal(buildDecisionExport(many,{mode:'session'}).turns.length,30);
});
test('READ=0 does not become verified source in thematic map', () => {
  const topics=buildTopicMap({turnRecords:[turn(1,'Когда списание по балансу?',[])]});
  const balance=topics.find(t=>t.id==='balance');
  assert.ok(balance);
  assert.equal(balance.status,'unverified');
  assert.ok(balance.episodes[0].steps.some(s=>s.kind==='read'&&s.status==='unknown'));
});
