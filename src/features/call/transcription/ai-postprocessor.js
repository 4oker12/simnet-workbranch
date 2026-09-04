import { AI_CONFIG } from '../../../config/ai-config.js';

const AI_RUNTIME_CONFIG_KEY = 'simnet_workbench_ai_runtime_v1';
const AI_ANALYSIS_STORE_KEY = 'simnet_workbench_call_ai_analysis_v1';
const AI_ANALYSIS_SCHEMA = 1;
const AI_TIMEOUT_MS = 45_000;
const MAX_INPUT_CHARS = 60_000;
const MAX_OUTPUT_CHARS = 100_000;
const MAX_ANALYSES = 120;
const ANALYSIS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function block(value, max = MAX_OUTPUT_CHARS) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function oneLine(value, max = 1200) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stableHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['uk', 'ua', 'ukrainian', 'українська', 'украинский'].includes(raw)) return 'uk';
  if (['ru', 'russian', 'русский', 'російська'].includes(raw)) return 'ru';
  if (['mixed', 'mix', 'ru/uk', 'uk/ru', 'mixed_ru_uk', 'смешанный', 'змішана'].includes(raw)) return 'mixed';
  return 'mixed';
}

function analysisStoreShape(raw = {}) {
  return {
    schemaVersion: AI_ANALYSIS_SCHEMA,
    updatedAt: String(raw.updatedAt || ''),
    entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
  };
}

async function readRuntimeConfig() {
  const raw = (await chrome.storage.local.get(AI_RUNTIME_CONFIG_KEY))?.[AI_RUNTIME_CONFIG_KEY] || {};
  return {
    apiKey: String(raw.groqApiKey || '').trim(),
    model: String(raw.model || AI_CONFIG.model || '').trim() || 'qwen/qwen3.6-27b'
  };
}

async function readCached(callKey, sourceHash, model) {
  const raw = (await chrome.storage.local.get(AI_ANALYSIS_STORE_KEY))?.[AI_ANALYSIS_STORE_KEY] || {};
  const store = analysisStoreShape(raw);
  const entry = store.entries[String(callKey || '')];
  if (!entry) return null;
  if (entry.sourceHash !== sourceHash || entry.model !== model || !entry.analysis?.cleanText) return null;
  return { ...entry.analysis, cached: true };
}

async function saveCached(callKey, sourceHash, model, analysis) {
  const raw = (await chrome.storage.local.get(AI_ANALYSIS_STORE_KEY))?.[AI_ANALYSIS_STORE_KEY] || {};
  const store = analysisStoreShape(raw);
  const now = Date.now();
  const cutoff = now - ANALYSIS_RETENTION_MS;
  const entries = Object.values(store.entries)
    .filter(item => Number(item?.createdAtMs || 0) >= cutoff)
    .filter(item => item?.callKey && item.callKey !== callKey);
  entries.push({
    schemaVersion: AI_ANALYSIS_SCHEMA,
    callKey,
    sourceHash,
    model,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    analysis
  });
  entries.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  const trimmed = entries.slice(0, MAX_ANALYSES);
  store.entries = Object.fromEntries(trimmed.map(item => [item.callKey, item]));
  store.updatedAt = new Date(now).toISOString();
  await chrome.storage.local.set({ [AI_ANALYSIS_STORE_KEY]: store });
}

function sourceText(transcript = {}) {
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (segments.length) {
    const segmented = segments.map(segment => {
      const start = Number(segment?.start || 0).toFixed(1);
      const end = Number(segment?.end || 0).toFixed(1);
      return `[${start}-${end}] ${block(segment?.text, 2400)}`;
    }).join('\n');
    if (segmented.trim()) return segmented.slice(0, MAX_INPUT_CHARS);
  }
  return block(transcript.text, MAX_INPUT_CHARS);
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  try {
    return JSON.parse(text);
  } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('AI_POSTPROCESS: Groq не вернул JSON');
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    throw new Error('AI_POSTPROCESS: не удалось разобрать JSON ответа Groq');
  }
}

function normalizeAnalysis(raw = {}, meta = {}) {
  const cleanText = block(raw.clean_text ?? raw.cleanText);
  if (!cleanText) throw new Error('AI_POSTPROCESS: AI не вернул очищенный текст');
  return {
    schemaVersion: 1,
    language: normalizeLanguage(raw.language),
    cleanText,
    issue: oneLine(raw.issue || raw.reason || raw.topic || '', 1600),
    actions: oneLine(raw.actions || raw.operator_actions || raw.operatorActions || '', 2000),
    result: oneLine(raw.result || raw.outcome || '', 1600),
    nextStep: oneLine(raw.next_step || raw.nextStep || '', 1600),
    summary: oneLine(raw.summary || '', 2000),
    model: String(meta.model || ''),
    processedAt: new Date().toISOString(),
    cached: false
  };
}

async function requestGroq(messages, apiKey, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 3500,
        messages
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = oneLine(data?.error?.message || text || response.statusText, 700);
      throw new Error(`AI_POSTPROCESS: Groq HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('AI_POSTPROCESS: Groq вернул пустой ответ');
    return String(answer);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI_POSTPROCESS: таймаут Groq');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function postprocessTranscript(job = {}, transcript = {}) {
  const rawText = block(transcript.text, MAX_INPUT_CHARS);
  if (!rawText) throw new Error('AI_POSTPROCESS: отсутствует сырой транскрипт');

  const runtime = await readRuntimeConfig();
  if (!runtime.apiKey) {
    throw new Error('AI_POSTPROCESS: Groq API key не настроен локально в Workbench');
  }

  const callKey = String(job.callKey || transcript.callKey || '').trim();
  const source = sourceText(transcript);
  const sourceHash = stableHash(`${rawText}\n${source}`);
  const cached = callKey ? await readCached(callKey, sourceHash, runtime.model) : null;
  if (cached) return cached;

  const system = `Ты — постпроцессор транскриптов звонков техподдержки интернет-провайдера SIMNET.\n\nТвоя задача — исправить ошибки ASR и сделать текст пригодным для CRM, не меняя факты разговора.\n\nКРИТИЧЕСКИЕ ПРАВИЛА:\n1. НЕ ПЕРЕВОДИ речь. Украинские фразы оставляй украинскими, русские — русскими. Если разговор смешанный RU/UK или суржик — сохрани это естественно.\n2. language = "uk", "ru" или "mixed". При заметном переключении между украинским и русским ставь "mixed".\n3. Исправляй только очевидные ошибки распознавания: пунктуацию, регистр, слитые/разорванные слова и технические термины, когда контекст однозначен.\n4. Не выдумывай адреса, имена, номера, оборудование, диагностику, обещания или результат. Если факт не прозвучал — не добавляй его.\n5. Сохраняй смысл и последовательность разговора. Можно убрать только явные ASR-повторы и бессодержательные слова-паразиты, если это не меняет смысл.\n6. Термины ISP пиши корректно, если они действительно распознаны по контексту: SIMNET, Wi-Fi, Ethernet, ONU, ONT, OLT, GPON, EPON, VLAN, DHCP, PPPoE, NAT, IPv4, IPv6, MikroTik, TP-Link, Cudy, Juniper, BRAS.\n7. summary/issue/actions/result/next_step должны содержать ТОЛЬКО факты из разговора. Если данных нет — пустая строка.\n8. Ответь ТОЛЬКО JSON-объектом без markdown и комментариев.\n\nФормат:\n{"language":"uk|ru|mixed","clean_text":"полный очищенный транскрипт","summary":"краткая суть звонка","issue":"причина обращения","actions":"что было проверено/сделано оператором","result":"чем закончился звонок","next_step":"что явно договорились сделать дальше"}`;

  const whisperLanguage = oneLine(transcript.language || '', 24);
  const whisperProbability = Number(transcript.languageProbability || 0);
  const user = `CALL: ${String(job.usersideCallId || transcript.usersideCallId || '')}\nWhisper language hint: ${whisperLanguage || 'unknown'} (${Number.isFinite(whisperProbability) ? whisperProbability.toFixed(3) : '0.000'})\n\nТранскрипт по сегментам:\n${source}`;

  const answer = await requestGroq([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], runtime.apiKey, runtime.model);
  const analysis = normalizeAnalysis(parseJsonObject(answer), { model: runtime.model });
  if (callKey) await saveCached(callKey, sourceHash, runtime.model, analysis);
  return analysis;
}

export const AI_POSTPROCESS_RUNTIME_KEY = AI_RUNTIME_CONFIG_KEY;
