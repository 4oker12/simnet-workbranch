# SIMNET Workbench — known-good HOME/WORK baseline

Date: 2026-09-21

This document pins the working production-like baseline before further refactoring.

## Operator-visible success criteria

PBX manual call analysis must work from the `Разобрать` button and produce:

1. PBX audio fetch
2. local Workbench upload to the ASR endpoint
3. Whisper `large-v3` transcription on CUDA
4. AI post-processing through the active provider
5. `Спросить по разговору` answers from the saved transcript

Verified end-to-end on 2026-09-21.

## ASR invariant

Workbench always talks to one local endpoint:

- `http://127.0.0.1:8090`

That local endpoint forwards to Vast:

- remote ASR: `127.0.0.1:8000`
- model: `large-v3`
- device: `cuda`
- compute type: `float16`
- GPU: `NVIDIA GeForce RTX 3090`
- profile: `simnet`

The PBX/UI code must never depend on the public Vast address directly. Only the launcher/tunnel layer may know the Vast SSH endpoint.

## WORK mode

At WORK:

- Billing/UserSide/PBX use the direct corporate route.
- Only the ASR SSH forward is required for transcription.
- Local ASR remains `127.0.0.1:8090`.
- A healthy already-running expected SSH forward must be reused, not rejected or recreated.

Expected forward semantics:

`127.0.0.1:8090 -> Vast 127.0.0.1:8000`

Both OpenSSH spellings are valid and must be treated as equivalent:

- `-L 8090:127.0.0.1:8000`
- `-L 127.0.0.1:8090:127.0.0.1:8000`

## HOME mode

At HOME:

- Workbench uses the Vast HOME transport for SIMNET web/PBX access.
- ASR still appears to the extension only as `127.0.0.1:8090`.
- Browser/PBX transport and ASR transport may share one SSH process, but the extension must not care.
- HOME/WORK switching must not change PBX transcription code or AI code.

## Vast transcriber startup rule

Remote Git state is not a runtime dependency when the transcriber is already healthy.

Launcher order must be:

1. Check remote/local transcriber health.
2. If healthy: reuse it and skip `git checkout/reset/pull/bootstrap`.
3. Only bootstrap/recover Git when the service is actually unavailable.

Reason: a healthy transcriber must not be taken offline by unrelated repository filesystem errors such as `Stale file handle`.

## AI invariant

The active AI provider is selected from Workbench AI settings.

Current verified provider:

- provider: `deepseek`
- model: `deepseek-flash`

The API key stays only in `chrome.storage.local` of the Workbench Chrome profile and must never be committed, logged, exported, or copied into this repository.

PBX call analysis and `Спросить по разговору` must use the active provider only. They must not display or execute Groq/Qwen fallback chains when DeepSeek is active.

## Current Vast endpoint

Current instance endpoint during this verification:

- host: `142.111.146.204`
- SSH port: `32140`

This endpoint is operational data, not a permanent architectural constant. Replacing/recreating the Vast instance may change it. The long-term launcher must keep this value in local/private runtime configuration, while the extension continues to use only localhost endpoints.

## Known launcher defects to eliminate

1. `Start-WorkbenchSupervisor.ps1` performs remote Git recovery before accepting an already healthy transcriber; this can fail on `Stale file handle` even though ASR is working.
2. WORK tunnel reuse currently expects only one textual `-L` representation and can reject the equivalent working `-L 8090:127.0.0.1:8000` tunnel.
3. The rail settings enhancer still contains legacy Groq/Qwen labels and fallback UI even when DeepSeek is the active provider.

These are stabilization defects, not reasons to change the PBX/ASR architecture.
