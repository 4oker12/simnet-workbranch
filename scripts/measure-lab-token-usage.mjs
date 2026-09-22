#!/usr/bin/env node
/**
 * Token measurement for exported AI Operator Lab / api-cost JSON.
 *
 * Usage:
 *   node scripts/measure-lab-token-usage.mjs path/to/export.json
 *   node scripts/measure-lab-token-usage.mjs path/to/export.json --json
 *
 * Important Lab detail: historic `experiment_result` events contain `totalTokens`
 * but often no `customerMessageId`. We associate them with the active customer turn
 * while walking the ordered event stream. Detailed data for the current turn wins
 * over its aggregate `experiment_result`, so that turn is never counted twice.
 */

import fs from 'node:fs';
import path from 'node:path';

function readInput(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function usageFrom(value = {}) {
  const input = num(
    value.input
    ?? value.prompt_tokens
    ?? value.promptTokens
    ?? value.input_tokens
    ?? value.usage?.prompt_tokens
    ?? value.usage?.promptTokens
    ?? value.usage?.input
  );
  const output = num(
    value.output
    ?? value.completion_tokens
    ?? value.completionTokens
    ?? value.output_tokens
    ?? value.usage?.completion_tokens
    ?? value.usage?.completionTokens
    ?? value.usage?.output
  );
  const total = num(
    value.total
    ?? value.total_tokens
    ?? value.totalTokens
    ?? value.tokens
    ?? value.usage?.total
    ?? value.usage?.total_tokens
    ?? value.usage?.totalTokens
    ?? value.usage?.tokens
  ) || (input + output);
  return { input, output, total };
}

function stageName(value = {}) {
  const stage = String(value.stage || value.variant || value.label || value.type || '').trim();
  if (!stage) return 'unknown';
  const lower = stage.toLowerCase();
  if (/prompt.?guard|guard/.test(lower)) return 'prompt_guard';
  if (/understand|semantic_analysis|intent|nlu|probe/.test(lower)) return 'understanding';
  // `reply_with_knowledge` / `with_knowledge` are reply calls, not a separate KB LLM stage.
  if (/reply|synthesis|answer|generatesubscriberreply|final|with_knowledge|without_knowledge/.test(lower)) return 'reply';
  if (/knowledge|reflection/.test(lower)) return 'knowledge';
  if (/ground|tool.?broker|tool_execution/.test(lower)) return 'tool_grounding';
  return stage;
}

function makeCall({ turnId, stage, model, usage, source, aggregate = false, sequence = null }) {
  return {
    turnId: String(turnId || 'turn'),
    stage: String(stage || 'unknown'),
    model: String(model || 'unknown'),
    source: String(source || 'unknown'),
    aggregate: Boolean(aggregate),
    sequence: sequence == null ? null : String(sequence),
    ...usage
  };
}

function collectCallsFromApiCost(apiCost = {}, fallbackTurnId = null) {
  const calls = [];
  const defaultTurnId = fallbackTurnId || apiCost.turnId || 'turn';

  if (Array.isArray(apiCost.turnCalls)) {
    for (const item of apiCost.turnCalls) {
      const usage = usageFrom(item);
      if (!usage.total && !usage.input && !usage.output) continue;
      calls.push(makeCall({
        turnId: item.turnId || defaultTurnId,
        stage: stageName(item),
        model: item.model,
        usage,
        source: 'apiCost.turnCalls',
        sequence: item.sequence ?? item.seq ?? item.id
      }));
    }
  }

  if (apiCost.turns && typeof apiCost.turns === 'object') {
    for (const [turnId, bucket] of Object.entries(apiCost.turns)) {
      for (const item of Array.isArray(bucket?.calls) ? bucket.calls : []) {
        const usage = usageFrom(item);
        if (!usage.total && !usage.input && !usage.output) continue;
        calls.push(makeCall({
          turnId,
          stage: stageName(item),
          model: item.model,
          usage,
          source: 'apiCost.turns',
          sequence: item.sequence ?? item.seq ?? item.id
        }));
      }
    }
  }

  return calls;
}

function collectExperimentDetails(experiment = {}) {
  const calls = [];
  const turnId = String(experiment.customerMessageId || experiment.turnId || experiment.id || 'last');

  if (experiment.analysis?.usage || experiment.analysis?.decision?.usage) {
    const usage = usageFrom(experiment.analysis.usage || experiment.analysis.decision?.usage || {});
    if (usage.total || usage.input || usage.output) {
      calls.push(makeCall({
        turnId,
        stage: 'understanding',
        model: experiment.analysis.model || experiment.model,
        usage,
        source: 'lastExperiment.analysis',
        sequence: 'understanding'
      }));
    }
  }

  for (const [index, variant] of (Array.isArray(experiment.variants) ? experiment.variants : []).entries()) {
    const usage = usageFrom(variant);
    if (!usage.total && !usage.input && !usage.output) continue;
    calls.push(makeCall({
      turnId,
      stage: 'reply',
      model: variant.model || experiment.model,
      usage,
      source: `lastExperiment.variant:${String(variant.label || 'reply')}`,
      sequence: variant.sequence ?? variant.id ?? `variant-${index + 1}`
    }));
  }

  if (experiment.usage && !Array.isArray(experiment.variants)) {
    const usage = usageFrom(experiment.usage);
    if (usage.total || usage.input || usage.output) {
      calls.push(makeCall({
        turnId,
        stage: 'reply',
        model: experiment.model,
        usage,
        source: 'lastExperiment.usage',
        sequence: 'reply'
      }));
    }
  }

  return calls;
}

function collectEventTotals(events = [], { currentExperimentId = null, currentTurnId = null } = {}) {
  const calls = [];
  let activeCustomerMessageId = null;

  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'customer_message' && event?.messageId) {
      activeCustomerMessageId = String(event.messageId);
    }
    if (event?.customerMessageId) {
      activeCustomerMessageId = String(event.customerMessageId);
    }

    const hasUsage = Boolean(
      event?.usage
      || event?.tokens != null
      || event?.totalTokens != null
      || event?.total_tokens != null
    );
    if (!hasUsage) continue;

    const usage = usageFrom(
      event.usage
      || {
        total: event.tokens ?? event.totalTokens ?? event.total_tokens,
        input: event.input ?? event.inputTokens ?? event.prompt_tokens,
        output: event.output ?? event.outputTokens ?? event.completion_tokens
      }
    );
    if (!usage.total && !usage.input && !usage.output) continue;

    const belongsToCurrentExperiment = Boolean(
      currentExperimentId
      && event?.experimentId
      && String(event.experimentId) === String(currentExperimentId)
    );
    const turnId = belongsToCurrentExperiment && currentTurnId
      ? currentTurnId
      : (event.customerMessageId || event.turnId || activeCustomerMessageId || event.id || 'event');

    calls.push(makeCall({
      turnId,
      stage: event.type === 'experiment_result' ? 'turn_total' : stageName(event),
      model: event.model,
      usage,
      source: `events:${String(event.type || 'event')}`,
      aggregate: event.type === 'experiment_result' || (!usage.input && !usage.output && usage.total > 0),
      sequence: event.id || event.experimentId
    }));
  }
  return calls;
}

function collectCallsFromLab(lab = {}) {
  const experiment = lab.lastExperiment || lab.experiment || null;
  const experimentTurnId = experiment
    ? String(experiment.customerMessageId || experiment.turnId || experiment.id || 'last')
    : null;
  const experimentId = experiment?.id || experiment?.experimentId || null;

  const apiCalls = lab.apiCost
    ? collectCallsFromApiCost(lab.apiCost, experimentTurnId)
    : [];

  // apiCost is the richest current-turn source. If it exists, do not also count
  // lastExperiment analysis/variants for the same current turn.
  const detailCalls = apiCalls.length
    ? apiCalls
    : (experiment ? collectExperimentDetails(experiment) : []);

  const eventCalls = collectEventTotals(lab.events, {
    currentExperimentId: experimentId,
    currentTurnId: experimentTurnId
  });
  return [...detailCalls, ...eventCalls];
}

function collectCallsGeneric(root) {
  if (Array.isArray(root)) {
    const calls = [];
    root.forEach((item, index) => {
      const turnId = String(item.turnId || item.customerMessageId || item.id || `turn-${index + 1}`);
      const list = item.calls || item.llmCalls || item.turnCalls || [];
      if (Array.isArray(list) && list.length) {
        for (const call of list) {
          const usage = usageFrom(call);
          if (!usage.total && !usage.input && !usage.output) continue;
          calls.push(makeCall({
            turnId,
            stage: stageName(call),
            model: call.model,
            usage,
            source: 'array.calls',
            sequence: call.sequence ?? call.seq ?? call.id
          }));
        }
      } else if (item.usage || item.prompt_tokens != null || item.total_tokens != null || item.totalTokens != null || item.tokens != null) {
        const usage = usageFrom(item);
        if (!usage.total && !usage.input && !usage.output) return;
        calls.push(makeCall({ turnId, stage: stageName(item), model: item.model, usage, source: 'array.item', sequence: item.sequence ?? item.id }));
      }
    });
    return calls;
  }

  if (!root || typeof root !== 'object') return [];

  const looksLikeLab = Boolean(root.lastExperiment || root.experiment || root.events || root.apiCost);
  if (looksLikeLab) return collectCallsFromLab(root);

  if (root.turnCalls || root.turns) return collectCallsFromApiCost(root, root.turnId || null);

  if (root.usage || root.prompt_tokens != null || root.total_tokens != null || root.totalTokens != null || root.tokens != null) {
    const usage = usageFrom(root);
    return [makeCall({
      turnId: root.turnId || root.customerMessageId || root.id || 'turn',
      stage: stageName(root),
      model: root.model,
      usage,
      source: 'root',
      sequence: root.sequence ?? root.id
    })];
  }

  return [];
}

function normalizeCalls(calls) {
  const detailedTurns = new Set(calls.filter(call => !call.aggregate).map(call => call.turnId));

  // Historic experiment_result totals are valuable, but an aggregate for a turn
  // with stage-level details is verification metadata, not an extra call.
  const preferred = calls.filter(call => !(call.aggregate && detailedTurns.has(call.turnId)));

  const seen = new Set();
  const unique = [];
  for (const call of preferred) {
    const identity = call.sequence
      ? `${call.turnId}|${call.sequence}|${call.stage}|${call.model}|${call.input}|${call.output}|${call.total}`
      : `${call.turnId}|${call.stage}|${call.model}|${call.input}|${call.output}|${call.total}|${call.aggregate ? 'aggregate' : 'detail'}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(call);
  }
  return unique;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function groupByTurn(calls) {
  const map = new Map();
  for (const call of calls) {
    if (!map.has(call.turnId)) map.set(call.turnId, []);
    map.get(call.turnId).push(call);
  }
  return map;
}

function payloadBreakdownNote(root) {
  const notes = [];
  const hasSizes = Boolean(
    root?.payloadBytes
    || root?.promptSections
    || root?.diagnostics?.promptChars
    || root?.lastExperiment?.analysis?.decision?.promptChars
  );
  if (!hasSizes) {
    notes.push('Payload-block breakdown (conversation / instructions / tool manifest / KB / evidence / diagnostics) is NOT present in this export.');
    notes.push('To measure those blocks, Lab needs additional instrumentation that records section character/token sizes per LLM call.');
    return notes;
  }
  notes.push('Export contains some payload size fields; raw values:');
  if (root.payloadBytes) notes.push(JSON.stringify(root.payloadBytes, null, 2));
  if (root.promptSections) notes.push(JSON.stringify(root.promptSections, null, 2));
  return notes;
}

function printHuman(turns, session, notes) {
  for (const [turnId, calls] of turns) {
    const total = calls.reduce((sum, item) => sum + item.total, 0);
    console.log(`TURN ${turnId}`);
    const byStage = new Map();
    for (const call of calls) {
      const prev = byStage.get(call.stage) || { input: 0, output: 0, total: 0, models: new Set() };
      prev.input += call.input;
      prev.output += call.output;
      prev.total += call.total;
      prev.models.add(call.model);
      byStage.set(call.stage, prev);
    }
    for (const stage of ['prompt_guard', 'understanding', 'knowledge', 'reply', 'tool_grounding', 'turn_total']) {
      if (!byStage.has(stage)) continue;
      const row = byStage.get(stage);
      console.log(`├─ ${stage}: in=${row.input} out=${row.output} total=${row.total} model=${[...row.models].join('|')}`);
      byStage.delete(stage);
    }
    for (const [stage, row] of byStage) {
      console.log(`├─ ${stage}: in=${row.input} out=${row.output} total=${row.total} model=${[...row.models].join('|')}`);
    }
    console.log(`└─ TOTAL: ${total}`);
    console.log('');
  }

  console.log('SESSION');
  console.log(`turns: ${session.turns}`);
  console.log(`average per turn: ${session.average}`);
  console.log(`median per turn: ${session.median}`);
  console.log(`max per turn: ${session.max}`);
  console.log(`total session tokens: ${session.total}`);
  console.log(`calls: ${session.calls}`);
  console.log('');
  for (const note of notes) console.log(`NOTE: ${note}`);
}

function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--json');
  const asJson = process.argv.includes('--json');
  if (!args[0]) {
    console.error('Usage: node scripts/measure-lab-token-usage.mjs <export.json> [--json]');
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  const root = readInput(filePath);
  const unique = normalizeCalls(collectCallsGeneric(root));
  const turns = groupByTurn(unique);
  const turnTotals = [...turns.values()].map(list => list.reduce((sum, item) => sum + item.total, 0));
  const total = turnTotals.reduce((a, b) => a + b, 0);
  const session = {
    turns: turnTotals.length,
    calls: unique.length,
    total,
    average: turnTotals.length ? Math.round(total / turnTotals.length) : 0,
    median: Math.round(median(turnTotals)),
    max: turnTotals.length ? Math.max(...turnTotals) : 0
  };

  const notes = payloadBreakdownNote(root);
  if (!unique.length) {
    notes.push('No token usage records found. Export apiCost.turnCalls, events[].experiment_result.totalTokens, or Lab lastExperiment usage.');
  }

  if (asJson) {
    console.log(JSON.stringify({
      file: filePath,
      calls: unique,
      turns: Object.fromEntries([...turns.entries()].map(([id, list]) => [id, list])),
      session,
      notes
    }, null, 2));
    return;
  }

  printHuman(turns, session, notes);
}

main();
