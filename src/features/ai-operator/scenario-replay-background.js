'use strict';

import { AI_OPERATOR_LAB_KEY, runIsolatedLabCase } from './lab-background.js';
import { executeOperatorTool } from './live-tool-runtime.js';
import { SCENARIO_REPLAY_CASES, getScenarioReplayCase, listScenarioReplayCases } from './scenario-replay-cases.js';
import { checkpointForTurn, compareScenarioRuns, firstRetryableTurn, runScenario } from './scenario-replay.js';

const STORAGE_KEY = 'simnet_ai_operator_scenario_replay_v1';
const MAX_RUNS = 30;

const TYPES = Object.freeze({
  LIST: 'AI_OPERATOR_SCENARIO_LIST', RUN: 'AI_OPERATOR_SCENARIO_RUN', RUN_ALL: 'AI_OPERATOR_SCENARIO_RUN_ALL',
  STOP: 'AI_OPERATOR_SCENARIO_STOP', RESULTS: 'AI_OPERATOR_SCENARIO_RESULTS', RERUN_TURN: 'AI_OPERATOR_SCENARIO_RERUN_TURN',
  RERUN_FAILED: 'AI_OPERATOR_SCENARIO_RERUN_FAILED', COMPARE: 'AI_OPERATOR_SCENARIO_COMPARE',
  EXPORT: 'AI_OPERATOR_SCENARIO_EXPORT', CLEAR: 'AI_OPERATOR_SCENARIO_CLEAR'
});

let activePromise = null;
let activeController = null;
let activeMeta = null;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function compact(value, max = 1000) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function currentLabState() {
  const raw = (await chrome.storage.local.get(AI_OPERATOR_LAB_KEY))?.[AI_OPERATOR_LAB_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw) : {};
}

async function readStore() {
  const raw = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY];
  const store = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { version: 1, runs: Array.isArray(store.runs) ? store.runs : [] };
}

function identityToolArgs(value = '') {
  const input = compact(value, 120).replace(/\u00a0/g, ' ').trim();
  if (!input) throw new Error('Укажите номер договора или login реального абонента.');
  const abon = input.match(/^abon\s*[-:#№]?\s*(\d{3,12})$/i)?.[1] || '';
  if (abon) return { input, kind: 'contract', toolArgs: { contract: abon } };
  if (/^\d{3,12}$/.test(input)) return { input, kind: 'contract', toolArgs: { contract: input } };
  if (/^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(input)) return { input, kind: 'login', toolArgs: { login: input } };
  throw new Error('Объект теста: ожидается номер договора, abonNNN или Billing login.');
}

async function bootstrapRealSubscriber(subjectIdentity = '') {
  const identity = identityToolArgs(subjectIdentity);
  const lookup = await executeOperatorTool({ tool: 'customer.lookup', toolArgs: identity.toolArgs, labState: {} });
  if (!lookup?.ok) {
    throw new Error(`Не удалось выбрать реального абонента (${String(lookup?.code || 'LOOKUP_FAILED')}). Проверь договор/login.`);
  }
  const patch = lookup.statePatch && typeof lookup.statePatch === 'object' ? lookup.statePatch : {};
  const candidate = clone(patch.confirmedSubscriber || lookup?.data?.candidate || null);
  const confirmedCaseId = compact(patch.confirmedCaseId || candidate?.caseId, 180);
  if (!candidate || !confirmedCaseId) throw new Error('customer.lookup не вернул подтверждённого subscriber case.');

  const toolState = {
    pendingCandidate: null,
    confirmedCaseId,
    confirmedSubscriber: candidate,
    invalidatedAt: 0,
    domainContext: {},
    factSourceCache: {}
  };
  const subject = {
    input: identity.input,
    kind: identity.kind,
    caseId: confirmedCaseId,
    billingId: compact(candidate.billingId, 40),
    contract: compact(candidate.contract, 80),
    login: compact(candidate.login, 80),
    fullName: compact(candidate.fullName, 180),
    address: compact(candidate.address, 260),
    connectionFamily: compact(candidate.connectionFamily, 80),
    lookup: { tool: 'customer.lookup', code: String(lookup.code || 'OK'), source: compact(lookup?.data?.source, 120) }
  };
  return { subject, toolState };
}

function compactCheckpointState(state = {}) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const domainContext = clone(source.domainContext || {});
  if (domainContext?.factSourceCache) delete domainContext.factSourceCache;
  return {
    confirmedCaseId: source.confirmedCaseId || '', confirmedSubscriber: clone(source.confirmedSubscriber || null),
    pendingCandidate: clone(source.pendingCandidate || null), domainContext,
    conversationState: clone(source.conversationState || null), alreadyExplainedFacts: clone(source.alreadyExplainedFacts || []),
    offeredActions: clone(source.offeredActions || []), factSourceCache: clone(source.factSourceCache || {})
  };
}

function persistableRun(run = {}) {
  const value = clone(run);
  value.finalToolState = compactCheckpointState(value.finalToolState || {});
  value.turns = (value.turns || []).map(turn => ({ ...turn, checkpointBefore: turn?.checkpointBefore ? {
    transcript: clone(turn.checkpointBefore.transcript || []).slice(-40), toolState: compactCheckpointState(turn.checkpointBefore.toolState || {})
  } : null }));
  return value;
}

async function saveRun(run) {
  const store = await readStore();
  const persisted = persistableRun(run);
  await chrome.storage.local.set({ [STORAGE_KEY]: { version: 1, runs: [persisted, ...store.runs.filter(item => item?.id !== persisted.id)].slice(0, MAX_RUNS) } });
  return persisted;
}

function runSummary(run = {}) {
  return {
    id: run.id || '', scenarioId: run.scenarioId || '', scenarioTitle: run.scenarioTitle || '', status: run.status || '',
    startedAt: run.startedAt || '', finishedAt: run.finishedAt || '', summary: clone(run.summary || {}),
    mode: run.mode || 'scenario', parentRunId: run.parentRunId || '', subject: clone(run.subject || null)
  };
}

async function statePayload() {
  const store = await readStore();
  return { version: 1, cases: listScenarioReplayCases(), active: activeMeta ? clone(activeMeta) : null, runs: store.runs.map(runSummary) };
}

function activeVariant(experiment = {}) {
  const variants = Array.isArray(experiment?.variants) ? experiment.variants : [];
  return variants.find(item => item?.label === experiment?.activeVariant) || variants[0] || null;
}

async function executeScenario(scenario, payload = {}, replay = {}) {
  const lab = await currentLabState();
  const knowledgeMode = String(payload.knowledgeMode || lab.knowledgeMode || 'auto');
  const behavior = clone(payload.behavior || lab.behavior || {});
  const subject = clone(replay.subject || null);
  if (!subject?.caseId) throw new Error('Scenario Replay требует заранее подтверждённого реального абонента.');
  const runScope = `scenario_${scenario.id}_${subject.billingId || subject.contract || 'subscriber'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const controller = activeController;
  activeMeta = { scenarioId: scenario.id, title: scenario.title, subject: clone(subject), currentTurn: Number(replay.startIndex || 0), totalTurns: scenario.turns.length, startedAt: new Date().toISOString(), mode: replay.mode || 'scenario' };

  const run = await runScenario({
    scenario, signal: controller?.signal || null, startIndex: replay.startIndex || 0,
    endIndex: replay.endIndex == null ? null : replay.endIndex, seedTranscript: replay.seedTranscript || [],
    seedToolState: clone(replay.seedToolState || {}), existingTurns: replay.existingTurns || [],
    runTurn: async ({ text, transcript, toolState, turnIndex }) => {
      activeMeta = { ...activeMeta, currentTurn: turnIndex, totalTurns: scenario.turns.length };
      const outcome = await runIsolatedLabCase({ text, transcript, knowledgeMode, behavior, toolState, scope: `${runScope}:turn_${turnIndex + 1}` });
      const variant = activeVariant(outcome?.experiment);
      if (variant && !variant.dialoguePolice && outcome?.decision?.dialoguePolice) variant.dialoguePolice = clone(outcome.decision.dialoguePolice);
      return outcome;
    }
  });
  run.mode = replay.mode || 'scenario';
  run.parentRunId = replay.parentRunId || '';
  run.knowledgeMode = knowledgeMode;
  run.behavior = behavior;
  run.subject = subject;
  return saveRun(run);
}

function locked(action) {
  if (activePromise) throw new Error('Scenario Replay уже выполняется. Остановите текущий прогон или дождитесь завершения хода.');
  activeController = new AbortController();
  activePromise = Promise.resolve().then(action).finally(() => { activePromise = null; activeController = null; activeMeta = null; });
  return activePromise;
}

async function runOne(payload = {}) {
  const scenario = getScenarioReplayCase(payload.scenarioId || payload.id);
  if (!scenario) throw new Error('Scenario Replay: неизвестный scenarioId.');
  const boot = await bootstrapRealSubscriber(payload.subjectIdentity);
  return executeScenario(scenario, payload, { seedToolState: boot.toolState, subject: boot.subject });
}

async function runAll(payload = {}) {
  const boot = await bootstrapRealSubscriber(payload.subjectIdentity);
  const completed = [];
  for (const scenario of SCENARIO_REPLAY_CASES) {
    if (activeController?.signal.aborted) break;
    completed.push(await executeScenario(scenario, payload, { seedToolState: clone(boot.toolState), subject: clone(boot.subject) }));
  }
  return { stopped: Boolean(activeController?.signal.aborted), subject: clone(boot.subject), runs: completed.map(runSummary), state: await statePayload() };
}

async function findRun(runId) {
  const store = await readStore();
  const run = store.runs.find(item => item?.id === String(runId || ''));
  if (!run) throw new Error('Scenario Replay run не найден.');
  return clone(run);
}

async function rerunTurn(payload = {}) {
  const source = await findRun(payload.runId), scenario = getScenarioReplayCase(source.scenarioId), index = Number(payload.turnIndex);
  if (!scenario) throw new Error('Исходный scenario больше не найден.');
  if (!Number.isInteger(index) || index < 0 || index >= scenario.turns.length) throw new Error('Некорректный номер turn для rerun.');
  const checkpoint = checkpointForTurn(source, index);
  return executeScenario(scenario, payload, { mode: 'rerun_turn', parentRunId: source.id, startIndex: index, endIndex: index + 1, seedTranscript: checkpoint.transcript, seedToolState: checkpoint.toolState, existingTurns: [], subject: source.subject });
}

async function rerunFailed(payload = {}) {
  const source = await findRun(payload.runId), scenario = getScenarioReplayCase(source.scenarioId), index = firstRetryableTurn(source);
  if (!scenario) throw new Error('Исходный scenario больше не найден.');
  if (index < 0) throw new Error('В этом run нет failed/incomplete turn для повторного прогона.');
  const checkpoint = checkpointForTurn(source, index);
  return executeScenario(scenario, payload, { mode: 'rerun_failed', parentRunId: source.id, startIndex: index, seedTranscript: checkpoint.transcript, seedToolState: checkpoint.toolState, existingTurns: source.turns.filter(turn => Number(turn?.index) < index), subject: source.subject });
}

async function compare(payload = {}) { return compareScenarioRuns(await findRun(payload.leftRunId), await findRun(payload.rightRunId)); }
async function exportRun(payload = {}) { return { exportedAt: new Date().toISOString(), run: await findRun(payload.runId) }; }
async function clearRuns() { if (activePromise) throw new Error('Нельзя очищать Scenario Replay во время прогона.'); await chrome.storage.local.remove(STORAGE_KEY); return statePayload(); }
function stopActive() { if (!activeController) return { stopped: false, active: null }; const active = clone(activeMeta); activeController.abort(); return { stopped: true, active }; }

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;
  const payload = message?.payload || {};
  let action;
  try {
    action = type === TYPES.LIST || type === TYPES.RESULTS ? statePayload()
      : type === TYPES.RUN ? locked(() => runOne(payload))
        : type === TYPES.RUN_ALL ? locked(() => runAll(payload))
          : type === TYPES.RERUN_TURN ? locked(() => rerunTurn(payload))
            : type === TYPES.RERUN_FAILED ? locked(() => rerunFailed(payload))
              : type === TYPES.COMPARE ? compare(payload)
                : type === TYPES.EXPORT ? exportRun(payload)
                  : type === TYPES.CLEAR ? clearRuns()
                    : Promise.resolve(stopActive());
  } catch (error) { sendResponse({ success: false, error: compact(error?.message || error || 'Scenario Replay error', 1400) }); return false; }
  void Promise.resolve(action).then(data => sendResponse({ success: true, data }), error => sendResponse({ success: false, error: compact(error?.message || error || 'Scenario Replay error', 1400) }));
  return true;
});

export const AI_OPERATOR_SCENARIO_MESSAGE_TYPES = TYPES;
export const AI_OPERATOR_SCENARIO_STORAGE_KEY = STORAGE_KEY;
export { identityToolArgs, bootstrapRealSubscriber };
