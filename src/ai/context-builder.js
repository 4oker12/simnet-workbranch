import { buildAiCaseSnapshot, aiSnapshotExcludedByDefault } from './case-snapshot.js';
import { normalizeDialogMemory } from './dialog-session.js';

const DEFAULT_BUDGET = Object.freeze({
  snapshotChars: 1200,
  memoryChars: 850,
  playbookChars: 1200,
  historyChars: 1400,
  totalDynamicChars: 4700,
  maxCards: 5,
  maxHistoryMessages: 6
});

const clean = (value, max = 400) => {
  const raw = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
};

const lower = value => clean(value, 3000).toLowerCase();
const approxTokens = value => Math.ceil(String(value || '').length / 4);

function memoryHas(memory, patterns = []) {
  const text = lower(Object.entries(memory || {}).map(([k, v]) => `${k} ${v}`).join(' '));
  return patterns.some(re => re.test(text));
}

function isUnavailable(memory, patterns = []) {
  const rows = Object.entries(memory || {});
  return rows.some(([key, value]) => patterns.some(re => re.test(String(key))) && /unavailable|невозмож|нет возможности/i.test(String(value)));
}

function cardAnsweredByMessage(cardId, message) {
  const q = lower(message);
  if (cardId === 'scope') return /на (?:всех|нескольких|одном) устройств|одно устройство|несколько устройств/.test(q);
  if (cardId === 'wifi_band') return /(?:2[.,]4|5)\s*(?:ггц|ghz)/.test(q);
  if (cardId === 'wifi_distance') return /рядом с роут|возле роут|далеко от роут|через .*стен|в другой комнате/.test(q);
  if (cardId === 'wifi_phy') return /\bphy\b|link rate|скорост.*соединен.*wifi|скорост.*линк.*wifi/.test(q);
  if (cardId === 'wifi_radio') return /channel utilization|загруз.*канал|ширин.*канал|\b(?:20|40|80|160)\s*(?:mhz|мгц)\b/.test(q);
  if (cardId === 'medium') return /(?:wifi|wi-fi|вай.?фай|ви.?фи).*(?:кабел|lan|ethernet)|(?:кабел|lan|ethernet).*(?:wifi|wi-fi|вай.?фай|ви.?фи)/.test(q);
  if (cardId === 'router_bypass') return /напрямую|в обход роут/.test(q);
  if (cardId === 'service_scope') return /только один (?:сайт|сервис|прилож)|остальные (?:сайты|сервисы).*работ/.test(q);
  if (cardId === 'time') return /только вечером|только утром|постоянно|каждый день|по времени/.test(q);
  if (cardId === 'ip_gateway') return /169\.254|(?:есть|получил|нет).*?(?:ip|айпи)|шлюз.*?(?:пинг|доступ|ответ)/.test(q);
  if (cardId === 'dns_path') return /nslookup|dns.*?(?:работ|не работ|timeout|тайм)|ping.*?(?:8\.8\.8\.8|1\.1\.1\.1|домен|google\.com)/.test(q);
  if (cardId === 'recovery') return /сам.*восстан|после.*перезагруз|возвращается сам/.test(q);
  if (cardId === 'vpn_path') return /через vpn|с vpn|мобильн.*интернет|через 4g|через 5g/.test(q);
  if (cardId === 'cpe_reboot') return /перезагруз.*роут|роут.*перезагруз/.test(q);
  if (cardId === 'pon_lights') return /\blos\b|индикатор.*onu|onu.*(?:горит|мигает|питание)/.test(q);
  return false;
}

function cardKnown(cardId, memory) {
  if (cardId === 'scope') return memoryHas(memory, [/affected.*device|device.*scope|нескольк.*устрой|одно.*устрой/]);
  if (cardId === 'wifi_band') return memoryHas(memory, [/wifi.*band|2\.4|5\s*ghz|5\s*ггц/]);
  if (cardId === 'wifi_distance') return memoryHas(memory, [/wifi.*distance|рядом.*роут|далеко.*роут|через.*стен/]);
  if (cardId === 'wifi_phy') return memoryHas(memory, [/wifi.*phy|phy.*rate|link.*rate/]);
  if (cardId === 'wifi_radio') return memoryHas(memory, [/wifi.*channel.*width|wifi.*channel.*change|channel.*utilization|загруз.*канал/]);
  if (cardId === 'medium') return memoryHas(memory, [/lan.*speed|ethernet.*speed|по кабел|wired.*speed/]);
  if (cardId === 'router_bypass') return memoryHas(memory, [/direct.*test|router.*bypass|напрямую/]) || isUnavailable(memory, [/direct|bypass/]);
  if (cardId === 'link_vs_internet') return memoryHas(memory, [/wifi.*association|wifi.*remain|wifi.*drop|теряет.*wifi|значок.*wifi/]);
  if (cardId === 'service_scope') return memoryHas(memory, [/service.*scope|один.*сайт|все.*сайт|один.*сервис/]);
  if (cardId === 'time') return memoryHas(memory, [/problem.*pattern|problem.*time|drop.*frequency|drop.*duration|вечер|утр|постоян|период/]);
  if (cardId === 'ip_gateway') return memoryHas(memory, [/client.*ip.*state|gateway.*reach/]);
  if (cardId === 'dns_path') return memoryHas(memory, [/dns.*resolution|dns.*change|ping.*ip|ping.*hostname/]);
  if (cardId === 'recovery') return memoryHas(memory, [/drop.*recovery|cpe.*reboot|onu.*reboot/]);
  if (cardId === 'vpn_path') return memoryHas(memory, [/vpn.*effect|mobile.*network.*test/]);
  if (cardId === 'cpe_reboot') return memoryHas(memory, [/cpe.*reboot/]) || isUnavailable(memory, [/cpe.*reboot/]);
  if (cardId === 'pon_lights') return memoryHas(memory, [/los.*reported|onu.*power.*state/]);
  return false;
}

function cardResolvedBySnapshot(cardId, snapshot) {
  if (cardId === 'ethernet_capacity') return snapshot?.ethernet?.capacityVsTariff === 'sufficient';
  if (cardId === 'multiple_macs') return snapshot?.identity?.learnedState === 'normal';
  if (cardId === 'stability_events') return snapshot?.stability?.state === 'no_anomaly_observed';
  if (cardId === 'onu_current_state') return snapshot?.onu?.poll?.state === 'recent';
  return false;
}

function cardRelevance(card, message, snapshot, memory = {}) {
  const q = lower(`${message || ''} ${Object.entries(memory || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`);
  const tags = Array.isArray(card?.tags) ? card.tags.map(lower) : [];
  let score = 0;
  let reason = '';
  const set = (points, why) => { if (points > score) { score = points; reason = why; } };

  if (card.id === 'wifi_band' && /wifi|wi-fi|вай.?фай|ви.?фи/.test(q)) set(18, 'Wi‑Fi: диапазон сильно меняет ожидаемую скорость/радиоусловия');
  if (card.id === 'wifi_distance' && /wifi|wi-fi|вай.?фай|ви.?фи|скорост/.test(q)) set(15, 'Wi‑Fi: рядом/далеко разделяет покрытие и ограничение CPE');
  if (card.id === 'wifi_phy' && /wifi|wi-fi|вай.?фай|ви.?фи|скорост/.test(q)) set(17, 'Wi‑Fi: PHY rate помогает отделить radio/link от реального throughput');
  if (card.id === 'wifi_radio' && /wifi|wi-fi|вай.?фай|ви.?фи|скорост|канал/.test(q)) set(14, 'Wi‑Fi: канал/ширина/загрузка эфира — практичная следующая ветка');
  if (card.id === 'scope' && /нет интернета|не работает|скорост|обрыв|пропад|сайт|прилож/.test(q)) set(11, 'масштаб по устройствам отделяет локальную проблему от общей');
  if (card.id === 'medium' && /скорост|wifi|wi-fi|вай.?фай|ви.?фи/.test(q)) set(13, 'Wi‑Fi ↔ LAN отделяет радио от остального тракта');
  if (card.id === 'router_bypass' && /кабел|lan|ethernet|скорост/.test(q)) set(7, 'LAN ↔ обход роутера отделяет CPE от сети выше');
  if (card.id === 'link_vs_internet' && /обрыв|пропад|нет интернета|отключ/.test(q)) set(16, 'сохранение Wi‑Fi во время сбоя разделяет радио и WAN/сеть');
  if (card.id === 'service_scope' && /сайт|сервис|dns|vpn|прилож|megogo|netflix|ютуб|youtube/.test(q)) set(16, 'один сервис ↔ многие ресурсы разделяет локальную сервисную и общую проблему');
  if (card.id === 'time' && /обрыв|пропад|вечер|период|иногда/.test(q)) set(8, 'привязка ко времени помогает сопоставить повторяющийся фактор');
  if (card.id === 'ip_gateway' && /нет интернет|без интернет|не работает интернет|dhcp|айпи|\bip\b/.test(q)) set(17, 'нет интернета: IP и gateway быстро отделяют LAN/DHCP от DNS/доступа выше');
  if (card.id === 'dns_path' && /dns|сайт|не открыва|нет интернет|vpn/.test(q)) set(16, 'IP ↔ hostname/DNS отделяет резолвинг от общего сетевого доступа');
  if (card.id === 'recovery' && /обрыв|пропад|нестабил|отвалива/.test(q)) set(13, 'способ восстановления помогает понять, какой слой реально сбрасывается');
  if (card.id === 'vpn_path' && /сайт|сервис|dns|vpn|прилож|удален|удалён/.test(q)) set(15, 'VPN/другая сеть меняет путь и хорошо разделяет сервис/DNS/маршрут');
  if (card.id === 'cpe_reboot' && /нет интернет|обрыв|пропад|роут|cpe/.test(q)) set(7, 'эффект reboot CPE полезен как state-change test, если его ещё не делали');
  if (card.id === 'pon_lights' && /нет интернет|los|onu|ону|pon/.test(q)) set(12, 'состояние LOS/питания со слов абонента дополняет текущий PON snapshot');
  if (card.id === 'ethernet_capacity' && /скорост|кабел|lan|ethernet/.test(q)) set(12, 'скорость: сопоставить Ethernet link с тарифом');
  if (card.id === 'multiple_macs' && Number(snapshot?.identity?.learnedCount || 0) > 1) set(24, 'Workbench видит несколько MAC за ONU');
  if (card.id === 'stability_events' && snapshot?.stability?.state === 'abnormal') set(24, 'Workbench видит частые события ONU');
  if (card.id === 'onu_current_state' && String(snapshot?.access?.family || '').toUpperCase() === 'PON' && /нет интернета|скорост|обрыв|пропад|нестабил/.test(q)) set(20, 'PON-жалоба: текущий ONU poll отсутствует или может быть неактуален');
  if (card.id === 'ethernet_capacity' && snapshot?.ethernet?.capacityVsTariff === 'insufficient') set(24, 'Ethernet link ниже скорости тарифа');

  for (const tag of tags) {
    if (tag && q.includes(tag) && score < 5) set(5, 'карточка совпала с темой сообщения');
  }
  return { score, reason };
}

function minimalCard(card, reason) {
  return {
    id: clean(card?.id, 60),
    split: clean(card?.split || card?.title, 130),
    use: clean(card?.use || card?.explanation, 190),
    reason: clean(reason, 120)
  };
}

function selectPlaybook(playbook, message, memory, snapshot, budget = DEFAULT_BUDGET) {
  const source = Array.isArray(playbook?.cards) ? playbook.cards : Array.isArray(playbook?.heuristics) ? playbook.heuristics : [];
  const suggested = new Set(Array.isArray(playbook?.suggestedCardIds) ? playbook.suggestedCardIds.map(String) : []);
  const ranked = source
    .filter(card => card?.id && !cardKnown(String(card.id), memory) && !cardAnsweredByMessage(String(card.id), message) && !cardResolvedBySnapshot(String(card.id), snapshot))
    .map(card => {
      const relevance = cardRelevance(card, message, snapshot, memory);
      return { card, score: relevance.score + (suggested.has(String(card.id)) ? 3 : 0), reason: relevance.reason || (suggested.has(String(card.id)) ? 'предварительно выбрано по теме сообщения' : '') };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, budget.maxCards)
    .map(row => minimalCard(row.card, row.reason));
  const result = {
    revision: clean(playbook?.revision || 'selective-playbook-v1', 80),
    instruction: 'Эвристики — разделители, не чек-лист. Будь инициативным: выбери главный ход или 2–4 связанных проверки одной ветки, если это быстрее.',
    cards: []
  };
  for (const card of ranked) {
    const candidate = { ...result, cards: [...result.cards, card] };
    if (JSON.stringify(candidate).length > budget.playbookChars) break;
    result.cards.push(card);
  }
  return result;
}

function selectSnapshotForContext(snapshot, message, memory) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const q = lower(`${message || ''} ${Object.entries(memory || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`);
  const speed = /скорост|speed|мбит|mbit/.test(q);
  const noInternet = /нет интернет|интернет не работает|без интернет|no internet/.test(q);
  const unstable = /обрыв|пропад|нестабил|disconnect|вылогин|фриз/.test(q);
  const wifi = /wifi|wi-fi|вай.?фай|ви.?фи/.test(q);
  const service = /сайт|сервис|dns|vpn|прилож|megogo|netflix|youtube|ютуб/.test(q);
  const macTopic = /\bmac\b|\bмак\b|мак[-\s]?адрес|bridge|мост|точк.*доступ/.test(q);
  const ponComplaint = String(snapshot?.access?.family || '').toUpperCase() === 'PON' && (speed || noInternet || unstable);
  const hasAnomalies = Array.isArray(snapshot.anomalies) && snapshot.anomalies.length > 0;
  const identityAbnormal = ['multiple'].includes(String(snapshot?.identity?.learnedState || ''))
    || ['mismatch'].includes(String(snapshot?.identity?.subscriberMacMatch || ''));
  const brasAbnormal = snapshot?.bras?.state && !['online', 'available', 'unknown'].includes(String(snapshot.bras.state));

  const out = { schema: snapshot.schema, access: snapshot.access };
  if (snapshot?.case?.complaint) out.case = { complaint: snapshot.case.complaint };
  if (speed) out.tariff = snapshot.tariff;
  if (ponComplaint || noInternet || unstable || hasAnomalies) out.onu = snapshot.onu;
  if (speed || noInternet || unstable || snapshot?.ethernet?.link === 'down' || snapshot?.ethernet?.capacityVsTariff === 'insufficient') out.ethernet = snapshot.ethernet;
  if (unstable || snapshot?.stability?.state === 'abnormal') out.stability = snapshot.stability;
  if (macTopic || identityAbnormal || ponComplaint) out.identity = snapshot.identity;
  if (noInternet || service || brasAbnormal) out.bras = snapshot.bras;
  if ((/tmc|тмц|привяз|olt|ону.*соответ/.test(q)) && snapshot.tmc) out.tmc = snapshot.tmc;
  if (hasAnomalies) out.anomalies = snapshot.anomalies;
  if (snapshot.details) out.details = snapshot.details;

  // For a vague continuation keep the core current PON state, but still avoid a full technical dump.
  if (!speed && !noInternet && !unstable && !wifi && !service && !macTopic && !snapshot.details) {
    if (String(snapshot?.access?.family || '').toUpperCase() === 'PON') out.onu = snapshot.onu;
    if (hasAnomalies) out.anomalies = snapshot.anomalies;
  }
  return out;
}

function trimString(value, maxChars) {
  const raw = String(value || '');
  return raw.length <= maxChars ? raw : `${raw.slice(0, Math.max(0, maxChars - 1))}…`;
}

function sectionStats(sections) {
  const out = {};
  for (const [key, value] of Object.entries(sections)) {
    out[key] = { chars: String(value || '').length, approxTokens: approxTokens(value) };
  }
  return out;
}

function snapshotReason(path) {
  if (path.startsWith('tariff.')) return 'сопоставление тарифа с link/замерами';
  if (path.startsWith('onu.poll.')) return 'контроль свежести состояния линии';
  if (path.startsWith('onu.')) return 'текущее состояние и последняя причина ONU';
  if (path.startsWith('ethernet.')) return 'физический link между ONU и CPE';
  if (path.startsWith('stability.')) return 'частота отключений/перезапусков';
  if (path.startsWith('identity.')) return 'соответствие MAC и топология за ONU';
  if (path.startsWith('bras.')) return 'состояние сетевой сессии';
  if (path.startsWith('tmc.')) return 'наличие сверки TMC без жёсткого блокера';
  if (path.startsWith('anomalies')) return 'Workbench уже классифицировал отклонение';
  if (path.startsWith('details.')) return 'оператор прямо спросил эту техническую деталь';
  return 'минимальный контекст текущего кейса';
}

function flattenSnapshot(snapshot) {
  const rows = [];
  const walk = (value, path = '') => {
    if (Array.isArray(value)) {
      value.slice(0, 8).forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
      return;
    }
    if (value !== undefined && value !== null && value !== '') rows.push({ path, value: String(value), reason: snapshotReason(path) });
  };
  walk(snapshot);
  return rows.filter(row => row.path !== 'schema').slice(0, 40);
}

function memoryPriority(key, value, query) {
  const k = String(key || '').toLowerCase();
  const v = String(value || '').toLowerCase();
  let score = 1;
  if (/unavailable|tried_no_effect|fails|no_effect|none_confirmed/.test(v)) score += 30;
  if (/affected_devices|problem_pattern|wired_test|other_device_test|cpe_reboot/.test(k)) score += 18;
  const domains = [
    [/нет интернет|без интернет|dhcp|gateway|шлюз|айпи|\bip\b/, /client_ip|gateway|dns_|ping_|wifi_association|wifi_ssid|wired_test|cpe_reboot|affected_devices/],
    [/скорост|wifi|wi-fi|вай.?фай|ви.?фи|мбит|mbit|phy/, /wifi_|wired_test|ethernet_|cpe_|other_device|affected_devices/],
    [/обрыв|пропад|нестабил|disconnect|фриз|отвалива/, /drop_|problem_|wifi_association|cpe_reboot|onu_reboot|los_|onu_power|affected_devices/],
    [/сайт|сервис|dns|vpn|прилож|megogo|netflix|youtube|ютуб|удален|удалён/, /service_|dns_|vpn_|mobile_network|ping_|affected_devices/],
    [/pon|onu|ону|los|оптик/, /los_|onu_|wired_test|drop_|problem_/]
  ];
  for (const [qre, kre] of domains) if (qre.test(query) && kre.test(k)) score += 22;
  return score;
}

function selectMemoryForContext(memory = {}, message = '', maxChars = 850) {
  const normalized = normalizeDialogMemory(memory);
  const q = lower(`${message || ''} ${Object.entries(normalized).slice(-8).map(([k, v]) => `${k} ${v}`).join(' ')}`);
  const ranked = Object.entries(normalized)
    .map(([key, value], index) => ({ key, value, index, score: memoryPriority(key, value, q) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const selected = [];
  let used = 0;
  for (const row of ranked) {
    const line = `${row.key}: ${row.value}`;
    if (selected.length && used + line.length + 1 > maxChars) continue;
    if (!selected.length && line.length > maxChars) selected.push(line.slice(0, maxChars));
    else { selected.push(line); used += line.length + 1; }
  }
  return selected.join('\n') || 'Пока ничего отдельно не установлено из разговора.';
}

export function buildAiContext({ caseData, message, dialogMemory = {}, recentHistory = [], playbook = {}, systemPrompt = '', budget = DEFAULT_BUDGET } = {}) {
  const normalizedMemory = normalizeDialogMemory(dialogMemory);
  const fullSnapshot = buildAiCaseSnapshot(caseData, { message });
  const snapshot = selectSnapshotForContext(fullSnapshot, message, normalizedMemory);
  const selectedPlaybook = selectPlaybook(playbook, message, normalizedMemory, fullSnapshot, budget);
  const snapshotText = trimString(JSON.stringify(snapshot || { status: 'no-current-case-snapshot' }), budget.snapshotChars);
  const memoryText = trimString(selectMemoryForContext(normalizedMemory, message, budget.memoryChars), budget.memoryChars);
  const playbookText = JSON.stringify(selectedPlaybook);
  const candidates = (Array.isArray(recentHistory) ? recentHistory : []).slice(-budget.maxHistoryMessages).map(item => ({ role: item.role, content: clean(item.content, 520) }));
  const boundedHistory = [];
  let historyChars = 2;
  for (const item of [...candidates].reverse()) {
    const candidateChars = JSON.stringify(item).length + 1;
    if (boundedHistory.length && historyChars + candidateChars > budget.historyChars) break;
    if (!boundedHistory.length && candidateChars > budget.historyChars) {
      boundedHistory.unshift({ ...item, content: trimString(item.content, Math.max(80, budget.historyChars - 80)) });
      break;
    }
    boundedHistory.unshift(item);
    historyChars += candidateChars;
  }
  const historyText = JSON.stringify(boundedHistory);

  const sections = { system: systemPrompt, snapshot: snapshotText, memory: memoryText, playbook: playbookText, history: historyText, user: message };
  const stats = sectionStats(sections);
  const dynamicChars = stats.snapshot.chars + stats.memory.chars + stats.playbook.chars + stats.history.chars;
  const meta = {
    schema: 'simnet-ai-context-inspector-v1',
    budget: { ...budget, dynamicChars, status: dynamicChars <= budget.totalDynamicChars ? 'ok' : 'over' },
    sections: stats,
    selectedSnapshot: flattenSnapshot(snapshot),
    excludedSnapshot: aiSnapshotExcludedByDefault(),
    playbookCards: selectedPlaybook.cards.map(card => ({ id: card.id, reason: card.reason })),
    historyMessages: boundedHistory.length,
    freshness: snapshot?.onu?.poll || { state: 'unknown' }
  };
  return { snapshot, snapshotText, memoryText, playbook: selectedPlaybook, playbookText, history: boundedHistory, meta };
}

export { DEFAULT_BUDGET as AI_CONTEXT_BUDGET };
