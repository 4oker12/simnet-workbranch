'use strict';

import { recordApiUsage } from './api-cost.js';
import { AI_CONFIG, readAiRuntimeConfig } from '../../config/ai-config.js';
import { AI_OPERATOR_GENERATION_MODEL_POOL } from './semantic-probe.js';
import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';

export const AI_OPERATOR_SOFT_TOOL_CAPABILITIES = Object.freeze({ billing: true, userside: true, network: true });

export const AI_OPERATOR_TOOL_CAPABILITY_DETAILS = Object.freeze({
  billing: 'live-read-only',
  userside: 'live-read-only',
  network: 'workbench-case-read-only'
});

export const AI_OPERATOR_SOFT_TOOL_CATALOG = Object.freeze([
  { name: 'customer.lookup', source: 'Billing', purpose: 'Найти абонента по договору, login, IP или адресу через текущую авторизованную Billing-сессию.' },
  { name: 'customer.confirm', source: 'Conversation', purpose: 'Подтвердить или отклонить найденного по адресу кандидата.' },
  { name: 'customer.snapshot', source: 'Billing', purpose: 'Прочитать live-снимок карточки подтверждённого абонента.' },
  { name: 'billing.balance', source: 'Billing', purpose: 'Прочитать баланс и финансовое состояние.' },
  { name: 'billing.tariff', source: 'Billing', purpose: 'Прочитать текущий/следующий тариф и состояние услуги.' },
  { name: 'billing.history', source: 'Billing payshow', purpose: 'Прочитать исторические события клиента: изменения пакета, блокировки, временные платежи, изменения данных и другие записи payshow.' },
  { name: 'billing.payments', source: 'Billing', purpose: 'Прочитать последние доступные платежи.' },
  { name: 'userside.snapshot', source: 'UserSide', purpose: 'Найти того же подтверждённого абонента в UserSide и прочитать live технический снимок.' },
  { name: 'building.snapshot', source: 'UserSide building index', purpose: 'Прочитать всю рабочую карточку здания по известному адресу: GPON, собственник, заметки, ключи, УК/ОСББ, этажи, подъезды и другие поля.' },
  { name: 'network.session', source: 'Juniper/BRAS', purpose: 'Прочитать последнюю доступную сетевую сессию из Workbench-кейса того же абонента.' },
  { name: 'pon.onu', source: 'UserSide/PON', purpose: 'Прочитать live ONU/OLT/порт данные; при недоступности использовать подтверждённый Workbench fallback.' },
  { name: 'pon.signal', source: 'UserSide/PON', purpose: 'Прочитать live оптические показатели ONU; при недоступности использовать подтверждённый Workbench fallback.' }
]);

const ACCOUNT_TOOLS = new Set(['customer.snapshot', 'billing.balance', 'billing.tariff', 'billing.history', 'billing.payments', 'userside.snapshot', 'network.session', 'pon.onu', 'pon.signal']);
const SYNTHESIS_COOLDOWNS = new Map();

function oneLine(value, max = 500) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function block(value, max = 2600) {
  const normalized = String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function stringList(value, maxItems = 8, maxChars = 360) {
  return (Array.isArray(value) ? value : []).map(item => oneLine(item, maxChars)).filter(Boolean).slice(0, maxItems);
}
function compactObject(input, maxDepth = 4, depth = 0) {
  if (depth >= maxDepth) return oneLine(input, 320);
  if (Array.isArray(input)) return input.slice(0, 12).map(item => compactObject(item, maxDepth, depth + 1));
  if (!input || typeof input !== 'object') return input;
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, 60)) {
    if (/^(?:pp|password|passwd|pass|token|secret|csrf|authorization)$/i.test(key)) continue;
    output[key] = compactObject(value, maxDepth, depth + 1);
  }
  return output;
}
function usageTotal(...items) {
  return items.reduce((total, item) => {
    const usage = item?.usage || item || {};
    total.prompt_tokens += Number(usage.prompt_tokens || 0);
    total.completion_tokens += Number(usage.completion_tokens || 0);
    total.total_tokens += Number(usage.total_tokens || 0);
    return total;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}
function parseJsonObject(value) {
  const source = String(value || '').trim();
  try { return JSON.parse(source); } catch {}
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Tool synthesis: model did not return JSON');
  return JSON.parse(source.slice(first, last + 1));
}
function numberHeader(headers, name) {
  const value = Number(headers?.get?.(name) || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function rateLimitFromHeaders(headers) {
  return {
    limitTokens: numberHeader(headers, 'x-ratelimit-limit-tokens'),
    remainingTokens: numberHeader(headers, 'x-ratelimit-remaining-tokens'),
    resetTokens: oneLine(headers?.get?.('x-ratelimit-reset-tokens') || '', 80),
    remainingRequests: numberHeader(headers, 'x-ratelimit-remaining-requests'),
    retryAfter: oneLine(headers?.get?.('retry-after') || '', 80)
  };
}
function durationMs(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return 0;
  if (/^\d+(?:\.\d+)?$/.test(source)) return Math.ceil(Number(source) * 1000);
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
  for (const match of source.matchAll(re)) {
    const amount = Number(match[1]);
    total += match[2] === 'ms' ? amount : match[2] === 'h' ? amount * 3600000 : match[2] === 'm' ? amount * 60000 : amount * 1000;
  }
  return Math.ceil(total);
}
function markCooling(model, rateLimit = {}) {
  const wait = Math.max(durationMs(rateLimit.retryAfter), durationMs(rateLimit.resetTokens), 5000);
  SYNTHESIS_COOLDOWNS.set(model, Date.now() + Math.min(wait + 1500, 180000));
}
function modelCandidates(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  const all = [preferred, ...AI_OPERATOR_GENERATION_MODEL_POOL].filter((model, index, list) => model && list.indexOf(model) === index);
  const ready = all.filter(model => Number(SYNTHESIS_COOLDOWNS.get(model) || 0) <= Date.now());
  return ready.length ? ready : all;
}

async function requestOnce(messages, runtime, model, meterContext, jsonMode = true) {
  let usage = null;
  let reportedModel = model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(45_000, Number(AI_CONFIG.timeoutMs || 45_000)));
  try {
    const body = { model, temperature: 0.12, max_tokens: 700, messages };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.groqApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rateLimit = rateLimitFromHeaders(response.headers);
    const rawText = await response.text();
    let data = null;
    try { data = rawText ? JSON.parse(rawText) : null; } catch {}
    usage = data?.usage || null;
    reportedModel = String(data?.model || model);
    if (!response.ok) {
      const error = new Error(`Groq HTTP ${response.status} — ${oneLine(data?.error?.message || rawText || response.statusText, 500)}`);
      error.status = response.status;
      error.rateLimit = rateLimit;
      if (response.status === 429) markCooling(model, rateLimit);
      throw error;
    }
    SYNTHESIS_COOLDOWNS.delete(model);
    const answer = String(data?.choices?.[0]?.message?.content || '');
    if (!answer.trim()) throw new Error('Tool synthesis: Groq returned an empty response');
    return { answer, model: reportedModel, usage: data?.usage || {}, rateLimit };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Tool synthesis: Groq request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    await recordApiUsage({ ...meterContext, model: reportedModel, usage });
  }
}

async function requestSynthesis(messages, meterContext = {}) {
  const runtime = await readAiRuntimeConfig();
  if (!String(runtime.groqApiKey || '').trim()) throw new Error('Groq API key is not configured');
  const failures = [];
  for (const model of modelCandidates(runtime)) {
    try {
      return await requestOnce(messages, runtime, model, meterContext, true);
    } catch (error) {
      failures.push(error);
      const status = Number(error?.status || 0);
      if (status === 400 && /generate json|validate json|failed_generation/i.test(String(error?.message || ''))) {
        try { return await requestOnce(messages, runtime, model, meterContext, false); }
        catch (retryError) { failures.push(retryError); }
      }
      if ([401, 403].includes(status)) break;
    }
  }
  throw failures.at(-1) || new Error('Tool synthesis failed');
}

function needText(need = {}) {
  return `${oneLine(need.system, 80)} ${oneLine(need.field, 160)} ${oneLine(need.why, 260)}`.toLowerCase();
}
function hasPonTerm(text = '') {
  return /(?:^|[^a-zа-яіїєґ0-9])(?:onu|ont|olt|pon|gpon|epon)(?=$|[^a-zа-яіїєґ0-9])/iu.test(String(text || ''));
}
function toolForNeed(need = {}) {
  const text = needText(need);
  const system = oneLine(need.system, 80).toLowerCase();
  if (/building\.snapshot/.test(text)) return 'building.snapshot';
  const buildingKeyFact = /(?:^|[\s:;,])ключ(?:и|ей|а)?(?=$|[\s:;,.!?])/.test(text);
  const buildingContext = /дом|будин|здан|адрес|покрыт|coverage|собственник|owner|замет|прим[еі]чан|working[_ ]?note|осбб|building/.test(text) || buildingKeyFact;
  const buildingFact = /gpon|epon|оптик|покрыт|coverage|собственник|owner|замет|прим[еі]чан|working[_ ]?note|осбб|этаж|поверх|подъезд|під.?їзд|квартир|penetration|менеджер|ktv|ктв/.test(text) || buildingKeyFact;
  if (buildingContext && buildingFact) return 'building.snapshot';
  if (/billing\.history/.test(text)) return 'billing.history';
  const historyIntent = /истори|хронолог|когда.{0,40}(?:менял|смен|блокир|плат[её]ж|пополн|спис)|последн.{0,30}(?:измен|событ)|что.{0,30}(?:менял|изменял)|событи.{0,20}клиент/i.test(text);
  if (historyIntent) return 'billing.history';
  if (/баланс|balance|рахун|финанс|заборг|долг|списан/.test(text)) return 'billing.balance';
  if (/кешбек|кэшбек|cashback/.test(text) && /услов|правил|начисл|зачисл|положен|належ|будет|буде/.test(text)) return '';
  if (/плат[её]ж|оплат|payment|пополн/.test(text)) return 'billing.payments';
  if (/тариф|пакет|абонплат|скорост|speed/.test(text) && !/сесс|линк|порт/.test(text)) return 'billing.tariff';
  if (/сигнал|rx|tx|оптик|затух|dbm/.test(text)) return 'pon.signal';
  if (hasPonTerm(text)) return system.includes('userside') ? 'userside.snapshot' : 'pon.onu';
  if (/bras|juniper|сесс|авторизац|dhcp|traffic|трафик|vlan/.test(text)) return 'network.session';
  if (/userside|user\s*side|тмц|tmc|точк.*подключ|коммут|ethernet|порт/.test(text) || system.includes('userside')) return 'userside.snapshot';
  if (system.includes('network')) return 'network.session';
  if (system.includes('billing')) return 'customer.snapshot';
  return 'customer.snapshot';
}

function buildingAddressFromNeed(need = {}) {
  const direct = oneLine(need?.address, 320);
  if (direct) return direct;
  for (const candidate of [need?.field, need?.why]) {
    const source = oneLine(candidate, 500);
    if (!source) continue;
    const match = source.match(/(?:по\s+адрес(?:у|у\b)|за\s+адресою|адрес(?:а|у)?|address)\s*[:\-]?\s*(.+)$/iu);
    if (!match?.[1]) continue;
    const value = oneLine(match[1], 320).replace(/[.!?]+$/u, '').trim();
    if (value && /\d/.test(value)) return value;
  }
  return '';
}

export function mapInformationNeedsToTools(needs = []) {
  const calls = [];
  const freshTools = new Set(['billing.balance', 'billing.tariff', 'billing.history', 'billing.payments', 'customer.snapshot', 'userside.snapshot', 'pon.onu', 'pon.signal']);
  for (const need of Array.isArray(needs) ? needs : []) {
    const tool = toolForNeed(need);
    if (!tool || calls.some(item => item.tool === tool)) continue;
    const toolArgs = freshTools.has(tool) ? { refresh: true, maxAgeMs: 120000 } : {};
    if (tool === 'building.snapshot') {
      const address = buildingAddressFromNeed(need);
      if (address) toolArgs.address = address;
    }
    calls.push({
      tool,
      toolArgs,
      requestedBy: { system: oneLine(need?.system, 80), field: oneLine(need?.field, 160), why: oneLine(need?.why, 260) }
    });
  }
  return calls.slice(0, 5);
}

function customerMessages(transcript = []) {
  return (Array.isArray(transcript) ? transcript : []).filter(item => item?.role === 'customer' && oneLine(item?.text, 1200)).slice(-12);
}
function latestCustomerText(transcript = []) {
  return oneLine(customerMessages(transcript).at(-1)?.text, 500);
}
function pendingConfirmation(transcript = [], state = {}) {
  if (!state?.pendingCandidate || state?.confirmedCaseId) return null;
  const source = latestCustomerText(transcript).toLowerCase().replace(/[.!?,;:]+$/g, '').trim();
  if (!source) return null;
  if (/^(?:да|так|ага|угу|верно|вірно|правильно|це\s+він|это\s+он|це\s+мій|это\s+мой|мій|мой)$/.test(source)) return true;
  if (/^(?:нет|ні|неа|не\s+он|не\s+він|не\s+мой|не\s+мій|неверно|невірно)$/.test(source)) return false;
  return null;
}

export function extractIdentityHints(transcript = [], analysis = {}) {
  const dialogue = Array.isArray(transcript) ? transcript : [];
  const customers = customerMessages(dialogue);
  for (let index = customers.length - 1; index >= 0; index -= 1) {
    const source = oneLine(customers[index]?.text, 500);
    const login = source.match(/\b(abon\d{3,12})\b/i)?.[1];
    if (login) return { login: login.toLowerCase() };
    const ip = source.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
    if (ip) return { ip };
    const explicitContract = source.match(/(?:договор|договір|лицев(?:ой|ий)?\s*сч[её]т|особов(?:ий|ого)\s*рахунок)[^\d]{0,30}(\d{3,12})/i)?.[1];
    if (explicitContract) return { contract: explicitContract };
    if (/^\s*\d{3,8}\s*$/.test(source)) {
      const originalIndex = dialogue.findIndex(item => item === customers[index]);
      const previous = originalIndex > 0 ? oneLine(dialogue[originalIndex - 1]?.text, 500) : '';
      const semanticRef = `${oneLine(analysis?.probe?.refersTo, 400)} ${oneLine(analysis?.probe?.latestMessageMeans, 500)}`;
      if (/договор|договір|номер|login|логин|особов|лицев/i.test(`${previous} ${semanticRef}`)) return { contract: source.trim() };
    }
    if (/(?:^|\s)(?:адрес|адреса|вул\.?|улица|ул\.?|просп\.?|проспект|пров\.?|переулок|буд\.?|будинок|дом|д\.?|кв\.?|квартира)(?:\s|$)/iu.test(source) && /\d/.test(source)) {
      return { address: source.replace(/^\s*(?:адрес|адреса)\s*[:\-]?\s*/iu, '').trim() };
    }
  }
  const userFacts = Array.isArray(analysis?.probe?.factsSaidByUser) ? analysis.probe.factsSaidByUser : [];
  for (const fact of userFacts) {
    const source = oneLine(fact, 500);
    const login = source.match(/\b(abon\d{3,12})\b/i)?.[1];
    if (login) return { login: login.toLowerCase() };
    const contract = source.match(/(?:договор|договір|лицев|особов)[^\d]{0,30}(\d{3,12})/i)?.[1];
    if (contract) return { contract };
    const address = source.match(/(?:адрес|адреса)\s*[:\-]?\s*(.+)$/iu)?.[1];
    if (address && /\d/.test(address)) return { address: oneLine(address, 320) };
  }
  return {};
}

function applyStatePatch(state = {}, patch = {}) {
  const next = state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return next;
  for (const [key, value] of Object.entries(patch)) next[key] = compactObject(value);
  return next;
}
function evidenceSource(result = {}) {
  return oneLine(result?.data?.source || result?.data?.evidence?.source || result?.data?.evidence?.workbenchState || result?.tool || '', 140);
}

export async function executeInformationNeeds({ needs = [], transcript = [], analysis = {}, labState = {}, execute } = {}) {
  if (typeof execute !== 'function') throw new Error('Soft tool broker requires execute(tool)');
  const identity = extractIdentityHints(transcript, analysis);
  const planned = mapInformationNeedsToTools(needs).map(item => (
    item.tool === 'building.snapshot' && !item?.toolArgs?.address && identity.address
      ? { ...item, toolArgs: { ...(item.toolArgs || {}), address: identity.address } }
      : item
  ));
  let state = applyStatePatch({}, labState);
  const calls = [];
  const buildingNeedsSubscriberAddress = planned.some(item =>
    item.tool === 'building.snapshot'
    && !item?.toolArgs?.address
    && Boolean(identity.login || identity.contract || identity.ip)
  );
  const needsAccount = planned.some(item => ACCOUNT_TOOLS.has(item.tool)) || buildingNeedsSubscriberAddress;
  const confirmation = pendingConfirmation(transcript, state);
  if (confirmation !== null) {
    calls.push({
      tool: 'customer.confirm',
      toolArgs: { confirmed: confirmation },
      requestedBy: { system: 'identity', field: 'pendingCandidate', why: confirmation ? 'Клиент подтвердил найденное подключение.' : 'Клиент отклонил найденное подключение.' }
    });
  } else if (needsAccount && !String(state.confirmedCaseId || '').trim() && !state.pendingCandidate) {
    if (Object.keys(identity).length) {
      calls.push({
        tool: 'customer.lookup',
        toolArgs: identity,
        requestedBy: { system: 'identity', field: Object.keys(identity)[0], why: 'Нужна привязка live-данных к конкретному абоненту.' }
      });
    }
  }
  calls.push(...planned);

  const trace = [];
  for (const call of calls.slice(0, 6)) {
    let toolResult;
    try {
      toolResult = await execute({ tool: call.tool, toolArgs: call.toolArgs || {}, labState: state });
    } catch (error) {
      toolResult = { ok: false, tool: call.tool, code: 'TOOL_EXECUTION_ERROR', observedAt: new Date().toISOString(), data: { message: oneLine(error?.message || error, 500) }, warnings: [], statePatch: {} };
    }
    state = applyStatePatch(state, toolResult?.statePatch || {});
    trace.push({
      tool: oneLine(toolResult?.tool || call.tool, 100),
      requestedBy: compactObject(call.requestedBy || {}),
      args: compactObject(call.toolArgs || {}),
      ok: Boolean(toolResult?.ok),
      code: oneLine(toolResult?.code || (toolResult?.ok ? 'OK' : 'ERROR'), 100),
      observedAt: oneLine(toolResult?.observedAt || '', 100),
      source: evidenceSource(toolResult),
      data: compactObject(toolResult?.data || {}),
      warnings: stringList(toolResult?.warnings, 5, 360)
    });
  }

  if (needsAccount && !calls.length) {
    trace.push({
      tool: 'customer.lookup',
      requestedBy: { system: 'identity', field: 'contract/address', why: 'Live-данные относятся к конкретному абоненту.' },
      args: {},
      ok: false,
      code: 'IDENTITY_HINT_MISSING',
      observedAt: new Date().toISOString(),
      source: '',
      data: { message: 'В диалоге пока нет достаточно надёжного номера договора/login/IP/адреса для READ-поиска.' },
      warnings: []
    });
  }
  return { planned, trace, labState: state };
}

function normalizeDataNeeds(value) {
  return (Array.isArray(value) ? value : []).map(item => ({ system: oneLine(item?.system, 80), field: oneLine(item?.field, 160), why: oneLine(item?.why, 300) })).filter(item => item.system || item.field || item.why).slice(0, 6);
}
function fallbackFromAnalysis(analysis = {}, toolTrace = []) {
  const failedIdentity = toolTrace.some(item => ['IDENTITY_REQUIRED', 'IDENTITY_HINT_MISSING', 'AMBIGUOUS_IDENTITY'].includes(item.code));
  if (failedIdentity) return 'Для проверки данных по вашему подключению нужен номер договора или точный адрес. После этого смогу продолжить проверку.';
  const goal = oneLine(analysis?.probe?.whatUserWants, 420);
  if (toolTrace.some(item => item.ok)) return 'Проверку данных выполнил, но сейчас не удалось корректно сформировать итоговый ответ. Данные проверки сохранены; повторите, пожалуйста, этот ход.';
  if (goal) return `Я понял запрос: ${goal}. Сейчас не удалось получить подтверждённые данные, поэтому не буду придумывать ответ. Попробуйте повторить запрос.`;
  return 'Запрос получен, но сейчас не удалось сформировать корректный ответ. Повторите, пожалуйста, сообщение.';
}
export function ensureNonEmptyReply(reply, analysis = {}, toolTrace = []) {
  return block(reply, 2200) || fallbackFromAnalysis(analysis, toolTrace);
}

function pickData(data = {}, keys = []) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const output = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') output[key] = compactObject(source[key]);
  }
  return output;
}

function synthesisEvidenceData(item = {}) {
  const data = item?.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
  if (item?.tool === 'customer.lookup') {
    const candidate = data.candidate && typeof data.candidate === 'object' ? data.candidate : {};
    return {
      ...pickData(data, ['count', 'requiresConfirmation', 'searchMode']),
      ...(Object.keys(candidate).length ? { candidate: pickData(candidate, ['caseId', 'billingId', 'contract', 'login', 'address', 'ip']) } : {})
    };
  }
  if (item?.tool === 'billing.balance') {
    return pickData(data, [
      'accountBalance', 'balanceAfterTariff', 'balanceWithoutTemporary', 'temporaryPayment',
      'price', 'priceSemantics', 'totalDue', 'totalDueSemantics', 'currentTariff'
    ]);
  }
  if (item?.tool === 'billing.tariff') {
    return pickData(data, [
      'currentTariff', 'tariffDisplay', 'tariffId', 'nextTariff', 'nextTariffDelay',
      'price', 'priceSemantics', 'totalDue', 'totalDueSemantics', 'group'
    ]);
  }
  if (item?.tool === 'billing.history') {
    const history = data.history && typeof data.history === 'object' ? data.history : {};
    const events = Array.isArray(history.events) ? history.events.slice(0, 10) : (Array.isArray(data.events) ? data.events.slice(0, 10) : []);
    return {
      ...pickData(data, ['count', 'packageBeforeBlock', 'tariffRecovered', 'scope']),
      ...(events.length ? { events: compactObject(events) } : {})
    };
  }
  if (item?.tool === 'billing.payments') return pickData(data, ['payments', 'count']);
  if (item?.tool === 'customer.confirm') return pickData(data, ['confirmedCaseId', 'confirmedSubscriber', 'confirmed']);
  return compactObject(data);
}

function synthesisMessages({ transcript = [], latestCustomer = {}, analysis = {}, draft = {}, toolTrace = [], factResolution = null, useKnowledge = true } = {}) {
  const dialogue = (Array.isArray(transcript) ? transcript : []).slice(-14).map(item => ({ role: item?.role === 'customer' ? 'customer' : 'operator', text: block(item?.text, 700) })).filter(item => item.text);
  const evidence = factResolution ? [] : toolTrace.map(item => ({
    tool: item.tool,
    requested_by: compactObject(item.requestedBy || {}),
    ok: item.ok,
    code: item.code,
    observed_at: item.observedAt,
    source: item.source,
    data: synthesisEvidenceData(item),
    warnings: item.warnings
  }));
  const stageInstruction = `ЭТАП: TOOL EVIDENCE SYNTHESIS.

READ-only проверки уже выполнены. Сформируй естественный полезный ответ на исходный вопрос абонента, используя dialogue, internal_knowledge и canonical_fact_evidence (либо legacy tool_evidence) как evidence. draft_reply может быть пустым: для live-запросов это нормально, потому что ответ специально не генерируется до получения фактов.

Сначала рассуждай по уже имеющимся фактам. Если их достаточно для прямого логического, арифметического, технического или семантического вывода, дай этот вывод. Не создавай новые требования к данным из-за гипотетического исключения или сценария «а вдруг».

Правила источников:
- tool_evidence с ok=true подтверждает только реально возвращённые поля;
- canonical_fact_evidence содержит только запрошенные канонические факты: status=known подтверждает значение, status=absent означает успешно наблюдавшееся пустое поле, status=unknown означает, что факт не прочитан/не подтверждён;
- requested_by показывает, ради какого факта был сделан READ; соседние возвращённые поля не обязаны попадать в ответ;
- source=billing-live-read-only и source=billing-main-live-read-only — свежая READ-проверка Billing;
- source=userside-live-read-only — свежая READ-проверка UserSide;
- source=userside-building-snapshot-local — сохранённая карточка здания; учитывай snapshotGeneratedAt/snapshotComplete;
- ok=false означает только «проверить не удалось/нет данных в этом источнике», а не отрицательный факт;
- Workbench/Network fallback не выдавай за свежий запрос, если источник так не говорит;
- слова клиента/оператора не превращай в системный факт;
- конкретные внутренние тарифы/правила SIMNET бери из переданного internal_knowledge/live evidence, а общие знания используй для их интерпретации;
- subscriber_data_needed оставляй только для конкретного факта, без которого действительно нельзя закрыть существенную часть запроса;
- отвечай только на текущий запрос: не перечисляй договор, access/service state, тип подключения или другие соседние поля только потому, что tool их вернул;
- по умолчанию отвечай 1–3 короткими предложениями и сообщай только факты, которые прямо отвечают на вопрос или нужны для объяснения вывода;
- не превращай ответ в сводку карточки: статусы услуги/доступа, тариф, баланс, прошлые списания и другие факты не перечисляй, если клиент их не спрашивал и они не нужны для ответа;
- историю в стиле «у вас было X, потом Y» добавляй только когда вопрос действительно про историю/причину изменения; иначе отвечай на текущий вопрос;
- текст description у записи payments (например «Снятие за услуги интернет») подтверждает только описание конкретной Billing-операции. Не используй его как доказательство типа услуги, состава пакета или того, что списание относится именно к интернет-тарифу;
- не теряй исходный вопрос клиента;
- reply обязан быть непустым.

Верни только JSON:
{
  "reply":"готовый непустой ответ абоненту",
  "subscriber_data_needed":[{"system":"Billing|UserSide|Network","field":"что ещё действительно нужно","why":"почему без этого нельзя ответить"}],
  "unresolved_requests":["что реально осталось незакрытым"],
  "clarification_questions":["вопросы реально заданные в reply"],
  "verification_needed":["что всё ещё действительно нельзя утверждать"],
  "next_step_offered":"следующий шаг или пусто",
  "basis":["dialogue","knowledge:...","tool:..."]
}`;
  return [
    ...autonomousOperatorSystemMessages(stageInstruction),
    {
      role: 'user',
      content: JSON.stringify({
        dialogue,
        latest_customer_message: block(latestCustomer?.text, 1200),
        understanding: compactObject(analysis?.probe || {}),
        internal_knowledge: useKnowledge ? compactObject(analysis?.knowledge || {}) : { skipped: true },
        draft_reply: block(draft?.reply, 1800),
        draft_data_needs: normalizeDataNeeds(draft?.subscriberDataNeeded),
        canonical_fact_evidence: compactObject(factResolution?.evidence || []),
        fact_resolver_diagnostics: compactObject(factResolution?.diagnostics || {}),
        tool_evidence: evidence
      })
    }
  ];
}
function normalizeSynthesis(raw = {}, draft = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    reply: block(value.reply, 2200),
    subscriberDataNeeded: normalizeDataNeeds(value.subscriber_data_needed),
    unresolvedRequests: stringList(value.unresolved_requests, 8, 420),
    clarificationQuestions: stringList(value.clarification_questions, 3, 360),
    verificationNeeded: stringList(value.verification_needed, 8, 360),
    nextStepOffered: oneLine(value.next_step_offered, 500),
    basis: stringList(value.basis, 12, 160),
    behaviorEffects: draft?.behaviorEffects || {},
    behavior: draft?.behavior || {}
  };
}

export async function groundSubscriberReply({ draft = {}, transcript = [], latestCustomer = {}, analysis = {}, useKnowledge = true, labState = {}, execute, meterContext = {}, factResolution = null } = {}) {
  const needs = normalizeDataNeeds(draft?.subscriberDataNeeded);
  const factTrace = (Array.isArray(factResolution?.sourceTrace) ? factResolution.sourceTrace : []).map(item => ({
    tool: oneLine(item?.tool || 'canonical.fact_resolver', 100),
    requestedBy: { system: 'CanonicalDomain', field: (item?.requestedFacts || []).join(', '), why: 'Resolve only facts selected by semantic understanding.' },
    args: compactObject(item?.args || {}),
    ok: Boolean(item?.ok),
    code: oneLine(item?.code || (item?.ok ? 'OK' : 'ERROR'), 100),
    observedAt: oneLine(item?.observedAt || '', 100),
    source: oneLine(item?.provenance || item?.source || '', 140),
    data: {},
    warnings: stringList(item?.warnings, 5, 360),
    cache: oneLine(item?.cache || '', 20),
    requestedFacts: [...(item?.requestedFacts || [])]
  }));
  const cycle = factResolution
    ? { trace: factTrace, labState: factResolution.context || labState }
    : await executeInformationNeeds({ needs, transcript, analysis, labState, execute });
  const hasToolActivity = cycle.trace.length > 0 || Boolean(factResolution?.requestedFacts?.length);
  const rawDraftReply = block(draft?.reply, 2200);
  const safeDraft = ensureNonEmptyReply(rawDraftReply, analysis, cycle.trace);
  if (!hasToolActivity) {
    return { ...draft, reply: safeDraft, subscriberDataNeeded: needs, toolTrace: [], toolEvidence: [], degraded: Boolean(draft?.degraded), degradationReason: oneLine(draft?.degradationReason, 500), toolState: cycle.labState };
  }
  try {
    const messages = factResolution
      ? synthesisMessages({ transcript, latestCustomer, analysis, draft: { ...draft, reply: rawDraftReply }, toolTrace: cycle.trace, factResolution, useKnowledge })
      : synthesisMessages({ transcript, latestCustomer, analysis, draft: { ...draft, reply: rawDraftReply }, toolTrace: cycle.trace, useKnowledge });
    const response = await requestSynthesis(
      messages,
      { ...meterContext, stage: 'tool_synthesis' }
    );
    const normalized = normalizeSynthesis(parseJsonObject(response.answer), draft);
    normalized.reply = ensureNonEmptyReply(normalized.reply, analysis, cycle.trace);
    return {
      ...draft,
      ...normalized,
      model: [draft?.model, response.model].filter(Boolean).join(' → '),
      usage: usageTotal(draft?.usage, response.usage),
      rateLimit: response.rateLimit || draft?.rateLimit || {},
      toolTrace: cycle.trace,
      toolEvidence: cycle.trace.filter(item => item.ok),
      factEvidence: compactObject(factResolution?.evidence || []),
      factDiagnostics: compactObject(factResolution?.diagnostics || {}),
      degraded: false,
      degradationReason: '',
      toolState: cycle.labState
    };
  } catch (error) {
    return {
      ...draft,
      reply: ensureNonEmptyReply(safeDraft, analysis, cycle.trace),
      subscriberDataNeeded: needs,
      toolTrace: cycle.trace,
      toolEvidence: cycle.trace.filter(item => item.ok),
      factEvidence: compactObject(factResolution?.evidence || []),
      factDiagnostics: compactObject(factResolution?.diagnostics || {}),
      degraded: true,
      degradationReason: oneLine(error?.message || error, 600),
      toolState: cycle.labState
    };
  }
}
