# PBX manual call analysis

Version: `1.7.36.109-pbx-manual-call-analysis`

## Goal

The PBX history page remains operator-driven: nothing is transcribed automatically. Each row that contains a PBX `getrec.php?id=<UniqueID>` recording gets Workbench controls next to the existing `запись разговора` link.

Flow:

1. Operator opens `https://pbx.simnet.kiev.ua/...` call history.
2. Workbench reads the row and extracts the PBX recording `recordId`.
3. `✦` explicitly starts processing for that one call.
4. The extension service worker downloads the authenticated PBX recording.
5. The recording is posted to the existing local/Vast transcriber tunnel (`/transcribe`).
6. The transcript is persisted in `chrome.storage.local` by PBX `recordId`.
7. If Workbench AI is configured, the transcript is sent for a structured support-call analysis.
8. The PBX row shows status (`DL`, `TXT`, `AI…`, `AI`, `!`). Hovering the result badge shows the saved result; the transcript is available inside the same card.

## Important separation

This feature does not replace or change the normal CALL registration workflow. The existing UserSide `call_list` path remains the primary source for automatic call registration/correlation. PBX manual analysis is a separate operator-selected workflow for historical calls.

## Persistence

Jobs are keyed by PBX recording `recordId` and stored under:

- `simnet_pbx_manual_analysis_jobs_v1`

This means the result is attached to the call itself rather than to a particular DOM row. Reloading the PBX page restores the status/result.

## Transcriber endpoint

Default:

- `http://127.0.0.1:8090`

The worker posts multipart audio to:

- `POST /transcribe`
- `language=auto`
- `profile=simnet`

Configuration storage key:

- `simnet_pbx_manual_analysis_config_v1`

Supported fields:

```json
{
  "transcriberBaseUrl": "http://127.0.0.1:8090",
  "language": "auto",
  "profile": "simnet",
  "aiEnabled": true
}
```

The default matches the previously tested local tunnel to the Vast transcriber. A different tunnel URL can be written through the background message `PBX_MANUAL_ANALYSIS_CONFIG_SET`.

## AI behavior

AI is deliberately downstream of transcription. If the local Workbench Groq configuration is unavailable, the job is retained as `transcribed`: the PBX UI shows `TXT` and the transcript remains usable. Once AI is configured, pressing `↻` retries the AI stage from the saved transcript without re-downloading/re-transcribing the audio.

The AI prompt sends the transcript and minimal call timing/operator metadata. It does not send the PBX phone/contract/address metadata as separate prompt fields.

## Smoke test

1. Start the existing local tunnel to the Vast transcriber and verify `http://127.0.0.1:8090/health`.
2. Reload the unpacked Workbench extension.
3. Reload an authenticated PBX history page.
4. Confirm a `✦` control appears next to each row that has a valid recording UniqueID.
5. Pick a short non-sensitive test call and press `✦`.
6. Expected row progression: `DL` → `TXT` → `AI…` → `AI` (or `TXT` when AI is not configured).
7. Hover `AI`/`TXT` and verify the saved result.
8. Reload PBX and verify the same call still shows its saved state.
9. Confirm the normal UserSide CALL registration flow still works unchanged.

## Known live dependency

The extension worker fetches the PBX recording with `credentials: include`. Static tests can verify the code path, but the first live test must confirm that the authenticated PBX session cookie is accepted for an extension-origin fetch. If the PBX cookie policy blocks that request, the fallback is to move only the recording download into the PBX content script and keep transcription/AI/state in the background worker.
