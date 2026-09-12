(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__taskSpecialPolicyV3SafetyNetLoaded || !WB.taskSpecialPolicyV3?.interpretRows) return;
  WB.__taskSpecialPolicyV3SafetyNetLoaded = true;

  const basePolicy = WB.taskSpecialPolicyV3;
  const VERSION = 1;

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

  const ACCESS_SIGNAL_RE = /(?:ключ|ключі|доступ|пропуск|диспетчер|консьерж|консерж|охран|охорон|жек|жэк|жед|керуюч|управляющ|осбб|подвал|підвал|чердак|горищ|крыша|дах|тамбур|щитк|тех\.?этаж|техповерх|домофон|код\s+(?:двер|замк)|замок)/iu;
  const MANDATORY_SIGNAL_RE = /(?:обязательн\w*|обов.?язков\w*|треба|потрібно|необходимо|необхідно|нужно|надо|запрещ\w*|заборон\w*|не\s+трогат\w*|не\s+чіпат\w*|только|лише|тільки)/iu;
  const TIME_SIGNAL_RE = /(?:до|после|після|с|з)\s*\d{1,2}(?:[:.\-]\d{2})?/iu;

  function fallbackItem(row) {
    const raw = compact(row?.text, 6000);
    if (!raw) return null;
    const access = ACCESS_SIGNAL_RE.test(raw);
    const mandatory = MANDATORY_SIGNAL_RE.test(raw);
    if (!access && !mandatory) return null;

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
      if (rowCovered(row, baseItems)) continue;
      const item = fallbackItem(row);
      if (item) extra.push(item);
    }
    return dedupe([...baseItems, ...extra]);
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({
      ...basePolicy,
      interpretRows,
      safetyNetVersion: VERSION
    });
  } catch {}
})();