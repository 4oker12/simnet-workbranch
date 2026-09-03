(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.junctionDebug) return;

  const valueOf = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
  const text = value => String(valueOf(value) ?? '').replace(/\s+/g, ' ').trim();
  const lower = value => text(value).toLowerCase();
  const compact = (value, max = 220) => {
    const out = text(value);
    return out.length > max ? `${out.slice(0, max)}…` : out;
  };
  const normalizeMac = value => {
    const hex = text(value).replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.length === 12 ? hex : '';
  };
  const normalizeSerial = value => text(value).replace(/[^0-9a-z]/gi, '').toUpperCase();
  const normalizeInterface = value => text(value).replace(/\s+/g, '').toUpperCase();

  function serialForms(value) {
    const raw = normalizeSerial(value);
    const forms = new Set(raw ? [raw] : []);
    if (/^[A-Z]{4}[A-Z0-9]+$/.test(raw)) {
      const prefix = raw.slice(0, 4);
      const hexPrefix = Array.from(prefix)
        .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      forms.add(`${hexPrefix}${raw.slice(4)}`);
    }
    return forms;
  }

  function serialEquivalent(left, right) {
    const leftForms = serialForms(left);
    const rightForms = serialForms(right);
    if (!leftForms.size || !rightForms.size) return false;
    return [...leftForms].some(value => rightForms.has(value));
  }

  function sameValue(field, left, right) {
    if (!text(left) || !text(right)) return false;
    if (/mac/i.test(field)) return Boolean(normalizeMac(left) && normalizeMac(left) === normalizeMac(right));
    if (/serial|sn/i.test(field)) return serialEquivalent(left, right);
    if (/interface|port/i.test(field)) return normalizeInterface(left) === normalizeInterface(right);
    return lower(left) === lower(right);
  }

  function fact(caseData, group, key) {
    return text(caseData?.[group]?.[key]);
  }

  function junction({
    id,
    joint,
    kind = 'observation',
    severity = 'info',
    status = 'observed',
    title,
    leftLabel = '',
    leftValue = '',
    rightLabel = '',
    rightValue = '',
    fields = [],
    reason = '',
    contour = '',
    at = '',
    count = 1
  }) {
    return {
      id: String(id || `${joint}:${title}`),
      joint: String(joint || ''),
      kind: String(kind || 'observation'),
      severity: String(severity || 'info'),
      status: String(status || 'observed'),
      title: String(title || ''),
      left: { label: String(leftLabel || ''), value: compact(leftValue, 360) },
      right: { label: String(rightLabel || ''), value: compact(rightValue, 360) },
      fields: Array.isArray(fields) ? fields.map(String) : [],
      reason: compact(reason, 520),
      contour: String(contour || ''),
      at: String(at || ''),
      count: Math.max(1, Number(count || 1))
    };
  }

  function activeSourceJunctions(caseData) {
    const details = caseData?.diagnostic?.ponWorkflowDetails || {};
    const conflicts = Array.isArray(details.conflicts) ? details.conflicts : [];
    const prefill = Array.isArray(details.prefillFields) ? details.prefillFields : [];
    const expected = details.expectedTechnical || {};
    const billing = details.billing || {};
    const result = [];

    for (const item of conflicts) {
      const field = String(item?.field || 'unknown');
      const labels = { olt: 'OLT', onuMac: 'ONU MAC', onuSerial: 'ONU Serial' };
      result.push(junction({
        id: `active:tmc-billing:${field}`,
        joint: 'TMC ↔ Billing',
        kind: 'source_mismatch',
        severity: item?.blocking ? 'error' : 'warn',
        status: 'active',
        title: `${labels[field] || field} не совпадает`,
        leftLabel: 'Billing',
        leftValue: item?.billing || '—',
        rightLabel: 'TMC',
        rightValue: item?.tmc || '—',
        fields: [field],
        reason: item?.blocking
          ? 'Идентичность/привязка расходится между двумя независимыми источниками.'
          : 'Источники дают разные значения. Downstream-опрос сам по себе это расхождение не устраняет.',
        contour: 'PON · сверка Billing/TMC'
      }));
    }

    for (const field of prefill) {
      if (conflicts.some(item => String(item?.field || '') === String(field))) continue;
      const billingValue = field === 'olt'
        ? [billing.oltName, billing.oltIp].filter(Boolean).join(' · ')
        : field === 'onuMac' ? billing.onuMac : billing.onuSerial;
      const tmcValue = field === 'olt'
        ? [expected.oltName, expected.oltIp].filter(Boolean).join(' · ')
        : field === 'onuMac' ? expected.onuMac : expected.onuSerial;
      result.push(junction({
        id: `active:tmc-billing-gap:${field}`,
        joint: 'TMC → Billing',
        kind: 'source_gap',
        severity: 'warn',
        status: 'needs_action',
        title: `${field === 'olt' ? 'OLT' : field === 'onuMac' ? 'ONU MAC' : 'ONU Serial'} есть в TMC, но не подтверждён в Billing`,
        leftLabel: 'Billing',
        leftValue: billingValue || '—',
        rightLabel: 'TMC',
        rightValue: tmcValue || 'есть значение',
        fields: [field],
        reason: 'TMC является подсказкой/источником сверки. Для poll нужны фактически сохранённые технические данные Billing.',
        contour: 'PON · заполнение технических данных'
      }));
    }

    return result;
  }

  function currentPollJunctions(caseData) {
    const result = [];
    const snapshot = caseData?.live?.oltSnapshot || null;
    if (!snapshot) return result;

    const billingOltIp = fact(caseData, 'pon', 'oltIp');
    const tmcOltIp = fact(caseData, 'pon', 'tmcOltIp');
    const billingMac = fact(caseData, 'pon', 'onuMac');
    const tmcMac = fact(caseData, 'pon', 'tmcOnuMac');
    const billingSerial = fact(caseData, 'pon', 'onuSerial');
    const tmcSerial = fact(caseData, 'pon', 'tmcOnuSerial');
    const observedSerial = text(snapshot.observedOnuSerial || snapshot.onuSerial);
    const observedMac = text(snapshot.observedOnuMac || snapshot.onuMac);
    const observedOltIp = text(snapshot.oltIp);
    const observedInterface = text(snapshot.interface);
    const tmcInterface = fact(caseData, 'pon', 'tmcPort');

    const comparisons = [
      { id: 'oltIp', label: 'OLT IP', expectedLabel: billingOltIp ? 'Billing' : 'TMC', expected: billingOltIp || tmcOltIp, observed: observedOltIp },
      { id: 'onuMac', label: 'ONU MAC', expectedLabel: billingMac ? 'Billing' : 'TMC', expected: billingMac || tmcMac, observed: observedMac },
      { id: 'onuSerial', label: 'ONU Serial', expectedLabel: billingSerial ? 'Billing' : 'TMC', expected: billingSerial || tmcSerial, observed: observedSerial },
      { id: 'interface', label: 'Интерфейс', expectedLabel: 'TMC', expected: tmcInterface, observed: observedInterface }
    ];

    for (const item of comparisons) {
      if (!text(item.expected) || !text(item.observed)) continue;
      if (sameValue(item.id, item.expected, item.observed)) continue;
      result.push(junction({
        id: `active:source-poll:${item.id}`,
        joint: `${item.expectedLabel} ↔ OLT response`,
        kind: 'poll_mismatch',
        severity: ['onuMac', 'onuSerial'].includes(item.id) ? 'error' : 'warn',
        status: snapshot.status === 'confirmed' ? 'active' : 'observed',
        title: `${item.label} ответа не совпадает с ожидаемым`,
        leftLabel: item.expectedLabel,
        leftValue: item.expected,
        rightLabel: 'OLT response',
        rightValue: item.observed,
        fields: [item.id],
        reason: 'Ответ оборудования относится к привязке, которую нужно сверить с upstream-источником.',
        contour: 'Poll · привязка ответа к абоненту',
        at: snapshot.capturedAt || snapshot.updatedAt || ''
      }));
    }
    return result;
  }

  function workflowUiJunctions(caseData) {
    const result = [];
    const decision = WB.caseView?.decision?.(caseData) || null;
    const details = caseData?.diagnostic?.ponWorkflowDetails || {};
    if (!decision) return result;

    const progress = caseData?.progress || {};
    const action = String(decision.action || '');
    const impossible = [];
    if (action === 'check_tmc' && progress?.tmcChecked?.done === true) impossible.push('tmcChecked=true, но решение требует check_tmc');
    if (['poll_current_binding', 'poll_candidate', 'retry_poll'].includes(action) && details.billingTechnicalComplete === false) {
      impossible.push('poll предлагается при неполных сохранённых технических данных Billing');
    }
    if (action === 'complete_confirmed' && (Number(details.conflicts?.length || 0) > 0 || Number(details.prefillFields?.length || 0) > 0)) {
      impossible.push('UI/decision завершает кейс при незакрытой сверке Billing/TMC');
    }

    if (impossible.length) {
      result.push(junction({
        id: 'active:workflow-ui',
        joint: 'Workflow state ↔ UI decision',
        kind: 'state_mismatch',
        severity: 'error',
        status: 'active',
        title: 'Состояние и отображаемое действие противоречат друг другу',
        leftLabel: 'Workflow/state',
        leftValue: impossible.join(' | '),
        rightLabel: 'UI decision',
        rightValue: action,
        fields: [String(decision.completionKey || '')].filter(Boolean),
        reason: 'Код не обязательно падает: это логическое расхождение между рассчитанным состоянием и тем, что UI считает следующим действием.',
        contour: 'LIVE · state → decision → render'
      }));
    }
    return result;
  }

  function historicalJunctions(caseData) {
    const raw = Array.isArray(caseData?.conflicts) ? caseData.conflicts : [];
    const normalized = [];
    const groups = new Map();

    for (const item of raw) {
      const field = String(item?.field || '');
      if (!field) continue;
      if (/serial/i.test(field) && serialEquivalent(item?.oldValue, item?.newValue)) {
        normalized.push(junction({
          id: `history:equivalent:${field}:${item?.at || ''}`,
          joint: 'Fact normalization',
          kind: 'equivalent_change',
          severity: 'info',
          status: 'equivalent',
          title: `${field} изменил представление, но не значение`,
          leftLabel: item?.oldSource || 'old',
          leftValue: item?.oldValue,
          rightLabel: item?.newSource || 'new',
          rightValue: item?.newValue,
          fields: [field],
          reason: 'После нормализации значения эквивалентны. Это не активный конфликт источников.',
          contour: 'Facts · нормализация идентификатора',
          at: item?.at || '',
          count: item?.count || 1
        }));
        continue;
      }

      const atMs = Date.parse(item?.at || '') || 0;
      const sameSource = String(item?.oldSource || '') === String(item?.newSource || '');
      const isOltBinding = /^pon\.olt(Name|Ip|Id|DeviceId)$/i.test(field);
      const bucket = isOltBinding
        ? `olt:${Math.floor(atMs / 250)}`
        : `field:${field}:${item?.oldValue || ''}:${item?.newValue || ''}:${item?.oldSource || ''}:${item?.newSource || ''}`;
      const group = groups.get(bucket) || {
        at: item?.at || '',
        fields: [],
        oldParts: [],
        newParts: [],
        oldSource: item?.oldSource || '',
        newSource: item?.newSource || '',
        oldSources: new Set(),
        newSources: new Set(),
        count: 0,
        sameSource,
        isOltBinding
      };
      group.fields.push(field);
      group.oldParts.push(`${field.split('.').pop()}: ${text(item?.oldValue) || '—'}`);
      group.newParts.push(`${field.split('.').pop()}: ${text(item?.newValue) || '—'}`);
      group.oldSources.add(String(item?.oldSource || ''));
      group.newSources.add(String(item?.newSource || ''));
      const sourceFamily = source => String(source || '').split(':')[0];
      if (sourceFamily(item?.oldSource) !== sourceFamily(item?.newSource)) group.sameSource = false;
      group.count += Number(item?.count || 1);
      if (String(item?.at || '') > String(group.at || '')) group.at = item?.at || group.at;
      groups.set(bucket, group);
    }

    const history = [...groups.values()].map((group, index) => junction({
      id: `history:${group.isOltBinding ? 'olt-binding' : 'fact'}:${index}:${group.at}`,
      joint: group.sameSource ? 'Source → same source' : 'Source ↔ source',
      kind: group.isOltBinding ? 'binding_change' : 'fact_change',
      severity: 'info',
      status: 'historical',
      title: group.isOltBinding ? 'OLT binding изменился одним событием' : `${group.fields[0]} изменилось`,
      leftLabel: group.isOltBinding ? 'previous Billing binding' : (group.oldSource || 'old source'),
      leftValue: group.oldParts.join(' · '),
      rightLabel: group.isOltBinding ? 'new Billing binding' : (group.newSource || 'new source'),
      rightValue: group.newParts.join(' · '),
      fields: group.fields,
      reason: group.sameSource
        ? 'Один и тот же источник позже сообщил другое значение. Это история изменения факта, а не доказательство текущего конфликта между источниками.'
        : 'Канонический факт был заменён значением другого источника. Проверять нужно актуальное состояние, а не только сам факт замены.',
      contour: group.isOltBinding ? 'Facts · OLT binding' : 'Facts · canonical value',
      at: group.at,
      count: group.count
    }));

    return [...normalized, ...history].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }

  function guardHistory(caseData) {
    const journal = Array.isArray(caseData?.journal) ? caseData.journal : [];
    const currentBillingOlt = fact(caseData, 'pon', 'oltIp');
    const items = [];
    const seen = new Set();
    for (const event of journal) {
      if (!['interaction_warning', 'interaction_guard'].includes(String(event?.type || ''))) continue;
      const details = event?.details || {};
      const reason = String(details.reason || '');
      if (!/^poll-(olt|action|billing)-mismatch$/.test(reason) || seen.has(reason)) continue;
      seen.add(reason);
      let status = 'historical';
      let title = reason;
      let leftLabel = 'expected';
      let leftValue = '';
      let rightLabel = 'actual';
      let rightValue = '';
      if (reason === 'poll-olt-mismatch') {
        title = 'Ссылка/страница poll указывала на другую OLT';
        leftLabel = details.expectedSource === 'tmc' ? 'TMC' : 'Billing expected';
        leftValue = details.expectedOltIp || '';
        rightLabel = 'Poll page';
        rightValue = details.actualOltIp || '';
        if (currentBillingOlt && sameValue('oltIp', currentBillingOlt, details.expectedOltIp)) status = 'resolved';
      } else if (reason === 'poll-action-mismatch') {
        title = 'Тип/действие poll не совпадало с ожидаемым';
        leftValue = [details.expectedTechnology, details.expectedAction].filter(Boolean).join(' ');
        rightValue = [details.actualTechnology, details.actualAction].filter(Boolean).join(' ');
      } else {
        title = 'Poll относился к другому Billing ID';
        leftValue = details.expectedBillingId || '';
        rightValue = details.actualBillingId || '';
      }
      items.push(junction({
        id: `guard:${reason}:${event?.at || ''}`,
        joint: 'Expected binding ↔ Poll page',
        kind: 'guard_mismatch',
        severity: status === 'resolved' ? 'info' : 'warn',
        status,
        title,
        leftLabel,
        leftValue,
        rightLabel,
        rightValue,
        reason: status === 'resolved'
          ? 'Расхождение было зафиксировано ранее, но текущая сохранённая привязка уже соответствует ожидаемой.'
          : 'Guard заметил конкретное расхождение в момент штатного действия оператора.',
        contour: 'Poll Guard · expected binding → clicked poll',
        at: event?.at || ''
      }));
    }
    return items;
  }

  function analyze(caseData) {
    if (!caseData) {
      return { caseId: '', active: [], history: [], all: [], metrics: { active: 0, warnings: 0, errors: 0, history: 0, equivalent: 0, junctions: 0 } };
    }

    const active = [
      ...activeSourceJunctions(caseData),
      ...currentPollJunctions(caseData),
      ...workflowUiJunctions(caseData)
    ];
    const history = [...guardHistory(caseData), ...historicalJunctions(caseData)];
    const all = [...active, ...history];
    return {
      caseId: String(caseData.id || ''),
      active,
      history,
      all,
      metrics: {
        active: active.filter(item => ['active', 'needs_action', 'observed'].includes(item.status)).length,
        warnings: active.filter(item => item.severity === 'warn').length,
        errors: active.filter(item => item.severity === 'error').length,
        history: history.filter(item => ['historical', 'resolved'].includes(item.status)).length,
        equivalent: history.filter(item => item.status === 'equivalent').length,
        junctions: new Set(all.map(item => item.joint)).size
      }
    };
  }

  let lastConsoleSignature = '';
  function activeCaseFromState(state) {
    return state?.cases?.[state?.activeCaseId] || null;
  }

  function logReport(state) {
    const report = analyze(activeCaseFromState(state));
    if (!report.caseId) return;
    const signature = JSON.stringify(report.active.map(item => [item.id, item.status, item.left.value, item.right.value]));
    if (signature === lastConsoleSignature) return;
    lastConsoleSignature = signature;
    const prefix = `[SIMNET WB][JUNCTION] ${report.metrics.active} active · ${report.metrics.junctions} junctions · case=${report.caseId}`;
    if (report.metrics.active) console.warn(prefix, report.active);
    else console.info(prefix, { active: [], history: report.metrics.history, equivalent: report.metrics.equivalent });
    WB.bus?.emit?.('debug:junction', report);
  }

  const unsub = WB.bus?.on?.('store:state', logReport) || null;

  function destroy() {
    if (typeof unsub === 'function') unsub();
    lastConsoleSignature = '';
  }

  WB.junctionDebug = Object.freeze({ analyze, serialEquivalent, sameValue, destroy });
})();
