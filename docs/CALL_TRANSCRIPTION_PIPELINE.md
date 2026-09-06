# CALL transcription pipeline

## Scope

PR #9 keeps one shared audio/transcription stack and exposes it through two operator workflows.

### 1. UserSide registration flow

```text
UserSide call_list
  -> correlated/selected CALL
  -> PBX getrec.php recording
  -> Vast transcriber
  -> CALL_TRANSCRIPT evidence
  -> optional review in registration UI
  -> normal UserSide registration submit
```

The existing CALL correlation, binding, wrong-card and anti-double-submit rules remain authoritative. Transcript-derived identity must never override a uniquely resolved UserSide customer.

### 2. Manual PBX history analysis

```text
PBX call history
  -> operator explicitly clicks the Workbench icon on one recording
  -> pbx:<recordId> manual job
  -> PBX getrec.php recording
  -> same Vast transcriber
  -> same transcript storage
  -> Groq postprocessor
  -> compact AI result next to that PBX row
```

This is not a second automatic CALL-correlation contour. PBX history is a manual entry point: the operator chooses which historical call is worth listening to/analyzing. No UserSide registration is performed from this path.

## Audio boundary

Only `https://pbx.simnet.kiev.ua/fop2/getrec.php?id=<recordId>` is accepted as PBX audio source. The MV3 service worker fetches the file using the current PBX session and holds the audio Blob only in memory while sending it to the transcriber.

The transcriber is reachable only through local HTTP (`127.0.0.1`/`localhost`) intended for an SSH `-L` tunnel to the Vast instance.

## Transcript evidence

Transcript entries are bounded local evidence. They include call key, UserSide call/customer ids where known, PBX record id, text/segments, detected language/probability, ASR profile, duration, processing time, RTF, request id, audio SHA-256 and byte size.

Manual PBX history uses `callKey = pbx:<recordId>` so the result survives page refresh/navigation and can be restored beside the same PBX recording.

## AI postprocessing

The postprocessor does not invent diagnosis or identity. It cleans ASR output and returns only conversation-grounded fields:

- summary;
- issue;
- operator actions;
- result;
- explicitly agreed next step;
- cleaned transcript text.

For the manual PBX workflow these fields are shown in the hover/focus card beside the selected recording. If Groq is unavailable or no local API key is configured, the Whisper transcript remains saved and the row is marked as transcript-ready rather than losing the result.

## Runtime states for manual PBX analysis

```text
✦ -> queued -> DL -> TXT -> AI… -> AI
```

- `✦` — not analyzed yet;
- `DL` — PBX recording download;
- `TXT` — Whisper transcription;
- `AI…` — postprocessing;
- `AI` — analysis ready;
- `TXT` after completion — transcript ready, AI unavailable/failed;
- `!` — PBX/transcription failure.

The result is persisted in `chrome.storage.local` by PBX record id and rehydrated when PBX history is opened again.

## Safety/invariants

- manual PBX analysis never calls `save_call`;
- manual PBX analysis never sends `CALL_REGISTRATION_SUBMIT`;
- no automatic bulk transcription of the PBX table;
- processing starts only from an explicit row click;
- normal CALL registration remains usable if PBX/Vast/Groq is unavailable;
- PBX audio is not persisted by Workbench after upload to the transcriber.

## Browser smoke test

1. checkout PR #9 branch `feat/transcript-evidence-orchestration`;
2. reload unpacked Workbench;
3. open authenticated `pbx.simnet.kiev.ua` call history;
4. verify `✦` appears next to rows that contain `getrec.php?id=...`;
5. ensure the local Vast tunnel/transcriber health is reachable;
6. click `✦` on one short call;
7. observe `DL -> TXT -> AI… -> AI`;
8. hover/focus `AI` and verify summary + transcript;
9. refresh PBX and verify the result is restored for the same `recordId`;
10. separately smoke-test the existing UserSide registration/transcription path.
