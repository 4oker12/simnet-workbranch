# SIMNET Data Audit

Data Audit is a separate split-screen workspace inside the MV3 Workbench. The existing Workbench rail is unchanged.

## Guided workflow

The normal path is intentionally linear and human-readable:

1. **Источник** — open a Billing `listuser` selection and choose 1–20 pages with the slider.
2. **Отбор** — currently choose either `Только PON` or `Оставить всех`.
3. **Группа** — create a persistent group with required name, color and optional purpose.
4. **Проверка** — choose `ONU Serial + MAC Billing ↔ ТМЦ` or `OLT Billing ↔ ТМЦ`.
5. **Запуск** — review the upper request estimate, then run sequentially.
6. **Результат** — inspect markers, save the check into group history, export CSV or reopen the group.

Future steps remain disabled until the current step has a valid result. Completed steps can be revisited with Back.

## Billing page collection

The slider controls how many pages are read starting from the currently open Billing page.

- current page: parsed directly from DOM, 0 GET;
- following pages: one GET at a time using the same current Billing filters and `start=N`;
- native Billing pagination behavior is mirrored by dropping the display-only `colnarrow` parameter on following pages;
- duplicates are removed by subscriber login;
- subscriber rows require a real Billing `a=user` or `a=dopdata` link with numeric `id`.

Pause, Continue, Finish Here and Cancel are supported. Pages already collected remain in the working draft when a run is stopped.

## Group lifecycle / CRUD

A group is created only after the selection/filter step. Audit checks do not remove subscribers from it.

- Create: wizard step 3.
- Read: `Открыть` in the library; metadata, members and check history are shown.
- Update: edit name, purpose and color from the group view or wizard.
- Delete: explicit destructive action from the group view.

Each fixed check stores per-subscriber markers and a check summary in the same group history.

## Persistence

IndexedDB stores groups, rules, runs, cache, semantic logs and wizard draft state. The wizard also has an explicit `Сохранить состояние` action. Collection/filter state and completed check results can be restored after navigation/reload.

## Safety

Data Audit is read-only. It does not call `askolt`, reboot, ONU reload or poller endpoints. Network work is sequential (`parallelism = 1`) and an upper request estimate is shown before audit execution.


## v1.6.1 UserSide resolution and load telemetry

For TMC checks, Data Audit first reads the subscriber IP from Billing technical data (native `gotouser.php?ip=...` link or the labeled IP field) and calls the same UserSide handoff endpoint. The final `/customer/<id>` redirect is used as the customer id. Exact `ajax_search` and `search_page` are fallback paths only.

The footer reports actual Billing/UserSide GET counts, average GET/min, active requests (hard maximum 1), cache hits and gotouser/fallback success. The same network snapshot is saved into audit run/group history for post-run analysis.


## v1.6.2 shared TMC parser

Data Audit no longer has a separate interpretation of the UserSide TMC block. The same shared parser is loaded before the live UserSide adapter and inside the Audit workspace. It detects the semantic `Найдено/Знайдено на OLT` block, prefers the OLT `/device/<id>` link, extracts OLT name/IP plus ONU Serial/MAC/Interface, and keeps a text fallback for customer-tab HTML.

Audit results distinguish:

- `found` — OLT name and/or IP were extracted;
- `unparsed` — a TMC/OLT block exists but the OLT identity could not be extracted;
- `missing` — no `Найдено/Знайдено на OLT` block was present.

The cache key is `tmc:v3`, so older cached false-empty TMC results are not reused after this upgrade.
