# Operator audit integration — 2026-10-04

Integrated and corrected the external 0d8c669 patch against the tree published as de014c5 on research/contextual-reasoning-finance-spike.

## Changes

- Runtime tool data and statePatch use an unbounded JSON-state clone, not diagnostic compaction. The broker preserves patches and cached state across turns/checkpoints. Credentials are redacted; structured network authorization status is retained. Diagnostic projections remain bounded.
- Missing Billing technology falls through to UserSide. Already resolved alternatives and already attempted source reads are reused, including failures; unavailable evidence stays unknown. No recursive fallback chain.
- General product questions trigger local knowledge retrieval in auto mode even when semantic understanding incorrectly says knowledge is unnecessary. The existing off mode is respected. Tests inspect the actual final-generation payload and article text.
- NEW_OCCUPANT reaches final synthesis and dialogue memory. Previous-contract finance, tariff and service evidence is excluded from the new resident's answer context; finance arithmetic is disabled for that relationship. A degraded fallback cannot quote the previous contract's amount as the new resident's obligation. General knowledge and building/technical checks remain available.
- Stored Billing reads retain the original observation timestamp. Field timestamps survive persistence. Fallback metadata separates the failed attempt from the observation. An expired snapshot plus BILLING_AUTH_REQUIRED cannot become fresh successful evidence.
- Tariff speed parsing accepts explicit Mbit/Mbps/Мб/с/Gbit tokens adjacent to punctuation. A bare price is not a speed.
- Consumption-start questions request the dedicated service.startDay fact instead of the contract date. Zero is preserved as source data; its business meaning is unverified and must not be called a date or an unset setting.
- Replay includes canonical source traces and request metadata, merges duplicate trace entries, and excludes cache hits from read counts. Execution, fact coverage and answer heuristics are reported separately. No detected issue is explicitly NOT semantic validation of the answer.
- Instruction v12 and its generated artifact are synchronized; the new module is included in syntax checks.

## Verification

- Clean baseline: 822 tests, 687 passed, 135 failed.
- Full integration run: 841 tests, 706 passed, the same 135 failures by test name; no new failures.
- Final bounded-source-reuse adjustment: 20 audit regressions pass. Combined audit/resolver/discount run: 47 tests, 42 passed and the same five pre-existing resolver failures; no new failure names.
- Syntax checks and git diff whitespace checks pass.
- One old source-regex test pinned the removed compaction function. Replaced it with execution of customer.snapshot and deep equality of the returned discount, including a collection exceeding the old truncation limit.

## Limits

No live provider-model run and no authenticated Billing/UserSide end-to-end run was performed. Model HTTP responses and source failures were simulated; this proves payload/wiring behavior, not real conversation quality. The existing 135 suite failures remain open. The original address incident, guest-page remote recovery and relocation destination selection are not newly validated by this audit. Empty Billing results still do not prove lack of coverage; GPON availability and current subscriber technology remain distinct facts. startDay zero semantics still require source/business confirmation.
