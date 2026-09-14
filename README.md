## 1.7.36.167 — Click to inspect tab load

- Per-tab details open immediately with the extension popup. Cached values appear first, followed by one bounded flush of all loaded CRM tabs, including background tabs. Discarded tabs are not woken. Snapshot export also flushes loaded background tabs; each response has a three-second wait limit and displayed timestamps expose stale samples.

## 1.7.36.166 — Tab load visibility

- Extension popup shows total/working/background/discarded tab counts and expandable per-tab metrics with a focus button. Existing five-second popup refresh and minute sample cadence are reused.
- Hidden-tab resource completions and metric aggregates are no longer dropped. Samples include visible/hidden wall time, activations, hidden request/long-task counts and return-to-animation-frame delay; hidden samples skip DOM scanning and event-loop probes.
- Snapshot `report.tabLoad` includes per-tab aggregates and performance grouped by open tab count. Aggregates cover retained samples, background attribution uses observer-delivery visibility, and background timers can be throttled. JS heap estimates may be shared across tabs and must not be summed or interpreted as CPU/full RAM. Long-task capture threshold remains 120 ms.

## 1.7.36.165 — LIVE layout

- Removed the LIVE progress bar and completion counter. PON checkpoints are ordered Technical → TMC → ONU poll → Juniper, retaining actual status/timestamps and independent navigation.
- Consistent chevrons replace text arrows. “Открыть Billing” replaces the contract-copy footer action and opens the current subscriber's Billing card through existing authenticated navigation.

## 1.7.36.164 — Selectize OLT selection

- The TMC fill button sits in the right-hand cell of the OLT row.
- Selectize OLT options are resolved from the live widget catalogue by exact IP, including when the hidden native select contains only an empty option. A single click fills differing ONU fields and selects OLT through Selectize, then closes/blurs the dropdown. Equal fields are preserved; missing/ambiguous OLT choices are reported without inventing IDs.

## 1.7.36.163 — Technical controls and reverse navigation

- Compact “Подставить из ТМЦ” button beside OLT changes only differing fields. Native/select2/chosen OLT controls refresh and close after selection; saving remains explicit.
- Confirmed TMC ONU/OLT evidence supplies PON classification when the connection family is missing. Explicit Ethernet is preserved.
- UserSide → Billing ignores stale cross-case handoffs and recovers closed source tabs using a live session in the correct Billing realm. Failed navigation reports a reason instead of silently focusing a wrong destination.

## 1.7.36.162 — OLT route and selective TMC transfer

- Engineer poll navigation resolves the native technology from existing OLT/TMC evidence even before Billing completeness permits an actual request. Request guards remain active.
- OLT reconciliation uses exact IP, never display names or IDs from different systems. MAC and Serial ignore formatting differences.
- Billing Technical has a “Подставить отличия из ТМЦ” button next to Serial. It fills only differing ONU MAC, Serial and OLT fields, selecting OLT by a unique exact IP match. Save using the native Billing button. Subscriber/router MAC is untouched.

## 1.7.36.161 — Runtime performance

- Batch diagnostic log writes with a bounded 80-entry pending buffer and one writer per page. Routine logs remain exportable without flooding the console with object references.
- Share simultaneous identical call-list refreshes; routed registration may reuse a successful result for 15 seconds only when date, extension and phone activity match. Independent clicks still refresh.
- Show the resolved call target without waiting for a foreign customer's form. Native forms and CSRF are never cached by this change.
- Export actual HTTP headers/body timing separately from call-list parse/merge time, the 12 largest retained JS-memory samples, and slow browser interactions including input delay. Exclude known telephony streams from ordinary resource latency.
- These changes reduce avoidable work; they do not establish the cause of the observed memory peak or fix server/VPN response latency.

## 1.7.36.160 — Continuous performance snapshots + CALL trust tiers

- Performance collection now runs continuously in the background without a 30-minute timer or a manual start/stop cycle. `Снять слепок и скачать` exports the accumulated period while collection immediately continues.
- Snapshot JSON includes an exact action timeline and millisecond timings for Workbench clicks, CALL registration open/module load, filtered `call_list`, native form fetch/parse/render, focus selection, binding, submission and finalization.
- Every `Рег. звонок` click performs one fresh filtered `call_list` request. Native active-phone state selects the current 6047 row; when the phone is idle, the newest completed row is focused and stale cached focus cannot override it.
- “Звонки 6047 сегодня” no longer presents heuristic scores such as `97%` as probabilities. `100%` is reserved exclusively for one unique CUSTOMER directly supplied by UserSide `call_list`; all indirect matches use explicit evidence tiers (`Сильные признаки`, `Есть признаки`, `Слабые признаки`, `Неоднозначно`, `Конфликт`).

## 1.7.36.159 — Direct filtered current-call focus

- Opening `Рег. звонок` performs one authoritative filtered `call_list` GET for today and extension `6047`, then uses the matching current row from that response directly.
- Removed the manifest-connected background call-list resolver so the same list is not polled repeatedly while a call is active. Manual refresh remains available only when UserSide has not returned the current row yet.
- The active-call safety guard no longer erases a fresh matching LIVE row merely because no separate `call_list` tab is open; a previous completed call still cannot replace an active one.

## 1.7.36.158 — Restore LIVE call-list resolver

- Connected the existing current-call resolver to the shipped manifest so an active PBX call can be enriched from the filtered UserSide `call_list` instead of remaining forever in the waiting screen.
- The LIVE waiting state now explains that UserSide has not returned the current row yet and offers a bounded manual `Обновить call_list` action; a previous caller is still never reused.

## 1.7.36.157 — Native UserSide call-list filter

- CALL now refreshes the current operator call through the exact filter query emitted by the current UserSide form: period in slot `0`, employee phone in slot `2`, and the native `employee_ipphone_number0_value` companion field.
- Both dates are generated automatically from the current `Europe/Kyiv` calendar day; operator extension `6047` remains configurable in the URL builder.

## 1.7.36.156 — Passive performance session snapshot

- The extension popup can start a passive 30-minute performance session and finish it at any earlier moment with `Снять срез сейчас`.
- Visible Billing/UserSide pages contribute one compact aggregate roughly once per minute and on page entry; collection is disabled outside an active session.
- The report compares the beginning and end of the session across page load/TTFB, resource requests, Workbench readiness, long JavaScript tasks, event-loop delay, DOM size, JS heap and Workbench storage size.
- Slow route and Workbench-operation summaries are aggregated without customer identifiers, phone numbers or URL query strings.
- A completed snapshot remains available in the popup and can be downloaded as JSON for deeper comparison.

## 1.7.36.155 — UserSide UUID call registration

- CALL loads the current native UserSide registration form with `customer_uuid`, while preserving numeric `customer_id` compatibility for older responses.
- Native UUID values for the standard comment and additional phone field are read from the fresh form; CSRF and form field UUIDs are never hardcoded.
- Opening `Рег. звонок` starts the native form request and authoritative `call_list` refresh in parallel, while the dialog shell appears immediately.
- Direct `call_list` refresh is server-filtered to the current `Europe/Kyiv` calendar date and operator extension `6047`, avoiding an unfiltered call-history download.
- UserSide UUID call keys are preserved for both completed calls and the current/live preview.

## 1.7.36.108 — CALL live routing + safe maintenance

- CALL registration can be opened while the call is still ongoing: the form uses the current LIVE candidate/confidence and locks the target only after the operator chooses to continue. Completed calls continue to use immutable frozen snapshots.
- Registration is global rather than tied to the current browser tab. If the current tab is not a valid context for the selected subscriber, Workbench prefers a live evidence tab for that target, focuses it, verifies identity and opens the registration there; if necessary it opens the target UserSide customer page.
- Pre-existing tabs do not become evidence for a new call merely because they were already open. A physical tab can participate in later calls only through new interaction in the new call window, preventing stale subscriber identity from leaking across calls.
- Compact CALL form keeps only the call, focus subscriber + confidence, topic, comment and submit in the main surface. Detailed evidence is available only through the info/hover detail.
- When no subscriber is established, CALL offers only native UserSide task flows that actually exist: Potential subscriber (ЖК `41`, private sector `70`) and New connection (ЖК `1`, private sector `15`). The current call phone is carried into the native task form and Workbench restyles the form without replacing CSRF, `/task/save` or native validation.
- Creation of a potential/new-connection task is recorded as a CALL outcome and appears in call history, so an unknown caller can still have an authoritative outcome without inventing a subscriber binding.
- Added Workbench-only storage maintenance: Settings and the extension popup can perform a full WB reset (Case/CALL evidence and snapshots/AI/CRM cache/Audit DB). UserSide/Billing authentication cookies are explicitly preserved and no cookie permission is requested.
- Automatic retention now bounds both CALL repositories and Audit storage: sparse CALL evidence 48h, frozen calls/snapshots 14d, bindings 30d, audit logs 30d/max 1000, audit runs 90d/max 250; user-created audit rules/groups are retained.

> Integration note: this build was produced from the recovered `1.7.36.76-call-module-frozen-snapshots` source tree because the later `.107` archive was not available as source in the runtime. The CALL behaviour above is the forward-integrated model agreed after `.107`.

## 1.7.36.76 — CALL Module + frozen evidence snapshots

- CALL business logic is isolated behind its own lifecycle and message router; the MV3 service worker remains the transport/integration layer.
- UserSide `/message/call_list` ID is canonical (`call:<usersideCallId>`). PBX record IDs are optional legacy aliases; the PBX content script and host permission are no longer installed.
- Optional PBX realtime is disabled by default and, if explicitly enabled, stores only bounded start/end hints without call/customer/phone identity.
- Global event-driven CALL evidence buffer retains 48 hours of `SEARCH_SUBMIT`, `SEARCH_RESOLVED`, `SEARCH_RESULT_OPEN`, `SUBSCRIBER_VISIT` and `HANDOFF` events.
- Completed calls freeze an immutable multi-candidate snapshot after `endedAt + 15s`; snapshots retain compact evidence copies for 14 days.
- Raw score and absolute confidence are separated (`scoringVersion: 1`); exact UserSide CUSTOMER is 100%, hard identity conflict is 0%.
- Bindings and registration status are separate from snapshots. Missing local binding now means registration status is `unknown`, not automatically `unregistered`.
- `operatorVisitTimeline` and resolvable `pbx:*` state migrate once into the new repositories without creating duplicate physical calls.
- “Мои звонки” shows pending/frozen candidate state and exposes `⋯ Экспорт CALL audit`; candidate selection always uses the frozen snapshot.
- `CALL OFF` removes evidence listeners, closes/blocks CALL UI, stops refresh and rejects CALL message handlers while leaving shared Workbench core services active.

## 1.7.36.75 — Call canonical evidence audit

- CALL keeps a sparse 48-hour evidence ledger only for events useful to subscriber↔call canonical correlation: deliberate searches, exact/unique search resolutions, significant Billing/UserSide subscriber visits and handoffs.
- UserSide global search now preserves a unique autocomplete customer as soft evidence at submit time, even if the operator opens a task instead of the customer card.
- Search→open fallback is same-source only; a UserSide search can no longer accidentally boost an unrelated Billing visit.
- Duplicate reload/pageshow visits no longer move evidence timestamps, reducing storage churn and keeping call windows stable.
- Rejected/stale/foreign contexts are not written to CALL timeline.
- Case export now includes `callAudit` with canonical identity, relevant sparse events, handoffs, bindings and only the calls that actually correlate with that Case.
- The ledger is derived per Case on export, so unrelated searches/visits are not dumped into every subscriber JSON.
- Distribution build contains no embedded Groq API secret; AI requires the existing local secure key/proxy setup.

## 1.7.36.74 — Call search evidence transport fix

- CALL registration no longer asks the operator to pick a call from a scored call list.
- The latest own 6047 call is the automatic focus; an in-progress fresh call_list row can be shown as a live, non-bindable preview.
- Correlation is inverted: the focused call window produces ranked subscriber candidates from Billing/UserSide activity.
- Current card is only highlighted; it adds zero confidence by itself.
- Billing contract/address SUBMIT → INFO → CARD chains remain strong intent evidence.
- Old unregistered calls keep their own historical window and can be reopened from “calls today”.
- Today log shows registered / unregistered / review / ongoing state.

## 1.7.36.72 — Call search chain

- Billing subscriber search is captured as causal `SUBMIT → INFO → CARD OPEN` evidence.
- Supports both contract/login search and address search (`street + house + block/apartment`).
- Repeated address corrections are kept as attempts; only the completed chain identifies the subscriber.
- Search submit must occur during the call; INFO/card opening may complete within the short post-call grace window.
- Call registration shows a per-call `?` audit tooltip explaining whether this exact current subscriber was searched during that call.

## 1.7.36.71 — Call correlation hardening

- UserSide `call_list` `DATEADD` теперь трактуется как **начало звонка**, конец вычисляется как `START + duration`; legacy PBX сохраняет отдельную семантику `END`.
- `extension 6047` остаётся фильтром «мой звонок», но больше **не добавляет процент совпадения с абонентом**.
- `call_list` refresh запускается сразу при открытии CALL и не зависит от успешного определения UserSide Customer ID/загрузки формы.
- После resolve Customer ID корреляция пересчитывается из уже обновлённого store без второго HTTP fetch.
- Billing/UserSide посещения одного договора объединяются в одного кандидата, поэтому `UserSide + Billing` теперь действительно работает как evidence.
- Однозначный `CUSTOMER` из UserSide `call_list` стал жёстким identity-evidence: тот же Customer ID = 100%, другой Customer ID = конфликт, который timeline не может молча перекрыть.
- Добавлено лёгкое evidence поиска: submit глобального UserSide/Billing поиска, UserSide address-fast-find и точный клик по найденному абоненту; цепочка `SEARCH → OPEN` видна в расшифровке процента.
- Search/timeline хранит только origin+pathname страницы, без query string с Billing `pp`/другими служебными параметрами.
- Слабый/неоднозначный звонок больше не получает автоматический `operatorOverride`; перед регистрацией требуется реальное подтверждение оператора. Background больше не создаёт auto-soft binding при Submit.
- Исправлен lazy-loader CALL: `force` — реальный параметр, есть таймаут injection, loaded-флаг ставится только после успешной регистрации модуля, повтор после сбоя идёт с forced injection; ошибка открытия CALL уходит в компактный toast.
- Старый неиспользуемый DOM-reader `userside-call-list.js` больше не грузится content-script'ом: активным источником остаётся один service-worker bridge.

## 1.7.36.70 — Unified field-visit guard + compact task UI

- Единый предохранитель выездных заявок для CREATE/EDIT независимо от точки входа: пустая форма, карточка абонента, календарь или переоформление существующей заявки.
- Восстановлена полная проверенная матрица выездных типов из Crew Advisor: B2B/B2C и технические выездные категории.
- Для любой выездной заявки обязательна реальная `Бр. …`; L1/NOC/другие отделы могут оставаться вместе с бригадой.
- CREATE теперь тоже жёстко блокируется без бригады — больше не advisory-only.
- Минимальное новое время выезда: `now + 3 часа`; это же правило действует при non-field → field и при ручном изменении расписания.
- Существующую выездную заявку с неизменённым будущим временем можно редактировать без принудительного переноса на +3ч; время в прошлом блокируется всегда.
- При field → non-field выездной guard сразу отключается, поэтому заявку можно корректно вернуть обратно.
- EDIT picker исполнителей больше не разворачивает огромный розовый блок: текущие назначения компактные, полный список скрыт за `Изменить исполнителей` и автоматически раскрывается только когда для выездной заявки не хватает бригады/идёт переход в выездной тип.
- Ошибки даты/времени/бригады подсвечивают именно соответствующие штатные области и показываются компактным верхним списком.

## 1.7.36.69 — Direct UserSide call_list refresh

- «Регистрация звонка» перед построением списка сама делает authenticated GET `/message/call_list` из service worker;
- страница «Сообщения → Список звонков» и PBX-вкладка для актуализации больше не обязательны;
- завершённые звонки `ANSWERPHONE=6047` из UserSide преобразуются в существующий protected call-store по PBX UniqueID из `getrec.php?id=...`;
- текущая логика binding/anti-double-submit сохранена без отдельной параллельной телефонии;
- старый PBX tab refresh остаётся только fallback, если прямой UserSide fetch не удался;
- UI явно показывает источник `UserSide call_list` и больше не просит держать PBX/список звонков открытым.

## 1.7.36.68 — UserSide ↔ Billing symmetric binding

- Привязка Case UserSide→Billing имеет ту же силу, что Billing→UserSide;
- `resolveCaseId`: кросс-матч login/contract/billingId в обе стороны (abonN↔N, billingId↔contract−1);
- `focusHandoffSource`: если нет source-handoff из Billing — берёт любую открытую Billing-вкладку с `pp`, создаёт reverse handoff и вешает Case;
- billingId для URL при старте с UserSide выводится из договора/логина при необходимости.

## 1.7.36.67 — Call form null-safe callerId

- Фикс краша «Cannot read properties of null (reading 'callerId')» в «Регистрация звонка»;
- `phoneFromPbxCall` / `pbxCallLabel` / `reasonText` принимают `null` без падения (нет выбранного PBX-звонка).

## 1.7.36.66 — Progress visualization

- LIVE: визуализация прогресса выполнения чекпоинтов (шкала + N/M);
- полный план шагов в стабильном порядке (сделано + ожидает), не только завершённые;
- статус: ✓ / ? / ○; стрелка → только у выполненных с replay;
- PON: Техданные → ТМЦ → Juniper → Опрос ONU.

## 1.7.36.65 — Compact LIVE: checkpoints only, no hand-holding

- LIVE панель пропорционально сжата (панель ~220px, меньше padding/шрифты);
- убраны карточки «следующий шаг / перейти туда / сделать это» (ponContext + live-next);
- остаётся список важных чекпоинтов «Что уже сделано» со статусом и стрелкой → к месту;
- статусные блоки (конфликт данных, результат опроса) сохранены.

## 1.7.36.64 — Rail lower, attention bell stays high

- колокольчик attention остаётся у верхнего края (`top: 72px`);
- rail + панель опущены намного ниже (`margin-top: 168px` у `.shell`);
- attention-wrap вынесен из потока (`position: absolute`), чтобы не толкать rail вниз вместе с собой.

## 1.7.36.63 — CALL filter: extension 6047 authoritative

- PBX own-call filter: primary key is **extension === 6047** + **durationSeconds > 0** (accepted/talked).
- Removed hard requirement on agent free-text (`zyatev_andriy` / `opw`) — those strings no longer block valid 6047 rows.
- Soft-reject only when agent text **leads** with a different extension (e.g. `6004 …`).
- Extension normalized from digits / «вн. 6047» noise; agent column used only as fallback when extension cell is empty.
- UserSide `call_list`: same rule — `ANSWERPHONE` normalized to 6047 **and** duration > 0; `OPER` is stored for display only, never as the inclusion criterion.
- PBX remains fallback; UserSide probe still read-only.

## 1.7.36.62 — Compact rail + attention bell + AI topics + UserSide call_list probe

- компактный floating rail (графит, ~46px, только SVG), панель ~242px слева от rail, gap 4px;
- rail опущен от верхнего края (`top: 72px`); Billing/UserSide не сдвигаются;
- отдельный ATTENTION bell выше rail: badge + popup только по проблемам (не зелёные ok);
- AI: при пустом диалоге — quick topics → отправка через существующий AI pipeline; «← Темы» возвращает launcher;
- CALL: read-only parser UserSide `/message/call_list` (ANSWERPHONE=6047), soft-enrichment рядом с PBX; PBX не удалён;
- без новой телефонии и без угадывания API.

## 1.7.36.61 — Own accepted calls + no tab groups + FIO focus

- отключена автоматическая группировка Chrome-вкладок по Case; разрешение `tabGroups` удалено;
- PBX учитывает только принятые звонки оператора `6047 / Zyatev_Andriy / OPW`; чужие и непринятые звонки отбрасываются до хранения и повторно фильтруются в Service Worker;
- в заголовке регистрации звонка жирным выделяется только ФИО, номер договора отображается обычным начертанием.

## 1.7.36.60 — Match % + handset + text topics · no tab groups

- Иконка совпадения: классическая **трубка** (receiver), не мобильный телефон.
- Типы обращения — компактные текстовые чипы без SVG-иконок.
- У каждого кандидата PBX — **% точности**; в шапке списка — лучший % и кнопка **?**.
- По наведению на **?** показывается формула score (веса timeline/договор/IP) и перевод в процент.
- Контекст Case сохранён, но автоматическая Chrome-группировка вкладок по абоненту отключена.

## 1.7.36.59 — Call list compact + tab colors

- Список совпадений PBX в «Регистрация звонка» сделан компактнее: меньше padding и шрифт.
- Кнопка «Открыть запись» убрана.
- Маркеры ●/○ заменены на маленькую иконку телефона.
- Контекст формы по-прежнему жёстко привязан к Case вкладки, с которой открыта регистрация (localCaseId + caseSnapshot + guard).
- Вкладки одного абонента (billing + userside и т.д.) автоматически собираются в цветную Chrome tab group; цвет стабилен по caseId.

## 1.7.36.53 — CREATE schedule repeat guard

- CREATE выездной заявки теперь жёстко блокируется при отсутствии даты/времени или времени раньше `now + 1 час`.
- Проверка выполняется и на `click`, и на `submit`, поэтому повторная попытка сохранения не обходит фильтр.
- Исполнители/бригады на CREATE по-прежнему полностью штатные: Workbench их не скрывает, не сортирует и не подставляет.
- Отсутствие бригады на CREATE остаётся предупреждением; жёсткий gate в этой версии касается только расписания.

## 1.7.36.52 — AI domain routing

- CRM context is no longer sticky across unrelated operator questions.
- Questions about speed, Wi-Fi, cable, ping, drops, Internet, ONU/OLT/BRAS/DHCP/DNS use the normal diagnostic assistant even if a CRM building was active before.
- Matching CRM follow-ups such as “что по Вадиму?”, “а ключи?” still reuse the active building.
- A PC without the CRM snapshot no longer silently falls back to the Danchenko test fixture. Production CRM source reports `missing` instead.
- CREATE task-form behavior from 1.7.36.51 is unchanged: advisory only; native UserSide staff controls remain untouched.

## 1.7.36.51 — CREATE advisory only

Создание заявок (`/task/dialog_add`) полностью оставлено штатному UserSide.

Workbench при CREATE:
- не скрывает, не сортирует и не заменяет список исполнителей;
- не ставит и не снимает бригады;
- не создаёт параллельные staff-поля;
- не перехватывает и не блокирует native submit;
- только читает штатную дату/время/checked `Бр. …` и показывает предупреждение для выездных типов.

Предупреждение включает: нет даты, нет времени, время менее чем через +1 час, не выбрана бригада. Оно advisory-only и не мешает UserSide сохранить заявку.

EDIT-ветка (включая L1 → выездную) не изменена.
