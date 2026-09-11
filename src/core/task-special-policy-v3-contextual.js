(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__taskSpecialPolicyV3ContextualLoaded || !WB.taskSpecialPolicyV3?.interpretRows) return;
  WB.__taskSpecialPolicyV3ContextualLoaded = true;

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

  function exclusiveTechnology(rows) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const raw = compact(row?.text, 6000);
      const text = fold(raw);
      if (!text) continue;

      const match = text.match(/(?:подключ\w*|пидключ\w*|включ\w*)?[^.!?]{0,35}(?:только|лише|тилки)\s+(?:по\s+)?(?:технологи\w*\s+)?(gpon|epon|pon|ethernet|вит\w*\s+пар\w*)/iu)
        || text.match(/(?:технологи\w*\s+)?(gpon|epon|pon|ethernet)[^.!?]{0,18}(?:только|лише|тилки)/iu);
      if (!match) continue;

      const token = String(match[1] || '').toLowerCase();
      const technology = token === 'gpon' ? 'GPON'
        : token === 'epon' ? 'EPON'
          : token === 'pon' ? 'PON'
            : token === 'ethernet' || /вит/.test(token) ? 'Ethernet'
              : '';
      if (!technology) continue;
      return { technology, evidence: raw, sourceKey: String(row?.key || '') };
    }
    return null;
  }

  function interpretRows(rows, context = {}) {
    let items = basePolicy.interpretRows(rows, context);
    const exclusive = exclusiveTechnology(rows);
    if (!exclusive) return items;

    const samePositive = new RegExp(`^${exclusive.technology.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*—\\s*(?:да|доступ)`, 'iu');
    items = items.filter(item => !(item?.type === 'technology_restriction'
      && item?.severity === 'info'
      && samePositive.test(String(item?.summary || ''))));

    const summary = `Подключение — только ${exclusive.technology}`;
    if (!items.some(item => fold(item?.summary) === fold(summary))) {
      items.push({
        type: 'technology_restriction',
        severity: 'warning',
        summary,
        evidence: exclusive.evidence,
        scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: [exclusive.technology] },
        certainty: 'explicit',
        conditional: false,
        temporalScope: 'current_or_unspecified',
        needsReview: false,
        reviewReasons: [],
        decisionMode: 'acknowledge_if_scope_matches',
        priority: 4.5,
        sourceKeys: [exclusive.sourceKey].filter(Boolean)
      });
    }

    return items.sort((a, b) => Number(a?.priority ?? 50) - Number(b?.priority ?? 50));
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({
      ...basePolicy,
      interpretRows,
      contextualPolicyVersion: VERSION
    });
  } catch {}
})();
