const MEMORY_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MEMORY_PLACEHOLDER_KEYS = new Set(['fact_key', 'key', 'value', 'example']);
const MEMORY_ALLOWED_KEYS = new Set([
  // universal scope / test state
  'complaint', 'affected_devices', 'problem_pattern', 'problem_time_pattern', 'wired_test', 'other_device_test', 'cpe_reboot',
  // Wi-Fi / speed / CPE
  'wifi_band', 'wifi_distance', 'wifi_association', 'wifi_ssid_visible', 'wifi_speed', 'wifi_phy_rate', 'wifi_rssi',
  'wifi_channel_width', 'wifi_channel_change', 'firmware_update', 'cpe_qos', 'cpe_smart_connect', 'cpe_mesh_repeater',
  // Ethernet / client path
  'ethernet_cable_change', 'ethernet_port_change',
  // service / DNS / route / VPN
  'service_scope', 'service_name', 'dns_resolution', 'dns_change', 'ping_ip', 'ping_hostname', 'gateway_reachability',
  'client_ip_state', 'vpn_effect', 'mobile_network_test',
  // intermittent / PON / mass-scope reports
  'drop_layer', 'drop_recovery', 'drop_duration', 'drop_frequency', 'los_reported', 'onu_power_state', 'onu_reboot',
  'mass_neighbor_report', 'mass_other_tickets'
]);
const MEMORY_KEY_ALIASES = Object.freeze({
  direct_test: 'wired_test',
  direct_wired_test: 'wired_test',
  wifi_speed_mbps: 'wifi_speed'
});
const MEMORY_MAX_ENTRIES = 32;

const MEMORY_UNKNOWN_RE = /^(?:unknown|not_asked|not asked|неизвестно|неизвестен|неизвестна|неизвестный)$/i;
const MEMORY_STATUS_UNAVAILABLE_RE = /(?:unavailable|невозмож|нет возможности|никак не (?:могу|может|получается)|не может|не получится)/i;
const HYPOTHETICAL_LEAD_RE = /^\s*(?:(?:а\s+)?если|допустим|например|представим|в теории|предположим)(?:\s|$|[,.;:!?])/i;
const SHORT_YES_RE = /^(?:да|ага|угу|есть|остается|остаётся|видно|работает)[.!\s]*$/i;
const SHORT_NO_RE = /^(?:нет|неа|не работает|не видно|пропадает|отваливается)[.!\s]*$/i;
const SHORT_UNAVAILABLE_RE = /^(?:нет возможности|никак|не может|невозможно|не получится|нечем|не на чем|не на чём)[!.\s]*$/i;
const SHORT_NO_EFFECT_RE = /^(?:не помогло|без изменений|без результата|то же самое|так же|никак не изменилось)[!.\s]*$/i;

const isUnknownMemoryValue = value => MEMORY_UNKNOWN_RE.test(cleanText(value, 180));

export function mergeDialogMemory(base = {}, candidate = {}, maxEntries = MEMORY_MAX_ENTRIES) {
  const current = normalizeDialogMemory(base, maxEntries);
  const next = normalizeDialogMemory(candidate, maxEntries);
  const out = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (Object.keys(out).length >= maxEntries && !(key in out)) break;
    const previous = out[key];
    if (!previous || isUnknownMemoryValue(previous)) {
      if (!isUnknownMemoryValue(value)) out[key] = value;
      continue;
    }
    if (isUnknownMemoryValue(value)) continue;
    if (String(previous).toLowerCase() === String(value).toLowerCase()) continue;
    // Established dialog facts are sticky. Explicit corrections are applied by the
    // operator-side deterministic extractor before model memory is merged.
  }
  return normalizeDialogMemory(out, maxEntries);
}

function recentDialogText(recentHistory = [], roles = null) {
  return (Array.isArray(recentHistory) ? recentHistory : [])
    .filter(item => !roles || roles.includes(item?.role))
    .slice(-4)
    .map(item => cleanText(item?.content, 700))
    .join(' ')
    .toLowerCase();
}

function assertiveText(raw = '') {
  const source = cleanText(raw, 1800);
  if (!source) return '';
  const parts = source
    .split(/(?<=[.!?;])\s+|\s+(?=(?:а\s+)?если(?:\s|$|[,.;:!?])|допустим(?:\s|$|[,.;:!?])|например(?:\s|$|[,.;:!?])|представим(?:\s|$|[,.;:!?])|в теории(?:\s|$|[,.;:!?])|предположим(?:\s|$|[,.;:!?]))/iu)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !HYPOTHETICAL_LEAD_RE.test(part));
  return parts.join(' ');
}

function assistantQuestionTargets(text = '') {
  const q = String(text || '').toLowerCase();
  const targets = [];
  const add = key => { if (!targets.includes(key)) targets.push(key); };
  if (/кабел|провод|ethernet|lan|напрям|в обход роут/.test(q)) add('wired_test');
  if (/друг(?:ом|ой)\s+(?:телефон|устройств|девайс)|другое устройство/.test(q)) add('other_device_test');
  if (/перезагру|reboot.*роут|роут.*reboot/.test(q)) add('cpe_reboot');
  if (/wi-?fi.*оста[её]т|вай.?фай.*оста[её]т|значок.*wi-?fi|ssid.*вид/.test(q)) add('wifi_association');
  if (/ssid.*вид|сеть\s+wi-?fi.*вид|вай.?фай.*видн/.test(q)) add('wifi_ssid_visible');
  if (/на всех.*устрой|на одном.*устрой|нескольк.*устрой/.test(q)) add('affected_devices');
  if (/через vpn|с vpn|vpn.*помог|vpn.*работ/.test(q)) add('vpn_effect');
  if (/мобильн.*интернет|через 4g|через 5g|раздать.*телефон/.test(q)) add('mobile_network_test');
  if (/dns.*мен|смен.*dns|друг.*dns/.test(q)) add('dns_change');
  if (/ping.*шлюз|пинг.*шлюз|gateway.*ping/.test(q)) add('gateway_reachability');
  return targets;
}

function bindShortReply(out, raw, recentAssistant) {
  const targets = assistantQuestionTargets(recentAssistant);
  if (targets.length !== 1) return;
  const key = targets[0];
  if (SHORT_UNAVAILABLE_RE.test(raw)) {
    out[key] = 'unavailable';
    return;
  }
  if (SHORT_NO_EFFECT_RE.test(raw)) {
    if (['cpe_reboot','dns_change','other_device_test','mobile_network_test','vpn_effect'].includes(key)) out[key] = 'tried_no_effect';
    return;
  }
  if (key === 'wifi_association') {
    if (SHORT_YES_RE.test(raw)) out[key] = 'stays';
    else if (SHORT_NO_RE.test(raw)) out[key] = 'drops';
  } else if (key === 'wifi_ssid_visible') {
    if (SHORT_YES_RE.test(raw)) out[key] = 'visible';
    else if (SHORT_NO_RE.test(raw)) out[key] = 'not_visible';
  } else if (key === 'affected_devices') {
    if (SHORT_YES_RE.test(raw) && /на всех/.test(recentAssistant)) out[key] = 'all';
  }
}

export function deriveOperatorDialogMemory(memory = {}, message = '', recentHistory = []) {
  const out = normalizeDialogMemory(memory);
  const raw = cleanText(message, 1800);
  if (!raw) return out;
  const recent = recentDialogText(recentHistory);
  const recentAssistant = recentDialogText(recentHistory, ['assistant']);
  bindShortReply(out, raw, recentAssistant);

  const asserted = assertiveText(raw);
  if (!asserted) return normalizeDialogMemory(out);
  const q = asserted.toLowerCase();
  const set = (key, value) => { if (key && value) out[key] = value; };

  // UNIVERSAL SCOPE / PATTERN -------------------------------------------------
  if (/(?:на|у)\s+(?:всех|всех его|всех домашних)\s+(?:телефон|устройств|девайс)|все\s+(?:устройств|телефон).*?(?:так же|не работают|без интернет|проблем)/i.test(asserted)) set('affected_devices', 'all');
  else if (/(?:на|у)\s+(?:нескольких|двух|тр[её]х|четыр[её]х)\s+(?:телефон|устройств|девайс)|несколько\s+(?:телефон|устройств|девайс)/i.test(asserted)) set('affected_devices', 'multiple');
  else if (/(?:только\s+)?на\s+одном\s+(?:телефон|устройств|девайс)|только\s+одно\s+устройств/i.test(asserted)) set('affected_devices', 'one');

  if (/периодич|иногда|временами|то работает.*то нет|пропада|обрыв|отвалива|каждые\s+\d+/i.test(asserted)) set('problem_pattern', 'intermittent');
  else if (/постоянно|всегда|вообще не работает|совсем не работает/i.test(asserted)) set('problem_pattern', 'constant');
  if (/только\s+вечер|по\s+вечерам|вечером/i.test(asserted)) set('problem_time_pattern', 'evening');
  else if (/только\s+утр|по\s+утрам|утром/i.test(asserted)) set('problem_time_pattern', 'morning');
  else if (/под нагрузк|когда скачив|когда кача|при скачив|во время игр|в игре/i.test(asserted)) set('problem_time_pattern', 'under_load');

  // WI-FI / SPEED -------------------------------------------------------------
  if (/(?:5\s*(?:ггц|ghz)(?:\s|$|[.,!?])|\b5g\b)/i.test(asserted)) set('wifi_band', '5GHz');
  else if (/(?:2[.,]4\s*(?:ггц|ghz)(?:\s|$|[.,!?])|\b2g\b)/i.test(asserted)) set('wifi_band', '2.4GHz');

  if (/(?:рядом|возле|около)\s+(?:с\s+)?роутер|прямо\s+у\s+роутер/i.test(asserted)) set('wifi_distance', 'near_router');
  else if (/далеко\s+от\s+роутер|в\s+другой\s+комнат|через\s+(?:\w+\s+)?стен/i.test(asserted)) set('wifi_distance', 'far_or_walls');

  if (/(?:wi-?fi|wifi|вай.?фай|ви.?фи)[^.!?]{0,60}(?:оста[её]тся(?: подключ)?|не отвалива|значок оста[её]тся|подключение оста[её]тся)/i.test(asserted)) set('wifi_association', 'stays');
  else if (/(?:wi-?fi|wifi|вай.?фай|ви.?фи)[^.!?]{0,60}(?:отвалива|пропада|разъединя|disconnect)/i.test(asserted)) set('wifi_association', 'drops');
  if (/(?:ssid|wi-?fi сеть|вай.?фай сеть)[^.!?]{0,40}(?:видна|видно|есть)/i.test(asserted)) set('wifi_ssid_visible', 'visible');
  else if (/(?:ssid|wi-?fi сеть|вай.?фай сеть)[^.!?]{0,40}(?:не видна|не видно|пропадает)/i.test(asserted)) set('wifi_ssid_visible', 'not_visible');

  const speedContext = /скорост|speed|wifi|wi-fi|вай.?фай|ви.?фи/.test(q) || /скорост|speed|wifi|wi-fi|вай.?фай|ви.?фи/.test(recent);
  let speedMatch = asserted.match(/(?:меньше|ниже|до)\s*(\d{2,4})\s*(?:мбит|mbit|mbps)?/i);
  if (speedContext && speedMatch) set('wifi_speed', `<${speedMatch[1]} Mbps`);
  else {
    speedMatch = asserted.match(/(?:около|примерно|~)\s*(\d{2,4})\s*(?:мбит|mbit|mbps)?/i)
      || asserted.match(/(\d{2,4})\s*(?:мбит|mbit|mbps)/i)
      || (speedContext ? asserted.match(/(?:показывает|дает|даёт|выдает|выдаёт)\s*(\d{2,4})\b/i) : null);
    if (speedContext && speedMatch) set('wifi_speed', `${speedMatch[1]} Mbps`);
  }
  const phy = asserted.match(/(?:phy(?:\s*rate)?|link\s*rate|скорост\w*\s+соединен\w*\s+(?:wi-?fi|wifi))[^\d]{0,20}(\d{2,4})\s*(?:мбит|mbit|mbps)?/i);
  if (phy) set('wifi_phy_rate', `${phy[1]} Mbps`);
  const rssi = asserted.match(/(?:rssi|сигнал)[^\d-]{0,20}(-?\d{2,3})\s*(?:dbm|дбм)?/i);
  if (rssi) set('wifi_rssi', `${rssi[1]} dBm`);
  const width = asserted.match(/(?:ширин\w*|канал\w*)[^.!?]{0,40}\b(20|40|80|160)\s*(?:мгц|mhz)\b/i);
  if (width) set('wifi_channel_width', `${width[1]}MHz`);
  if (/канал[^.!?]{0,60}(?:менял|меняли|переключал|переключали|ставил|ставили)[^.!?]{0,60}(?:не помог|без результат|без измен|то же|так же)/i.test(asserted)
      || /(?:менял|меняли|переключал|переключали)[^.!?]{0,40}канал[^.!?]{0,60}(?:не помог|без результат|без измен|то же|так же)/i.test(asserted)) set('wifi_channel_change', 'tried_no_effect');

  // WIRED / CPE / CLIENT ------------------------------------------------------
  const wiredMention = /кабел|провод|ethernet|lan|напрям/i.test(asserted);
  const wiredUnavailable = /(?:кабел|провод|ethernet|lan|напрям)[^.!?]{0,90}(?:нет возможности|невозмож|не может|никак|не получится)|(?:нет возможности|невозмож|не может|никак|не получится)[^.!?]{0,90}(?:кабел|провод|ethernet|lan|напрям)/i.test(asserted);
  if (wiredUnavailable) set('wired_test', 'unavailable');
  else if (wiredMention && /(?:проверил|проверили|замерил|замерили|тестировал|тестировали)/i.test(asserted)) {
    if (/(?:норм|полная|гигабит|900|800|700)/i.test(asserted)) set('wired_test', 'normal');
    else if (/нет интернет|без интернет/i.test(asserted)) set('wired_test', 'no_internet');
    else if (/медлен|низк.*скорост|меньше|ниже/i.test(asserted)) set('wired_test', 'slow');
    else set('wired_test', 'done');
  }

  if (/роутер[^.!?]{0,50}(?:перезагру|ребут)|(?:перезагру|ребут)[^.!?]{0,50}роутер/i.test(asserted)) {
    if (/не помог|без результат|без измен|то же|так же/i.test(asserted)) set('cpe_reboot', 'tried_no_effect');
    else if (/помог|заработал|восстановил|исправил/i.test(asserted)) set('cpe_reboot', 'fixed');
    else if (/на время|временно|потом снова/i.test(asserted)) set('cpe_reboot', 'temporary_effect');
    else set('cpe_reboot', 'done');
  }
  if (/(?:друг(?:ом|ой)\s+(?:телефон|устройств|девайс)|другое устройство)[^.!?]{0,80}(?:то же|так же|та же|не работает|медленно|проблем)/i.test(asserted)) set('other_device_test', 'same_problem');
  else if (/(?:друг(?:ом|ой)\s+(?:телефон|устройств|девайс)|другое устройство)[^.!?]{0,80}(?:норм|работает|всё ок|все ок)/i.test(asserted)) set('other_device_test', 'normal');
  if (/друг(?:ой|им)\s+кабел[^.!?]{0,60}(?:не помог|без измен|то же)/i.test(asserted)) set('ethernet_cable_change', 'tried_no_effect');
  else if (/друг(?:ой|им)\s+кабел[^.!?]{0,60}(?:помог|заработал|стал.*1000)/i.test(asserted)) set('ethernet_cable_change', 'fixed');
  if (/друг(?:ой|ом)\s+порт[^.!?]{0,60}(?:не помог|без измен|то же)/i.test(asserted)) set('ethernet_port_change', 'tried_no_effect');
  else if (/друг(?:ой|ом)\s+порт[^.!?]{0,60}(?:помог|заработал|стал.*1000)/i.test(asserted)) set('ethernet_port_change', 'fixed');

  if (/прошивк[^.!?]{0,50}(?:обновил|обновлял|обновили|поставил|поставили)[^.!?]{0,50}(?:не помог|без результат|без измен|то же|так же)/i.test(asserted)) set('firmware_update', 'tried_no_effect');
  else if (/прошивк[^.!?]{0,50}(?:обновил|обновлял|обновили|поставил|поставили)/i.test(asserted)) set('firmware_update', 'done');
  if (/qos[^.!?]{0,30}(?:включ|on)/i.test(asserted)) set('cpe_qos', 'enabled');
  else if (/qos[^.!?]{0,30}(?:выключ|off)/i.test(asserted)) set('cpe_qos', 'disabled');
  if (/smart\s*connect[^.!?]{0,30}(?:включ|on)/i.test(asserted)) set('cpe_smart_connect', 'enabled');
  else if (/smart\s*connect[^.!?]{0,30}(?:выключ|off)/i.test(asserted)) set('cpe_smart_connect', 'disabled');
  if (/mesh|репитер|repeater|усилител/i.test(asserted)) set('cpe_mesh_repeater', /нет\s+(?:mesh|репитер|repeater|усилител)/i.test(asserted) ? 'absent' : 'present');

  // NO INTERNET / DNS / SERVICE / VPN ----------------------------------------
  if (/только\s+(?:один|этот)\s+(?:сайт|сервис|прилож)|остальн(?:ые|ой).*?(?:сайты|сервисы|интернет).*?работ/i.test(asserted)) set('service_scope', 'one_service');
  else if (/(?:все|многие)\s+(?:сайты|сервисы).*?(?:не работают|не открываются)|вообще\s+ничего\s+не открывается/i.test(asserted)) set('service_scope', 'many_or_all');
  const serviceName = asserted.match(/\b(megogo|netflix|youtube|ютуб|steam|zoom|telegram|телеграм|discord|дискорд)\b/i);
  if (serviceName) set('service_name', serviceName[1]);

  if (/через\s+vpn[^.!?]{0,70}(?:работ|открыва|норм|помог)/i.test(asserted) || /vpn[^.!?]{0,50}(?:решает|помогает|помог)/i.test(asserted)) set('vpn_effect', 'fixes');
  else if (/через\s+vpn[^.!?]{0,70}(?:не работ|не помог|то же|так же)/i.test(asserted)) set('vpn_effect', 'no_effect');
  if (/(?:мобильн.*интернет|через\s+(?:4g|5g)|раздал.*телефон)[^.!?]{0,80}(?:работ|открыва|норм)/i.test(asserted)) set('mobile_network_test', 'works');
  else if (/(?:мобильн.*интернет|через\s+(?:4g|5g)|раздал.*телефон)[^.!?]{0,80}(?:не работ|не открыва|то же)/i.test(asserted)) set('mobile_network_test', 'fails');

  if (/(?:сменил|поменял|менял|меняли|поставил|изменил)[^.!?]{0,35}dns|dns[^.!?]{0,35}(?:сменил|поменял|менял|меняли|поставил|изменил)/i.test(asserted)) {
    if (/не помог|без измен|то же|так же/i.test(asserted)) set('dns_change', 'tried_no_effect');
    else if (/помог|заработал|открыва|исправил/i.test(asserted)) set('dns_change', 'fixed');
    else set('dns_change', 'done');
  }
  if (/(?:nslookup|dns|резолв)[^.!?]{0,60}(?:timeout|тайм.?аут|не отвечает|не резолв|не разреш)/i.test(asserted)) set('dns_resolution', 'fails');
  else if (/(?:nslookup|dns|резолв)[^.!?]{0,60}(?:работ|ответ|резолв|разреш)/i.test(asserted)) set('dns_resolution', 'works');
  if (/(?:ping|пинг)[^.!?]{0,30}(?:8\.8\.8\.8|1\.1\.1\.1|ip|айпи)[^.!?]{0,40}(?:ид[её]т|работ|ответ|успеш)/i.test(asserted)) set('ping_ip', 'works');
  else if (/(?:ping|пинг)[^.!?]{0,30}(?:8\.8\.8\.8|1\.1\.1\.1|ip|айпи)[^.!?]{0,40}(?:не ид[её]т|timeout|тайм.?аут|нет ответа)/i.test(asserted)) set('ping_ip', 'fails');
  if (/(?:ping|пинг)[^.!?]{0,50}(?:домен|google\.com|hostname|имя)[^.!?]{0,40}(?:не ид[её]т|timeout|тайм.?аут|не резолв)/i.test(asserted)) set('ping_hostname', 'fails');
  else if (/(?:ping|пинг)[^.!?]{0,50}(?:домен|google\.com|hostname|имя)[^.!?]{0,40}(?:ид[её]т|ответ|работ)/i.test(asserted)) set('ping_hostname', 'works');
  if (/(?:шлюз|gateway)[^.!?]{0,45}(?:пингуется|доступен|отвечает|работ)/i.test(asserted)) set('gateway_reachability', 'reachable');
  else if (/(?:шлюз|gateway)[^.!?]{0,45}(?:не пингуется|не доступен|не отвечает)/i.test(asserted)) set('gateway_reachability', 'unreachable');
  if (/169\.254\./.test(asserted)) set('client_ip_state', 'apipa');
  else if (/(?:получил|есть|выдан)[^.!?]{0,30}(?:ip|айпи)/i.test(asserted)) set('client_ip_state', 'present');
  else if (/(?:не получил|нет)[^.!?]{0,30}(?:ip|айпи)/i.test(asserted)) set('client_ip_state', 'absent');

  // DROPS / PON / MASS --------------------------------------------------------
  if (/ssid.*пропада|wi-?fi.*отвалива|вай.?фай.*отвалива/i.test(asserted)) set('drop_layer', 'wlan');
  else if (/los|пон.*падает|onu.*offline|ону.*offline/i.test(asserted)) set('drop_layer', 'pon');
  else if (/интернет.*пропада.*wi-?fi.*оста[её]т|wi-?fi.*оста[её]т.*интернет.*пропада/i.test(asserted)) set('drop_layer', 'internet_above_wlan');
  if (/сам(?:о|а)?\s+восстанавлива|само приходит|через\s+\d+\s*(?:сек|мин).*возвращ/i.test(asserted)) set('drop_recovery', 'automatic');
  else if (/после\s+перезагрук(?:и)?.*роутер.*(?:возвращ|работ|восстан)/i.test(asserted)) set('drop_recovery', 'cpe_reboot');
  else if (/после\s+перезагрук(?:и)?.*(?:onu|ону).*?(?:возвращ|работ|восстан)/i.test(asserted)) set('drop_recovery', 'onu_reboot');
  const dropDuration = asserted.match(/(?:пропада|обрыв|нет интернет)[^.!?]{0,30}?(?:на|примерно|около)?\s*(\d+)\s*(секунд|сек|минут|мин)/i);
  if (dropDuration) set('drop_duration', `${dropDuration[1]} ${dropDuration[2]}`);
  const dropFreq = asserted.match(/(?:каждые|раз в)\s*(\d+)\s*(минут|мин|час|часа|часов)/i);
  if (dropFreq) set('drop_frequency', `${dropFreq[1]} ${dropFreq[2]}`);

  if (/(?:сейчас|прямо сейчас|в данный момент)[^.!?]{0,50}\blos\b|\blos\b[^.!?]{0,50}(?:горит|мигает|красн)/i.test(asserted)) set('los_reported', 'now');
  else if (/\blos\b[^.!?]{0,40}(?:не горит|нет)/i.test(asserted)) set('los_reported', 'no');
  if (/(?:onu|ону)[^.!?]{0,40}(?:не горит|без питания|выключен)/i.test(asserted)) set('onu_power_state', 'off');
  else if (/(?:onu|ону)[^.!?]{0,40}(?:горит|включен|есть питание)/i.test(asserted)) set('onu_power_state', 'on');
  if (/(?:onu|ону)[^.!?]{0,50}(?:перезагру|ребут)|(?:перезагру|ребут)[^.!?]{0,50}(?:onu|ону)/i.test(asserted)) {
    if (/не помог|без измен|то же|так же/i.test(asserted)) set('onu_reboot', 'tried_no_effect');
    else if (/помог|заработал|восстанов/i.test(asserted)) set('onu_reboot', 'fixed');
    else set('onu_reboot', 'done');
  }

  if (/(?:со слов абонента|абонент говорит|говорит что)[^.!?]{0,100}(?:сосед|подъезд|дом).*?(?:жал|тоже|не работает)/i.test(asserted)) set('mass_neighbor_report', 'subscriber_report');
  if (/(?:обращени|заявк)[^.!?]{0,60}(?:нет|не было|ноль|0)/i.test(asserted) && /сосед|массов|дом|подъезд/i.test(asserted)) set('mass_other_tickets', 'none_confirmed');
  else {
    const tickets = asserted.match(/(?:обращени|заявк)[^\d]{0,20}(\d{1,2})/i);
    if (tickets && /сосед|массов|дом|подъезд/i.test(asserted)) set('mass_other_tickets', tickets[1]);
  }

  return normalizeDialogMemory(out);
}

const cleanText = (value, max = 220) => {
  const raw = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
};

export function aiDialogSessionKey(caseData = null, fallbackCaseId = '', fallbackEpisodeId = '') {
  const caseId = cleanText(caseData?.id || fallbackCaseId, 160);
  const episodeId = cleanText(caseData?.episodeId || fallbackEpisodeId, 180);
  if (!caseId) return '';
  return `${caseId}::${episodeId || 'episode-current'}`;
}

export function normalizeDialogMemory(value, maxEntries = MEMORY_MAX_ENTRIES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(out).length >= maxEntries) break;
    const rawNormalizedKey = cleanText(rawKey, 48).toLowerCase();
    const key = MEMORY_KEY_ALIASES[rawNormalizedKey] || rawNormalizedKey;
    if (!MEMORY_KEY_RE.test(key) || MEMORY_PLACEHOLDER_KEYS.has(key) || !MEMORY_ALLOWED_KEYS.has(key)) continue;
    const normalizedValue = cleanText(
      rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? rawValue.value ?? rawValue.status ?? ''
        : rawValue,
      180
    );
    if (!normalizedValue) continue;
    out[key] = normalizedValue;
  }
  return out;
}

function normalizeContextMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sections = value.sections && typeof value.sections === 'object'
    ? Object.fromEntries(Object.entries(value.sections).slice(0, 10).map(([key, row]) => [cleanText(key, 40), {
        chars: Math.max(0, Number(row?.chars || 0)),
        approxTokens: Math.max(0, Number(row?.approxTokens || 0))
      }]))
    : {};
  return {
    schema: cleanText(value.schema, 80),
    actualPromptTokens: Math.max(0, Number(value.actualPromptTokens || 0)),
    budget: value.budget && typeof value.budget === 'object' ? {
      snapshotChars: Math.max(0, Number(value.budget.snapshotChars || 0)),
      memoryChars: Math.max(0, Number(value.budget.memoryChars || 0)),
      playbookChars: Math.max(0, Number(value.budget.playbookChars || 0)),
      historyChars: Math.max(0, Number(value.budget.historyChars || 0)),
      totalDynamicChars: Math.max(0, Number(value.budget.totalDynamicChars || 0)),
      dynamicChars: Math.max(0, Number(value.budget.dynamicChars || 0)),
      status: cleanText(value.budget.status, 20)
    } : null,
    sections,
    selectedSnapshot: (Array.isArray(value.selectedSnapshot) ? value.selectedSnapshot : []).slice(0, 40).map(item => item && typeof item === 'object' ? {
      path: cleanText(item.path, 120),
      value: cleanText(item.value, 180),
      reason: cleanText(item.reason, 180)
    } : { path: cleanText(item, 120), value: '', reason: '' }),
    excludedSnapshot: (Array.isArray(value.excludedSnapshot) ? value.excludedSnapshot : []).slice(0, 24).map(item => cleanText(item, 120)),
    playbookCards: (Array.isArray(value.playbookCards) ? value.playbookCards : []).slice(0, 8).map(item => ({ id: cleanText(item?.id, 60), reason: cleanText(item?.reason, 160) })),
    historyMessages: Math.max(0, Number(value.historyMessages || 0)),
    freshness: value.freshness && typeof value.freshness === 'object' ? {
      state: cleanText(value.freshness.state, 20),
      ageMinutes: Math.max(0, Number(value.freshness.ageMinutes || 0)),
      at: cleanText(value.freshness.at, 48)
    } : null
  };
}

export function normalizeAiSession(value = {}, identity = {}) {
  const messages = (Array.isArray(value?.messages) ? value.messages : [])
    .slice(-16)
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : item?.role === 'error' ? 'error' : 'user',
      content: cleanText(item?.content, 1800),
      at: cleanText(item?.at, 48),
      usage: item?.usage && typeof item.usage === 'object' ? {
        promptTokens: Math.max(0, Number(item.usage.promptTokens || 0)),
        completionTokens: Math.max(0, Number(item.usage.completionTokens || 0)),
        totalTokens: Math.max(0, Number(item.usage.totalTokens || 0))
      } : null,
      context: normalizeContextMeta(item?.context)
    }))
    .filter(item => item.content);

  const usage = value?.usage && typeof value.usage === 'object' ? {
    promptTokens: Math.max(0, Number(value.usage.promptTokens || 0)),
    completionTokens: Math.max(0, Number(value.usage.completionTokens || 0)),
    totalTokens: Math.max(0, Number(value.usage.totalTokens || 0)),
    requests: Math.max(0, Number(value.usage.requests || 0))
  } : { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };

  return {
    schema: 'simnet-ai-dialog-session-v1',
    caseId: cleanText(identity.caseId || value?.caseId, 160),
    episodeId: cleanText(identity.episodeId || value?.episodeId, 180),
    updatedAt: cleanText(value?.updatedAt, 48),
    dialogMemory: normalizeDialogMemory(value?.dialogMemory),
    crmContext: value?.crmContext && typeof value.crmContext === 'object' && !Array.isArray(value.crmContext) ? {
      scope: cleanText(value.crmContext.scope || (value.crmContext.entityId ? 'building' : value.crmContext.street ? 'street' : ''), 24),
      entityType: cleanText(value.crmContext.entityType || (value.crmContext.entityId ? 'building' : ''), 24),
      entityId: cleanText(value.crmContext.entityId, 80),
      address: cleanText(value.crmContext.address, 260),
      url: cleanText(value.crmContext.url, 260),
      street: cleanText(value.crmContext.street, 180)
    } : null,
    messages,
    usage
  };
}

export function aiRecentHistory(session, maxMessages = 6) {
  return normalizeAiSession(session).messages
    .filter(item => item.role === 'user' || item.role === 'assistant')
    .slice(-Math.max(2, Number(maxMessages || 6)))
    .map(item => ({ role: item.role, content: cleanText(item.content, 700) }));
}

export function dialogMemoryText(memory) {
  const normalized = normalizeDialogMemory(memory);
  const rows = Object.entries(normalized).map(([key, value]) => `${key}: ${value}`);
  return rows.length ? rows.join('\n') : 'Пока ничего отдельно не установлено из разговора.';
}
