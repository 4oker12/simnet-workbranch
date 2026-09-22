# AI Operator Dialogue Policy + Scenario Replay handoff

Date: 2026-09-23
Branch: `research/contextual-reasoning-finance-spike`

## Scope

This work closes the main gaps found in the 2026-09-22 Lab audit without replacing the existing semantic → canonical facts → READ evidence → synthesis architecture.

All concrete logins, contracts, amounts, tariff/status strings and customer utterances used in tests are regression fixtures/illustrations only. Production logic must not depend on them.

## Phase 1 status

Implemented/landed on the branch:

- fact-level evidence gate: successful tool execution is not treated as proof that a requested fact was returned;
- named-login identity flow before subscriber-specific reads;
- `billing.main_summary` registry/identity-path regression coverage;
- Dialogue Police with developer-visible violation codes;
- capability boundary for unsupported action promises;
- unnecessary address/general-product safeguards;
- dialogue state with discourse acts and active intents;
- CORRECT keeps the parent unresolved intent; CANCEL cancels it;
- dialogue memory stores active requests/facts and already explained facts;
- corrected-intent required facts are carried **before** canonical resolver execution;
- deterministic balance-coverage arithmetic uses integer cents and source-backed balance + current tariff price;
- no calendar/date claim is derived from arithmetic without a source-backed billing calendar anchor.

`start_day` / exact service-consumption-start-day is intentionally not catalogued yet: no reliable raw/parser path was confirmed in the current repository audit. Keep it UNKNOWN until the Billing source semantics are verified.

## Phase 2: Scenario Replay

Runtime modules:

- `src/features/ai-operator/scenario-replay.js`
- `src/features/ai-operator/scenario-replay-cases.js`
- `src/features/ai-operator/scenario-replay-background.js`
- `src/ui/ai-operator-scenario-replay.js`

The background entry loads Scenario Replay alongside the existing Lab and HelpCrunch Replay. The two replay systems remain separate.

### Real subscriber is the test object

Scenario Replay does **not** contain hardcoded subscriber ids.

The operator explicitly enters a real Billing identity in a separate field:

```text
[ contract / login ] → customer.lookup → confirmedSubscriber → selected scenario
```

Accepted inputs:

- numeric contract;
- `abonNNN` form;
- normal Billing login.

The identity bootstrap is deterministic and happens before the first dialogue turn. It is not counted as one of the scenario turns and does not require the scenario text to repeat the contract/login.

A run starts only after `customer.lookup` returns a confirmed subscriber case. The run stores a compact subject snapshot (`caseId`, billing id, contract/login, name, address, connection family when available).

`Run all` performs the identity bootstrap once and starts every scenario from a clone of the same real subscriber state. This makes all 10 variants comparable against the same subscriber.

### Execution semantics

Inside one scenario:

```text
real confirmedSubscriber/toolState
  ↓
turn 1
  → await the same runIsolatedLabCase used by Lab
  → preserve transcript
  → preserve returned toolState
turn 2
  → same subscriber + state from turn 1
...
```

No turn concurrency is allowed inside a dialogue. State is shared only between turns of that scenario. Each scenario in `Run all` starts from a fresh clone of the same confirmed real-subscriber seed state.

The preserved state includes subscriber/domain context and dialogue state. Checkpoints are saved before turns so a failed/incomplete path can be replayed from the same conversation state.

### Controls

Lab UI provides:

- real subscriber contract/login input;
- Run scenario;
- Run all;
- Stop;
- Rerun failed;
- Compare last 2;
- Export JSON.

The backend also supports single-turn rerun from checkpoint.

### Scenario catalog

10 subscriber-agnostic scenarios × 8 turns:

1. neutral dialogue;
2. colloquial wording;
3. typos;
4. very short follow-ups;
5. multiple questions in one turn;
6. irony/jokes;
7. frustrated customer;
8. terminology correction;
9. returning to an earlier topic;
10. gradual context.

They exercise finance, tariff/current-vs-general scope, building availability, access family, memory, repetition, corrections and Dialogue Police behavior against the selected real subscriber.

## Per-turn diagnostics

A scenario turn records:

- customer text and agent reply;
- semantic intent / latest-message meaning / discourse act;
- requested, returned and unknown canonical facts;
- compact fact evidence;
- tools and result codes;
- KB article ids;
- Dialogue Police violations;
- token usage and elapsed time;
- dialogue/subscriber state before and after;
- checkpoint before the turn.

A turn is not marked incomplete merely because semantic `unresolvedRequests` is non-empty. Incomplete status is based on observable failure signals such as degradation, unknown requested facts or `NON_ANSWER`.

## Regression coverage added

Tests now cover:

- exactly 10 scenarios with 8 turns each;
- no hardcoded `abon408980` / `giv1984` or leading subscriber id in scenario fixtures;
- strict sequential execution (max in-flight = 1);
- the same seeded confirmed subscriber remains the object across all turns;
- checkpoint preserves the subscriber state;
- Stop prevents the next turn from starting;
- compare reports reply/policy changes;
- failed/incomplete rerun target selection;
- dialogue correction fact carry;
- deterministic finance decision nodes;
- Dialogue Police wiring;
- fact-level evidence and identity flow.

Relevant test files include:

- `tests/ai_operator_scenario_replay_test.mjs`
- `tests/ai_operator_dialogue_runtime_state_test.mjs`
- `tests/ai_operator_finance_decision_nodes_test.mjs`
- `tests/ai_operator_dialogue_fact_carry_test.mjs`

These tests were added/updated in the branch. This GitHub editing environment did not run the full repository test suite; run `npm test` from a local checkout before merge.

## Important remaining live checks

1. Enter a real contract in Scenario Replay and confirm the subject line shows the actual subscriber returned by Billing.
2. Run `real_subscriber_correction` and confirm turn 7 reuses `subscriber.access.connectionFamily` and triggers the correct READ path without cancelling the intent.
3. Run frustrated/irony scenarios and inspect Dialogue Police counts for repeated offers, unnecessary address requests and capability overclaims.
4. Validate the general tariff catalog against current SIMNET KB data; do not treat `[ПАУЗА]` or another current service state as the tariff catalog.
5. Verify the real Billing source/semantics for service-consumption start day before adding a canonical fact.
6. Run repository-wide tests locally before any merge.

No merge to `main` was performed.
