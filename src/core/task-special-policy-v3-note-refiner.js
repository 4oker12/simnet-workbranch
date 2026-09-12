(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__taskSpecialPolicyV3NoteRefinerLoaded || !WB.taskSpecialPolicyV3?.interpretRows) return;
  WB.__taskSpecialPolicyV3NoteRefinerLoaded = true;

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

  const GENERIC_SUMMARY_RE = /^(?:доступ\s*[—-]\s*(?:есть\s+)?(?:важн|особ)|есть\s+(?:важн|обязательн)|проверь\s+исходн|ключи?\s*\/\s*доступ|доступ\s+нужно\s+согласовать|особая\s+инструкц|обязательная\s+инструкц|дополнительное\s+условие)/iu;
  const PON_RISK_RE = /(?:забит|заполн|переполн|занят|нет\s+(?:свободн|мест|порт)|нема\s+(?:вільн|місц|порт)|не\s+подключ|не\s+підключ|невозмож|неможлив)/iu;
  const PON_INVENTORY_RE = /(?:\b(?:gpon|epon|pon)\b|пон)[^.!?]{0,160}(?:бокс|делит|1\/8|1\/4|1\/16|парад|этаж|поверх|слаботоч|нише|ніші)/iu;
  const ACCESS_WORD_RE = /(?:ключ|доступ|пропуск|диспетчер|консьерж|охран|охорон|жек|жэк|жед|осбб|тамбур|двер|ворот|код|соглас|узгод|поперед|предупред|звон|дзвон)/iu;
  const IMPERATIVE_RE = /(?:обязательн|обов.?язков|необхідно|необходимо|потрібно|треба|нужно|надо|поперед|предупред|запрещ|заборон)/iu;

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
    const match = String(raw || '').match(/\b(\d{1,2})\s*(?:-?а|-?я|га|ша)?\s*секц\w*/iu);
    return match ? `${Number(match[1])} секция` : '';
  }

  function securityNotice(raw) {
    const text = String(raw || '');
    const forward = /(?:попередж\w*|предупред\w*|повідом\w*|сообщ\w*)[^.!?]{0,80}(?:охорон\w*|охран\w*)/iu.test(text);
    const reverse = /(?:охорон\w*|охран\w*)[^.!?]{0,80}(?:попередж\w*|предупред\w*|повідом\w*|сообщ\w*)/iu.test(text);
    if (!forward && !reverse) return '';
    return 'охрану нужно предупредить о визите интернет-бригады';
  }

  function keyLocation(raw) {
    const text = String(raw || '');
    if (!/ключ/iu.test(text)) return '';
    if (!/диспетчер/iu.test(text)) return '';

    let object = '';
    const match = text.match(/ключ\w*\s+(?:від|от)\s+([^,.;]{2,60}?)(?=\s+(?:в|у)\s+диспетчер|[,.;]|$)/iu);
    if (match) object = compact(match[1], 50);
    object = object
      .replace(/колясочної/giu, 'колясочной')
      .replace(/колясочною/giu, 'колясочной')
      .replace(/колясочн[а-яіїє]*/giu, 'колясочной');
    return object ? `Ключи от ${object} — у диспетчера` : 'Ключи — у диспетчера';
  }

  function orgPhone(raw) {
    const value = phone(raw);
    if (!value) return '';
    if (/(?:жек|жэк|жед)/iu.test(raw)) return `ЖЭК: ${value}`;
    if (/диспетчер/iu.test(raw)) return `Диспетчер: ${value}`;
    if (/охран|охорон/iu.test(raw)) return `Охрана: ${value}`;
    return '';
  }

  function conciseAccessSummary(raw) {
    const parts = [];
    const add = value => {
      const text = compact(value, 130);
      if (!text || parts.some(existing => fold(existing) === fold(text))) return;
      parts.push(text);
    };

    add(securityNotice(raw));
    add(keyLocation(raw));
    add(orgPhone(raw));
    if (!parts.length) return '';

    const sec = section(raw);
    const body = parts.join(' · ');
    return compact(sec ? `${sec}: ${body}` : body, 300);
  }

  function stripRoutineTech(raw) {
    return compact(String(raw || '')
      .replace(/\b(?:gpon|epon|pon)\s*:\s*[^.!?]*(?:бокс|делит|1\/8|1\/4|1\/16|парад|этаж|поверх|слаботоч|нише|ніші)[^.!?]*/giu, ' ')
      .replace(/(?:\b(?:gpon|epon|pon)\b|пон)[^.!?]{0,160}(?:бокс|делит|1\/8|1\/4|1\/16|парад|этаж|поверх|слаботоч|нише|ніші)[^.!?]*/giu, ' '), 6000);
  }

  function meaningfulClause(raw) {
    const cleaned = stripRoutineTech(raw);
    if (!cleaned) return '';
    const clauses = cleaned.split(/[.!?;]+/u).map(part => compact(part, 220)).filter(part => part.length >= 5);
    const preferred = clauses.find(part => (ACCESS_WORD_RE.test(part) || IMPERATIVE_RE.test(part)) && !isRoutinePon(part));
    return compact(preferred || '', 200);
  }

  function refineGenericItem(item) {
    const summary = compact(item?.summary, 240);
    if (!GENERIC_SUMMARY_RE.test(summary)) return item;
    const evidence = compact(item?.evidence, 6000);
    if (!evidence) return item;

    const accessSummary = conciseAccessSummary(evidence);
    if (accessSummary) {
      return {
        ...item,
        type: 'access_coordination',
        severity: 'warning',
        summary: accessSummary,
        needsReview: false,
        reviewReasons: [],
        decisionMode: 'acknowledge_if_scope_matches',
        certainty: 'explicit'
      };
    }

    if (isRoutinePon(evidence) && !ACCESS_WORD_RE.test(stripRoutineTech(evidence))) return null;

    const clause = meaningfulClause(evidence);
    if (!clause) return null;
    return {
      ...item,
      severity: /(?:\?|возможно|может\s+быть|скорее\s+всего|невідом|неизвест)/iu.test(clause) ? item.severity : 'warning',
      summary: clause,
      needsReview: /(?:\?|возможно|может\s+быть|скорее\s+всего|невідом|неизвест)/iu.test(clause) ? item.needsReview : false,
      reviewReasons: /(?:\?|возможно|может\s+быть|скорее\s+всего|невідом|неизвест)/iu.test(clause) ? item.reviewReasons : [],
      decisionMode: /(?:\?|возможно|может\s+быть|скорее\s+всего|невідом|неизвест)/iu.test(clause) ? item.decisionMode : 'acknowledge_if_scope_matches'
    };
  }

  function refinerItem(row) {
    const raw = compact(row?.text, 6000);
    const summary = conciseAccessSummary(raw);
    if (!summary) return null;
    return {
      type: 'access_coordination',
      severity: 'warning',
      summary,
      evidence: raw,
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

  function dedupe(items) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      if (!item) continue;
      const key = `${item.type || ''}|${fold(item.summary || '')}`;
      if (!fold(item.summary || '') || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out.sort((a, b) => Number(a?.priority ?? 50) - Number(b?.priority ?? 50));
  }

  function interpretRows(rows, context = {}) {
    const normalizedRows = Array.isArray(rows) ? rows.filter(row => compact(row?.text, 8)) : [];
    let items = Array.isArray(basePolicy.interpretRows(normalizedRows, context))
      ? basePolicy.interpretRows(normalizedRows, context)
      : [];

    const added = [];
    for (const row of normalizedRows) {
      const raw = compact(row?.text, 6000);
      const refined = refinerItem(row);
      if (refined) {
        items = items.filter(item => {
          if (!sameEvidence(item, raw)) return true;
          return !['access_coordination', 'manual_review'].includes(String(item?.type || ''));
        });
        added.push(refined);
        continue;
      }

      if (isRoutinePon(raw)) {
        items = items.filter(item => {
          if (!sameEvidence(item, raw)) return true;
          if (!['access_coordination', 'manual_review', 'technology_restriction'].includes(String(item?.type || ''))) return true;
          const summary = compact(item?.summary, 240);
          return !GENERIC_SUMMARY_RE.test(summary) && !/^(?:gpon|epon|pon)\s*[—-]\s*(?:да|доступ|можно)/iu.test(summary);
        });
      }
    }

    return dedupe([...items.map(refineGenericItem).filter(Boolean), ...added]);
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({
      ...basePolicy,
      interpretRows,
      noteRefinerVersion: VERSION
    });
  } catch {}
})();
