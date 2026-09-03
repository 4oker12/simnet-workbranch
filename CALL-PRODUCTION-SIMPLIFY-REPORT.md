# CALL production simplify report — v1.7.36.107

## Production behavior

- Real `/message/call_list` is the primary CALL source. TEST/Frozen controls remain internal compatibility code and are not mounted in the operator production flow.
- A unique `call_list.customerId` is authoritative for that call. The card open behind CALL is only page context and cannot replace the call owner.
- Cross-card registration is supported: if the call belongs to customer B, it can be registered while customer A or a task page is open. The native UserSide form is requested for B.
- Header/form phone/submit validation use the call target; current `activeCase` phone fallback was removed to prevent cross-card contamination.
- If `call_list` has no customer, evidence can resolve the target only when exactly one non-conflicting candidate reaches >=80.
- Native UserSide form loading is lazy and the existing native parse/serialize/submit path is preserved.
- Closing CALL fully removes its host; a later rail click recreates it, with one event-driven self-heal retry if the host fails to mount. No polling/watchdog loop was added.

## Operator UI

- Header: `Звонок` / `Регистрация` plus one resolved subscriber identity.
- Snapshot: call line, compact chronological evidence, `Выгрузить`, `Зарегистрировать`.
- Removed from normal UI: duplicate call_list/candidate explanations, TEST/Frozen picker/HUD, verbose hints, duplicate subscriber blocks, bottom `Закрыть/Отмена` where the top × already closes the modal.
- Evidence-only unresolved calls still show a concise candidate/confidence or `Абонент не определён`; authoritative call_list calls do not show redundant 100% scoring.

## Snapshot export

`simnet-call-snapshot-v2` exports only the selected call window:
- call id/key/time/duration/direction/phone/operator extension;
- resolved target and source;
- compact counts;
- chronological evidence events.

It does not export the whole Workbench Case, `contexts`, `journal`, or raw internal candidate arrays.

## Safety / preserved behavior

- UserSide call_list parser/repository and canonical call keys are unchanged.
- Snapshot lifecycle and immediate CALL_END freeze are unchanged.
- Background call_list-first resolver and submit customerId guard remain intact.
- Existing UserSide registration form serialization/submission is not replaced.
- Billing group word search is absent; native `select[name=grp]` is untouched.

## Validation

Targeted production contracts pass, including:
- authoritative cross-card target;
- modal close/reopen;
- lazy registration;
- call-scoped v2 export;
- compact operator UI;
- evidence-only unique target fallback;
- UserSide call_list parser;
- live-session lifecycle;
- search/session correlation;
- snapshot lifecycle/migration;
- LIVE identity enrichment;
- version consistency.

Full test-directory result after this patch: **103 PASS / 21 FAIL**. The 21 failures are the same legacy TEST/Frozen/debug expectation set already present in v1.7.36.106; no new production regression was added.
