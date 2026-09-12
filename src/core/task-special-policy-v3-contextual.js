(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__taskSpecialPolicyV3ContextualLoaded || !WB.taskSpecialPolicyV3?.interpretRows) return;
  WB.__taskSpecialPolicyV3ContextualLoaded = true;

  const basePolicy = WB.taskSpecialPolicyV3;
  const VERSION = 5;

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

  function ponBoxCapacity(rows) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const raw = compact(row?.text, 6000);
      if (!/(?:\bpon\d*\b|пон\d*)[^.!?]{0,30}бокс|бокс[^.!?]{0,30}(?:\bpon\d*\b|пон\d*)/iu.test(raw)) continue;
      if (!/(?:забит|заполн|переполн|занят|нет\s+(?:свободн\w*|мест|порт)|нема\s+(?:вільн\w*|місц|порт)|все\s+(?:места|порты)\s+занят|всі\s+(?:місця|порти)\s+зайнят)/iu.test(raw)) continue;
      return {
        type: 'infrastructure_capacity',
        severity: 'blocker',
        summary: 'PON-боксы — нет свободного ресурса',
        evidence: raw,
        scope: { level: 'infrastructure', wholeBuilding: true, entrances: [] },
        certainty: 'explicit',
        conditional: false,
        temporalScope: 'current_or_unspecified',
        needsReview: false,
        reviewReasons: [],
        decisionMode: 'hard_block_if_scope_matches',
        priority: 1.5,
        sourceKeys: [String(row?.key || '')].filter(Boolean)
      };
    }
    return null;
  }

  function severityMeta(item = {}) {
    if (item.needsReview || item.severity === 'review' || item.decisionMode === 'manual_review') {
      return { level: 'review', label: 'НУЖНА ПРОВЕРКА' };
    }
    if (item.severity === 'blocker' || item.decisionMode === 'hard_block_if_scope_matches') {
      return { level: 'blocker', label: 'МОЖЕТ СОРВАТЬ ЗАЯВКУ' };
    }
    if (item.severity === 'info' || item.decisionMode === 'info') {
      return { level: 'info', label: 'СПРАВОЧНО' };
    }
    return { level: 'warning', label: 'ВАЖНО ДО СОХРАНЕНИЯ' };
  }

  function accessWindowAction(summary) {
    const until = String(summary || '').match(/до\s*(\d{1,2}:\d{2})/u);
    if (until) return `Выезд — до ${until[1]}.`;
    if (/выходн/iu.test(summary || '')) return 'Не ставить выезд на закрытое время; заранее проверить доступ.';
    return 'Учесть допустимое время выезда.';
  }

  function presentItem(item = {}, context = {}) {
    const summary = compact(item.summary, 220) || 'Важное условие по адресу';
    const severity = severityMeta(item);
    const type = String(item.type || 'special_instruction');
    const taskType = compact(context.taskTypeLabel, 120);
    const common = { summary, severity: severity.level, severityLabel: severity.label };

    switch (type) {
      case 'connection_block':
        return { ...common, tag: 'ПОДКЛЮЧЕНИЕ', impact: 'Заявка может быть технически невыполнима и уйти в работу ошибочно.', action: 'Не обещать подключение. Уточнить техническую возможность или эскалировать до оформления.' };
      case 'infrastructure_capacity':
        return { ...common, tag: 'РЕСУРС', impact: 'Бригаде может не хватить порта, волокна или другого ресурса для выполнения работ.', action: 'Проверить свободный ресурс или согласовать расширение до назначения заявки.' };
      case 'entrance_scope':
        return { ...common, tag: 'ПОДЪЕЗД / СЕКЦИЯ', impact: 'Ограничение действует не на весь дом: неверный подъезд может сделать выезд бесполезным.', action: 'Сверить подъезд/секцию заявки. Если выбран запрещённый — не отправлять заявку как обычную.' };
      case 'manual_review':
        return { ...common, tag: 'ПРОВЕРИТЬ', impact: 'Формулировка неоднозначна — Workbench не может безопасно решить за оператора.', action: 'Прочитать исходную заметку и уточнить условие до сохранения заявки.' };
      case 'speed_limit':
        return { ...common, tag: 'СКОРОСТЬ', impact: 'Абоненту нельзя обещать скорость выше ограничения по этому адресу.', action: 'Сверить тариф и ожидания абонента; зафиксировать ограничение в заявке.' };
      case 'technology_restriction':
        return { ...common, tag: 'ТЕХНОЛОГИЯ', impact: 'Неверная технология может сделать заявку невыполнимой или потребовать переоформления.', action: 'Сверить технологию заявки с разрешённой для этого адреса.' };
      case 'service_restriction':
        return { ...common, tag: 'УСЛУГА', impact: `${taskType ? `Для «${taskType}» это может быть критично: ` : ''}услуга может быть недоступна по адресу.`, action: 'Не обещать недоступную услугу; сверить допустимый вариант до сохранения.' };
      case 'visit_duration':
        return { ...common, tag: 'ВРЕМЯ НА РАБОТЫ', impact: 'Обычного слота может не хватить, и бригада не успеет выполнить заявку.', action: 'Заложить указанную длительность при назначении визита.' };
      case 'access_window':
        return { ...common, tag: 'ДОСТУП / ВРЕМЯ', impact: 'Вне этого времени бригада может не получить доступ, и выезд сорвётся.', action: accessWindowAction(summary) };
      case 'access_coordination': {
        const keyLike = /ключ|код/iu.test(`${summary} ${item.evidence || ''}`);
        return {
          ...common,
          tag: 'ДОСТУП',
          impact: keyLike ? 'Без ключа, кода или согласованного доступа бригада может не попасть к месту работ.' : 'Без предварительного согласования бригада может не попасть к месту работ.',
          action: keyLike ? 'Уточнить ключ/код/контакт и передать способ доступа бригаде.' : 'Заранее согласовать доступ и передать условие исполнителю.'
        };
      }
      case 'commercial_condition':
        return { ...common, tag: 'СТОИМОСТЬ', impact: '', action: '', secondary: true };
      case 'special_instruction':
        return { ...common, tag: 'ОСОБОЕ ДЕЙСТВИЕ', impact: item.temporalScope === 'future_instruction' ? 'Требование относится к следующему выезду и легко потеряется, если не передать его исполнителю.' : 'Условие меняет обычный порядок выполнения заявки.', action: 'Зафиксировать требование в заявке и передать его исполнителю.' };
      default:
        return { ...common, tag: 'ВАЖНО', impact: 'Условие может изменить порядок или результат выполнения заявки.', action: 'Сверить исходную заметку и передать важное условие исполнителю.' };
    }
  }

  function isRoutinePositive(item = {}) {
    if (item.severity !== 'info' && item.decisionMode !== 'info') return false;
    const summary = fold(item.summary);
    if (item.type === 'technology_restriction' && /\b(?:gpon|epon|pon|ethernet)\b.*\b(?:да|доступ|можно)\b/u.test(summary)) return true;
    return false;
  }

  function hasAccessEvidence(item = {}) {
    const evidence = fold(item.evidence);
    if (!evidence) return false;

    // The word "домофон" by itself describes a service. It is access evidence
    // only when the note explicitly connects it with a key/code/door/access.
    if (/(?:доступ|ключ|код|жек|жед|жео|осбб|председател|управдом|тамбур|двер|ворот|консьерж|охрана)/u.test(evidence)) return true;
    if (/(?:домофон).{0,35}(?:ключ|код|доступ|двер|откр)|(?:ключ|код|доступ|двер|откр).{0,35}(?:домофон)/u.test(evidence)) return true;

    return /(?:набирать|звонить|дзвонити|поперед|предупред).{0,40}(?:за день|заранее|заздалегид)/u.test(evidence)
      || /(?:за день|заранее|заздалегид).{0,40}(?:набирать|звонить|дзвонити|поперед|предупред)/u.test(evidence);
  }

  function hasConnectionBlockEvidence(item = {}) {
    const evidence = fold(item.evidence);
    if (!evidence) return false;

    // Commercial phrase "завод кабеля без подключения" describes a price,
    // not absence of technical possibility.
    const stripped = evidence
      .replace(/завод\w* кабел\w* без подключ\w*/gu, ' ')
      .replace(/кабел\w* без подключ\w*/gu, ' ');

    return /(?:нет|нема|видсутн)\s+(?:техническ\w*\s+)?(?:возможност\w*|можливост\w*)[^a-zа-я0-9]{0,8}(?:подключ\w*|пидключ\w*)/u.test(stripped)
      || /(?:подключ\w*|пидключ\w*)[^a-zа-я0-9]{0,20}(?:невозмож\w*|неможлив\w*)/u.test(stripped)
      || /(?:не подключаем|не подключать|не пидключаем|не пидключати|подключение невозможно|пидключення неможлив)/u.test(stripped);
  }

  function isSupportedByEvidence(item = {}) {
    if (item.type === 'connection_block') return hasConnectionBlockEvidence(item);
    if (item.type === 'access_coordination') return hasAccessEvidence(item);
    if (item.type === 'access_window') {
      const evidence = fold(item.evidence);
      return hasAccessEvidence(item) && /(?:\b\d{1,2}[:.]\d{2}\b|до\s*\d{1,2}|выходн|будн|час)/u.test(evidence);
    }
    return true;
  }

  function dedupe(items) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      const summary = fold(item?.summary);
      const evidence = fold(item?.evidence);
      const scope = Array.isArray(item?.scope?.entrances) ? item.scope.entrances.join(',') : '';
      const key = `${item?.type || ''}|${summary}|${evidence}|${scope}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function refineItems(items) {
    return dedupe((Array.isArray(items) ? items : [])
      .filter(item => !isRoutinePositive(item))
      .filter(isSupportedByEvidence));
  }

  function interpretRows(rows, context = {}) {
    let items = basePolicy.interpretRows(rows, context);
    const exclusive = exclusiveTechnology(rows);
    const capacity = ponBoxCapacity(rows);

    if (exclusive) {
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
    }

    if (capacity && !items.some(item => item?.type === 'infrastructure_capacity' && fold(item?.summary) === fold(capacity.summary))) {
      items.push(capacity);
    }

    return refineItems(items).sort((a, b) => Number(a?.priority ?? 50) - Number(b?.priority ?? 50));
  }

  try {
    WB.taskSpecialPolicyV3 = Object.freeze({
      ...basePolicy,
      interpretRows,
      presentItem,
      contextualPolicyVersion: VERSION
    });
  } catch {}
})();