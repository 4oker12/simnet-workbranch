# CALL transcription pipeline

## Purpose

Turn a completed PBX call into reusable Workbench evidence without creating a second call-registration implementation.

The authoritative identity rules do not change:

1. UserSide `/message/call_list` remains the canonical completed-call source.
2. The current CALL binding/correlation selects the subscriber.
3. PBX `getrec.php?id=...` is only the audio source for that already selected call.
4. The transcript is a derived evidence artifact, not identity evidence by itself.
5. UserSide registration still goes through the existing native form and `CALL_REGISTRATION_SUBMIT` path.

## Runtime path

```text
UserSide call_list
      |
      | callKey + usersideCallId + recordUrl
      v
CALL registration UI
      |
      | "Транскрибировать"
      v
MV3 service worker
      |
      | authenticated GET
      v
PBX /fop2/getrec.php?id=...
      |
      | audio Blob (memory only)
      v
http://127.0.0.1:8000/transcribe
      |
      | SSH -L tunnel
      v
Vast.ai / faster-whisper large-v3
      |
      | simnet-transcript-v1 JSON
      v
Workbench transcript evidence store
      |
      +--> textarea[name="comment"] in native UserSide form
      |
      +--> later: transcript -> structured facts -> Case/AI/Guide
```

## Why localhost instead of exposing Vast

Workbench has host permission only for PBX and local `127.0.0.1/localhost`. The Vast API stays bound to `127.0.0.1:8000`; an SSH local-forward connects the browser machine to it.

Benefits:

- no public unauthenticated ASR port;
- no PBX/UserSide cookies on Vast;
- Vast IP/SSH port can change without changing extension code;
- failure is local and explicit: closed tunnel means transcription is unavailable, while normal CALL registration keeps working.

## Transcript evidence

Stored under `simnet_workbench_transcripts_v1`, bounded to 120 entries / 14 days.

Each entry contains:

- canonical `callKey` when available;
- `usersideCallId`, `customerId`, PBX record id;
- full transcript text and segment timestamps;
- language and probability;
- ASR profile;
- audio duration, processing time and realtime factor;
- transcriber request id;
- SHA-256 and byte length of the audio actually transcribed;
- `analysis: null` reserved for the next stage.

Audio itself is not persisted by Workbench or the transcriber.

## Operator behavior

The transcription assistant injects one secondary button into the existing registration form.

- normal click: reuse a cached transcript for the same call if present;
- `Shift+click`: force a new PBX download and ASR pass;
- empty comment: transcript becomes the draft;
- existing comment: transcript is appended instead of destroying operator text;
- very long text: the UserSide draft is capped, while the full transcript stays in local evidence storage;
- registration is never auto-submitted by the transcription module.

The last point is deliberate. Existing binding, wrong-card protection and anti-double-submit logic remain the gatekeeper for the write into UserSide.

## Failure boundaries

### PBX fails

Workbench reports PBX HTTP/auth/audio errors. No call state is changed and the normal registration form remains usable.

### SSH tunnel / Vast fails

Workbench reports transcriber fetch/timeout errors. No public fallback endpoint is attempted.

### ASR fails

No transcript evidence is stored unless a valid non-empty transcription response is returned.

### UserSide registration fails

Handled by the existing CALL registration logic; transcription does not bypass or reinterpret the response.

## Next stage: transcript -> structured facts

The evidence schema intentionally reserves `analysis` for an LLM/structured extraction result. That stage should be implemented after real transcripts are collected and the output schema is fixed.

Recommended shape:

```json
{
  "problem": "...",
  "diagnosticsAlreadyDone": [],
  "facts": [],
  "recommendedNextSteps": [],
  "sentiment": null,
  "confidence": 0.0
}
```

Only structured facts that can be tied back to transcript spans should be promoted into Case/LIVE automatically. Recommendations should remain advisory. Transcript-derived identity must never override a unique UserSide `call_list.customerId`.
