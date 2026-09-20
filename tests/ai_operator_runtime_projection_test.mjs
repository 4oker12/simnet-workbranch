import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compactFactResolutionForSynthesis,
  compactRuntimeAnalysis,
  compactRuntimeCapabilities,
  compactRuntimeTranscript
} from '../src/features/ai-operator/runtime-projection.js';

test('runtime projection removes verbose duplicate semantic fields while preserving decision fields', () => {
  const projected = compactRuntimeAnalysis({
    probe: {
      language: 'ru',
      whatUserWants: 'узнать цену гигабита и кабельного ТВ',
      latestMessageMeans: 'спрашивает общую цену',
      factsSaidByUser: ['очень длинный повтор уже доступного dialogue'],
      factsSaidByOperator: ['ещё один дубль'],
      unresolvedRequests: ['цена гигабит + ТВ'],
      liveDataNeed: 'none',
      requiredFacts: [],
      knowledgeNeed: 'needed',
      knowledgeReason: 'нужны внутренние цены SIMNET',
      confidence: 0.97
    },
    knowledge: {
      skipped: false,
      usedArticles: [{ id: 'tariff.residential', why: 'тариф' }],
      articleEvidence: [{ id: 'tariff.residential', title: 'Тарифы', summary: 'гигабит', text: 'x'.repeat(5000) }],
      relevantInternalKnowledge: ['1 Гбит/с — 350 грн/мес'],
      hypotheses: [{ text: 'не нужно в runtime', basis: 'diagnostic only' }]
    },
    candidates: [{ id: 'duplicate-candidate' }],
    decision: { reply: 'verbose readable diagnostic' }
  });

  assert.equal(projected.probe.whatUserWants, 'узнать цену гигабита и кабельного ТВ');
  assert.equal(Object.hasOwn(projected.probe, 'factsSaidByUser'), false);
  assert.equal(Object.hasOwn(projected.probe, 'factsSaidByOperator'), false);
  assert.equal(Object.hasOwn(projected, 'candidates'), false);
  assert.equal(Object.hasOwn(projected, 'decision'), false);
  assert.equal(Object.hasOwn(projected.knowledge, 'hypotheses'), false);
  assert.ok(projected.knowledge.articleEvidence[0].text.length <= 1000);
});

test('runtime transcript keeps only recent compact turns', () => {
  const transcript = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'agent' : 'customer',
    text: `${index}: ${'z'.repeat(900)}`
  }));
  const projected = compactRuntimeTranscript(transcript, { maxTurns: 6, maxChars: 100 });
  assert.equal(projected.length, 6);
  assert.match(projected[0].text, /^14:/);
  assert.ok(projected.every(item => item.text.length <= 100));
});

test('reply capabilities do not carry tool planner manifest into the model prompt', () => {
  const projected = compactRuntimeCapabilities({
    billing: true,
    userside: true,
    network: true,
    toolPlanner: { tools: Array.from({ length: 100 }, () => ({ establishes: 'x'.repeat(1000) })) }
  });
  assert.deepEqual(projected, { billing: true, userside: true, network: true });
});

test('fact resolver diagnostics are omitted only from synthesis payload', () => {
  const source = {
    evidence: [{ path: 'subscriber.finance.balance.account', value: 100 }],
    diagnostics: { broadPayloadChars: 9000, evidenceChars: 120 },
    context: { confirmedCaseId: '42' }
  };
  const projected = compactFactResolutionForSynthesis(source);
  assert.deepEqual(projected.diagnostics, {});
  assert.deepEqual(projected.evidence, source.evidence);
  assert.equal(projected.context.confirmedCaseId, '42');
  assert.equal(source.diagnostics.broadPayloadChars, 9000);
});

test('semantic runtime uses deterministic KB retrieval instead of a second knowledge LLM call', () => {
  const source = readFileSync(new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url), 'utf8');
  assert.match(source, /knowledgeMode:\s*'off'/);
  assert.match(source, /searchKnowledgeLibrary\(query/);
  assert.match(source, /Отдельный LLM knowledge-reflection этап не запускается/);
  assert.doesNotMatch(source, /await\s+base\.buildKnowledgeReflectionMessages/);
});

test('semantic stage prompts stay task-scoped instead of duplicating AUTONOMOUS_OPERATOR', () => {
  const source = readFileSync(new URL('../src/features/ai-operator/semantic-probe-runtime-base.js', import.meta.url), 'utf8');
  assert.match(source, /ЭТАП: UNDERSTANDING\./);
  assert.match(source, /ЭТАП: FINAL ANSWER\./);
  assert.match(source, /ЭТАП: FINAL ANSWER AFTER READ\./);
  assert.doesNotMatch(source, /ANSWER RELEVANCE GATE/);
  assert.doesNotMatch(source, /НЕИЗМЕНЯЕМЫЕ правила достоверности/);
  assert.doesNotMatch(source, /"behavior_effects"/);
});

test('canonical fact path bypasses legacy tool synthesis prompt', () => {
  const source = readFileSync(new URL('../src/features/ai-operator/semantic-tool-broker-core.js', import.meta.url), 'utf8');
  assert.match(source, /generateGroundedSubscriberReply/);
  assert.match(source, /if \(!originalFactResolution\)/);
  assert.match(source, /canonicalFactEvidence:/);
  assert.doesNotMatch(source, /TOOL EVIDENCE SYNTHESIS/);
});
