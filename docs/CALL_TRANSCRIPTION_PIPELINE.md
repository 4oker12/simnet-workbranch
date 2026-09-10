# CALL transcription pipeline

## Shared path

Workbench uses one shared audio/transcript stack:

```text
PBX recording
  -> local Workbench service worker
  -> localhost/Vast transcriber
  -> Whisper transcript evidence
  -> Groq AI postprocess
```

The transcript is the shared evidence artifact. It can then be consumed by either UserSide CALL registration or the manual PBX history analysis flow.

## UserSide CALL registration

UserSide `/message/call_list` remains the canonical source of completed-call identity/correlation. Existing binding, wrong-card and anti-double-submit invariants are preserved. Transcription only prepares evidence/text; final registration still uses the existing native UserSide submit flow.

## Manual PBX history analysis

PBX history is a second manual entry point into the same transcription stack, not a second automatic CALL/correlation contour.

For a PBX row with a stable `getrec.php?id=<recordId>` Workbench creates a local job keyed by:

```text
pbx:<recordId>
```

Operator UX:

```text
✦ -> DL -> TXT -> AI… -> AI
```

- `✦`: explicit operator request to analyse that recording;
- `DL`: authenticated PBX audio fetch;
- `TXT`: Whisper/transcript stage;
- `AI…`: Groq postprocess;
- `AI`: structured analysis ready;
- final `TXT`: transcript is preserved but AI is unavailable;
- `!`: PBX/ASR failure.

The PBX page also gets a lightweight `Workbench · PBX` shell showing analysis counts and AI configuration status. It intentionally does not run subscriber diagnostics from the UserSide/Billing rail because PBX history is a different page context.

## AI runtime

Groq secrets are never committed into the repository. The API key is stored locally in `chrome.storage.local` under `simnet_workbench_ai_runtime_v1` and can be configured from the Workbench Settings UI.

The MV3 background path is service-worker-safe: AI runtime configuration is loaded asynchronously without top-level `await` during module evaluation.

Call-analysis fallback order:

```text
qwen/qwen3.6-27b
  -> openai/gpt-oss-120b
  -> qwen/qwen3.8-27b
  -> openai/gpt-oss-20b
```

`401/403` are treated as key/authentication problems. `429`, timeout or temporary model/provider failure can advance to the next configured model. The standard call-analysis budget is bounded to roughly 20k input characters and up to 1800 completion tokens.

## Standard analysis profile

The default profile is fact-preserving and conversation-grounded:

- cleaned transcript without translation;
- summary;
- issue/reason for contact;
- operator actions that were actually performed;
- result;
- explicitly agreed next step.

The standard profile does not rate the operator's personality or intelligence. Future optional profiles (`operator review`, `technical`, `service`) can reuse the already stored transcript without rerunning Whisper.

## Safety invariants

- manual PBX analysis never calls `save_call`;
- manual PBX analysis never calls `CALL_REGISTRATION_SUBMIT`;
- transcript-derived identity never overrides a unique UserSide `call_list.customerId`;
- PBX audio is not kept as a persistent Workbench artifact after transcription;
- transcript remains available if Groq fails;
- Groq key is not included in diagnostics/export.
