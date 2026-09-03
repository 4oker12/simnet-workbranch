(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || (WB.callRegistration && !WB.callRegistration.__lazy)) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
  const FORM_PATH = '/message/tab';
  const SAVE_PATH = '/message/save_call';
  const FORM_MESSAGE = 'CALL_REGISTRATION_FORM';
  const SUBMIT_MESSAGE = 'CALL_REGISTRATION_SUBMIT';
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';
  const PBX_BIND_MESSAGE = 'PBX_CALL_BIND';
  const PBX_FINALIZE_MESSAGE = 'PBX_CALL_SUBMISSION_FINALIZE';
  const CALL_GLOBAL_AUDIT_MESSAGE = 'CALL_GLOBAL_AUDIT_GET';
  const CALL_ROUTE_TARGET_MESSAGE = 'CALL_REGISTRATION_ROUTE_TARGET';

  const valueOf = raw => (
    raw && typeof raw === 'object' && 'value' in raw
      ? raw.value
      : raw
  );

  const esc = value => String(value == null ? '' : value).replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]
  );

  const compact = (value, max = 260) => {
    const text = String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function customerIdOf(raw) {
    const text = String(valueOf(raw) ?? '').trim();
    return /^\d{1,12}$/.test(text) ? text : '';
  }

  function usersideFormUrl(customerId) {
    const id = customerIdOf(customerId);
    if (!id) return '';
    const url = new URL(FORM_PATH, USERSIDE_ORIGIN);
    url.searchParams.set('section', 'call');
    url.searchParams.set('customer_id', id);
    return url.href;
  }

  function actionUrlOf(form) {
    try {
      const url = new URL(
        String(form?.getAttribute?.('action') || ''),
        USERSIDE_ORIGIN
      );
      return url.origin === USERSIDE_ORIGIN && url.pathname === SAVE_PATH
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  function parseNativeCallForm(html, expectedCustomerId = '') {
    if (typeof DOMParser === 'undefined') {
      throw new Error('DOMParser недоступен');
    }

    const documentNode = new DOMParser().parseFromString(
      String(html || ''),
      'text/html'
    );
    const forms = Array.from(
      documentNode.forms || documentNode.querySelectorAll?.('form') || []
    );
    const form = forms.find(candidate => Boolean(actionUrlOf(candidate)));

    if (!form) {
      throw new Error('UserSide не вернул штатную форму регистрации звонка');
    }

    if (String(form.getAttribute?.('method') || 'get').toLowerCase() !== 'post') {
      throw new Error('UserSide вернул форму с неожиданным методом');
    }

    const hiddenFields = Array.from(
      form.querySelectorAll?.('input[type="hidden"][name]') || []
    ).map(input => ({
      name: String(input.getAttribute?.('name') || input.name || ''),
      value: String(input.value ?? input.getAttribute?.('value') ?? '')
    })).filter(field => field.name);

    const hiddenValue = name => hiddenFields.find(field => field.name === name)?.value || '';
    const customerId = customerIdOf(hiddenValue('customer_id'));
    const expected = customerIdOf(expectedCustomerId);
    const csrf = hiddenValue('_csrf');

    if (!customerId || !csrf) {
      throw new Error('В штатной форме UserSide отсутствует customer_id или _csrf');
    }
    if (expected && customerId !== expected) {
      throw new Error(`Форма относится к другому абоненту: ${customerId}`);
    }
    if (!hiddenFields.some(field => field.name === 'additional_fields[]' && field.value === '13')) {
      throw new Error('UserSide не вернул обязательное поле телефона dopf_13');
    }

    const standard = form.querySelector?.('select[name="standart_comment"]');
    const comment = form.querySelector?.('textarea[name="comment"]');
    const phone = form.querySelector?.('input[name="dopf_13"]');
    if (!standard || !comment || !phone) {
      throw new Error('Состав штатной формы UserSide изменился');
    }

    const options = Array.from(
      standard.options || standard.querySelectorAll?.('option') || []
    ).filter(option => !option.disabled).map(option => ({
      value: String(option.value ?? option.getAttribute?.('value') ?? ''),
      label: compact(option.textContent || option.label || ''),
      selected: Boolean(option.selected)
    }));

    if (!options.length) {
      throw new Error('UserSide не вернул варианты типового комментария');
    }

    const nativeSelected = String(
      standard.value
      || options.find(option => option.selected)?.value
      || options[0].value
    );

    return {
      action: actionUrlOf(form),
      method: 'POST',
      customerId,
      csrf,
      hiddenFields,
      options,
      defaults: {
        standardComment: nativeSelected,
        comment: String(comment.value || ''),
        phone: String(phone.value || '')
      },
      phoneRequired: Boolean(phone.required || phone.hasAttribute?.('required')),
      phoneMaxLength: Number(phone.maxLength > 0 ? phone.maxLength : phone.getAttribute?.('maxlength')) || 35
    };
  }

  function serializeNativeCallForm(model, values = {}) {
    if (!model?.customerId || !model?.csrf || !Array.isArray(model.hiddenFields)) {
      throw new Error('Штатная форма ещё не загружена');
    }

    const selected = String(values.standardComment ?? model.defaults?.standardComment ?? '');
    if (!model.options?.some(option => String(option.value) === selected)) {
      throw new Error('Выбран неизвестный типовой комментарий');
    }

    const comment = String(values.comment ?? '');
    const phone = String(values.phone ?? '').trim();
    if (model.phoneRequired && !phone) {
      throw new Error('Укажите телефон');
    }
    if (phone.length > Number(model.phoneMaxLength || 35)) {
      throw new Error(`Телефон длиннее ${Number(model.phoneMaxLength || 35)} символов`);
    }

    const replaced = new Set([
      'customer_id',
      'standart_comment',
      'comment',
      'dopf_13'
    ]);
    const fields = model.hiddenFields
      .filter(field => field?.name && !replaced.has(String(field.name)))
      .map(field => ({
        name: String(field.name),
        value: String(field.value ?? '')
      }));

    fields.push(
      { name: 'customer_id', value: model.customerId },
      { name: 'standart_comment', value: selected },
      { name: 'comment', value: comment },
      { name: 'dopf_13', value: phone }
    );

    return fields;
  }

  function responseDocument(html) {
    if (typeof DOMParser === 'undefined') return null;
    try {
      return new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch {
      return null;
    }
  }

  function responseMessage(documentNode, html, { error = false, allowBodyMatch = true } = {}) {
    const selector = error
      ? '.error, .error-message, .errorMessage, .alert-danger, .bad_info_text, .validation-error, .help-block.error'
      : '.success, .success-message, .alert-success';
    const node = documentNode?.querySelector?.(selector);
    const selected = compact(node?.textContent || '');
    if (selected) return selected;
    if (!allowBodyMatch) return '';

    const text = compact(documentNode?.body?.textContent || html || '');
    if (!text) return '';
    if (error) {
      const match = text.match(/[^.!?]*(?:ошиб|помил|обязатель|обов'язков|не\s+заполн|некоррект|invalid|csrf)[^.!?]*/i);
      return compact(match?.[0] || '');
    }
    const match = text.match(/[^.!?]*(?:звонок|дзвінок)[^.!?]*(?:зарегистрирован|зареєстрован|сохран[её]н|збережен)[^.!?]*/i);
    return compact(match?.[0] || '');
  }

  function classifySubmissionResult(result = {}, customerId = '') {
    const id = customerIdOf(customerId);
    const html = String(result.data || '');
    const documentNode = responseDocument(html);
    const hasNativeForm = Boolean(
      Array.from(documentNode?.forms || documentNode?.querySelectorAll?.('form') || [])
        .some(form => Boolean(actionUrlOf(form)))
    );
    const errorMessage = responseMessage(documentNode, html, {
      error: true,
      allowBodyMatch: !result.ok || hasNativeForm
    });

    if (!result.ok) {
      return {
        status: 'error',
        message: errorMessage || `UserSide вернул HTTP ${Number(result.status || 0) || 'ошибку'}`
      };
    }

    if (errorMessage || hasNativeForm) {
      return {
        status: 'error',
        message: errorMessage || 'UserSide вернул форму повторно — сохранение не подтверждено'
      };
    }

    let finalUrl = null;
    try {
      finalUrl = new URL(String(result.url || ''), USERSIDE_ORIGIN);
    } catch {}

    const redirectedToCustomer = Boolean(
      result.redirected
      && finalUrl?.origin === USERSIDE_ORIGIN
      && id
      && (
        finalUrl.pathname === `/customer/${id}`
        || finalUrl.searchParams.get('customer_id') === id
        || finalUrl.searchParams.get('id') === id
      )
    );
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scriptedCustomerRedirect = Boolean(
      id
      && new RegExp(
        `(?:location(?:\\.href)?|location\\.replace\\s*\\()\\s*(?:=\\s*)?["'][^"']*\\/customer\\/${escapedId}(?:[^"']*)["']`,
        'i'
      ).test(html)
    );
    const successMessage = responseMessage(documentNode, html, {
      allowBodyMatch: html.length > 0 && html.length < 20000
    });

    if (redirectedToCustomer || scriptedCustomerRedirect || successMessage) {
      return {
        status: 'success',
        message: successMessage || 'Звонок зарегистрирован'
      };
    }

    return {
      status: 'unknown',
      message: 'UserSide ответил, но сохранение не подтверждено. Проверь запись в карточке абонента.'
    };
  }

  function reliablePhone(caseData = {}) {
    const candidates = [
      caseData?.profile?.phone,
      caseData?.profile?.mobile,
      caseData?.identity?.phone,
      caseData?.contact?.phone
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || !('value' in candidate)) continue;
      const phone = String(candidate.value || '').trim();
      const confidence = Number(candidate.confidence || 0);
      const source = String(candidate.source || '');
      if (
        phone
        && phone.length <= 35
        && confidence >= 0.9
        && /userside|customer|card/i.test(source)
      ) return phone;
    }
    return '';
  }

  async function extensionRequest(type, payload) {
    try {
      const response = await chrome.runtime.sendMessage({ type, payload });
      if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
      return response.data;
    } catch (error) {
      if (/Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error))) {
        WB.runtime?.invalidateExtensionContext?.(error?.message || String(error));
      } else {
        // CALL business/lookup errors are recoverable and are rendered inside the
        // compact dialog. They must not trigger the global fatal Workbench screen.
        WB.log?.error?.('CALL', `request ${String(type || 'REQUEST')} failed`, {
          message: String(error?.message || error || '')
        });
      }
      throw error;
    }
  }

  function pbxCallLabel(call) {
    call = call && typeof call === 'object' ? call : {};
    const when = call.time || [call.date, call.time].filter(Boolean).join(' ') || '—';
    const caller = call.callerMasked || 'номер не определён';
    const duration = call.duration || '—';
    const agent = call.agentExtension || '';
    return agent
      ? `${when} · ${duration} · ${caller} · оп.${agent}`
      : `${when} · ${duration} · ${caller}`;
  }

  const REASON_LABELS = {
    'first-new': 'новый абонент сразу после начала звонка',
    'userside+billing': 'открыты UserSide и Billing',
    'repeat-visits': 'несколько возвратов к абоненту',
    'heavy-focus': 'активная работа с карточкой',
    'contract-match': 'совпал договор',
    'customer-match': 'UserSide call_list указал этого абонента',
    'ip-match': 'совпал IP',
    'phone-match': 'совпал телефон',
    'current-case': 'текущий абонент в Workbench',
    'mid-call-open': 'открыт во время звонка',
    'pre-call-open': 'был открыт ещё до звонка (−)',
    'late-only': 'появился ближе к концу (−)',
    'recent-revisit': 'случайный возврат (−)',
    'already-open-then-return': 'уже был открыт, потом снова',
    'search-then-open': 'после поиска открыт этот абонент',
    'search-result-opened': 'выбран результат поиска этого абонента',
    'search-unique-resolved': 'единственный результат autocomplete',
    'post-call-open': 'карточка открыта в течение 15 секунд после звонка',
    'handoff': 'переход между системами по этому абоненту',
    'hard-customer-conflict': 'конфликт с CUSTOMER из call_list'
  };

  function scoreToPercent(score) {
    const s = Math.max(0, Number(score) || 0);
    if (s <= 0) return 0;
    // Soft curve: 50≈46%, 90≈68%, 143≈83%, 200≈92%, cap 99.
    return Math.min(99, Math.round(100 * (1 - Math.exp(-s / 80))));
  }

  function matchPercent(call) {
    const match = call?.match || {};
    if (match.level === 'conflict') return 0;
    if (Number.isFinite(Number(match.confidence))) return Math.max(0, Math.min(100, Math.round(Number(match.confidence))));
    const exact = new Set(Array.isArray(match.matchedBy) ? match.matchedBy : []);
    if (exact.has('customer') || exact.has('contract')) return 100;
    if (exact.has('ip')) return 99;
    return scoreToPercent(Number(match.correlationScore || 0));
  }

  const SCORE_FORMULA_HINT = [
    'Формула совпадения (timeline + признаки):',
    '• +100 новый абонент сразу после начала звонка',
    '• +40 открыт во время звонка',
    '• +45 UserSide + Billing',
    '• +30 несколько возвратов · +15 активная работа',
    '• точный UserSide CUSTOMER / договор / IP — строгая привязка',
    '• +80 совпал договор · +80 совпал IP · +35 телефон',
    '• +65 SUBMIT поиска → карточка · +110 SUBMIT → INFO точного результата',
    '• −40 был открыт до звонка · −20 только в конце · −25 случайный возврат',
    'Процент берётся из frozen snapshot по абсолютной шкале scoringVersion=1.'
  ].join('\n');

  function reasonText(call) {
    call = call && typeof call === 'object' ? call : {};
    const reasons = Array.isArray(call.match?.correlationReasons)
      ? call.match.correlationReasons
      : [];
    const classic = Array.isArray(call.match?.matchedBy) ? call.match.matchedBy : [];
    const conflicts = Array.isArray(call.match?.conflicts) ? call.match.conflicts : [];
    const identityLabel = v => ({ customer: 'UserSide CUSTOMER', contract: 'договор', ip: 'IP', phone: 'телефон' })[v] || v;
    const parts = [
      ...conflicts.map(v => `КОНФЛИКТ: ${identityLabel(v)}`),
      ...reasons.map(r => REASON_LABELS[r] || r),
      ...classic.map(identityLabel)
    ];
    const searchQuery = compact(call.match?.correlationSearch?.query || '', 80);
    if (searchQuery) parts.push(`поиск: “${searchQuery}”`);
    const score = Number(call.match?.correlationScore || 0);
    const pct = matchPercent(call);
    if (!parts.length && score <= 0) return '';
    const head = pct > 0 ? `${pct}%` : '';
    return [head, ...parts].filter(Boolean).join(' · ');
  }

  function prettySearchQuery(query = '', searchKind = '') {
    const text = compact(query, 180);
    if (!text) return '';
    const fields = {};
    for (const part of text.split(';')) {
      const at = part.indexOf('=');
      if (at <= 0) continue;
      const key = part.slice(0, at).trim();
      const value = part.slice(at + 1).trim();
      if (key && value) fields[key] = value;
    }
    if (searchKind === 'address') {
      const street = fields.dopfield_5 || '';
      const house = fields.dopfield_6 || '';
      const block = fields.dopfield_11 || '';
      const apartment = fields.dopfield_8 || '';
      const parts = [street];
      if (house) parts.push(`дом ${house}${block || ''}`);
      if (apartment) parts.push(`кв. ${apartment}`);
      const human = parts.filter(Boolean).join(', ');
      if (human) return human;
    }
    if (searchKind === 'contract' && fields.name) return fields.name;
    return text;
  }

  function callSearchAudit(call) {
    const audit = call?.match?.currentCaseSearch || {};
    const status = String(audit.status || 'none');
    const source = audit.source === 'billing' ? 'Billing' : audit.source === 'userside' ? 'UserSide' : '';
    const kind = audit.searchKind === 'address'
      ? 'по адресу'
      : audit.searchKind === 'contract'
        ? 'по договору'
        : audit.searchKind === 'global'
          ? 'глобальный поиск'
          : 'поиск';
    const query = prettySearchQuery(audit.query || '', audit.searchKind || '');
    const attempts = Math.max(0, Number(audit.attempts || 0));
    const lines = [];
    if (status === 'confirmed') {
      lines.push('Поиск этого абонента во время звонка: ДА');
      if (source) lines.push(`${source} · ${kind}`);
      if (query) lines.push(`Запрос: ${query}`);
      if (attempts > 1) lines.push(`Попыток поиска: ${attempts}`);
      lines.push('✓ SUBMIT → INFO текущего абонента');
      lines.push('✓ открыта эта же карточка');
      return { tone: 'confirmed', title: lines.join('\n') };
    }
    if (status === 'result-opened') {
      lines.push('Поиск этого абонента во время звонка: почти подтверждён');
      if (source) lines.push(`${source} · ${kind}`);
      if (query) lines.push(`Запрос: ${query}`);
      if (attempts > 1) lines.push(`Попыток поиска: ${attempts}`);
      lines.push('✓ выбран INFO текущего абонента');
      lines.push('— открытие карточки не успело подтвердиться');
      return { tone: 'likely', title: lines.join('\n') };
    }
    if (status === 'search-then-open') {
      lines.push('Поиск во время звонка был');
      if (source) lines.push(`${source} · ${kind}`);
      if (query) lines.push(`Запрос: ${query}`);
      if (attempts > 1) lines.push(`Попыток поиска: ${attempts}`);
      lines.push('✓ после поиска открыта эта карточка');
      lines.push('— точный клик INFO не зафиксирован');
      return { tone: 'likely', title: lines.join('\n') };
    }
    if (status === 'attempted') {
      lines.push('Во время звонка поиск выполнялся');
      if (source) lines.push(`${source} · ${kind}`);
      if (query) lines.push(`Последний запрос: ${query}`);
      if (attempts) lines.push(`Попыток: ${attempts}`);
      lines.push('Но выбор именно этого абонента не подтверждён.');
      return { tone: 'attempted', title: lines.join('\n') };
    }
    return {
      tone: 'none',
      title: 'Поиск этого абонента во время данного звонка не зафиксирован.'
    };
  }

  function callSearchAuditBadge(call) {
    const audit = callSearchAudit(call);
    return `<span class="search-audit-tip ${esc(audit.tone)}" title="${esc(audit.title)}" aria-label="Проверка поиска абонента">?</span>`;
  }

  function candidatePercent(candidate = {}) {
    return Math.max(0, Math.min(100, Math.round(Number(candidate.confidence || 0))));
  }

  function registrationStateOf(binding = null) {
    if (!binding) return 'unknown';
    if (binding.registrationState) return String(binding.registrationState);
    if (binding.registrationStatus && typeof binding.registrationStatus === 'object') {
      return String(binding.registrationStatus.state || 'unknown');
    }
    const raw = String(binding.registrationStatus || 'unknown');
    return raw === 'bound' ? 'unknown' : raw;
  }

  function candidateSearchAudit(candidate = {}) {
    const audit = candidate.searchAudit || {};
    const status = String(audit.status || 'none');
    const source = audit.source === 'billing' ? 'Billing' : audit.source === 'userside' ? 'UserSide' : '';
    const kind = audit.searchKind === 'address' ? 'по адресу'
      : audit.searchKind === 'contract' ? 'по договору'
        : audit.searchKind === 'global' ? 'глобальный поиск' : 'поиск';
    const query = prettySearchQuery(audit.query || candidate.searchEvidence?.query || '', audit.searchKind || candidate.searchEvidence?.searchKind || '');
    const attempts = Math.max(0, Number(audit.attempts || 0));
    const lines = [];
    if (['confirmed', 'result-opened', 'search-then-open'].includes(status)) {
      lines.push('Поиск этого кандидата во время звонка: ДА');
      if (source) lines.push(`${source} · ${kind}`);
      if (query) lines.push(`Запрос: ${query}`);
      if (attempts > 1) lines.push(`Попыток поиска: ${attempts}`);
      if (audit.resultOpened) lines.push('✓ SUBMIT → INFO этого абонента');
      if (audit.cardConfirmed) lines.push('✓ открыта эта же карточка');
      return { tone: status === 'confirmed' ? 'confirmed' : 'likely', title: lines.join('\n') };
    }
    if (status === 'attempted') {
      lines.push('Во время звонка поиск выполнялся');
      if (source) lines.push(`${source} · ${kind}`);
      if (query) lines.push(`Последний запрос: ${query}`);
      lines.push('Выбор именно этого кандидата не подтверждён.');
      return { tone: 'attempted', title: lines.join('\n') };
    }
    return { tone: 'none', title: 'Поиск именно этого кандидата во время звонка не зафиксирован.' };
  }

  function candidateSearchBadge(candidate = {}) {
    const audit = candidateSearchAudit(candidate);
    return `<span class="search-audit-tip ${esc(audit.tone)}" title="${esc(audit.title)}" aria-label="Проверка поиска кандидата">?</span>`;
  }

  function phoneFromPbxCall(call) {
    call = call && typeof call === 'object' ? call : {};
    const raw = String(call.callerId || '').replace(/\D+/g, '');
    if (!raw || raw.length < 6 || raw.length > 15) return '';
    // Prefer national UA form 0XXXXXXXXX when possible.
    if (/^380\d{9}$/.test(raw)) return `0${raw.slice(3)}`;
    if (/^80\d{9}$/.test(raw)) return `0${raw.slice(2)}`;
    if (/^0\d{9}$/.test(raw)) return raw;
    if (/^\d{9}$/.test(raw)) return `0${raw}`;
    return raw;
  }

  const TOPIC_THEMES = [
    {
      keys: ['авар', 'аварi', 'аварі'],
      tone: 'danger',
      short: 'Авария',
      svg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2L1 21h22L12 2zm0 4.5l7.5 13h-15L12 6.5z"/><rect x="11" y="10" width="2" height="5.5" rx="1" fill="#fff"/><circle cx="12" cy="17.5" r="1.2" fill="#fff"/></svg>'
    },
    {
      keys: ['тех', 'техн'],
      tone: 'tech',
      short: 'Тех. вопрос',
      svg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M22.7 19.3l-1.4 1.4c-.4.4-1 .4-1.4 0L12 12.8l-2.1 2.1 1.6 1.6c.4.4.4 1 0 1.4l-1.4 1.4c-.4.4-1 .4-1.4 0L3.4 13.9c-.4-.4-.4-1 0-1.4l1.4-1.4c.4-.4 1-.4 1.4 0l1.6 1.6 2.1-2.1-1.6-1.6c-.4-.4-.4-1 0-1.4l1.4-1.4c.4-.4 1-.4 1.4 0l5.4 5.4 2.1-2.1-1.6-1.6c-.4-.4-.4-1 0-1.4l1.4-1.4c.4-.4 1-.4 1.4 0l5.3 5.3c.4.4.4 1 0 1.4z"/></svg>'
    },
    {
      keys: ['фін', 'фин', 'финанс', 'грош', 'оплат'],
      tone: 'money',
      short: 'Финансы',
      svg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm1.1 15.3h-2.2v-1.1c-1.3-.2-2.4-.9-2.6-2.2h1.7c.1.5.5.9 1.4.9.8 0 1.3-.4 1.3-1 0-.7-.5-1-1.6-1.3-1.6-.4-2.7-1.1-2.7-2.6 0-1.3.9-2.2 2.3-2.4V7.3h2.2v1.1c1.2.2 2 1 2.2 2.1h-1.7c-.1-.5-.5-.8-1.2-.8-.7 0-1.2.3-1.2.9 0 .6.5.9 1.7 1.2 1.7.5 2.6 1.2 2.6 2.7 0 1.4-1 2.3-2.4 2.5v1.3z"/></svg>'
    },
    {
      keys: ['mac', 'мак', 'реєстрац', 'регистрац'],
      tone: 'mac',
      short: 'MAC',
      svg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 7h3V5H4c-1.1 0-2 .9-2 2v3h2V7zm0 12h3v-2H4v-3H2v3c0 1.1.9 2 2 2zm16 0c1.1 0 2-.9 2-2v-3h-2v3h-3v2h3zM20 5h-3v2h3v3h2V7c0-1.1-.9-2-2-2zM8 9h8v6H8V9z"/></svg>'
    },
    {
      keys: ['проч', 'інш', 'ино', 'other'],
      tone: 'other',
      short: 'Прочее',
      svg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="6" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="18" cy="12" r="2.2" fill="currentColor"/></svg>'
    }
  ];

  function topicThemeFor(label = '') {
    const lower = String(label || '').toLowerCase();
    for (const theme of TOPIC_THEMES) {
      if (theme.keys.some(k => lower.includes(k))) return theme;
    }
    return {
      tone: 'other',
      short: compact(label, 18) || 'Тема',
      svg: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.2" fill="currentColor"/></svg>'
    };
  }

  function topicIconButtons(options = [], selected = '') {
    return `<div class="topic-grid" role="group" aria-label="Тип обращения">
      ${options.map(option => {
        const value = String(option.value ?? '');
        if (!value || value === '0' || value === '—') return '';
        const active = value === String(selected);
        const theme = topicThemeFor(option.label);
        const label = theme.short || compact(option.label || value, 22);
        return `<button type="button" class="topic-btn tone-${theme.tone}${active ? ' active' : ''}" data-action="pick-topic" data-topic-value="${esc(value)}" title="${esc(option.label || label)}"><span class="topic-label">${esc(label)}</span></button>`;
      }).join('')}
    </div>`;
  }

  class CallRegistration {
    constructor() {
      this.enabled = true;
      this.host = null;
      this.shadow = null;
      this.model = null;
      this.caseSnapshot = null;
      this.pbxCalls = [];
      this.focusCall = null;
      this.focusSnapshot = null;
      this.focusCandidates = [];
      this.currentCaseCandidate = null;
      this.dayCalls = [];
      this.historyFocusCallKey = '';
      this.pbxBinding = null;
      this.pbxLoadError = '';
      this.pbxFreshNote = '';
      this.assignmentLog = [];
      this.takenCalls = [];
      this.binding = false;
      this.overrideConfirmedCallKey = '';
      this.generation = 0;
      this.saving = false;
      this.boundKeydown = this.onKeydown.bind(this);
      this.boundModuleOpen = event => {
        if (event?.detail?.module !== 'call' && this.host && !this.saving) this.close();
      };
      window.addEventListener('simnet-workbench-module-open', this.boundModuleOpen);
      this.unsubStore = WB.bus.on('store:state', () => this.guardCurrentCase());
    }

    caseMatchesSnapshot() {
      if (!this.caseSnapshot) return false;
      // Global CALL view is intentionally independent from the page Case.
      if (!this.caseSnapshot.caseId) return true;
      const current = WB.store.activeCase?.() || null;
      return Boolean(
        current
        && String(current.id || '') === this.caseSnapshot.caseId
        && (
          !this.caseSnapshot.customerId
          || customerIdOf(current.identity?.customerId) === this.caseSnapshot.customerId
        )
      );
    }

    guardCurrentCase() {
      if (!this.host || !this.caseSnapshot || !this.caseSnapshot.caseId || this.caseMatchesSnapshot()) return;
      // Do not silently retarget an already opened registration form. The global
      // button may still be opened again and will route to the proper target.
      this.model = null;
      this.saving = false;
      this.renderDecision({ kind: 'warn', message: 'Текущая вкладка изменилась. Выбери звонок заново — Workbench переведёт на нужного абонента.' });
    }

    mount() {
      this.host?.remove();
      this.host = document.createElement('div');
      this.host.id = HOST_ID;
      this.host.dataset.simnetWbOwned = 'call-registration';
      Object.assign(this.host.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647'
      });
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `${this.styles()}<div class="backdrop" data-action="backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="sw-call-title"><div class="surface"></div></section></div>`;
      this.shadow.addEventListener('click', event => this.onClick(event));
      this.shadow.addEventListener('submit', event => this.onSubmit(event));
      document.addEventListener('keydown', this.boundKeydown, true);
      document.documentElement.appendChild(this.host);
    }

    styles() {
      return `<style>
        :host{all:initial;color-scheme:light;--plum:#A50046;--plum-hover:#870039;--plum-soft:#FFF1F6}
        *{box-sizing:border-box}
        .backdrop{
          width:100%;height:100%;display:grid;place-items:center;
          padding:24px;background:rgba(22,29,41,.34);
          backdrop-filter:blur(2px) saturate(.9);
          font:13px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1D2939;
          animation:fade-in .16s ease both
        }
        .dialog{
          width:min(560px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;
          border:1px solid #E4E7EC;border-radius:18px;background:#fff;
          box-shadow:0 28px 80px rgba(16,24,40,.24),0 2px 8px rgba(16,24,40,.08);
          animation:dialog-in .18s ease both
        }
        .head{display:flex;gap:12px;align-items:flex-start;padding:18px 20px 15px;border-bottom:1px solid #EAECF0;background:linear-gradient(180deg,#fff,#FFFCFD)}
        .mark{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:var(--plum);color:#fff;font-size:19px;box-shadow:0 7px 16px rgba(165,0,70,.20)}
        .title{min-width:0;flex:1}.title h2{margin:0;color:#1D2939;font-size:17px;letter-spacing:-.015em}.title p{margin:4px 0 0;color:#667085;font-size:12px;font-weight:400}.title p .subscriber-name{color:#344054;font-weight:800}.title p .subscriber-contract{font-weight:400}
        .close{width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:#667085;font-size:22px;cursor:pointer}.close:hover{background:#F2F4F7;color:#344054}
        form,.content{display:grid;gap:14px;padding:18px 20px 20px}
        label{display:grid;gap:6px;color:#475467;font-size:12px;font-weight:700}
        select,textarea,input{
          width:100%;border:1px solid #D0D5DD;border-radius:10px;background:#fff;color:#1D2939;
          padding:10px 11px;font:13px/1.4 inherit;outline:none;box-shadow:0 1px 2px rgba(16,24,40,.03)
        }
        select:focus,textarea:focus,input:focus{border-color:#C34C7D;box-shadow:0 0 0 3px rgba(165,0,70,.10)}
        option{background:#fff;color:#1D2939}textarea{min-height:122px;resize:vertical}
        .required{color:#D92D20}.hint{margin:-3px 0 0;color:#98A2B3;font-size:11px;line-height:1.45}
        .status{padding:10px 11px;border:1px solid #E4E7EC;border-radius:10px;background:#F9FAFB;color:#475467}
        .status.error{border-color:#FECDCA;background:#FEF3F2;color:#B42318}.status.warn{border-color:#FEDF89;background:#FFFAEB;color:#B54708}.status.success{border-color:#ABEFC6;background:#ECFDF3;color:#067647;font-weight:750}
        .pbx-card{display:grid;gap:10px;padding:12px;border:1px solid #FEDF89;border-radius:12px;background:#FFFAEB}
        .pbx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;color:#7A2E0E;font-weight:800}
        .pbx-mode{flex:0 0 auto;border-radius:999px;background:#F79009;color:#fff;padding:3px 7px;font-size:9px;letter-spacing:.04em}
        .pbx-help{color:#8A4B19;font-size:11px;line-height:1.45}
        .pbx-actions{display:flex;gap:8px;flex-wrap:wrap}
        .pbx-actions .action{padding:8px 11px}.pbx-empty{color:#8A4B19;font-size:11px}
        .actions{display:flex;justify-content:flex-end;gap:9px;margin-top:2px}
        button.action{border:1px solid #D0D5DD;border-radius:10px;padding:9px 15px;background:#fff;color:#344054;font:700 12px/1.2 inherit;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.04)}
        button.action:hover{background:#F9FAFB;border-color:#98A2B3}button.action.warning{border-color:#F79009;background:#FFF7E8;color:#9A3412}button.action.warning:hover{border-color:#DC6803;background:#FFFAEB;color:#7A2E0E}button.action.primary{border-color:var(--plum);background:var(--plum);color:#fff;box-shadow:0 5px 14px rgba(165,0,70,.18)}button.action.primary:hover{background:var(--plum-hover)}
        button:disabled{opacity:.55;cursor:wait}.loader{width:22px;height:22px;margin:12px auto;border:2px solid #EAECF0;border-top-color:var(--plum);border-radius:50%;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}@keyframes fade-in{from{opacity:0}}@keyframes dialog-in{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}
        @media(max-width:560px){.backdrop{padding:12px}.dialog{width:calc(100vw - 24px);max-height:calc(100vh - 24px)}}
        @media(prefers-reduced-motion:reduce){.backdrop,.dialog{animation:none!important}}
        .topic-grid{display:flex;flex-wrap:wrap;gap:6px}
        .topic-btn{
          display:inline-flex;align-items:center;justify-content:center;
          min-width:0;border:1px solid #E4E7EC;border-radius:999px;padding:5px 11px;
          background:#F9FAFB;color:#344054;font:650 11px/1.2 inherit;cursor:pointer;
          box-shadow:none;transition:background .12s ease,border-color .12s ease,color .12s ease
        }
        .topic-btn:hover{background:#F2F4F7;border-color:#D0D5DD}
        .topic-btn .topic-label{max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
        .topic-btn.tone-danger{background:#FEF3F2;color:#B42318;border-color:#FECDCA}
        .topic-btn.tone-tech{background:#EFF8FF;color:#175CD3;border-color:#B2DDFF}
        .topic-btn.tone-money{background:#ECFDF3;color:#067647;border-color:#ABEFC6}
        .topic-btn.tone-mac{background:#F4F3FF;color:#5925DC;border-color:#D9D6FE}
        .topic-btn.tone-other{background:#F9FAFB;color:#475467;border-color:#E4E7EC}
        .topic-btn.active{background:#FFF1F6;border-color:var(--plum);color:var(--plum);box-shadow:0 0 0 2px rgba(165,0,70,.12)}
        .topic-btn.active .topic-label{color:var(--plum)}
        .status.success{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
        .status .match-pct{font-weight:800;letter-spacing:.02em}
        .status .formula-tip{position:relative;display:inline-flex;align-items:center}
        .status .formula-btn{
          width:18px;height:18px;border:1px solid #ABEFC6;border-radius:50%;
          background:#fff;color:#067647;font:700 11px/1 inherit;cursor:help;padding:0
        }
        .status .formula-pop{
          display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:6;
          width:min(320px,calc(100vw - 64px));white-space:pre-line;text-align:left;
          border:1px solid #E4E7EC;border-radius:10px;background:#fff;color:#344054;
          box-shadow:0 12px 28px rgba(16,24,40,.14);padding:10px 12px;font:11px/1.4 inherit;font-weight:500
        }
        .status .formula-tip:hover .formula-pop,.status .formula-tip:focus-within .formula-pop{display:block}
        .call-item .pct-badge{
          flex:0 0 auto;margin-left:auto;font:700 10px/1 inherit;color:#067647;
          background:#D1FADF;border-radius:999px;padding:2px 6px
        }
        .call-item .call-badges{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;margin-left:auto}
        .call-item .call-badges .pct-badge{margin-left:0}
        .call-item .search-audit-tip{
          display:inline-grid;place-items:center;width:16px;height:16px;box-sizing:border-box;
          border:1px solid #D0D5DD;border-radius:50%;background:#fff;color:#667085;
          font:800 10px/1 inherit;cursor:help
        }
        .call-item .search-audit-tip.confirmed{border-color:#6CE9A6;background:#ECFDF3;color:#067647}
        .call-item .search-audit-tip.likely{border-color:#FEDF89;background:#FFFAEB;color:#B54708}
        .call-item .search-audit-tip.attempted{border-color:#B2DDFF;background:#EFF8FF;color:#175CD3}
        .call-item.secondary .pct-badge{color:#344054;background:#E7F8EF}
        .call-item.conflict .pct-badge{color:#B42318;background:#FEE4E2}
        .call-item:not(.strong):not(.secondary):not(.conflict) .pct-badge{color:#667085;background:#F2F4F7}
        .pbx-card{border-color:#E4E7EC;background:#F9FAFB}
        .pbx-head{color:#344054}
        .pbx-mode{background:#667085}
        .focus-tools{display:inline-flex;align-items:center;gap:6px}
        .focus-refresh{width:26px;height:26px;border:1px solid #D0D5DD;border-radius:8px;background:#fff;color:#475467;font:800 14px/1 inherit;cursor:pointer}
        .focus-refresh:hover{border-color:#98A2B3;background:#F2F4F7}
        .focus-call{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #E4E7EC;border-radius:10px;background:#fff}
        .focus-call-main{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#1D2939;font-weight:750}
        .focus-call-main .sep{color:#D0D5DD}.focus-window{color:#667085;font-size:10px;font-weight:600}
        .focus-state{flex:0 0 auto;border-radius:999px;padding:3px 7px;font-size:9px;font-weight:800;white-space:nowrap}
        .focus-state.registered{background:#D1FADF;color:#067647}.focus-state.open{background:#F2F4F7;color:#475467}.focus-state.ongoing{background:#EFF8FF;color:#175CD3}.focus-state.review{background:#FFFAEB;color:#B54708}
        .candidate-head{display:flex;align-items:center;justify-content:space-between;color:#667085;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.035em}
        .subscriber-candidates{display:grid;gap:5px}
        .subscriber-candidate{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 8px;border:1px solid #E4E7EC;border-radius:10px;background:#fff}
        .subscriber-candidate.current{border-color:#C34C7D;box-shadow:0 0 0 2px rgba(165,0,70,.08)}
        .subscriber-candidate.strong{background:#F6FEF9;border-color:#ABEFC6}.subscriber-candidate.secondary{background:#FCFCFD}.subscriber-candidate.weak{background:#fff}
        .candidate-rank{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#F2F4F7;color:#667085;font-size:10px;font-weight:800}
        .subscriber-candidate.strong .candidate-rank{background:#D1FADF;color:#067647}
        .candidate-bind{width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;font:900 13px/1 inherit;cursor:pointer}.candidate-bind:hover{background:rgba(165,0,70,.10);color:var(--plum)}.candidate-bind.conflict{color:#B42318}
        .candidate-body{min-width:0}.candidate-title{display:flex;align-items:center;gap:6px;min-width:0;color:#344054}.candidate-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
        .current-chip{flex:0 0 auto;border-radius:999px;background:#FFF1F6;color:var(--plum);padding:2px 5px;font-size:8px;font-weight:800}
        .candidate-meta{margin-top:1px;color:#667085;font-size:9px}.candidate-why{margin-top:2px;color:#667085;font-size:9px;line-height:1.25}
        .candidate-score{display:flex;align-items:center;gap:5px;color:#067647;font-size:11px;font-weight:850}.subscriber-candidate.weak .candidate-score{color:#667085}
        .subscriber-candidate .search-audit-tip{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid #D0D5DD;border-radius:50%;background:#fff;color:#667085;font:800 10px/1 inherit;cursor:help}
        .subscriber-candidate .search-audit-tip.confirmed{border-color:#6CE9A6;background:#ECFDF3;color:#067647}.subscriber-candidate .search-audit-tip.likely{border-color:#FEDF89;background:#FFFAEB;color:#B54708}.subscriber-candidate .search-audit-tip.attempted{border-color:#B2DDFF;background:#EFF8FF;color:#175CD3}
        .candidate-empty{padding:10px;border:1px dashed #D0D5DD;border-radius:10px;background:#fff;color:#667085;font-size:10px;text-align:center}
        .current-case-note{padding:7px 9px;border-radius:9px;font-size:10px}.current-case-note.ok{background:#ECFDF3;color:#067647}.current-case-note.warn{background:#FFFAEB;color:#B54708}.current-case-note.live{background:#EFF8FF;color:#175CD3}
        select option.match-strong{background:#D1FADF;color:#054F31;font-weight:700}
        select option.match-secondary{background:#ECFDF3;color:#067647}
        .match-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:#667085;margin-top:2px}
        .match-legend .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
        .match-legend .strong{background:#12B76A}
        .match-legend .secondary{background:#6CE9A6}
        .call-list{display:grid;gap:4px;max-height:220px;overflow:auto;padding:2px;border:1px solid #E4E7EC;border-radius:12px;background:#fff}
        .call-item{
          display:grid;gap:1px;text-align:left;border:1px solid transparent;border-radius:8px;
          padding:5px 9px;background:#fff;color:#1D2939;font:11px/1.3 inherit;cursor:pointer
        }
        .call-item:hover{background:#F9FAFB}
        .call-item.selected{border-color:#C34C7D;box-shadow:0 0 0 2px rgba(165,0,70,.12)}
        .call-item.strong{background:#ECFDF3;border-color:#ABEFC6}
        .call-item.strong.selected{border-color:#12B76A;box-shadow:0 0 0 2px rgba(18,183,106,.18)}
        .call-item.secondary{background:#F6FEF9}
        .call-item.conflict{background:#FEF3F2;border-color:#FECDCA}
        .call-item .row{display:flex;align-items:center;justify-content:space-between;gap:6px}
        .call-item .call-main{display:inline-flex;align-items:center;gap:5px;min-width:0}
        .call-item .mark{display:inline-flex;align-items:center;flex:0 0 auto;color:#12B76A;line-height:0}
        .call-item.secondary .mark{color:#32D583}
        .call-item .phone-mark{display:block}
        .call-item .call-label{min-width:0}
        .call-item .meta{color:#667085;font-size:10px}
        .call-item .why{color:#067647;font-size:10px;line-height:1.3}
        .call-item.secondary .why{color:#344054}
        .call-item.conflict .why{color:#B42318}
        .call-item:not(.strong):not(.secondary):not(.conflict) .why{color:#98A2B3}
        .pbx-fresh{font-size:11px;color:#667085}
        .pbx-fresh.warn{color:#B54708}
        .pbx-head{position:relative}
        .hist-wrap{position:relative;flex:0 0 auto}
        .hist-btn{
          width:28px;height:28px;border:1px solid #D0D5DD;border-radius:8px;background:#fff;
          color:#475467;font-size:13px;cursor:pointer;line-height:1
        }
        .hist-btn:hover,.hist-wrap:focus-within .hist-btn,.hist-wrap:hover .hist-btn{border-color:#98A2B3;background:#F9FAFB}
        .hist-pop{
          display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:5;
          width:min(360px,calc(100vw - 64px));max-height:220px;overflow:auto;
          border:1px solid #E4E7EC;border-radius:12px;background:#fff;
          box-shadow:0 12px 32px rgba(16,24,40,.16);padding:8px
        }
        .hist-wrap:hover .hist-pop,.hist-wrap:focus-within .hist-pop{display:block}
        .hist-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.hist-pop h4{margin:0;font-size:11px;color:#667085;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        .hist-latest,.hist-focus,.hist-audit{border:1px solid #D0D5DD;border-radius:7px;background:#fff;color:#475467;font:700 9px/1 inherit;cursor:pointer;padding:4px 6px}.hist-focus{padding:3px 5px}.hist-latest:hover,.hist-focus:hover,.hist-audit:hover{background:#F2F4F7}
        .hist-table tr.active td{background:#FFF7FA}.hist-table tr.active td:first-child{box-shadow:inset 2px 0 0 var(--plum)}
        .hist-table{width:100%;border-collapse:collapse;font-size:11px;color:#344054}
        .hist-table th{text-align:left;color:#98A2B3;font-weight:600;padding:3px 4px;border-bottom:1px solid #F2F4F7}
        .hist-table td{padding:4px;border-bottom:1px solid #F9FAFB;vertical-align:top}
        .hist-empty{color:#98A2B3;font-size:11px;padding:6px}
        .call-item.taken{opacity:.55;cursor:not-allowed}
        .focus-target{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border:1px solid #E4E7EC;border-radius:11px;background:#fff}
        .focus-target-main{min-width:0}.focus-target-kicker{color:#98A2B3;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.focus-target-name{margin-top:2px;color:#1D2939;font-size:13px;font-weight:850;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.focus-target-meta{margin-top:2px;color:#667085;font-size:10px}
        .focus-target-score{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;color:#067647;font-size:13px;font-weight:900}.focus-target-score.weak{color:#B54708}.focus-target-score.none{color:#98A2B3}
        .focus-outcome{margin-top:6px;padding:6px 8px;border:1px solid #ABEFC6;border-radius:8px;background:#ECFDF3;color:#067647;font-size:10px;font-weight:800}
        .focus-info{display:inline-grid;place-items:center;width:17px;height:17px;border:1px solid #D0D5DD;border-radius:50%;background:#fff;color:#667085;font:800 10px/1 inherit;cursor:help}
        .decision{display:grid;gap:12px;padding:18px 20px 20px}.decision-actions{display:grid;gap:8px}.decision-row{display:flex;gap:8px;flex-wrap:wrap}.decision-title{color:#344054;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.decision-note{color:#667085;font-size:11px;line-height:1.45}.task-choice{flex:1 1 150px;border:1px solid #D0D5DD;border-radius:10px;padding:9px 11px;background:#fff;color:#344054;font:750 11px/1.2 inherit;cursor:pointer}.task-choice:hover{border-color:#C34C7D;background:#FFF7FA;color:var(--plum)}
        .route-primary{width:100%;border:1px solid var(--plum);border-radius:10px;padding:10px 12px;background:var(--plum);color:#fff;font:800 12px/1.2 inherit;cursor:pointer}.route-primary:hover{background:var(--plum-hover)}
        .phone-inline{color:#475467;font-weight:750}.call-live-chip{border-radius:999px;background:#EFF8FF;color:#175CD3;padding:2px 6px;font-size:9px;font-weight:800}
      </style>`;
    }

    header() {
      const fullName = String(this.caseSnapshot?.fullName || '').trim();
      const contract = String(this.caseSnapshot?.contract || '').trim();
      const cid = this.caseSnapshot?.customerId ? ` · id ${this.caseSnapshot.customerId}` : '';
      const identity = this.caseSnapshot?.caseId
        ? ([
            fullName ? `<span class="subscriber-name">${esc(fullName)}</span>` : '',
            contract ? `<span class="subscriber-contract">Договор ${esc(contract)}</span>` : ''
          ].filter(Boolean).join(' · ') || esc(this.caseSnapshot?.label || `Customer ID ${this.caseSnapshot?.customerId || '—'}`))
        : '<span class="subscriber-contract">глобальный CALL · текущий/последний звонок</span>';
      return `<div class="head"><div class="mark">☎</div><div class="title"><h2 id="sw-call-title">Регистрация звонка</h2><p>${identity}${esc(cid)}</p></div><button class="close" type="button" data-action="cancel" aria-label="Закрыть">×</button></div>`;
    }

    surface(html) {
      const node = this.shadow?.querySelector('.surface');
      if (node) node.innerHTML = `${this.header()}${html}`;
    }

    renderLoading() {
      this.surface('<div class="content"><div class="status">Получаю актуальную штатную форму UserSide…</div><div class="loader"></div><div class="actions"><button class="action" type="button" data-action="cancel">Отмена</button></div></div>');
    }

    preferredPbxCallKey() {
      const strong = this.pbxCalls.filter(call => (
        call.match?.correlationLevel === 'strong'
        || call.match?.level === 'strong'
      ));
      if (strong.length === 1) return String(strong[0].callKey || '');
      if (strong.length > 1) return String(strong[0].callKey || '');
      const secondary = this.pbxCalls.filter(call => call.match?.correlationLevel === 'secondary');
      if (secondary.length >= 1) return String(secondary[0].callKey || '');
      return '';
    }

    operatorExtensionHint() {
      const counts = new Map();
      for (const call of this.pbxCalls.slice(0, 12)) {
        const ext = String(call.agentExtension || '').trim();
        if (!/^\d{3,6}$/.test(ext)) continue;
        counts.set(ext, (counts.get(ext) || 0) + 1);
      }
      let best = '';
      let bestN = 0;
      for (const [ext, n] of counts) {
        if (n > bestN) { best = ext; bestN = n; }
      }
      return best;
    }

    candidateTooltip(candidate = null) {
      if (!candidate) return 'Абонент не установлен: подтверждённого subscriber evidence пока нет.';
      const pct = candidatePercent(candidate);
      const lines = [`Уверенность: ${pct}%`];
      const reasons = (Array.isArray(candidate.reasons) ? candidate.reasons : [])
        .map(reason => REASON_LABELS[reason] || reason)
        .filter(Boolean);
      if (reasons.length) lines.push(`Основания: ${reasons.join(' · ')}`);
      const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
      for (const event of evidence.slice(0, 8)) {
        const when = Number(event?.ts || 0) ? new Date(Number(event.ts)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        const type = String(event?.type || '').replaceAll('_', ' ').toLowerCase();
        lines.push(`${when ? `${when} · ` : ''}${event?.source || 'crm'} · ${type}`);
      }
      const alternatives = (this.focusCandidates || []).filter(item => item !== candidate).slice(0, 4);
      if (alternatives.length) {
        lines.push('Другие кандидаты:');
        for (const item of alternatives) {
          const label = item.fullName || item.label || item.login || item.customerId || item.billingId || 'кандидат';
          lines.push(`• ${label} — ${candidatePercent(item)}%`);
        }
      }
      return lines.join('\n');
    }

    targetCandidate() {
      const candidates = Array.isArray(this.focusCandidates) ? this.focusCandidates : [];
      const binding = this.focusCall?.binding || this.pbxBinding || null;
      if (binding?.customerId) {
        const bound = candidates.find(candidate => String(candidate.customerId || '') === String(binding.customerId || ''));
        if (bound) return bound;
      }
      return candidates[0] || null;
    }

    pbxPanel() {
      const call = this.focusCall;
      const hist = this.assignmentHistoryMarkup();
      const refreshBtn = '<button type="button" class="focus-refresh" data-action="refresh-focus" title="Обновить call_list" aria-label="Обновить звонок">↻</button>';
      if (!call) {
        const message = this.pbxLoadError
          ? `UserSide call_list недоступен: ${this.pbxLoadError}`
          : 'Мой текущий/последний звонок пока не найден.';
        return `<section class="pbx-card focus-card"><div class="pbx-head"><span>Звонок</span><span class="focus-tools">${refreshBtn}${hist}</span></div><div class="pbx-empty">${esc(message)}</div></section>`;
      }

      const ongoing = call.ongoing === true || String(call.status || '') === 'ongoing' || call.snapshotStatus === 'live';
      const binding = call.binding || null;
      const bindingStatus = registrationStateOf(binding);
      const registered = bindingStatus === 'registered';
      const startMs = Number(call.startedAtMs || 0);
      const endMs = Number(call.endedAtMs || 0) || (startMs + Number(call.durationSeconds || 0) * 1000);
      const hhmmss = ms => {
        if (!Number(ms)) return '—';
        const d = new Date(Number(ms));
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
      };
      const direction = /out|исх|outgoing/i.test(String(call.direction || '')) ? '→' : '←';
      const phone = call.callerMasked || phoneFromPbxCall(call) || 'номер неизвестен';
      const duration = ongoing
        ? `${Math.max(0, Math.floor((Date.now() - startMs) / 1000))} сек`
        : (call.duration || `${Number(call.durationSeconds || 0)} сек`);
      const status = registered
        ? '<span class="focus-state registered">✓ зарегистрирован</span>'
        : ongoing
          ? '<span class="focus-state ongoing">● идёт</span>'
          : bindingStatus === 'review_required'
            ? '<span class="focus-state review">! проверить</span>'
            : '<span class="focus-state open">● не зарегистрирован</span>';

      const target = this.targetCandidate();
      const pct = target ? candidatePercent(target) : 0;
      const targetName = target
        ? (target.fullName || target.label || target.login || (target.contract ? `abon${target.contract}` : `Customer ${target.customerId || target.billingId || ''}`))
        : 'Абонент не установлен';
      const targetMeta = target
        ? [target.contract ? `дог. ${target.contract}` : '', target.login || '', target.customerId ? `US ${target.customerId}` : ''].filter(Boolean).join(' · ')
        : 'Нужен subscriber evidence либо форма потенциального/подключения';
      const scoreTone = !target ? 'none' : pct < 55 ? 'weak' : '';
      const info = `<span class="focus-info" title="${esc(this.candidateTooltip(target))}">i</span>`;
      const liveChip = ongoing ? '<span class="call-live-chip">LIVE</span>' : (call.snapshotStatus === 'frozen' ? '<span class="call-live-chip">FROZEN</span>' : '');
      const freshNote = this.pbxFreshNote ? `<div class="pbx-fresh">${esc(this.pbxFreshNote)}</div>` : '';
      const hiddenKey = call.callKey ? esc(call.callKey) : '';
      const outcome = call.outcome && String(call.outcome.stage || '') === 'created' ? call.outcome : null;
      const outcomeNote = outcome
        ? `<div class="focus-outcome">✓ ${esc(outcome.label || 'Задание создано')}${outcome.taskId ? ` · #${esc(outcome.taskId)}` : ''}</div>`
        : '';

      return `<section class="pbx-card focus-card">
        <div class="pbx-head"><span>Звонок ${liveChip}</span><span class="focus-tools">${refreshBtn}${hist}</span></div>
        <div class="focus-call"><div class="focus-call-main"><span>${esc(direction)} ${esc(phone)}</span><span class="sep">·</span><span class="focus-window">${esc(hhmmss(startMs))}${ongoing ? ' → сейчас' : ` → ${esc(hhmmss(endMs))}`} · ${esc(duration)}</span></div>${status}</div>
        ${freshNote}${outcomeNote}
        <input type="hidden" name="pbx_call_key" value="${hiddenKey}">
        <div class="focus-target">
          <div class="focus-target-main"><div class="focus-target-kicker">Фокус</div><div class="focus-target-name">${esc(targetName)}</div><div class="focus-target-meta">${esc(targetMeta)}</div></div>
          <div class="focus-target-score ${scoreTone}">${target ? `<span>${pct}%</span>` : ''}${info}</div>
        </div>
      </section>`;
    }

    assignmentHistoryMarkup() {
      const rows = Array.isArray(this.dayCalls) ? this.dayCalls : [];
      const body = rows.length
          ? rows.slice(0, 60).map(row => {
            const status = String(row.registrationStatus || 'unknown');
            const icon = status === 'registered' ? '✓' : status === 'ongoing' ? '●' : status === 'review_required' ? '!' : '·';
            const label = status === 'registered'
              ? (row.caseLabel || row.customerId || 'зарегистрирован')
              : status === 'ongoing' ? 'идёт сейчас'
                : status === 'review_required' ? 'проверить'
                  : status === 'unregistered' ? 'не зарегистрирован'
                    : 'регистрация неизвестна';
            const linkState = row.snapshotStatus === 'pending-window'
              ? '⏳'
              : row.snapshotStatus === 'frozen' && Number(row.frozenCandidateCount || 0) > 0
                ? `🔗 ${Number(row.frozenCandidateCount)} · ${Number(row.topConfidence || 0)}%`
                : '—';
            const canFocus = Boolean(row.callKey);
            const rowClass = this.focusCall?.callKey === row.callKey ? ' active' : '';
            const arrow = /out|исх|outgoing/i.test(String(row.direction || '')) ? '→' : '←';
            const focusLabel = row.caseLabel || row.topCandidateLabel || '';
            const outcome = row.outcome && String(row.outcome.stage || '') === 'created' ? row.outcome : null;
            const statusLabel = outcome
              ? `✓ ${outcome.label || 'Задание создано'}${outcome.taskId ? ` · #${outcome.taskId}` : ''}`
              : focusLabel && status !== 'registered'
                ? `${icon} ${focusLabel}${Number(row.topConfidence || 0) ? ` · ${Number(row.topConfidence)}%` : ''}`
                : `${icon} ${label}`;
            return `<tr class="${rowClass}"><td>${esc(row.time || '—')}</td><td>${esc(arrow)} ${esc(row.callerMasked || '—')}</td><td>${esc(row.duration || (status === 'ongoing' ? '…' : '—'))}</td><td>${esc(linkState)}</td><td>${esc(statusLabel)}</td><td>${canFocus ? `<button type="button" class="hist-focus" data-action="focus-history-call" data-call-key="${esc(row.callKey)}" title="Открыть звонок">↗</button>` : ''}</td></tr>`;
          }).join('')
        : '';
      const table = rows.length
        ? `<table class="hist-table"><thead><tr><th>Время</th><th>Номер</th><th>Длит.</th><th>Связь</th><th>Статус</th><th></th></tr></thead><tbody>${body}</tbody></table>`
        : '<div class="hist-empty">Сегодня звонков 6047 пока нет</div>';
      return `<div class="hist-wrap"><button type="button" class="hist-btn" title="Все мои звонки сегодня" aria-label="Все звонки сегодня">▤</button><div class="hist-pop" role="tooltip"><div class="hist-title"><h4>Звонки 6047 сегодня</h4><span>${this.historyFocusCallKey ? '<button type="button" class="hist-latest" data-action="focus-latest-call">Последний</button>' : ''} <button type="button" class="hist-audit" data-action="export-call-audit">⋯ Экспорт CALL audit</button></span></div>${table}</div></div>`;
    }

    taskLaunchUrl(typer = '') {
      const type = String(typer || '').replace(/\D+/g, '');
      if (!['1', '15', '41', '70'].includes(type)) return '';
      const url = new URL('/task/dialog_add', USERSIDE_ORIGIN);
      url.searchParams.set('typer', type);
      const call = this.focusCall || {};
      const context = {
        callKey: String(call.callKey || ''),
        phone: phoneFromPbxCall(call) || '',
        callerMasked: String(call.callerMasked || ''),
        startedAtMs: Number(call.startedAtMs || 0),
        typer: type
      };
      url.hash = `simnet-wb-call=${encodeURIComponent(JSON.stringify(context))}`;
      return url.href;
    }

    renderDecision(notice = null) {
      const status = notice
        ? `<div class="status ${esc(notice.kind || '')}">${esc(notice.message || '')}</div>`
        : '';
      const target = this.targetCandidate();
      const currentTarget = Boolean(this.caseSnapshot?.caseId && this.currentCaseCandidate && target
        && String(this.currentCaseCandidate.customerId || this.currentCaseCandidate.contract || this.currentCaseCandidate.login || '')
          === String(target.customerId || target.contract || target.login || ''));
      let actions = '';
      if (target) {
        const pct = candidatePercent(target);
        const identityPayload = encodeURIComponent(JSON.stringify({
          caseId: target.caseId || '', customerId: target.customerId || '', billingId: target.billingId || '',
          contract: target.contract || '', login: target.login || '', fullName: target.fullName || target.label || ''
        }));
        const tabIds = encodeURIComponent(JSON.stringify((target.evidence || []).map(item => item?.tabId).filter(id => id != null)));
        const label = target.fullName || target.label || target.login || (target.contract ? `abon${target.contract}` : 'абонент');
        actions = currentTarget
          ? `<button type="button" class="route-primary" data-action="load-current-form">Продолжить с ${esc(label)} · ${pct}%</button>`
          : `<button type="button" class="route-primary" data-action="route-target" data-candidate-identity="${esc(identityPayload)}" data-evidence-tabs="${esc(tabIds)}" data-confidence="${pct}">Перейти к ${esc(label)} · ${pct}%</button>`;
      } else {
        actions = `<div class="decision-title">Что оформляем?</div>
          <div class="decision-actions">
            <div class="decision-row"><button type="button" class="task-choice" data-action="open-task-form" data-typer="41">Потенциальный · ЖК</button><button type="button" class="task-choice" data-action="open-task-form" data-typer="70">Потенциальный · ЧС</button></div>
            <div class="decision-row"><button type="button" class="task-choice" data-action="open-task-form" data-typer="1">Подключение · ЖК</button><button type="button" class="task-choice" data-action="open-task-form" data-typer="15">Подключение · ЧС</button></div>
          </div>
          <div class="decision-note">Подтверждённого абонента нет. Регистрация звонка без абонента не создаётся — используем штатную форму потенциального абонента или подключения.</div>`;
      }
      this.surface(`<div class="decision">${status}${this.pbxPanel()}${actions}<div class="actions"><button class="action" type="button" data-action="cancel">Закрыть</button></div></div>`);
    }

    renderForm(values = null, notice = null) {
      if (!this.model) {
        this.renderDecision(notice);
        return;
      }
      const preferredKey = values?.pbxCallKey || String(this.focusCall?.callKey || '');
      const selectedCall = this.focusCall && String(this.focusCall.callKey || '') === preferredKey
        ? this.focusCall
        : (this.pbxCalls.find(c => c.callKey === preferredKey) || this.focusCall || null);
      const callPhone = phoneFromPbxCall(this.focusCall || selectedCall);
      const current = values || {
        standardComment: this.model.defaults.standardComment,
        comment: this.model.defaults.comment,
        phone: callPhone || reliablePhone(WB.store.activeCase?.()) || this.model.defaults.phone,
        pbxCallKey: preferredKey
      };
      if (callPhone && (!values?.phone || values?._phoneFromCall || !values)) {
        current.phone = callPhone;
        current._phoneFromCall = true;
      }
      const selected = String(current.standardComment ?? '');
      const status = notice
        ? `<div class="status ${esc(notice.kind || '')}">${esc(notice.message || '')}</div>`
        : '';
      const topics = topicIconButtons(this.model.options || [], selected);
      const focusBindingStatus = registrationStateOf(this.focusCall?.binding);
      const focusTakenByOther = Boolean(this.focusCall?.binding?.caseId && this.focusCall.binding.caseId !== this.caseSnapshot?.caseId);
      const targetCurrent = Boolean(this.currentCaseCandidate && this.caseSnapshot?.caseId);
      const saveDisabled = !this.focusCall?.callKey || !targetCurrent || focusTakenByOther
        || ['registered', 'submitting', 'review_required'].includes(focusBindingStatus);
      const phoneField = current.phone
        ? `<input name="dopf_13" type="hidden" value="${esc(current.phone)}"><div class="hint phone-inline">Телефон из звонка: ${esc(current.phone)}</div>`
        : `<label>Телефон <span class="required">(!)</span><input name="dopf_13" type="text" maxlength="${Number(this.model.phoneMaxLength || 35)}" value="" required autocomplete="tel"></label>`;
      this.surface(`<form data-call-form>${status}${this.pbxPanel()}<label>Тема обращения<input type="hidden" name="standart_comment" value="${esc(selected)}">${topics}</label><label>Комментарий<textarea name="comment" placeholder="Кратко зафиксируй обращение">${esc(current.comment || '')}</textarea></label>${phoneField}<div class="actions"><button class="action" type="button" data-action="cancel">Отмена</button><button class="action primary" type="submit"${saveDisabled ? ' disabled title="Регистрация разрешена только на подтверждённой вкладке выбранного абонента"' : ''}>Зарегистрировать</button></div></form>`);
    }

    renderError(message) {
      this.surface(`<div class="content"><div class="status error">${esc(message || 'Не удалось открыть форму')}</div><div class="actions"><button class="action" type="button" data-action="cancel">Закрыть</button></div></div>`);
    }

    renderResult(result) {
      const kind = result.status === 'success' ? 'success' : result.status === 'unknown' ? 'warn' : 'error';
      const prefix = result.status === 'success' ? '✓ ' : result.status === 'unknown' ? '! ' : '✕ ';
      this.surface(`<div class="content"><div class="status ${kind}">${prefix}${esc(result.message)}</div><div class="actions"><button class="action" type="button" data-action="cancel">Закрыть</button></div></div>`);
    }

    applyPbxSnapshot(pbx, resolvedCustomerId = '') {
      this.pbxCalls = Array.isArray(pbx?.calls) ? pbx.calls : [];
      this.focusCall = pbx?.focusCall && typeof pbx.focusCall === 'object' ? pbx.focusCall : null;
      this.focusSnapshot = pbx?.focusSnapshot && typeof pbx.focusSnapshot === 'object' ? pbx.focusSnapshot : null;
      this.focusCandidates = Array.isArray(pbx?.focusCandidates) ? pbx.focusCandidates : [];
      this.currentCaseCandidate = pbx?.currentCaseCandidate || null;
      this.dayCalls = Array.isArray(pbx?.dayCalls) ? pbx.dayCalls : [];
      this.assignmentLog = Array.isArray(pbx?.assignmentLog) ? pbx.assignmentLog : [];
      this.takenCalls = Array.isArray(pbx?.takenCalls) ? pbx.takenCalls : [];
      this.pbxBinding = this.focusCall?.binding?.caseId === this.caseSnapshot?.caseId
        && (!resolvedCustomerId || this.focusCall?.binding?.customerId === resolvedCustomerId)
        ? this.focusCall.binding
        : null;
      const updatedAt = pbx?.updatedAt ? String(pbx.updatedAt) : '';
      const n = this.dayCalls.length || this.pbxCalls.length;
      const direct = pbx?.refresh?.source === 'userside-call-list' && pbx?.refresh?.refreshed === true;
      if (this.focusCall) {
        const source = direct ? 'UserSide call_list' : 'сохранённый call_list';
        this.pbxFreshNote = updatedAt
          ? `${source} · обновлено ${updatedAt.slice(11, 19) || updatedAt} · сегодня: ${n}`
          : `${source} · сегодня: ${n}`;
      } else if (direct) {
        this.pbxFreshNote = 'UserSide call_list обновлён: звонков 6047 пока нет. Отдельная вкладка списка звонков не нужна.';
      } else {
        const reason = String(pbx?.refresh?.reason || pbx?.refresh?.fallback?.reason || '').trim();
        this.pbxFreshNote = reason ? `UserSide call_list не обновился: ${reason}` : 'Звонок 6047 пока не найден.';
      }
    }

    async loadNativeModelForCurrentCase(caseData, generation = this.generation) {
      if (!this.caseSnapshot?.caseId || !this.caseMatchesSnapshot()) {
        throw new Error('Нужная карточка абонента ещё не открыта');
      }
      const result = await extensionRequest(FORM_MESSAGE, {
        caseId: this.caseSnapshot.caseId,
        customerId: this.caseSnapshot.customerId
      });
      if (generation !== this.generation || !this.host) throw new Error('cancelled');
      if (!result?.ok) throw new Error(result?.message || `UserSide вернул HTTP ${Number(result?.status || 0) || 'ошибку'}`);
      const resolvedCustomerId = customerIdOf(result.customerId || this.caseSnapshot.customerId);
      if (!resolvedCustomerId) throw new Error('UserSide Customer ID не найден');
      this.caseSnapshot.customerId = resolvedCustomerId;
      WB.store.rememberCustomerId?.(
        this.caseSnapshot.caseId,
        resolvedCustomerId,
        `userside:${result.resolver || 'case'}:call-registration`
      );
      if (!this.caseMatchesSnapshot()) throw new Error('Активный абонент изменился во время загрузки формы');
      this.model = parseNativeCallForm(result.data, resolvedCustomerId);
      try {
        const active = WB.store.activeCase?.() || caseData;
        if (active && WB.caseView?.diagnosticSummary) {
          const summary = String(WB.caseView.diagnosticSummary(active) || '').trim();
          if (summary && !(this.model.defaults?.comment || '').trim()) {
            this.model.defaults = { ...(this.model.defaults || {}), comment: summary.slice(0, 900) };
          }
        }
      } catch {}
      return resolvedCustomerId;
    }

    async open(caseData = WB.store.activeCase?.() || null, options = {}) {
      if (!this.enabled) return { ok: false, reason: 'call-disabled' };
      this.close();
      window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'call' } }));
      const generation = ++this.generation;
      const hasCase = Boolean(caseData?.id);
      const customerId = hasCase ? customerIdOf(caseData?.identity?.customerId) : '';
      const login = hasCase ? String(valueOf(caseData.identity?.login) || '').trim() : '';
      const contract = hasCase ? String(valueOf(caseData.identity?.contract) || '').trim() : '';
      const fullName = hasCase ? String(valueOf(caseData.profile?.fullName) || valueOf(caseData.identity?.fullName) || '').trim() : '';
      this.caseSnapshot = {
        caseId: hasCase ? String(caseData.id || '') : '',
        customerId,
        login,
        contract,
        fullName,
        label: hasCase ? (fullName || login || (contract ? `Договор ${contract}` : `Customer ID ${customerId}`)) : ''
      };
      this.historyFocusCallKey = String(options.focusCallKey || '');
      this.mount();
      this.renderLoading();

      try {
        const pbx = await extensionRequest(PBX_QUERY_MESSAGE, {
          caseId: this.caseSnapshot.caseId,
          customerId: this.caseSnapshot.customerId,
          fresh: true,
          forceRefresh: true,
          focusCallKey: this.historyFocusCallKey
        });
        if (generation !== this.generation || !this.host) return { ok: false, reason: 'cancelled' };
        this.applyPbxSnapshot(pbx, this.caseSnapshot.customerId);
        if (!this.focusCall) {
          this.renderDecision();
          return { ok: true, mode: 'global-no-call' };
        }

        const target = this.targetCandidate();
        const currentTarget = Boolean(target?.isCurrentCase === true && this.caseSnapshot.caseId);
        if (!currentTarget) {
          this.model = null;
          this.renderDecision();
          return { ok: true, mode: target ? 'route-required' : 'task-choice' };
        }

        const resolvedCustomerId = await this.loadNativeModelForCurrentCase(caseData, generation);
        // Resolve customerId may enrich the Case. Re-score from the same CALL
        // repository without a second HTTP refresh, preserving requested focus.
        try {
          const rescored = await extensionRequest(PBX_QUERY_MESSAGE, {
            caseId: this.caseSnapshot.caseId,
            customerId: resolvedCustomerId,
            fresh: false,
            focusCallKey: String(this.focusCall?.callKey || this.historyFocusCallKey || '')
          });
          this.applyPbxSnapshot(rescored, resolvedCustomerId);
        } catch {}
        if (generation !== this.generation || !this.host) return { ok: false, reason: 'cancelled' };
        if (!this.targetCandidate()?.isCurrentCase) {
          this.model = null;
          this.renderDecision({ kind: 'warn', message: 'После обновления evidence лидирует другой абонент. Перехожу в безопасный режим выбора.' });
          return { ok: true, mode: 'route-required' };
        }
        this.renderForm();
        return { ok: true, customerId: resolvedCustomerId, mode: this.focusCall?.ongoing ? 'live-registration' : 'frozen-registration' };
      } catch (error) {
        if (generation === this.generation && this.host) {
          this.model = null;
          this.pbxLoadError = compact(error?.message || String(error), 180);
          this.renderDecision({ kind: 'error', message: error?.message || String(error) });
        }
        return { ok: false, reason: error?.message || String(error) };
      }
    }

    draft() {
      const form = this.shadow?.querySelector('form[data-call-form]');
      return form ? {
        standardComment: String(form.elements?.standart_comment?.value ?? ''),
        comment: String(form.elements?.comment?.value ?? ''),
        phone: String(form.elements?.dopf_13?.value ?? ''),
        pbxCallKey: String(form.elements?.pbx_call_key?.value ?? '')
      } : null;
    }

    selectedPbxCall() {
      const callKey = String(this.draft()?.pbxCallKey || '');
      if (this.focusCall && String(this.focusCall.callKey || '') === callKey) return this.focusCall;
      return this.pbxCalls.find(call => call.callKey === callKey) || null;
    }

    async bindSelectedPbxCall(options = {}) {
      if (this.binding || this.saving || !this.caseMatchesSnapshot()) return;
      const values = this.draft();
      const callKey = String(values?.pbxCallKey || '');
      if (!callKey) {
        this.renderForm(values, { kind: 'warn', message: 'Текущий звонок ещё не готов к регистрации.' });
        return;
      }
      const call = this.pbxCalls.find(item => item.callKey === callKey) || null;
      if (!call) {
        this.renderForm(values, { kind: 'error', message: 'Звонок в фокусе уже отсутствует в свежем снимке call_list.' });
        return;
      }
      if (call.binding && call.binding.caseId !== this.caseSnapshot?.caseId) {
        this.renderForm(values, { kind: 'error', message: 'Этот звонок уже закреплён за другим Case.' });
        return;
      }
      const registrationStatus = registrationStateOf(call.binding);
      if (call.binding?.caseId === this.caseSnapshot?.caseId && ['registered', 'submitting', 'review_required'].includes(registrationStatus)) {
        this.renderForm(values, { kind: 'error', message: 'Этот звонок уже закрыт защитным статусом и не может быть перепривязан.' });
        return;
      }

      const requestedOverride = options.operatorOverride === true;
      const matchLevel = String(call.match?.level || 'none');
      let operatorOverride = requestedOverride && matchLevel !== 'strong';
      if (requestedOverride && matchLevel === 'strong') {
        // Не создаём ложный override, если автоматическая корреляция и так строгая.
        operatorOverride = false;
      }

      if (operatorOverride) {
        const conflicts = Array.isArray(call.match?.conflicts) && call.match.conflicts.length
          ? `\nКонфликтующие признаки: ${call.match.conflicts.join(', ')}.`
          : '';
        const caseLabel = this.caseSnapshot?.label || this.caseSnapshot?.caseId || 'текущий Case';
        const confirmed = window.confirm(
          `Автоматическая привязка PBX-звонка к абоненту НЕ подтверждена.${conflicts}\n\n` +
          `Звонок: ${pbxCallLabel(call)}\n` +
          `Абонент: ${caseLabel}\n\n` +
          'Принять этот звонок под ответственность оператора? Действие будет записано в журнал и не станет автоматическим доказательством связи.'
        );
        if (!confirmed) return;
      }

      this.binding = true;
      try {
        const result = await extensionRequest(PBX_BIND_MESSAGE, {
          caseId: this.caseSnapshot.caseId,
          customerId: this.caseSnapshot.customerId,
          callKey,
          mode: operatorOverride ? 'operator-override' : 'dry-run',
          operatorOverride,
          overrideAcknowledged: operatorOverride
        });
        this.pbxBinding = result?.binding || null;
        if (operatorOverride) this.overrideConfirmedCallKey = callKey;
        this.pbxCalls = this.pbxCalls.map(item => (
          item.callKey === callKey ? { ...item, binding: this.pbxBinding } : item
        ));
        this.binding = false;
        this.renderForm(values, requestedOverride && !operatorOverride
          ? { kind: 'success', message: 'У звонка есть точное совпадение договора/IP; он закреплён обычным строгим способом.' }
          : null);
      } catch (error) {
        this.binding = false;
        this.renderForm(values, { kind: 'error', message: error?.message || String(error) });
      }
    }

    openSelectedRecord() {
      const call = this.selectedPbxCall();
      if (!call?.recordUrl) {
        this.renderForm(this.draft(), { kind: 'warn', message: 'Сначала выбери звонок с готовой записью.' });
        return;
      }
      window.open(call.recordUrl, '_blank', 'noopener,noreferrer');
    }

    async onSubmit(event) {
      const form = event.target.closest?.('form[data-call-form]');
      if (!form || this.saving) return;
      event.preventDefault();
      if (!this.model || !this.caseMatchesSnapshot()) {
        this.renderError('Активный абонент изменился. Открой форму заново.');
        return;
      }

      const values = this.draft();
      if (!values?.pbxCallKey) {
        this.renderForm(values, {
          kind: 'error',
          message: 'Звонок в фокусе ещё не имеет стабильного UserSide callId.'
        });
        return;
      }
      // Binding must be explicit. Strong call_list / identity / timeline evidence
      // can bind automatically; weaker or conflicting candidates require a real
      // operator confirmation. Legacy auto-soft bindings are upgraded here.
      const selected = this.focusCall && String(this.focusCall.callKey || '') === values.pbxCallKey
        ? this.focusCall
        : (this.pbxCalls.find(c => c.callKey === values.pbxCallKey) || null);
      if (!selected) {
        this.renderForm(values, { kind: 'error', message: 'Звонок в фокусе уже отсутствует в свежем списке.' });
        return;
      }
      // Subscriber registration is allowed only when the current tab is itself
      // one of the correlated identities for this CALL. A random pre-opened Case
      // can no longer be accepted through an override when evidence is empty.
      if (!this.currentCaseCandidate || this.targetCandidate()?.isCurrentCase !== true) {
        this.model = null;
        this.renderDecision({
          kind: 'warn',
          message: 'Эта вкладка не является подтверждённым target звонка. Workbench переведёт на нужную карточку либо предложит форму подключения/потенциального.'
        });
        return;
      }
      let selectedBinding = selected.binding?.callKey === values.pbxCallKey
        ? selected.binding
        : (this.pbxBinding?.callKey === values.pbxCallKey ? this.pbxBinding : null);
      const strong = String(selected.match?.level || 'none') === 'strong';
      const bindingMode = String(selectedBinding?.mode || '');
      const hasExplicitOverride = bindingMode === 'operator-override'
        && this.overrideConfirmedCallKey === values.pbxCallKey;
      const legacySoftBinding = ['soft', 'operator-select'].includes(bindingMode);
      const needsBinding = !selectedBinding || legacySoftBinding || (!strong && !hasExplicitOverride);

      if (needsBinding) {
        let operatorOverride = false;
        if (!strong) {
          const conflicts = Array.isArray(selected.match?.conflicts) && selected.match.conflicts.length
            ? `\nКонфликтующие признаки: ${selected.match.conflicts.join(', ')}.`
            : '';
          const why = reasonText(selected);
          const confirmed = window.confirm(
            `Автоматическая привязка звонка к абоненту не подтверждена.${conflicts}\n\n`
            + `Звонок: ${pbxCallLabel(selected)}\n`
            + `Абонент: ${this.caseSnapshot?.label || this.caseSnapshot?.caseId || 'текущий Case'}\n`
            + (why ? `Признаки: ${why}\n\n` : '\n')
            + 'Зарегистрировать этот звонок по выбранному абоненту под ответственность оператора?'
          );
          if (!confirmed) return;
          operatorOverride = true;
        }
        try {
          const result = await extensionRequest(PBX_BIND_MESSAGE, {
            caseId: this.caseSnapshot.caseId,
            customerId: this.caseSnapshot.customerId,
            callKey: values.pbxCallKey,
            mode: operatorOverride ? 'operator-override' : 'dry-run',
            operatorOverride,
            overrideAcknowledged: operatorOverride
          });
          selectedBinding = result?.binding || null;
          this.pbxBinding = selectedBinding;
          if (operatorOverride) this.overrideConfirmedCallKey = values.pbxCallKey;
          this.pbxCalls = this.pbxCalls.map(call => (
            call.callKey === values.pbxCallKey ? { ...call, binding: selectedBinding } : call
          ));
          if (this.focusCall?.callKey === values.pbxCallKey) this.focusCall = { ...this.focusCall, binding: selectedBinding };
        } catch (bindError) {
          this.renderForm(values, { kind: 'error', message: bindError?.message || String(bindError) });
          return;
        }
      } else {
        this.pbxBinding = selectedBinding;
      }

      const bindingStatus = registrationStateOf(selectedBinding);
      if (bindingStatus === 'registered' || bindingStatus === 'submitting' || bindingStatus === 'review_required') {
        const message = bindingStatus === 'registered'
          ? 'Этот PBX-звонок уже зарегистрирован.'
          : bindingStatus === 'submitting'
            ? 'Этот PBX-звонок уже отправляется из другой вкладки.'
            : 'Предыдущая отправка имеет неизвестный результат. Сначала проверь историю звонков UserSide.';
        this.renderForm(values, { kind: 'error', message });
        return;
      }
      let fields;
      try {
        fields = serializeNativeCallForm(this.model, values);
      } catch (error) {
        this.renderForm(values, { kind: 'error', message: error?.message || String(error) });
        return;
      }

      this.saving = true;
      for (const button of this.shadow.querySelectorAll('button')) button.disabled = true;
      const submitButton = this.shadow.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = 'Сохраняю…';
      const generation = this.generation;

      try {
        const response = await extensionRequest(SUBMIT_MESSAGE, {
          caseId: this.caseSnapshot.caseId,
          customerId: this.caseSnapshot.customerId,
          pbxCallKey: values.pbxCallKey,
          fields
        });
        const result = classifySubmissionResult(response, this.caseSnapshot.customerId);
        if (result.status === 'unknown') {
        } else if (result.status === 'error') {
        }
        let finalized;
        try {
          if (!response?.pbxSubmission?.submissionId) {
            throw new Error('Фоновый модуль не вернул ключ защищённой отправки');
          }
          finalized = await extensionRequest(PBX_FINALIZE_MESSAGE, {
            ...response.pbxSubmission,
            status: result.status
          });
        } catch (finalizeError) {
          if (generation !== this.generation || !this.host) return;
          this.saving = false;
          this.renderResult({
            status: 'unknown',
            message: `UserSide ответил, но защитный статус не подтверждён: ${finalizeError?.message || String(finalizeError)}. Не повторяй отправку — сначала проверь историю звонков.`
          });
          return;
        }
        if (generation !== this.generation || !this.host) return;
        this.pbxBinding = finalized?.binding || this.pbxBinding;
        this.pbxCalls = this.pbxCalls.map(call => (
          call.callKey === this.pbxBinding?.callKey ? { ...call, binding: this.pbxBinding } : call
        ));
        this.saving = false;
        if (result.status === 'error') {
          this.renderForm(values, { kind: 'error', message: result.message });
          return;
        }

        this.renderResult(result);
        if (result.status === 'success') {
          const selected = this.model.options.find(option => String(option.value) === String(values.standardComment));
          try {
            const call = this.pbxCalls.find(c => c.callKey === this.pbxBinding?.callKey);
            const row = {
              callKey: this.pbxBinding?.callKey || '',
              time: call?.time || '',
              date: call?.date || '',
              callerMasked: call?.callerMasked || '',
              duration: call?.duration || '',
              caseId: this.caseSnapshot?.caseId || '',
              caseLabel: this.caseSnapshot?.label || '',
              customerId: this.caseSnapshot?.customerId || '',
              contract: this.caseSnapshot?.label || '',
              registrationStatus: 'registered',
              at: new Date().toISOString()
            };
            this.assignmentLog = [row, ...(this.assignmentLog || []).filter(r => r.callKey !== row.callKey)].slice(0, 40);
          } catch {}
          void WB.store.addEvent?.(
            'call_registration',
            'Звонок зарегистрирован в UserSide',
            {
              customerId: this.caseSnapshot.customerId,
              standardComment: selected?.label || '',
              standardCommentValue: selected?.value || '',
              commentLength: values.comment.length,
              mechanism: 'userside-native-form',
              pbxCallKey: this.pbxBinding?.callKey || '',
              pbxRecordId: this.pbxBinding?.recordId || '',
              pbxBindingMode: this.pbxBinding?.mode || 'dry-run',
              operatorOverride: this.pbxBinding?.mode === 'operator-override'
            }
          );
          const successGeneration = this.generation;
          setTimeout(() => {
            if (this.host && successGeneration === this.generation && !this.saving) this.close();
          }, 1100);
        }
      } catch (error) {
        if (generation !== this.generation || !this.host) return;
        this.saving = false;
        this.renderForm(values, { kind: 'error', message: error?.message || String(error) });
      }
    }

    async onClick(event) {
      const actionNode = event.target.closest?.('[data-action]');
      const action = actionNode?.dataset.action || '';
      if (action === 'cancel') {
        this.close();
        return;
      }
      if (action === 'open-task-form') {
        event.preventDefault();
        const url = this.taskLaunchUrl(actionNode?.dataset?.typer || '');
        if (!url) return;
        window.open(url, '_blank', 'noopener');
        return;
      }
      if (action === 'route-target') {
        event.preventDefault();
        let identity = null;
        let evidenceTabIds = [];
        try { identity = JSON.parse(decodeURIComponent(String(actionNode.dataset.candidateIdentity || ''))); } catch {}
        try { evidenceTabIds = JSON.parse(decodeURIComponent(String(actionNode.dataset.evidenceTabs || ''))); } catch {}
        if (!identity || !this.focusCall?.callKey) return;
        try {
          await extensionRequest(CALL_ROUTE_TARGET_MESSAGE, {
            callKey: this.focusCall.callKey,
            identity,
            confidence: Number(actionNode.dataset.confidence || 0),
            evidenceTabIds
          });
          this.close();
        } catch (error) {
          this.renderDecision({ kind: 'error', message: error?.message || String(error) });
        }
        return;
      }
      if (action === 'load-current-form') {
        event.preventDefault();
        const active = WB.store.activeCase?.() || null;
        if (!active?.id || !this.targetCandidate()?.isCurrentCase) {
          this.renderDecision({ kind: 'warn', message: 'Эта вкладка не подтверждена как target звонка.' });
          return;
        }
        try {
          await this.loadNativeModelForCurrentCase(active, this.generation);
          this.renderForm();
        } catch (error) {
          this.model = null;
          this.renderDecision({ kind: 'error', message: error?.message || String(error) });
        }
        return;
      }
      if (action === 'export-call-audit') {
        event.preventDefault();
        try {
          const audit = await extensionRequest(CALL_GLOBAL_AUDIT_MESSAGE, {});
          const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
          const href = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = href;
          link.download = `simnet-call-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(href), 1000);
          this.renderForm(this.draft(), { kind: 'success', message: 'Global CALL audit экспортирован.' });
        } catch (error) {
          this.renderForm(this.draft(), { kind: 'error', message: error?.message || String(error) });
        }
        return;
      }
      if (action === 'bind-candidate') {
        event.preventDefault();
        const callKey = String(this.focusCall?.callKey || '');
        if (!callKey || !['frozen', 'live', 'pending'].includes(String(this.focusCall?.snapshotStatus || ''))) return;
        let candidateIdentity = null;
        try { candidateIdentity = JSON.parse(decodeURIComponent(String(actionNode.dataset.candidateIdentity || ''))); } catch {}
        if (!candidateIdentity) return;
        const confidence = Number(actionNode.dataset.confidence || 0);
        const hardConflict = actionNode.dataset.hardConflict === '1';
        const operatorOverride = hardConflict || confidence < 80;
        if (operatorOverride) {
          const confirmed = window.confirm(
            `${hardConflict ? 'Есть hard identity conflict.' : `Уверенность кандидата ${confidence}%.`}\n\n`
            + `Привязать frozen snapshot звонка к ${candidateIdentity.fullName || candidateIdentity.login || candidateIdentity.caseId || 'этому абоненту'} под ответственность оператора?`
          );
          if (!confirmed) return;
        }
        try {
          const result = await extensionRequest(PBX_BIND_MESSAGE, {
            caseId: candidateIdentity.caseId || this.caseSnapshot?.caseId || '',
            customerId: candidateIdentity.customerId || '',
            callKey,
            candidateIdentity,
            operatorOverride,
            overrideAcknowledged: operatorOverride
          });
          this.pbxBinding = result?.binding || null;
          this.focusCall = { ...this.focusCall, binding: this.pbxBinding };
          this.pbxCalls = this.pbxCalls.map(call => call.callKey === callKey ? { ...call, binding: this.pbxBinding } : call);
          const selectedCurrent = String(candidateIdentity.caseId || '') === String(this.caseSnapshot?.caseId || '');
          this.renderForm(this.draft(), {
            kind: 'success',
            message: selectedCurrent
              ? 'Кандидат закреплён за текущим Case.'
              : 'Звонок закреплён за выбранным кандидатом. Workbench может перевести на его карточку.'
          });
        } catch (error) {
          this.renderForm(this.draft(), { kind: 'error', message: error?.message || String(error) });
        }
        return;
      }
      if (action === 'pick-topic') {
        event.preventDefault();
        const value = String(actionNode?.dataset.topicValue || '');
        const form = this.shadow?.querySelector('form[data-call-form]');
        const hidden = form?.elements?.standart_comment;
        if (hidden) hidden.value = value;
        for (const btn of this.shadow.querySelectorAll('.topic-btn')) {
          btn.classList.toggle('active', btn.dataset.topicValue === value);
        }
        return;
      }
      if (action === 'refresh-focus' || action === 'focus-history-call' || action === 'focus-latest-call') {
        event.preventDefault();
        const requestedKey = action === 'focus-history-call'
          ? String(actionNode?.dataset.callKey || '')
          : action === 'focus-latest-call'
            ? ''
            : String(this.historyFocusCallKey || this.focusCall?.callKey || '');
        const active = WB.store.activeCase?.() || null;
        await this.open(active, { focusCallKey: requestedKey }).catch(error => {
          if (this.host) this.renderDecision({ kind: 'error', message: error?.message || String(error) });
        });
        return;
      }
      if (action === 'backdrop' && event.target === actionNode && !this.saving) {
        this.close();
      }
    }

    onKeydown(event) {
      if (event.key === 'Escape' && this.host && !this.saving) {
        event.preventDefault();
        this.close();
      }
    }

    close() {
      const wasOpen = Boolean(this.host || this.caseSnapshot);
      this.generation += 1;
      this.saving = false;
      this.binding = false;
      this.overrideConfirmedCallKey = '';
      this.model = null;
      this.caseSnapshot = null;
      this.pbxCalls = [];
      this.focusCall = null;
      this.focusSnapshot = null;
      this.focusCandidates = [];
      this.currentCaseCandidate = null;
      this.dayCalls = [];
      this.historyFocusCallKey = '';
      this.pbxBinding = null;
      this.pbxLoadError = '';
      this.pbxFreshNote = '';
      this.assignmentLog = [];
      this.takenCalls = [];
      document.removeEventListener('keydown', this.boundKeydown, true);
      this.host?.remove();
      this.host = null;
      this.shadow = null;
      if (wasOpen) {
        window.dispatchEvent(new CustomEvent('simnet-workbench-module-close', { detail: { module: 'call' } }));
      }
    }

    enable() {
      this.enabled = true;
      return true;
    }

    disable() {
      this.enabled = false;
      this.close();
      return true;
    }

    destroy() {
      this.enabled = false;
      this.close();
      window.removeEventListener('simnet-workbench-module-open', this.boundModuleOpen);
      this.unsubStore?.();
    }
  }

  globalThis.__SIMNET_WB_CALL_TEST_API__ = Object.freeze({
    customerIdOf,
    usersideFormUrl,
    parseNativeCallForm,
    serializeNativeCallForm,
    classifySubmissionResult,
    reliablePhone,
    pbxCallLabel
  });

  WB.callRegistration = new CallRegistration();
  WB.__callRegistrationLoaded = true;
})();
