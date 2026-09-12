(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__taskSpecialPolicyV3NoteRefinerLoaded || !WB.taskSpecialPolicyV3?.interpretRows) return;
  WB.__taskSpecialPolicyV3NoteRefinerLoaded = true;

  const basePolicy = WB.taskSpecialPolicyV3;
  const VERSION = 2;

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

  const GENERIC_RE = /^(?:доступ\s*[—-]\s*(?:есть\s+)?(?:важн|особ)|есть\s+(?:важн|обязательн)|проверь\s+исходн|ключи?\s*\/\s*доступ|доступ\s+нужно\s+согласовать|особая\s+инструкц|обязательная\s+инструкц|дополнительное\s+условие)/iu;
  const PON_RISK_RE = /(?:забит|заполн|переполн|занят|нет\s+(?:свободн|мест|порт)|нема\s+(?:вільн|місц|порт)|не\s+подключ|не\s+підключ|невозмож|неможлив)/iu;
  const PON_INVENTORY_RE = /(?:\b(?:gpon|epon|pon)\b|пон)[^.!?]{0,180}(?:бокс|делит|1\/8|1\/4|1\/16|парад|этаж|поверх|слаботоч|нише|ніші)/iu;
  const ACCESS_WORD_RE = /(?:ключ|доступ|пропуск|диспетчер|консьерж|охран|охорон|жек|жэк|жед|осбб|тамбур|двер|ворот|код|соглас|узгод|поперед|предупред|звон|дзвон)/iu;
  const IMPERATIVE_RE = /(?:обязательн|обов.?язков|необхідно|необходимо|потрібно|треба|нужно|надо|поперед|предупред|запрещ|заборон)/iu;
  const UNCERTAIN_RE = /(?:\?|возможно|может\s+быть|скорее\s+всего|невідом|неизвест)/iu;

  function sameEvidence(item, raw) {
    const a = fold(item?.evidence || '');
    const b = fold(raw || '');
    return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
  }

  function isRoutinePon(raw) {
    const text = compact(raw, 6000);
    if (!text || PON_RISK_RE.test(text)) return false;
    if (PON_INVENTORY_RE.test(text)) return true;
    return /(?:полностью\s+)?можно[^.!?]{0,45}(?:по\s+)?(?:gpon|epon|pon|пону)|(?:gpon|epon|pon)[^.!?]{0,35}(?:доступен|можно|можна)/iu.test(text);
  }

  function phone(raw) {
    const match = String(raw || '').match(/(?:\+?38[\s()-]*)?0\d{2}(?:[\s()-]*\d){7}/u);
    return match ? compact(match[0], 40).replace(/\s+/g, ' ') : '';
  }

  function section(raw) {
    const match = String(raw || '').match(/\b(\d{1,2})\s*(?:-?а|-?я|га|ша)?\s*секц[\p{L}]*/iu);
    return match ? `${Number(match[1])} секция` : '';
  }

  function securityFact(raw) {
    const text = String(raw || '');
    const warnFirst = /(?:попередж[\p{L}]*|предупред[\p{L}]*|повідом[\p{L}]*|сообщ[\p{L}]*)[^.!?]{0,90}(?:охорон[\p{L}]*|охран[\p{L}]*)/iu.test(text);
    const guardFirst = /(?:охорон[\p{L}]*|охран[\p{L}]*)[^.!?]{0,90}(?:попередж[\p{L}]*|предупред[\p{L}]*|повідом[\p{L}]*|сообщ[\p{L}]*)/iu.test(text);
    return warnFirst || guardFirst ? 'охрану нужно предупредить о визите интернет-бригады' : '';
  }

  function keyFact(raw) {
    const text = String(raw || '');
    if (!/ключ/iu.test(text) || !/диспетчер/iu.test(text)) return '';

    const match = text.match(/ключ[\p{L}]*\s+(?:від|от)\s+([^,.;]{2,60}?)(?=\s+(?:в|у)\s+диспетчер|[,.;]|$)/iu);
    let object = compact(match?.[1] || '', 50)
      .replace(/колясочної/giu, 'колясочной')
      .replace(/колясочною/giu, 'колясочной')
      .replace(/колясочн[\p{L}]*/giu, 'колясочной');
    return object ? `Ключи от ${object} — у диспетчера` : 'Ключи — у диспетчера';
  }

  function contactFact(raw) {
    const value = phone(raw);
    if (!value) return '';
    if (/(?:жек|жэк|жед)/iu.test(raw)) return `ЖЭК: ${value}`;
    if (/диспетчер/iu.test(raw)) return `Диспетчер: ${value}`;
    if (/охран|охорон/iu.test(raw)) return `Охрана: ${value}`;
    return '';
  }

  function accessSummary(raw) {
    const parts = [];
    const add = value => {
      const text = compact(value, 140);
      if (!text || parts.some(existing => fold(existing) === fold(text))) return;
      parts.push(text);
    };

    add(securityFact(raw));
    add(keyFact(raw));
    add(contactFact(raw));
    if (!parts.length) return '';

    const sec = section(raw);
    return compact(`${sec ? `${sec}: ` : ''}${parts.join(' · ')}`, 320);
  }

  function stripRoutineTech(raw) {
    return compact(String(raw || '')
      .replace(/\b(?:gpon|epon|pon)\s*:\s*[^.!?]*(?:бокс|делит|1\/8|1\/4|1\/16|парад|этаж|поверх|слаботоч|нише|ніші)[^.!?]*/giu, ' ')
      .replace(/(?:\b(?:gpon|epon|pon)\b|пон)[^.!?]{0,180}(?:бокс|делит|1\/8|1\/4|1\/16|парад|этаж|поверх|слаботоч|нише|ніші)[^.!?]*/giu, ' '), 6000);
  }

  function meaningfulClause(raw) {
    const cleaned = stripRoutineTech(raw);
    if (!cleaned) return '';
    const clauses = cleaned.split(/[.!?;]+/u).map(part => compact(part, 220)).filter(part => part.length >= 5);
    return compact(clauses.find(part => (ACCESS_WORD_RE.test(part) || IMPERATIVE_RE.test(part)) && !isRoutinePon(part)) || '', 200);
  }

  function makeAccessItem(row, summary) {
    return {
      type: 'access_coordination',
      severity: 'warning',
      summary,
      evidence: compact(row?.text, 6000),
      scope: { level: 'access', wholeBuilding: false, entrances: [] },
      certainty: 'explicit',
      conditional: false,
      temporalScope: 'current_or_unspecified',
      needsReview: false,
      reviewReasons: [],
      decisionMode: 'acknowledge_if_scope_matches',
      priority: 8.4,
      sourceKeys: [String(row?.key || '')].filter(Boolean)
    };
  }

  function refineGeneric(item) {
    const summary = compact(item?.summary, 240);
    if (!GENERIC_RE.test(summary)) return item;
    const evidence = compact(item?.evidence, 6000);
    if (!evidence) return item;

    const specific = accessSummary(evidence);
    if (specific) return { ...makeAccessItem({ text: evidence, key: item?.sourceKeys?.[0] || '' }, specific), priority: item?.priority ?? 8.4 };

    if (isRoutinePon(evidence) && !ACCESS_WORD_RE.test(stripRoutineTech(evidence))) return null;

    const clause = meaningfulClause(evidence);
    if (!clause) return null;
    const uncertain = UNCERTAIN_RE.test(clause);
    return {
      ...item,
      summary: clause,
      severity: uncertain ? item.severity : 'warning',
      needsReview: uncertain ? item.needsReview : false,
      reviewReasons: uncertain ? item.reviewReasons : [],
      decisionMode: uncertain ? item.decisionMode : 'acknowledge_if_scope_matches'
    };
  }

  function dedupe(items) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      if (!item) continue;
      const normalizedSummary = fold(item.summary || '');
      const key = `${item.type || ''}|${normalizedSummary}`;
      if (!normalizedSummary || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out.sort((a, b) => Number(a?.priority ?? 50) - Number(b?.priority ?? 50));
  }

  function interpretRows(rows, context = {}) {
    const normalizedRows = Array.isArray(rows) ? rows.filter(row => compact(row?.text, 8)) : [];
    const interpreted = basePolicy.interpretRows(normalizedRows, context);
    let items = Array.isArray(interpreted) ? interpreted : [];
    const added = [];

    for (const row of normalizedRows) {
      const raw = compact(row?.text, 6000);
      const specific = accessSummary(raw);

      if (specific) {
        items = items.filter(item => {
          if (!sameEvidence(item, raw)) return true;
          return !['access_coordination', 'manual_review'].includes(String(item?.type || ''));
        });
        added.push(makeAccessItem(row, specific));
        continue;
      }

      if (isRoutinePon(raw)) {
        items = items.filter(item => {
          if (!sameEvidence(item, raw)) return true;
          if (!['access_coordination', 'manual_review', 'technology_restriction'].includes(String(item?.type || ''))) return true;
          const summary = compact(item?.summary, 240);
          return !GENERIC_RE.test(summary) && !/^(?:gpon|epon|pon)\s*[—-]\s*(?:да|доступ|можно)/iu.test(summary);
        });
      }
    }

    return dedupe([...items.map(refineGeneric).filter(Boolean), ...added]);
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({
      ...basePolicy,
      interpretRows,
      noteRefinerVersion: VERSION
    });
  } catch {}
})();
