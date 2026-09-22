#!/usr/bin/env node
/**
 * Token measurement for exported AI Operator Lab / api-cost JSON.
 *
 * Usage:
 *   node scripts/measure-lab-token-usage.mjs path/to/export.json
 *   node scripts/measure-lab-token-usage.mjs path/to/export.json --json
 *
 * Accepted shapes (best-effort):
 * 1) Full lab blob: { messages, events, lastExperiment, apiCost, ... }
 * 2) apiCost summary: { turnCalls, turns, total, ... }
 * 3) Array of turns with { calls|llmCalls|usage, ... }
 * 4) Generic object with nested usage / prompt_tokens fields
 *
 * Payload-block sizes are reported only when the export contains them.
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
  const total = num(value.total ?? value.total_tokens ?? value.totalTokens ?? value.usage?.total_tokens) || (input + output);
  return { input, output, total };
}

function stageName(value = {}) {
  const stage = String(value.stage || value.variant || value.label || value.type || '').trim();
  if (!stage) return 'unknown';
  const lower = stage.toLowerCase();
  if (/prompt.?guard|guard/.test(lower)) return 'prompt_guard';
  if (/understand|semantic_analysis|intent|nlu|probe/.test(lower)) return 'understanding';
  if (/knowledge|reflection/.test(lower)) return 'knowledge';
  if (/reply|synthesis|answer|generateSubscriberReply|final/.test(lower)) return 'reply';
  if (/ground|tool.?broker|tool_execution/.test(lower)) return 'tool_grounding';
  return stage;
}

function collectCallsFromApiCost(apiCost = {}) {
  const calls = [];
  if (Array.isArray(apiCost.turnCalls)) {
    for (const item of apiCost.turnCalls) {
      const u = usageFrom(item);
      calls.push({
        turnId: String(item.turnId || apiCost.turnId || 'turn'),
        stage: stageName(item),
        model: String(item.model || 'unknown'),
        ...u
      });
    }
  }
  if (apiCost.turns && typeof apiCost.turns === 'object') {
    for (const [turnId, bucket] of Object.entries(apiCost.turns)) {
      for (const item of Array.isArray(bucket?.calls) ? bucket.calls : []) {
        const u = usageFrom(item);
        calls.push({
          turnId: String(turnId),
          stage: stageName(item),
          model: String(item.model || 'unknown'),
          ...u
        });
      }
    }
  }
  return calls;
}

function collectCallsFromLab(lab = {}) {
  const calls = [];
  const experiment = lab.lastExperiment || lab.experiment || null;
  if (experiment) {
    const turnId = String(experiment.customerMessageId || experiment.id || 'last');
    if (experiment.analysis?.usage || experiment.analysis?.decision?.usage) {
      const u = usageFrom(experiment.analysis.usage || experiment.analysis.decision || {});
      calls.push({ turnId, stage: 'understanding', model: String(experiment.analysis.model || experiment.model || 'unknown'), ...u });
    }
    for (const variant of Array.isArray(experiment.variants) ? experiment.variants : []) {
      const u = usageFrom(variant);
      if (u.total || u.input || u.output) {
        calls.push({
          turnId,
          stage: stageName({ stage: variant.label || 'reply', variant: variant.label }),
          model: String(variant.model || 'unknown'),
          ...u
        });
      }
    }
    if (experiment.usage && !Array.isArray(experiment.variants)) {
      const u = usageFrom(experiment.usage);
      calls.push({ turnId, stage: 'reply', model: String(experiment.model || 'unknown'), ...u });
    }
  }

  for (const event of Array.isArray(lab.events) ? lab.events : []) {
    if (!event?.usage && !event?.tokens) continue;
    const u = usageFrom(event.usage || { total: event.tokens });
    calls.push({
      turnId: String(event.customerMessageId || event.id || 'event'),
      stage: stageName(event),
      model: String(event.model || 'unknown'),
      ...u
    });
  }

  if (lab.apiCost) calls.push(...collectCallsFromApiCost(lab.apiCost));
  return calls;
}

function collectCallsGeneric(root) {
  const calls = [];
  if (Array.isArray(root)) {
    root.forEach((item, index) => {
      const turnId = String(item.turnId || item.id || `turn-${index + 1}`);
      const list = item.calls || item.llmCalls || item.turnCalls || [];
      if (Array.isArray(list) && list.length) {
        for (const call of list) {
          const u = usageFrom(call);
          calls.push({ turnId, stage: stageName(call), model: String(call.model || 'unknown'), ...u });
        }
      } else if (item.usage || item.prompt_tokens || item.total_tokens) {
        const u = usageFrom(item);
        calls.push({ turnId, stage: stageName(item), model: String(item.model || 'unknown'), ...u });
      }
    });
    return calls;
  }
  if (root && typeof root === 'object') {
    calls.push(...collectCallsFromLab(root));
    calls.push(...collectCallsFromApiCost(root));
    if (root.apiCost) calls.push(...collectCallsFromApiCost(root.apiCost));
  }
  return calls;
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
    for (const stage of ['prompt_guard', 'understanding', 'knowledge', 'reply', 'tool_grounding']) {
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
  const calls = collectCallsGeneric(root);

  const seen = new Set();
  const unique = [];
  for (const call of calls) {
    const key = [call.turnId, call.stage, call.model, call.input, call.output, call.total].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(call);
  }

  const turns = groupByTurn(unique);
  const turnTotals = [...turns.values()].map(list => list.reduce((sum, item) => sum + item.total, 0));
  const session = {
    turns: turnTotals.length,
    calls: unique.length,
    total: turnTotals.reduce((a, b) => a + b, 0),
    average: turnTotals.length ? Math.round(turnTotals.reduce((a, b) => a + b, 0) / turnTotals.length) : 0,
    median: Math.round(median(turnTotals)),
    max: turnTotals.length ? Math.max(...turnTotals) : 0
  };
  const notes = payloadBreakdownNote(root);
  if (!unique.length) {
    notes.push('No token usage records found. Export apiCost.turnCalls or lab lastExperiment.usage / variants[].usage.');
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
