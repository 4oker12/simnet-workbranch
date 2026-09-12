(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__taskSpecialPolicyV3SafetyNetLoaded || !WB.taskSpecialPolicyV3?.interpretRows) return;
  WB.__taskSpecialPolicyV3SafetyNetLoaded = true;

  const basePolicy = WB.taskSpecialPolicyV3;
  const VERSION = 3;

  const compact = (value, max = 6000) => {
    const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 6000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9/+]+/giu, ' ')
    .trim();

  const ACCESS_SIGNAL_RE = /(?:ключ|ключі|доступ|пропуск|диспетчер|консьерж|консерж|охран|охорон|жек|жэк|жед|керуюч|управляющ|осбб|подвал|підвал|чердак|горищ|крыша|дах|тамбур|щитк|тех\.?этаж|техповерх|код\s+(?:двер|замк)|замок)/iu;
  const DOMOPHONE_ACCESS_RE = /(?:домофон[^.!?]{0,35}(?:ключ|код|доступ|двер|откры|відкр)|(?:ключ|код|доступ|двер|откры|відкр)[^.!?]{0,35}домофон)/iu;
  const MANDATORY_SIGNAL_RE = /(?:обязательн\w*|обов.?язков\w*|треба|потрібно|необходимо|необхідно|нужно|надо|запрещ\w*|заборон\w*|не\s+трогат\w*|не\s+чіпат\w*|только|лише|тільки)/iu;
  const TIME_SIGNAL_RE = /(?:до|после|після|с|з)\s*\d{1,2}(?:[:.\-]\d{2})?/iu;
  const COMMERCIAL_SIGNAL_RE = /(?:\b\d{2,5}\s*(?:грн|₴)\b|стоимост|вартіст|цена|ціна|оплат|депозит|залог|застав|тариф|акци|кабель[^.!?]{0,20}(?:грн|₴|\/м)|аудиотрубк|аудіотрубк|видеодомофон|відеодомофон)/iu;
  const HARD_RISK_RE = /(?:не\s+подключ|не\s+підключ|нет\s+(?:возможност|можливост)|нема\s+(?:можливост|возможност)|запрещ|заборон|нет\s+свободн|нема\s+вільн|все\s+порт.*занят|всі\s+порт.*зайнят)/iu;

  function hasAccessMeaning(raw) {
    return ACCESS_SIGNAL_RE.test(raw) || DOMOPHONE_ACCESS_RE.test(raw);
  }

  function price(raw, re) {
    const match = String(raw || '').match(re);
    if (!match) return '';
    return compact(match[1] || match[0], 80).replace(/\s*(?:грн|₴)\s*$/iu, '').trim();
  }

  function commercialSummary(raw) {
    const source = compact(raw, 6000);
    const parts = [];
    const add = value => {
      const text = compact(value, 120);
      if (!text || parts.some(existing => fold(existing) === fold(text))) return;
      parts.push(text);
    };

    const connection = price(source, /(?:^|[.;,]\s*)(?:подключен\w*|підключен\w*)\s*[-–—:]?\s*(\d{2,5})\s*(?:грн|₴)/iu)
      || price(source, /(?:подключен\w*|підключен\w*)[^0-9]{0,18}(\d{2,5})\s*(?:грн|₴)/iu);
    if (connection) add(`Подключение — ${connection} грн`);

    const cableEntry = price(source, /(?:завод|заведен\w*|завести)[^.!?]{0,35}кабел\w*[^0-9]{0,25}(\d{2,5})\s*(?:грн|₴)/iu);
    const cableMeter = price(source, /кабел\w*[^.!?]{0,20}(\d{1,4})\s*(?:грн|₴)\s*(?:\/?\s*(?:м|метр)|за\s+метр)/iu);
    if (cableEntry || cableMeter) {
      add(`Завод кабеля — ${cableEntry ? `${cableEntry} грн` : ''}${cableEntry && cableMeter ? ' + ' : ''}${cableMeter ? `${cableMeter} грн/м` : ''}`);
    }

    const tube = price(source, /(?:аудио|аудіо)?трубк\w*[^0-9]{0,30}(\d{2,5})\s*(?:грн|₴)/iu);
    if (tube) add(`Аудиотрубка — ${tube} грн${/трубк\w*[^.!?]{0,80}без\s+монтаж/iu.test(source) ? ' без монтажа' : ''}`);

    const tubeMount = price(source, /монтаж\s+трубк\w*[^0-9]{0,20}(?:от|від)?\s*(\d{2,5})\s*(?:грн|₴)/iu);
    if (tubeMount) add(`Монтаж трубки — ${/(?:от|від)\s*\d/iu.test(source.match(/монтаж\s+трубк\w*[^.!?]{0,45}/iu)?.[0] || '') ? 'от ' : ''}${tubeMount} грн`);

    const video = price(source, /(?:подключен\w*|підключен\w*)?[^.!?]{0,18}(?:видео|відео)домофон\w*[^0-9]{0,20}(\d{2,5})\s*(?:грн|₴)?/iu);
    if (video) add(`Видеодомофон — ${video} грн`);

    const deposit = price(source, /(?:депозит|залог|застав)\w*[^0-9]{0,20}(\d{2,5})\s*(?:грн|₴)?/iu);
    if (deposit) add(`Депозит — ${deposit} грн`);

    const tariff = price(source, /коммерч\w*[^0-9]{0,30}(?:от|від)\s*(\d{2,5})\s*(?:грн|₴)?/iu);
    if (tariff) add(`Коммерческий тариф — от ${tariff} грн`);

    if (/акци\w*\s+не\s+(?:действ|діють)/iu.test(source)) add('Акции — не действуют');

    if (!parts.length) {
      const snippets = Array.from(source.matchAll(/[^.;]{0,55}\b\d{2,5}\s*(?:грн|₴)(?:\s*\/?\s*(?:м|метр))?[^.;]{0,35}/giu))
        .map(match => compact(match[0], 100))
        .filter(Boolean)
        .slice(0, 4);
      snippets.forEach(add);
    }

    return compact(parts.join(' · '), 360) || compact(source, 220);
  }

  function commercialItem(row) {
    const raw = compact(row?.text, 6000);
    if (!raw || !COMMERCIAL_SIGNAL_RE.test(raw) || HARD_RISK_RE.test(raw)) return null;
    return {
      type: 'commercial_condition',
      severity: 'info',
      summary: commercialSummary(raw),
      evidence: raw,
      scope: { level: 'commercial', wholeBuilding: true, entrances: [] },
      certainty: 'explicit',
      conditional: false,
      temporalScope: 'current_or_unspecified',
      needsReview: false,
      reviewReasons: [],
      decisionMode: 'info',
      priority: 10.2,
      sourceKeys: [String(row?.key || '')].filter(Boolean)
    };
  }

  function fallbackItem(row) {
    const raw = compact(row?.text, 6000);
    if (!raw) return null;
    const access = hasAccessMeaning(raw);
    const mandatory = MANDATORY_SIGNAL_RE.test(raw);
    const commercial = COMMERCIAL_SIGNAL_RE.test(raw);
    if (!access && !mandatory) return null;

    if (commercial && !access && !HARD_RISK_RE.test(raw)) return commercialItem(row);

    let summary = 'Есть важное условие — проверь исходную заметку';
    if (/ключ|ключі/iu.test(raw)) summary = 'Доступ — есть важная информация по ключам';
    else if (access && TIME_SIGNAL_RE.test(raw)) summary = 'Доступ — проверь время и условия доступа';
    else if (access) summary = 'Доступ — есть важное условие по дому';

    return {
      type: access ? 'access_coordination' : 'manual_review',
      severity: 'review',
      summary,
      evidence: raw,
      scope: { level: access ? 'access' : 'building', wholeBuilding: !access, entrances: [] },
      certainty: 'ambiguous',
      conditional: false,
      temporalScope: 'current_or_unspecified',
      needsReview: true,
      reviewReasons: ['operational_note_not_classified'],
      decisionMode: 'manual_review',
      priority: access ? 8.95 : 10.9,
      sourceKeys: [String(row?.key || '')].filter(Boolean)
    };
  }

  function rowCovered(row, items) {
    const key = String(row?.key || '');
    const raw = fold(row?.text || '');
    return items.some(item => {
      if (key && Array.isArray(item?.sourceKeys) && item.sourceKeys.includes(key)) return true;
      const evidence = fold(item?.evidence || '');
      return Boolean(raw && evidence && (evidence === raw || evidence.includes(raw) || raw.includes(evidence)));
    });
  }

  function rowHasCommercial(row, items) {
    const key = String(row?.key || '');
    const raw = fold(row?.text || '');
    return items.some(item => {
      if (item?.type !== 'commercial_condition') return false;
      if (key && Array.isArray(item?.sourceKeys) && item.sourceKeys.includes(key)) return true;
      const evidence = fold(item?.evidence || '');
      return Boolean(raw && evidence && (evidence === raw || evidence.includes(raw) || raw.includes(evidence)));
    });
  }

  function mergeCommercial(items) {
    const normal = [];
    const commercial = [];
    for (const item of items || []) {
      if (item?.type === 'commercial_condition') commercial.push(item);
      else normal.push(item);
    }
    if (!commercial.length) return normal;

    const parts = [];
    const seen = new Set();
    for (const item of commercial) {
      for (const part of String(item.summary || '').split(/\s*·\s*/)) {
        const text = compact(part, 140);
        const key = fold(text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        parts.push(text);
      }
    }

    normal.push({
      ...commercial[0],
      summary: compact(parts.join(' · '), 420),
      evidence: commercial.map(item => compact(item.evidence, 6000)).filter(Boolean).join(' | '),
      sourceKeys: Array.from(new Set(commercial.flatMap(item => Array.isArray(item.sourceKeys) ? item.sourceKeys : []).filter(Boolean)))
    });
    return normal;
  }

  function dedupe(items) {
    const out = [];
    const seen = new Set();
    for (const item of items || []) {
      const key = `${item?.type || ''}|${fold(item?.summary || '')}|${fold(item?.evidence || '').slice(0, 320)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out.sort((a, b) => Number(a?.priority ?? 50) - Number(b?.priority ?? 50));
  }

  function interpretRows(rows, context = {}) {
    const normalizedRows = Array.isArray(rows) ? rows.filter(row => compact(row?.text, 8)) : [];
    const interpreted = basePolicy.interpretRows(normalizedRows, context);
    const baseItems = Array.isArray(interpreted) ? interpreted : [];
    const extra = [];

    for (const row of normalizedRows) {
      const commercial = commercialItem(row);
      if (commercial && !rowHasCommercial(row, [...baseItems, ...extra])) extra.push(commercial);

      if (rowCovered(row, [...baseItems, ...extra])) continue;
      const item = fallbackItem(row);
      if (item) extra.push(item);
    }
    return dedupe(mergeCommercial([...baseItems, ...extra]));
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({
      ...basePolicy,
      interpretRows,
      safetyNetVersion: VERSION
    });
  } catch {}
})();
