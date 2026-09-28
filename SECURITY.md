# SIMNET Workbench security model

Workbench is a browser-side operator tool. The security boundary is intentionally simple: the normal product may use explicitly configured integrations, while the **SAFE DEMO** profile is built as an internal-only variant for review and demonstration.

## SAFE DEMO

Build it with:

```powershell
npm run package:safe-demo
```

The generated package uses `manifest.safe.json` as its runtime `manifest.json`.

The SAFE DEMO manifest grants host access only to the internal Workbench targets used by the browser UI:

- `userside.simnet.kiev.ua`
- `admin.simnet.kiev.ua`
- `admin.looknet.kiev.ua`
- `pbx.simnet.kiev.ua`

It deliberately omits:

- Groq and DeepSeek API hosts;
- HelpCrunch;
- `127.0.0.1` / `localhost` transcriber access.

The service worker also activates an explicit outbound fetch guard when the SAFE DEMO manifest is loaded. This is defense in depth: the demo profile does not rely only on UI switches.

The external-AI controls in Settings are visibly locked in SAFE DEMO.

## What remains in the source tree

Optional integrations are not deleted. Transcription, external LLM providers and HelpCrunch remain separate capabilities in the normal Workbench source so they can continue to be developed and used deliberately.

SAFE DEMO removes their active network boundary instead of forking or duplicating their business logic.

## Data handling principles

- READ-only is the default for operator data access.
- Existing authenticated browser sessions are reused; Workbench does not require a separate public backend for the internal UI.
- API keys are stored in `chrome.storage.local` and are not logged by the AI configuration module.
- Transcription accepts only the local loopback URL in the normal profile; a remote transcriber URL cannot be configured directly in the extension.
- Production actions must be distinguished from recommendations or intended actions; describing an action does not mark it as executed.
- Test fixtures and logs must not contain real subscriber personal data.

## Verification

The SAFE DEMO boundary is covered by `tests/safe-demo-profile.test.mjs`, which checks that forbidden external/loopback hosts are absent from the demo manifest, the HelpCrunch page bridge is not injected, and the service-worker outbound guard is present.

For an independent review, inspect the packaged `manifest.json` and capture the browser traffic while using SAFE DEMO. Security claims should be verified from permissions and observed traffic rather than accepted as a verbal guarantee.
