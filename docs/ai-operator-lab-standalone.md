# Standalone Autonomous AI Operator Lab

## Запуск

1. Загрузить или обновить распакованное расширение в `chrome://extensions`.
   Выбирать **корень репозитория с корневым `manifest.json`**.
   `extension/manifest.json` относится к отдельной старой сборке и не содержит этот AI runtime.
2. Открыть popup расширения → **AI LAB ↗ · отдельная страница**.
3. Прямой URL: `chrome-extension://<extension-id>/ai-operator-lab.html`.
   ID виден в `chrome://extensions` при включённом режиме разработчика.
4. Настройка провайдера, ключа и модели — ссылка **AI provider / модель ↗**.
   Используется прежняя конфигурация этого Chrome-профиля.

Billing/UserSide не нужны для открытия интерфейса. Файл запускается как страница
установленного расширения; `file://` и обычный HTTP не предоставляют Chrome runtime.
После обновления переоткрыть уже открытые вкладки настроек/Lab.

## Найденная архитектура

Исходная ветка: `research/contextual-reasoning-finance-spike`, base `e3a908d`.
Lab размещался в options page `src/ui/settings.html`, а не создавался content script.
Workbench открывает эту страницу через существующий маршрут настроек.

| Authority | Где находится |
| --- | --- |
| Чат, controls, exports, A/B, repeat, snapshots | `src/ui/ai-operator-lab.js` |
| Native behavior profile controls | `src/ui/ai-operator-behavior-v2.js` |
| Decision trace, runtime map, tool inspector, canonical/evidence diagnostics | `src/ui/ai-operator-lab-trace.js` |
| Lab controller и полный AI pipeline | `src/features/ai-operator/lab-background.js` |
| Диалог, tool/domain context, source cache, profile, experiments, snapshots | `chrome.storage.local`: `simnet_ai_operator_lab_v1` |
| Semantic understanding / ответ | `semantic-probe.js` и существующий runtime base |
| READ / canonical / evidence | Существующие `semantic-tool-broker*`, `live-tool-runtime*`, `canonical-fact-resolver.js` |
| Scenario Replay | `scenario-replay-background.js` → `runIsolatedLabCase` → тот же Lab pipeline |
| Пакетные формулировки | `lab-batch-background.js` → `runIsolatedLabCase` |
| HelpCrunch historical Replay | `replay-background.js` → существующий `planAutonomousTurn` |
| MV3 bootstrap | Корневой `manifest.json` → `src/background-entry.js` |

Все эти runtime-модули и state authorities оставлены без изменений.

## Изменение hosting

Оба entry point импортируют **один** `src/ui/ai-operator-lab-host.js`.
Он загружает **один** `ai-operator-lab-view.html`, затем последовательно импортирует
прежние UI controllers. Разметка перенесена из настроек побайтно.
Scenario Replay монтируется до регистрации accordion panels.

| Production-файл | Изменение |
| --- | --- |
| `ai-operator-lab.html` | Новая standalone extension page, прежние styles, ссылка на AI configuration |
| `src/ui/ai-operator-lab-host.js` | Общий bootstrap view/controllers, защита от повторного mount, ошибка загрузки view |
| `src/ui/ai-operator-lab-view.html` | Единственная разметка прежнего Lab |
| `src/ui/settings.html` | Embedded host вместо собственного экземпляра разметки и списка Lab scripts |
| `src/ui/ai-operator-lab.css` | Hosting layout и доступ к существующим experiment controls в standalone |
| `src/ui/popup.html` | Ссылка на standalone страницу |

Новых permissions, content scripts, service worker или build step не требуется:
страница и модули находятся внутри того же расширения и удовлетворяют его CSP.
Новых polling/retry циклов bootstrap не добавляет.

Текущий компактный CSS настроек скрывал knowledge/display controls, repeat,
snapshot и часть diagnostics, хотя их реализация существует в Lab controller.
Standalone раскрывает эти элементы scoped CSS. Для comparison/diagnostics
сохраняется поведение `hidden`; встроенное оформление не меняется.

## Feature parity и контекст

| Возможность | Standalone |
| --- | --- |
| Многоходовый чат, профиль, dialogue/tool/domain state | Общие прежние controller/runtime/storage |
| OFF / AUTO / ON / A/B / CLEAN и режимы отображения | Существующие controls и ветки Lab runtime |
| Repeat, snapshots, snapshot export, reset, TXT/JSON export | Существующая реализация |
| Банк вопросов по семи темам | Прежние категории и все реплики общего view |
| Debug, runtime map, evidence, canonical facts, tool traces/inspector | Прежний trace controller |
| Пакет формулировок | Прежний изолированный runner; ограничение 20 вариантов |
| HelpCrunch Replay | Import, отдельный/batch прогон, checkpoints, budgets, Stop, PASS/GAP/SKIP, JSON/CSV |
| Scenario Replay | Все **12** существующих сценариев, subject, Run/Run all/Stop, rerun failed, compare, export |
| Usage/tokens/cost | Прежние runtime/export данные; provider-aware панель расхода DeepSeek |

**Обе страницы используют один сохранённый Lab-диалог**, а не независимые сессии.
Переоткрытие восстанавливает его; reset в одном режиме сбрасывает тот же диалог.
Загрузка UI не создаёт нового абонента и не заполняет canonical facts.

Внешние зависимости сохранены:

- Billing READ/точный lookup требуют доступную авторизованную Billing-вкладку.
  Без неё возвращается `BILLING_TAB_REQUIRED`; источник не считается прочитанным.
- UserSide, building/network/PON tools используют прежние bridges, readers и
  накопленный контекст, с прежними provenance/freshness правилами.
  Отсутствующее подтверждение остаётся unknown; сохранённый контекст не становится
  свежим глобальным READ только из-за открытия standalone.
- Scenario Replay сначала делает реальный `customer.lookup`. Без подтверждённого
  subject прогон не начинается. Fixture-абоненты автоматически не подставляются.
  Текущая подпись UI говорит о 10 диалогах, но authority cases содержит 12.
- Historical Replay использует импортированный JSON и не выполняет текущие
  subscriber READ вместо исторических данных; при нехватке данных сохраняется
  прежний маршрут `tool_required`.
- Ответы модели требуют прежний API key. Интерфейс открывается независимо от
  ключа и CRM-вкладок; существующий runtime обрабатывает ошибки источников.

READ-only policy и блокировка HelpCrunch SEND сохранены.

## Regression / validation

`tests/ai_operator_lab_standalone_test.mjs` проверяет:

- два entry point, один view/controller set, одинаковые styles и прежний worker;
- порядок bootstrap, idempotent mount, независимость видимости standalone от
  сохранённой открытой API/model панели настроек;
- ошибку отсутствующей/повреждённой разметки без запуска fallback runtime;
- четыре хода через production Lab runtime с mock AI transport: вся история
  сохраняется и передаётся модели, GET восстанавливает тот же state;
- отсутствие CRM-вкладок: lookup и Scenario bootstrap возвращают ошибку контекста,
  financial canonical facts остаются `unknown`, без фиктивных snapshots;
- reset через прежний runtime.

Существующие UI contract tests адаптированы к общему view/bootstrap; остальные
runtime assertions не ослаблялись.

```bash
node --test tests/ai_operator_lab_standalone_test.mjs \
  tests/ai_operator_settings_workspace_test.mjs \
  tests/ai_operator_lab_trace_visibility_test.mjs \
  tests/ai_operator_batch_lab_contract_test.mjs \
  tests/ai_operator_replay_contract_test.mjs \
  tests/ai_operator_scenario_replay_test.mjs
npm run check:syntax
node --input-type=module --check < src/ui/ai-operator-lab-host.js
npm run test:ai-operator
```

Результат на 2026-10-01: targeted slice **23/23 PASS**, syntax **PASS**.
Полный AI suite: baseline **300 passed / 57 failed**; после изменения
**304 passed / те же 57 failed**, новых падений нет. Уже существующие падения
затрагивают в том числе устаревшие проверки prompt/структуры runtime; их ремонт
не входит в hosting-задачу.

UI smoke в Chromium 153 с HTTP/CSP harness: **PASS**, 58 общих control IDs,
12 сценариев, четыре хода, восстановление того же диалога в Settings,
TXT/JSON controls, snapshot/JSON export, repeat, A/B/CLEAN, display modes,
пакет из двух формулировок, HelpCrunch import, DeepSeek quota и reset;
JavaScript page errors: **0**. Отсутствие CRM не создаёт Scenario run.
Используются mocked Chrome bridge и те же production runtime handlers.
Реальные CRM/AI обращения в smoke не используются.
Эта проверка дополняет MV3 contracts и не является проверкой живых CRM integrations
или установки расширения в пользовательском Chrome.
