(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.taskSpecialPolicyV3) return;

  const VERSION = 3;
  const SCHEMA = 'simnet-task-special-policy-v3';

  const TYPE_ORDER = Object.freeze({
    connection_block: 0,
    infrastructure_capacity: 1,
    entrance_scope: 2,
    manual_review: 3,
    speed_limit: 4,
    technology_restriction: 5,
    service_restriction: 6,
    visit_duration: 7,
    access_window: 8,
    access_coordination: 9,
    commercial_condition: 10,
    special_instruction: 11
  });

  const compact = (value, max = 5000) => {
    const text = String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  const fold = value => compact(value, 6000)
    .toLowerCase()
    .replace(/ё/g, 'е').replace(/э/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ы/g, 'и').replace(/ь/g, '')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .trim();

  function sanitizeSource(value) {
    return compact(String(value || '')
      .replace(/\b[A-Za-z_$][\w$]*\s*\([^)]{0,240}\)\s*;?/g, ' ')
      .replace(/(?:javascript\s*:)?\s*[A-Za-z_$][\w$]*\s*=\s*[^;]{0,180};?/gi, ' '), 6000);
  }

  function uniqueNumbers(value) {
    const out = [];
    const seen = new Set();
    for (const raw of String(value || '').match(/\d{1,2}/g) || []) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 40 || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.sort((a, b) => a - b);
  }

  function numberListText(values) {
    return values.map(String).join(', ');
  }

  function selectedEntrance(context = {}) {
    const match = String(context.entrance || '').match(/\d{1,2}/);
    return match ? String(Number(match[0])) : '';
  }

  function add(items, item) {
    const summary = compact(item?.summary || '', 220);
    if (!summary) return;
    const evidence = sanitizeSource(item?.evidence || '');
    const scope = item?.scope && typeof item.scope === 'object'
      ? item.scope
      : { level: 'building', wholeBuilding: true, entrances: [] };
    const key = `${item.type || 'special_instruction'}|${fold(summary)}|${(scope.entrances || []).join(',')}`;
    if (items.some(existing => existing.__key === key)) return;
    items.push({
      __key: key,
      type: item.type || 'special_instruction',
      severity: item.severity || 'warning',
      summary,
      evidence,
      scope,
      certainty: item.certainty || 'explicit',
      conditional: Boolean(item.conditional),
      temporalScope: item.temporalScope || 'current_or_unspecified',
      needsReview: Boolean(item.needsReview),
      reviewReasons: Array.isArray(item.reviewReasons) ? [...item.reviewReasons] : [],
      decisionMode: item.decisionMode || (item.severity === 'blocker' ? 'hard_block_if_scope_matches' : 'acknowledge_if_scope_matches'),
      priority: Number.isFinite(item.priority) ? item.priority : (TYPE_ORDER[item.type] ?? 50),
      sourceKeys: Array.isArray(item.sourceKeys) ? item.sourceKeys.filter(Boolean) : []
    });
  }

  function entranceRestriction(raw) {
    const source = String(raw || '');
    const entranceWord = /(?:подъезд[\p{L}]*|парадн[\p{L}]*|під\s*['’]?\s*їзд[\p{L}]*|підїзд[\p{L}]*|пар\.)/iu;
    const blockRe = /(?:не\s*(?:подключ[\p{L}]*|підключ[\p{L}]*|включ[\p{L}]*)|(?:подключ[\p{L}]*|підключ[\p{L}]*)\s+нет\s+(?:возможност[\p{L}]*|можливост[\p{L}]*)|нет\s+(?:возможност[\p{L}]*|можливост[\p{L}]*)[^.!?]{0,30}(?:подключ[\p{L}]*|підключ[\p{L}]*))/iu;
    const blockMatch = blockRe.exec(source);
    if (!blockMatch) return null;

    const before = source.slice(Math.max(0, blockMatch.index - 100), blockMatch.index);
    const multiRe = /\d{1,2}(?:\s*(?:,|;|\/|\+|и|та|і|and|[-–—])\s*\d{1,2})+/giu;
    const multi = Array.from(before.matchAll(multiRe)).pop();
    let blocked = multi ? uniqueNumbers(multi[0]) : [];

    if (!blocked.length) {
      const singles = Array.from(before.matchAll(/(\d{1,2})\s*(?:[-–—]?\s*(?:й|ый|ий|й?))?\s*(?:подъезд[\p{L}]*|парадн[\p{L}]*|під\s*['’]?\s*їзд[\p{L}]*|підїзд[\p{L}]*|пар\.)/giu));
      const single = singles.pop();
      if (single) blocked = uniqueNumbers(single[1]);
    }

    if (!blocked.length || (!entranceWord.test(before) && !multi)) return null;

    let available = [];
    const readyRe = /(?:секц[\p{L}]*|подъезд[\p{L}]*|парадн[\p{L}]*)?\s*(\d{1,2}(?:\s*(?:,|;|\/|\+|и|та|і|and|[-–—])\s*\d{1,2})+|\d{1,2})[^.!?]{0,28}(?:готов[\p{L}]*|можно\s+подключ|можна\s+підключ)/giu;
    const readyMatches = Array.from(source.matchAll(readyRe));
    if (readyMatches.length) available = uniqueNumbers(readyMatches[readyMatches.length - 1][1]).filter(n => !blocked.includes(n));
    return { blocked, available };
  }

  function taskIsDomophone(context = {}) {
    return /домофон/iu.test(String(context.taskTypeLabel || ''));
  }

  function interpretRow(row, items, context = {}) {
    const raw = sanitizeSource(row?.text || '');
    if (!raw) return;
    const sourceKeys = [row?.key].filter(Boolean);
    const selected = selectedEntrance(context);

    const unsafeAccess = /(?:сним(?:аем|ать|ите)?\s+двер[\p{L}]*\s+с\s+петел|открыва[\p{L}]*\s+(?:с|з)\s+сил|відкрива[\p{L}]*\s+(?:з|із)\s+сил|взлом[\p{L}]*)/iu.test(raw);
    if (unsafeAccess) {
      add(items, {
        type: 'manual_review', severity: 'review', summary: 'Доступ — требуется ручная проверка заметки', evidence: raw,
        scope: { level: 'access', wholeBuilding: false, entrances: [] }, certainty: 'ambiguous', needsReview: true,
        reviewReasons: ['unsafe_or_forceful_access_wording'], decisionMode: 'manual_review', sourceKeys
      });
    }

    const uncertain = /(?:скорее\s+всего|может\s+быть|возможно|вроде|похоже|неизвест|уточн[\p{L}]*|\?)/iu.test(raw);
    const scoped = entranceRestriction(raw);
    if (scoped) {
      const blockedText = numberListText(scoped.blocked);
      const availableText = numberListText(scoped.available);
      const selectedMatches = !selected || scoped.blocked.map(String).includes(selected);
      if (selectedMatches) {
        add(items, {
          type: 'entrance_scope', severity: 'blocker',
          summary: `${blockedText} подъезд${scoped.blocked.length > 1 ? 'ы' : ''} — не подключаем${availableText ? `; ${availableText} — можно` : ''}`,
          evidence: raw,
          scope: { level: 'entrance', wholeBuilding: false, entrances: scoped.blocked.map(String), availableEntrances: scoped.available.map(String) },
          certainty: uncertain ? 'ambiguous' : 'explicit', needsReview: uncertain,
          reviewReasons: uncertain ? ['source_contains_uncertainty'] : [],
          decisionMode: uncertain ? 'manual_review' : 'hard_block_if_scope_matches', sourceKeys
        });
      }
    }

    const noFreeFiber = /нет\s+(?:свободн[\p{L}]*|вільн[\p{L}]*)\s+(?:волокон|волокна)|нема\s+(?:вільн[\p{L}]*|свободн[\p{L}]*)\s+волокон/iu.test(raw);
    const allPortsBusy = /(?:все|всі)\s+порт[\p{L}]*\s+(?:занят|зайнят)|порт[\p{L}]*\s+(?:все|всі)\s+(?:занят|зайнят)/iu.test(raw);
    const allTubesBlocked = /(?:труб[\p{L}]*\s+(?:все|всі)\s+забит|(?:все|всі)\s+труб[\p{L}]*\s+забит)/iu.test(raw);
    const strongCapacityBlock = noFreeFiber || allPortsBusy || allTubesBlocked;

    const scopedTechnologyBlock = /(?:по\s+вит[\p{L}]*\s+пар[\p{L}]*|ethernet|gpon|epon|\bpon\b)[^.!?]{0,45}не\s+(?:подключ|підключ)|не\s+(?:подключ|підключ)[^.!?]{0,45}(?:по\s+вит[\p{L}]*\s+пар[\p{L}]*|ethernet|gpon|epon|\bpon\b)/iu.test(raw);
    const scopedServiceBlock = /(?:домофон|кабельн[\p{L}]*\s+(?:тв|телевид)|\bктв\b|\btv\b)[^.!?]{0,45}не\s+(?:подключ|підключ)|не\s+(?:подключ|підключ)[^.!?]{0,45}(?:домофон|кабельн[\p{L}]*|\bктв\b|\btv\b)/iu.test(raw);
    const explicitNoConnection = /(?:нет|нема|відсутн[\p{L}]*)\s+(?:технич[\p{L}]*\s+)?(?:возможност[\p{L}]*|можливост[\p{L}]*)[^.!?]{0,80}(?:подключ[\p{L}]*|підключ[\p{L}]*|включ[\p{L}]*)|(?:не\s*(?:подключаем|підключаємо|подключать|підключати))/iu.test(raw);
    const positiveConnection = /(?:можно|можна)\s+(?:полностью\s+)?(?:подключ[\p{L}]*|підключ[\p{L}]*|включ[\p{L}]*)|(?:можно|можна)[^.!?]{0,30}(?:gpon|epon|\bpon\b)/iu.test(raw);
    if (!scoped && !scopedTechnologyBlock && !scopedServiceBlock && !strongCapacityBlock && explicitNoConnection) {
      const conflict = positiveConnection;
      add(items, {
        type: conflict ? 'manual_review' : 'connection_block',
        severity: conflict ? 'review' : 'blocker',
        summary: conflict ? 'Подключение — данные в заметке противоречат друг другу' : 'Подключение — нет технической возможности',
        evidence: raw,
        scope: { level: 'building', wholeBuilding: true, entrances: [] },
        certainty: (conflict || uncertain) ? 'ambiguous' : 'explicit', needsReview: Boolean(conflict || uncertain),
        reviewReasons: [conflict ? 'opposite_connection_statements' : '', uncertain ? 'source_contains_uncertainty' : ''].filter(Boolean),
        decisionMode: (conflict || uncertain) ? 'manual_review' : 'hard_block_if_scope_matches', sourceKeys
      });
    }

    if (noFreeFiber) {
      add(items, {
        type: 'infrastructure_capacity', severity: 'blocker', summary: 'Свободных волокон — нет', evidence: raw,
        scope: { level: 'infrastructure', wholeBuilding: true, entrances: [] }, certainty: 'explicit', decisionMode: 'hard_block_if_scope_matches', sourceKeys
      });
    }
    if (allPortsBusy) {
      add(items, {
        type: 'infrastructure_capacity', severity: 'blocker', summary: 'Все порты — заняты', evidence: raw,
        scope: { level: 'infrastructure', wholeBuilding: true, entrances: [] }, certainty: 'explicit', decisionMode: 'hard_block_if_scope_matches', sourceKeys
      });
    }
    if (allTubesBlocked) {
      add(items, {
        type: 'infrastructure_capacity', severity: 'blocker', summary: 'Трубки — забиты', evidence: raw,
        scope: { level: 'infrastructure', wholeBuilding: true, entrances: [] }, certainty: 'explicit', decisionMode: 'hard_block_if_scope_matches', sourceKeys
      });
    }

    const duration = raw.match(/(?:на\s+заявк[\p{L}]*[^.!?]{0,30})?(\d{1,2})\s*(?:час(?:а|ов)?|годин(?:а|и)?)(?:[^.!?]{0,18}(?:надо|треба|минимум|мінімум))?/iu);
    if (duration && /(?:заявк|треба|надо|минимум|мінімум)/iu.test(duration[0])) {
      add(items, {
        type: 'visit_duration', severity: 'warning', summary: `На заявку минимум ${Number(duration[1])} часа`, evidence: raw,
        scope: { level: 'time', wholeBuilding: true, entrances: [] }, certainty: 'explicit', sourceKeys
      });
    }

    const speed = raw.match(/(?:не\s+более|не\s+більше|макс(?:имум)?|до)\s*(\d{2,4})\s*(?:мбит|мб\/с|mbit|mbps)/iu);
    if (speed) {
      add(items, {
        type: 'speed_limit', severity: 'warning', summary: `Максимальная скорость — ${speed[1]} Мбит/с`, evidence: raw,
        scope: { level: 'service', wholeBuilding: true, entrances: [] }, certainty: 'explicit', sourceKeys
      });
    } else {
      const bareSpeed = raw.match(/макс(?:имум)?\s*(\d{2,4})(?=[.!\s])/iu);
      if (bareSpeed && /(?:тариф|оборуд|скорост|швидк)/iu.test(raw)) {
        add(items, {
          type: 'speed_limit', severity: 'warning', summary: `Скорость/тариф — максимум ${bareSpeed[1]} (по заметке)`, evidence: raw,
          scope: { level: 'service', wholeBuilding: true, entrances: [] }, certainty: 'derived', sourceKeys
        });
      }
    }

    const gponNo = /(?:\bgpon\b[^.!?]{0,24}(?:нет|нема|не\s+буд|недоступ)|(?:нет|нема)[^.!?]{0,20}\bgpon\b)/iu.test(raw);
    const eponNo = /(?:\bepon\b[^.!?]{0,24}(?:нет|нема|не\s+буд|недоступ)|(?:нет|нема)[^.!?]{0,20}\bepon\b)/iu.test(raw);
    const ponNo = /(?:\bpon\b|пона?)[^.!?]{0,20}(?:нет|нема|не\s+буд)|(?:нет|нема)[^.!?]{0,20}(?:\bpon\b|пона?)/iu.test(raw);
    const gponYes = /(?:подключ[\p{L}]*|підключ[\p{L}]*|можно|можна)[^.!?]{0,35}\bgpon\b|\bgpon\b[^.!?]{0,25}(?:можно|можна|доступ|подключ[\p{L}]*|підключ[\p{L}]*)/iu.test(raw);
    const eponYes = /(?:подключ[\p{L}]*|підключ[\p{L}]*|можно|можна)[^.!?]{0,35}\bepon\b|\bepon\b[^.!?]{0,25}(?:можно|можна|доступ|подключ[\p{L}]*|підключ[\p{L}]*)/iu.test(raw);
    const noCable = /(?:без\s+кабельн[\p{L}]*|нет\s+(?:ктв|кабельн[\p{L}]*\s+(?:тв|телевид))|нема\s+(?:ктв|кабельн[\p{L}]*)|дом\s+без\s+тв|тв\s+не\s+подключ)/iu.test(raw);

    if (gponNo) add(items, { type: 'technology_restriction', severity: 'warning', summary: 'GPON — нет', evidence: raw, scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: ['GPON'] }, certainty: 'explicit', sourceKeys });
    else if (gponYes && noCable) add(items, { type: 'technology_restriction', severity: 'info', summary: 'GPON — да', evidence: raw, scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: ['GPON'] }, certainty: 'explicit', decisionMode: 'info', sourceKeys });
    if (eponNo) add(items, { type: 'technology_restriction', severity: 'warning', summary: 'EPON — нет', evidence: raw, scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: ['EPON'] }, certainty: 'explicit', sourceKeys });
    else if (eponYes && noCable) add(items, { type: 'technology_restriction', severity: 'info', summary: 'EPON — да', evidence: raw, scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: ['EPON'] }, certainty: 'explicit', decisionMode: 'info', sourceKeys });
    if (ponNo && !gponNo && !eponNo) add(items, { type: 'technology_restriction', severity: 'warning', summary: 'PON — нет', evidence: raw, scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: ['PON'] }, certainty: 'explicit', sourceKeys });
    if (noCable) add(items, { type: 'service_restriction', severity: 'warning', summary: 'Кабельное ТВ — нет', evidence: raw, scope: { level: 'service', wholeBuilding: true, entrances: [], services: ['KTV'] }, certainty: 'explicit', sourceKeys });

    if (/по\s+вит[\p{L}]*\s+пар[\p{L}]*[^.!?]{0,35}не\s+подключ/iu.test(raw)) {
      add(items, { type: 'technology_restriction', severity: 'warning', summary: 'Витая пара — не подключаем', evidence: raw, scope: { level: 'technology', wholeBuilding: true, entrances: [], technologies: ['Ethernet'] }, certainty: 'explicit', sourceKeys });
    }

    if (/(?:только|лише)\s+(?:интернет|інтернет)\s*(?:и|та|\+)\s*iptv/iu.test(raw)) {
      add(items, { type: 'service_restriction', severity: 'warning', summary: 'Услуги — только Интернет и IPTV', evidence: raw, scope: { level: 'service', wholeBuilding: true, entrances: [], services: ['Internet', 'IPTV'] }, certainty: 'explicit', sourceKeys });
    }

    if (taskIsDomophone(context) && /домофон[\p{L}]*[^.!?]{0,35}не\s+подключ/iu.test(raw)) {
      add(items, { type: 'service_restriction', severity: 'blocker', summary: 'Домофон — не подключаем', evidence: raw, scope: { level: 'service', wholeBuilding: true, entrances: [], services: ['Domophone'] }, certainty: 'explicit', decisionMode: 'hard_block_if_scope_matches', sourceKeys });
    }

    const jekUntil = raw.match(/(?:жек|жед|жео)[^.!?]{0,45}(?:работ[\p{L}]*|прац[\p{L}]*)?[^.!?]{0,18}до\s*(\d{1,2})(?:[:.]([0-5]\d))?/iu);
    const weekendClosed = /(?:в\s+выходн|у\s+вихідн)[^.!?]{0,50}(?:не\s+работ|не\s+прац|закрит|закрыт)/iu.test(raw);
    if (jekUntil) {
      const hh = String(Number(jekUntil[1])).padStart(2, '0');
      const mm = String(Number(jekUntil[2] || 0)).padStart(2, '0');
      add(items, {
        type: 'access_window', severity: 'warning',
        summary: `ЖЭК — до ${hh}:${mm}${weekendClosed ? '; выходные закрыт' : ''}`, evidence: raw,
        scope: { level: 'time', wholeBuilding: false, entrances: [] }, certainty: 'explicit', sourceKeys
      });
    } else if (weekendClosed && /ключ/iu.test(raw)) {
      add(items, { type: 'access_window', severity: 'warning', summary: 'Ключи — в выходные не выдают', evidence: raw, scope: { level: 'time', wholeBuilding: false, entrances: [] }, certainty: 'explicit', sourceKeys });
    }

    if (/(?:доступ[^.!?]{0,25}(?:через|через\s+жек)|ключ[\p{L}]*[^.!?]{0,20}(?:в|у)\s+(?:жек|жед|жео))/iu.test(raw)) {
      add(items, { type: 'access_coordination', severity: 'warning', summary: /ключ/iu.test(raw) ? 'Ключи / доступ — через ЖЭК' : 'Доступ — через ЖЭК', evidence: raw, scope: { level: 'access', wholeBuilding: false, entrances: [] }, certainty: 'explicit', sourceKeys });
    } else if (/доступ[^.!?]{0,28}через\s+(?:председател|голов[\p{L}]*\s+осбб|управдом)/iu.test(raw)) {
      add(items, { type: 'access_coordination', severity: 'warning', summary: 'Доступ — согласовать с ответственным по дому', evidence: raw, scope: { level: 'access', wholeBuilding: false, entrances: [] }, certainty: 'explicit', sourceKeys });
    }

    if (/(?:набирать|звонить|дзвонити|поперед|предупред)[^.!?]{0,35}(?:за\s+день|заздалегідь)|за\s+день[^.!?]{0,25}(?:набирать|звонить|поперед)/iu.test(raw)) {
      add(items, { type: 'access_coordination', severity: 'warning', summary: 'Доступ — согласовать заранее', evidence: raw, scope: { level: 'access', wholeBuilding: false, entrances: [] }, certainty: 'explicit', sourceKeys });
    } else if (/(?:абонент|клиент)[^.!?]{0,45}(?:должен|має|повинен)[^.!?]{0,35}(?:договор|соглас|відкрити|открыть)[^.!?]{0,35}(?:тамбур|доступ|двер)/iu.test(raw)) {
      add(items, { type: 'access_coordination', severity: 'warning', summary: 'Доступ — абонент должен согласовать заранее', evidence: raw, scope: { level: 'access', wholeBuilding: false, entrances: [] }, certainty: 'explicit', sourceKeys });
    }

    if (/акци[\p{L}]*\s+не\s+(?:действ|діють)/iu.test(raw)) {
      add(items, { type: 'commercial_condition', severity: 'warning', summary: 'Акции — не действуют', evidence: raw, scope: { level: 'commercial', wholeBuilding: true, entrances: [] }, certainty: 'explicit', sourceKeys });
    }
    const deposit = raw.match(/(?:депозит|залог|застав)[\p{L}]*[^0-9]{0,20}(\d{2,5})\s*(?:грн|₴)?/iu);
    if (deposit) add(items, { type: 'commercial_condition', severity: 'warning', summary: `Депозит — ${deposit[1]} грн`, evidence: raw, scope: { level: 'commercial', wholeBuilding: true, entrances: [] }, certainty: 'explicit', sourceKeys });
    const commercial = raw.match(/коммерч[\p{L}]*[^0-9]{0,30}(?:от|від)\s*(\d{2,5})\s*(?:грн|₴)?/iu);
    if (commercial) add(items, { type: 'commercial_condition', severity: 'warning', summary: `Коммерческий тариф — от ${commercial[1]} грн`, evidence: raw, scope: { level: 'commercial', wholeBuilding: true, entrances: [] }, certainty: 'explicit', sourceKeys });

    if (/при\s+(?:следующ[\p{L}]*|наступн[\p{L}]*)\s+(?:заявк|заявц)[\p{L}]*[^.!?]{0,90}(?:замен|замін)[\p{L}]*[^.!?]{0,25}(?:свич|свіч|коммутатор|обладнан|оборуд)/iu.test(raw)) {
      add(items, {
        type: 'special_instruction', severity: 'info', summary: 'Следующая заявка — учесть замену оборудования', evidence: raw,
        scope: { level: 'infrastructure', wholeBuilding: false, entrances: [] }, certainty: 'explicit', temporalScope: 'future_instruction', decisionMode: 'info', sourceKeys
      });
    }
  }

  function interpretRows(rows, context = {}) {
    const items = [];
    const seenRows = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const clean = sanitizeSource(row?.text || '');
      const key = fold(clean);
      if (!key || seenRows.has(key)) continue;
      seenRows.add(key);
      interpretRow({ ...row, text: clean }, items, context);
    }
    return items
      .sort((a, b) => (a.priority - b.priority) || a.summary.localeCompare(b.summary, 'ru'))
      .map(({ __key, ...item }) => item);
  }

  WB.taskSpecialPolicyV3 = Object.freeze({
    version: VERSION,
    schema: SCHEMA,
    sanitizeSource,
    interpretRows
  });
})();