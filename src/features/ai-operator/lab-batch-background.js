import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { recordApiUsage } from './api-cost.js';
import { AI_OPERATOR_LAB_KEY, runIsolatedLabCase } from './lab-background.js';

const BATCH_KEY = 'simnet_ai_operator_batch_v1';
const MAX_CASES = 20;
const MIN_GENERATED = 2;

const TYPES = Object.freeze({
  GENERATE: 'AI_OPERATOR_BATCH_GENERATE',
  RUN: 'AI_OPERATOR_BATCH_RUN',
  GET: 'AI_OPERATOR_BATCH_GET',
  CLEAR: 'AI_OPERATOR_BATCH_CLEAR'
});

let batchPromise = null;

function compact(value, max = 4000) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clampCount(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_GENERATED, Math.min(MAX_CASES, Math.round(parsed)));
}

function normalizePhrases(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/\n+/);
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const phrase = compact(item, 1000);
    if (!phrase) continue;
    const key = phrase.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(phrase);
    if (result.length >= MAX_CASES) break;
  }
  return result;
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('AI не вернул JSON со списком формулировок.');
}

async function currentLabState() {
  const raw = (await chrome.storage.local.get(AI_OPERATOR_LAB_KEY))?.[AI_OPERATOR_LAB_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw) : {};
}

async function readBatch() {
  const raw = (await chrome.storage.local.get(BATCH_KEY))?.[BATCH_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

async function writeBatch(value) {
  await chrome.storage.local.set({ [BATCH_KEY]: value });
  return value;
}

async function requestParaphrases(sourceText, count) {
  const runtime = await readAiRuntimeConfig();
  const apiKey = String(runtime.apiKey || runtime.groqApiKey || '').trim();
  const model = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  if (!apiKey) throw new Error('AI provider API key is not configured');
  if (!model) throw new Error('AI provider model is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(45_000, Number(AI_CONFIG.timeoutMs || 45_000)));
  let usage = null;
  let reportedModel = model;
  try {
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.85,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Ты создаёшь тестовые переформулировки для AI-оператора интернет-провайдера. Сохраняй один и тот же смысл и фактический запрос. Меняй разговорность, порядок слов, краткость, опечатки, смешанный русский/украинский там, где это естественно. Не добавляй новые факты, адреса, суммы, номера договоров, симптомы или условия. Верни только JSON.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              source: sourceText,
              count,
              schema: { variants: ['ровно указанное количество разных формулировок, без исходной фразы'] }
            })
          }
        ]
      })
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    usage = data?.usage || null;
    reportedModel = String(data?.model || model);
    if (!response.ok) {
      throw new Error(`AI provider HTTP ${response.status} — ${compact(data?.error?.message || raw || response.statusText, 500)}`);
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('AI provider returned an empty paraphrase response');
    const parsed = parseJsonObject(answer);
    return {
      variants: normalizePhrases(parsed?.variants).slice(0, count),
      model: reportedModel,
      usage: clone(usage || {})
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI provider paraphrase request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    await recordApiUsage({ scope: 'ai-lab-batch', turnId: `paraphrase:${Date.now()}`, variant: 'paraphrase_generator', model: reportedModel, usage });
  }
}

async function generateBatch(payload = {}) {
  const source = compact(payload.source || payload.text || '', 1000);
  if (!source) throw new Error('Введи исходную реплику для генерации формулировок.');
  const count = clampCount(payload.count, 10);
  const generated = await requestParaphrases(source, count);
  const variants = normalizePhrases(generated.variants);
  if (variants.length < MIN_GENERATED) throw new Error('AI вернул слишком мало пригодных формулировок.');
  return {
    source,
    count: variants.length,
    variants,
    model: generated.model,
    usage: generated.usage,
    generatedAt: new Date().toISOString()
  };
}

function activeVariant(experiment = {}) {
  const variants = Array.isArray(experiment.variants) ? experiment.variants : [];
  return variants.find(item => item?.label === experiment.activeVariant) || variants[0] || null;
}

function compactResult(index, phrase, outcome = {}) {
  const experiment = outcome.experiment || {};
  const analysis = experiment.analysis || {};
  const probe = analysis.probe || {};
  const knowledge = analysis.knowledge || {};
  const variant = activeVariant(experiment) || {};
  const toolTrace = Array.isArray(variant.toolTrace) ? variant.toolTrace : [];
  const evidenceNeeds = Array.isArray(probe.evidenceNeeds) ? probe.evidenceNeeds : [];
  return {
    index,
    phrase,
    ok: true,
    whatUserWants: compact(probe.whatUserWants || '', 700),
    latestMessageMeans: compact(probe.latestMessageMeans || '', 900),
    confidence: Number(probe.confidence || 0) || 0,
    knowledgeNeed: String(probe.knowledgeNeed || ''),
    knowledgeUsed: !knowledge.skipped,
    knowledgeArticles: (knowledge.usedArticles || []).map(item => item?.id).filter(Boolean),
    liveDataNeed: String(probe.liveDataNeed || (evidenceNeeds.length ? 'needed' : 'none')),
    evidenceNeeds: clone(evidenceNeeds),
    toolTrace: clone(toolTrace),
    toolCalls: toolTrace.length,
    reply: compact(variant.reply || outcome.decision?.reply || '', 5000),
    degraded: Boolean(variant.degraded),
    degradationReason: compact(variant.degradationReason || '', 900),
    answerRelevance: clone(variant.answerRelevance || null),
    relevanceGate: clone(variant.relevanceGate || null),
    model: String(experiment.model || outcome.decision?.model || ''),
    usage: clone(experiment.usage || outcome.decision?.usage || {}),
    elapsedMs: Number(experiment.elapsedMs || 0) || 0
  };
}

function errorResult(index, phrase, error) {
  return {
    index,
    phrase,
    ok: false,
    error: compact(error?.message || error || 'unknown batch error', 1200),
    whatUserWants: '',
    latestMessageMeans: '',
    confidence: 0,
    knowledgeNeed: '',
    knowledgeUsed: false,
    knowledgeArticles: [],
    liveDataNeed: '',
    evidenceNeeds: [],
    toolTrace: [],
    toolCalls: 0,
    reply: '',
    degraded: true,
    degradationReason: compact(error?.message || error || '', 900),
    answerRelevance: null,
    relevanceGate: null,
    model: '',
    usage: {},
    elapsedMs: 0
  };
}

function summarize(results = []) {
  const ok = results.filter(item => item.ok);
  return {
    total: results.length,
    completed: ok.length,
    errors: results.length - ok.length,
    degraded: ok.filter(item => item.degraded).length,
    knowledgeUsed: ok.filter(item => item.knowledgeUsed).length,
    liveDataNeeded: ok.filter(item => item.liveDataNeed === 'needed' || item.evidenceNeeds?.length).length,
    toolCalls: ok.reduce((sum, item) => sum + Number(item.toolCalls || 0), 0),
    totalTokens: ok.reduce((sum, item) => sum + Number(item.usage?.total_tokens || 0), 0),
    elapsedMs: ok.reduce((sum, item) => sum + Number(item.elapsedMs || 0), 0)
  };
}

async function runBatch(payload = {}) {
  const phrases = normalizePhrases(payload.phrases || payload.variants || payload.text);
  if (!phrases.length) throw new Error('Нет формулировок для пакетного прогона.');
  const labState = await currentLabState();
  const knowledgeMode = String(payload.knowledgeMode || labState.knowledgeMode || 'auto');
  const behavior = clone(payload.behavior || labState.behavior || {});
  const baseToolState = clone(payload.toolState || labState.toolState || {});
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const results = [];

  for (let index = 0; index < phrases.length; index += 1) {
    const phrase = phrases[index];
    try {
      const outcome = await runIsolatedLabCase({
        text: phrase,
        knowledgeMode,
        behavior,
        toolState: clone(baseToolState),
        scope: `${batchId}:${index + 1}`
      });
      results.push(compactResult(index + 1, phrase, outcome));
    } catch (error) {
      results.push(errorResult(index + 1, phrase, error));
    }
  }

  return writeBatch({
    version: 1,
    id: batchId,
    source: compact(payload.source || '', 1000),
    knowledgeMode,
    behavior,
    phrases,
    results,
    summary: summarize(results),
    createdAt: new Date().toISOString()
  });
}

function serialized(action) {
  if (batchPromise) throw new Error('Пакетный тест уже выполняется.');
  batchPromise = Promise.resolve().then(action).finally(() => { batchPromise = null; });
  return batchPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = String(message?.type || '');
  if (!Object.values(TYPES).includes(type)) return false;

  const action = type === TYPES.GENERATE
    ? serialized(() => generateBatch(message?.payload || {}))
    : type === TYPES.RUN
      ? serialized(() => runBatch(message?.payload || {}))
      : type === TYPES.GET
        ? readBatch()
        : chrome.storage.local.remove(BATCH_KEY).then(() => ({ cleared: true }));

  void action.then(
    data => sendResponse({ success: true, data }),
    error => sendResponse({ success: false, error: compact(error?.message || error || 'AI batch error', 1200) })
  );
  return true;
});

export const AI_OPERATOR_BATCH_MESSAGE_TYPES = TYPES;
export const AI_OPERATOR_BATCH_KEY = BATCH_KEY;
