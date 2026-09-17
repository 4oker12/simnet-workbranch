import assert from 'node:assert/strict';
import {
  activeCompanionEpisode,
  applyCompanionToolResult,
  extractCompanionTarget,
  prepareCompanionWorkTurn
} from '../src/features/operator-companion/work-state.js';

let state = {};
let turn = prepareCompanionWorkTurn(state, 'расскажи короткую шутку', { nowMs: 1000 });
state = turn.state;
assert.equal(turn.activeEpisode, null, 'casual chat must not create a subscriber work episode');
assert.equal(state.episodes.length, 0);

turn = prepareCompanionWorkTurn(state, 'ладно братан, нам заявка пришла, глянь по 423525 что с интернетом, а потом на перекур снова', { nowMs: 2000 });
state = turn.state;
assert.equal(turn.activeEpisode?.target?.contract, '423525');
const firstEpisodeId = turn.activeEpisode.id;
assert.equal(state.episodes.length, 1);

turn = prepareCompanionWorkTurn(state, 'а баланс?', { nowMs: 3000 });
state = turn.state;
assert.equal(turn.activeEpisode?.id, firstEpisodeId, 'coreference must keep current subscriber');

turn = prepareCompanionWorkTurn(state, 'кстати, расскажи шутку про роутер', { nowMs: 4000 });
state = turn.state;
assert.equal(turn.activeEpisode?.id, firstEpisodeId, 'casual interlude must not destroy current work context');

turn = prepareCompanionWorkTurn(state, 'да ну это всё смешно', { nowMs: 4500 });
state = turn.state;
assert.equal(turn.activeEpisode?.id, firstEpisodeId, 'ordinary casual use of «всё» must not close the work episode');

state = applyCompanionToolResult(state, firstEpisodeId, {
  tool: 'billing.balance', ok: true, code: 'OK', observedAt: '2026-09-18T00:00:00.000Z',
  data: { accountBalance: '125.00' },
  statePatch: { confirmedCaseId: 'billing-live:423525', confirmedSubscriber: { contract: '423525', billingId: '423525' } }
});
assert.equal(activeCompanionEpisode(state)?.latestByTool?.['billing.balance']?.data?.accountBalance, '125.00');

turn = prepareCompanionWorkTurn(state, 'всё, с ним закончили', { nowMs: 5000 });
state = turn.state;
assert.equal(turn.activeEpisode, null, 'natural close phrase must end only the work episode');
assert.equal(state.episodes.find(item => item.id === firstEpisodeId)?.status, 'closed');

turn = prepareCompanionWorkTurn(state, '249040', { nowMs: 6000 });
state = turn.state;
assert.equal(turn.activeEpisode?.target?.contract, '249040');
const secondEpisodeId = turn.activeEpisode.id;
assert.notEqual(secondEpisodeId, firstEpisodeId);

state = applyCompanionToolResult(state, secondEpisodeId, {
  tool: 'billing.balance', ok: true, code: 'OK', observedAt: '2026-09-18T00:01:00.000Z',
  data: { accountBalance: '999.00' },
  statePatch: { confirmedCaseId: 'billing-live:249040', confirmedSubscriber: { contract: '249040', billingId: '249040' } }
});
assert.equal(state.episodes.find(item => item.id === firstEpisodeId)?.latestByTool?.['billing.balance']?.data?.accountBalance, '125.00', 'facts must stay isolated by subscriber');
assert.equal(state.episodes.find(item => item.id === secondEpisodeId)?.latestByTool?.['billing.balance']?.data?.accountBalance, '999.00');

turn = prepareCompanionWorkTurn(state, 'а у предыдущего какой сигнал был?', { nowMs: 7000 });
state = turn.state;
assert.equal(turn.activeEpisode?.id, firstEpisodeId, 'previous subscriber reference must reopen prior work episode');
assert.equal(turn.reopened, true);
assert.equal(state.episodes.find(item => item.id === secondEpisodeId)?.status, 'closed');

turn = prepareCompanionWorkTurn(state, '249040 глянь теперь сессию', { nowMs: 8000 });
state = turn.state;
assert.equal(turn.activeEpisode?.id, secondEpisodeId, 'explicit target must override current/coreference target');
assert.equal(turn.activeEpisode?.latestByTool?.['billing.balance']?.data?.accountBalance, '999.00', 'reopened episode keeps its own facts');

assert.equal(extractCompanionTarget('скорость 100 мбит'), null, 'ordinary numbers must not be mistaken for contract IDs');
assert.equal(extractCompanionTarget('что такое dying-gasp?'), null);

console.log('operator_companion_work_state_test: PASS', { firstEpisodeId, secondEpisodeId });
