# SIMNET / LOOKNET Diagnostic Workbench — Chrome Extension

Manifest V3 build of the production Diagnostic Workbench for the shared UserSide and two independent Billing databases.

## Source

- userscript: `SIMNET Diagnostic Workbench`;
- source version: `2.0.0-dev.5.8`;
- source SHA-256: `416C44C307E7B8324AE94E1A76477556856593B051677E9585DAEDB322E8D9AF`;
- extension version: `0.5.1`.

The original Workbench userscript business logic is bundled into `src/workbench.js` and augmented by extension-native provider and mentor modules. The Userside task-staff and validation module is bundled as `src/userside-task-staff-ui.js`. The extension supplies a compatibility layer for the Tampermonkey APIs still used by Workbench internals.

Live smoke-test results are recorded in `LIVE_VALIDATION.md`.

## Architecture

- `src/workbench.js` — original Workbench business logic, UI, diagnostics and optional modules;
- `src/billing-provider.js` — isolated Simnet/Looknet profiles and safe UserSide provider detection;
- `src/training-knowledge.js` — structured, testable mentor rules derived from the operator knowledge base;
- `src/training-mentor.js` — mode selector, contextual checklist, non-blocking DOM marker and an in-panel focus explanation;
- `src/userside-task-staff-ui.js` — Userside task staff recommendations, master/crew selection UI and save-time validation;
- `src/gm-compat.js` — synchronous cached facade over `chrome.storage.local`, cross-tab events, GET transport, styles and clipboard;
- `src/service-worker.js` — allowlisted cross-origin GET bridge and request cancellation;
- `src/page-hook.js` — passive MAIN-world capture for the UserSide map module.

The service worker accepts only GET requests to:

- `https://userside.simnet.kiev.ua`;
- `https://admin.simnet.kiev.ua`;
- `http://admin.looknet.kiev.ua` (entry redirect);
- `https://admin.looknet.kiev.ua` (effective Billing origin).

It rejects other origins and methods.

## Permissions

- `storage` — shared Workbench state, Billing bridge, workspace mirror and module state;
- `unlimitedStorage` — prevents the bounded map-evidence and diagnostic state from exhausting Chrome's default local-storage quota;
- `https://userside.simnet.kiev.ua/*` — Workbench on UserSide;
- `https://admin.simnet.kiev.ua/*` — Workbench on Simnet Billing;
- `http://admin.looknet.kiev.ua/*` — Looknet entry redirect;
- `https://admin.looknet.kiev.ua/*` — Workbench on the effective Looknet Billing origin.

There are no permissions for cookies, `webRequest`, `declarativeNetRequest`, native messaging or arbitrary sites.

## Installation

1. Disable the Tampermonkey versions of `SIMNET Diagnostic Workbench` and `Userside - исполнители заявки UI compact + address guards`. Do not run either userscript alongside the extension.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `simnet-workbench-extension` directory containing `manifest.json`.
6. Open or reload an authenticated Simnet and/or Looknet Billing tab.
7. Open or reload UserSide.

For an update, click **Reload** on the extension card and then reload both target tabs.

## First live validation

Perform these checks in order and stop after the first failure:

1. **Startup:** one Workbench panel appears on UserSide and each enabled Billing.
2. **Provider:** `Авто` shows the provider from the UserSide subscriber card; manual `Simnet` and `Looknet` overrides work.
3. **Billing status:** the selected provider reports only its own authenticated Billing bridge.
4. **Mentor:** switch to `Обучение`; automatic diagnostic controls disappear and a contextual checklist appears.
5. **DOM hint:** click `Показать на странице`; the relevant live element is highlighted, a click-through marker appears, and the full explanation stays inside the docked panel.
6. **Progress:** mark a step as checked, verify progress, then reset the checklist.
7. **Workspace mirror:** changing panel state in one tab is reflected in the other.
8. **Safe diagnostic:** run one designated test contract per provider and compare the result with userscript `2.0.0-dev.5.8`.
9. **STOP:** stop an active diagnostic from the mirrored panel.
10. **ONU:** compare one designated ONU poll result per provider.
11. **PON port:** compare one known PON-port analysis.
12. **Map module:** on the UserSide map, perform a normal search and verify that passive evidence counters change.
13. **Clipboard:** copy one text report.
14. **No duplicates:** reload each page and verify that only one Workbench panel exists.
15. **Task staff UI:** open a designated test task and verify the compact staff/crew controls.
16. **Validation:** verify that a strict task cannot be saved without the required date and field crew; do not submit a real task during smoke testing.

## Expected compatibility

The migration keeps:

- diagnostic and PON-port business logic;
- automatic UserSide provider detection with a manual override;
- separate PP state and bridge-presence state for Simnet and Looknet;
- diagnostic and training modes with a remembered operator preference;
- knowledge-base-driven UserSide/Billing checklists;
- live DOM highlighting without persistent observers, global click interception or bundled subscriber screenshots;
- PON-first Billing flow: port poll, then Juniper, then account and technical checks;
- request budgets, timeouts and STOP;
- Billing authenticated-tab bridge;
- cross-tab workspace state;
- panel geometry and journal state;
- clipboard actions;
- passive UserSide map capture;
- task staff recommendations and save-time task validation without Tampermonkey;
- optional modules included in the source userscript.

## Important validation note

Static compatibility does not prove authenticated behavior. Billing cookies, PP rebinding and real UserSide/Billing responses must be verified in the signed-in Chrome profile. Keep the Tampermonkey userscript disabled during extension tests, but retain it as the rollback version.

## Rollback

1. Disable the extension in `chrome://extensions`.
2. Re-enable userscript `2.0.0-dev.5.8` in Tampermonkey.
3. Reload Billing and UserSide.

The extension uses its own `chrome.storage.local`; it does not delete or modify Tampermonkey storage.

## Errors

- page console: `F12` → **Console**, filter by `[SIMNET-WB-EXT]`;
- manifest/content errors: `chrome://extensions` → extension → **Errors**;
- background bridge: `chrome://extensions` → extension → **Service worker** → **Inspect**.
