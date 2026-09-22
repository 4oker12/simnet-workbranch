import assert from 'node:assert/strict';
import { runScenario, compareScenarioRuns, checkpointForTurn, firstRetryableTurn } from '../src/features/ai-operator/scenario-replay.js';
import { SCENARIO_REPLAY_CASES } from '../src/features/ai-operator/scenario-replay-cases.js';

assert.equal(SCENARIO_REPLAY_CASES.length, 10);
for (const scenarioCase of SCENARIO_REPLAY_CASES) {
  assert.equal(scenarioCase.turns.length, 8, scenarioCase.id);
  const fixtureText = scenarioCase.turns.map(turn => turn.user).join('\n');
  assert.doesNotMatch(fixtureText, /\babon408980\b|\bgiv1984\b/i, `${scenarioCase.id}: hardcoded subscriber leaked into scenario fixture`);
  assert.doesNotMatch(fixtureText, /^\s*(?:abon)?\d{3,12}\b/im, `${scenarioCase.id}: identity belongs to subject input, not dialogue fixture`);
}

const scenario = { id: 'sequence_test', title: 'Sequence test', turns: [{ user: 'one' }, { user: 'two' }, { user: 'three' }] };
let inFlight = 0;
let maxInFlight = 0;
const seenMarkers = [];
const seenSubscribers = [];
const seedToolState = {
  marker: 0,
  confirmedCaseId: 'billing-live:40898',
  confirmedSubscriber: { billingId: '40898', contract: '408980', fullName: 'Test Subscriber' }
};
const run = await runScenario({
  scenario,
  seedToolState,
  runTurn: async ({ text, toolState, turnIndex }) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    seenMarkers.push(toolState.marker);
    seenSubscribers.push(toolState.confirmedSubscriber?.contract || '');
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight -= 1;
    return {
      toolState: {
        ...toolState,
        marker: turnIndex + 1,
        domainContext: { ...(toolState.domainContext || {}), dialogue: { activeRequests: [text], activeRequiredFacts: [`fact.${turnIndex + 1}`] } }
      },
      experiment: {
        id: `exp_${turnIndex}`, elapsedMs: 5, usage: { total_tokens: 10 },
        analysis: { probe: { whatUserWants: text, unresolvedRequests: [], requiredFacts: [`fact.${turnIndex + 1}`] }, knowledge: { usedArticles: [] } },
        variants: [{ label: 'v', reply: `answer ${text}`, factDiagnostics: { returnedFacts: [`fact.${turnIndex + 1}`], unknownFacts: [] }, factEvidence: [{ path: `fact.${turnIndex + 1}`, status: 'known', value: true }], toolTrace: [] }],
        activeVariant: 'v'
      }
    };
  }
});

assert.equal(maxInFlight, 1);
assert.deepEqual(seenMarkers, [0, 1, 2]);
assert.deepEqual(seenSubscribers, ['408980', '408980', '408980'], 'real subscriber must remain the dialogue object across turns');
assert.equal(run.status, 'complete');
assert.equal(run.finalTranscript.length, 6);
assert.equal(checkpointForTurn(run, 1).toolState.confirmedSubscriber.contract, '408980');
assert.equal(firstRetryableTurn(run), -1);

const controller = new AbortController();
let started = 0;
const stopped = await runScenario({
  scenario,
  signal: controller.signal,
  runTurn: async ({ text, turnIndex }) => {
    started += 1;
    if (turnIndex === 0) controller.abort();
    return { toolState: {}, experiment: { analysis: { probe: { whatUserWants: text, unresolvedRequests: [] }, knowledge: { usedArticles: [] } }, variants: [{ label: 'v', reply: 'ok', factDiagnostics: { returnedFacts: [], unknownFacts: [] }, toolTrace: [] }], activeVariant: 'v' } };
  }
});
assert.equal(started, 1);
assert.equal(stopped.status, 'stopped');

const changed = structuredClone(run);
changed.id = 'changed';
changed.turns[1].reply = 'different';
changed.turns[1].dialoguePolice = { violations: ['REPEATED_INFORMATION'] };
const comparison = compareScenarioRuns(run, changed);
assert.equal(comparison.changedTurns, 1);
assert.ok(comparison.turns[1].changed.includes('reply'));
assert.ok(comparison.turns[1].changed.includes('violations'));

const incomplete = structuredClone(run);
incomplete.turns[1].status = 'incomplete';
assert.equal(firstRetryableTurn(incomplete), 1);
console.log('ai_operator_scenario_replay_test: ok');
