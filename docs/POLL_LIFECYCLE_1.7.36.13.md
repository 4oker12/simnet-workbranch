# OLT poll lifecycle — 1.7.36.13

## Real break confirmed by `abon507126-poll-desync.json`

The native Billing poll can return from an explicit request URL

`a=313&id=...&act=askolt&olt_ip=...`

to a plain poll surface

`a=313&id=...`

while the same request is still active. Previous reader logic required `act=askolt` to remain in the current URL, so the later page was read as `requestObserved=false` even when the durable poll attempt still matched the action/Billing id.

That split produced competing states:

- `operations.poll.current.pending=true`
- `diagnostic.readyForOnuPoll=true`
- no confirmed `live.oltSnapshot`

## Canonical flow

1. Native `Запрос OLT` click creates one durable attempt.
2. `deriveCurrentPollState(caseData)` projects that attempt against the current Billing binding.
3. Billing reader correlates the active attempt by action + Billing id + optional OLT, even if `act=askolt` / `olt_ip` were stripped.
4. Terminal parser decides whether real equipment output exists. Native profile/source rows are not terminal evidence.
5. Terminal evidence resolves the attempt immediately.
6. Background retires stale or binding-mismatched pending attempts before recomputing diagnostics.
7. `diagnostic.pollState` drives PON `wait_poll` / retry / ready decisions.
8. LIVE pending consumes the same `diagnostic.pollState`; its timer never mutates lifecycle state.
9. A manually opened page with real terminal output may create `billing-poll-page` LIVE evidence without inventing an ActionSession. Unverified page evidence is shown as `observed`, not silently promoted to workflow completion.

## Current poll projection

`idle | pending | confirmed | failed | timeout | superseded`

Binding checks apply before a historical terminal result can control the current route. A confirmed result for an old OLT/action is therefore historical evidence, not proof that the current binding was polled.

## Conflict rule

`case.conflicts` remains audit history of canonical fact changes. Current PON conflict count comes only from the present Billing↔TMC comparison.
