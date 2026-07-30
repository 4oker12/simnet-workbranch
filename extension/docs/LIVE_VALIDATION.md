# SIMNET Diagnostic Workbench Extension — live validation

Date: 2026-07-30

## Build

- extension: `0.5.0`;
- Workbench source: `2.0.0-dev.5.8`;
- browser: signed-in Chrome profile;
- Tampermonkey: disabled by the operator.

No contract numbers, session tokens, PP values or subscriber data are included in this report.

## Passed checks

### UserSide

- Extension content scripts loaded.
- Storage compatibility cache initialized.
- Workbench `2.0.0-dev.5.8` started and completed initialization.
- Exactly one `#dp-panel` exists.
- The old POC panel is absent.
- No extension startup notice is present.
- Billing session is confirmed and the authenticated-tab bridge reports ready.
- The previous completed diagnostic state was restored from extension storage.
- After a page reload, exactly one panel was created again.
- Console error count after validation: `0`.

### Billing

- Extension content scripts loaded.
- Storage compatibility cache initialized.
- Workbench `2.0.0-dev.5.8` started and completed initialization.
- Exactly one `#dp-panel` exists.
- The old POC panel is absent.
- No extension startup notice is present.
- Billing session and current-page PP state are confirmed.
- Workspace is idle and available for a new run.
- Console error count after validation: `0`.

### Cross-tab behavior

- UserSide sees the ready Billing bridge.
- UserSide and Billing show the same completed diagnostic status.
- State remains available after reloading UserSide.
- Both tabs return to the idle/free role after the completed operation.

## Not automatically repeated

The original smoke-test did not start another subscriber diagnostic because no dedicated test contract was selected for that validation pass. Mentor-mode live checks are recorded separately after the extension is reloaded. It also did not deliberately repeat:

- active-operation STOP;
- a new ONU poll;
- a new PON-port analysis;
- UserSide map evidence capture;
- clipboard export.
- submission of a real task through the integrated task-staff validation module.

The browser already showed a successfully completed diagnostic through the extension. The remaining checks should be exercised against a designated test contract to avoid unnecessary live requests.

## Result

The migration baseline is operational in Chrome without Tampermonkey. Manifest loading, Workbench startup, shared extension storage, Billing bridge visibility, state restoration, reload behavior and error-free initialization are confirmed on both target systems.
