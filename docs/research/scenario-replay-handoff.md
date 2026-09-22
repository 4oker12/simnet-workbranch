# AI Operator Dialogue Policy + Scenario Replay handoff

Date: 2026-09-23
Branch: `research/contextual-reasoning-finance-spike`

## Scope

This work closes the main gaps found in the 2026-09-22 Lab audit without replacing the existing semantic → canonical facts → READ evidence → synthesis architecture.

All concrete logins, contracts, amounts, tariff/status strings and customer utterances below are regression fixtures/illustrations only. Production logic must not depend on them.

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
- corrected-intent required facts are now carried **before** canonical resolver execution;
- deterministic balance-coverage arithmetic uses integer cents and source-backed balance + current tariff price;
- no calendar/date claim is derived from arithmetic without a source-backed billing calendar anchor.

`start_day` / exact service-consumption-start-day is intentionally not catalogued yet: no reliable raw/parser path was confirmed in the current repository audit. Keep it UNKNOWN until the Billing source semantics are verified.

## Phase 2: Scenario Replay

New runtime modules:

- `src/features/ai-operator/scenario-replay.js`
- `src/features/ai-operator/scenario-replay-cases.js`
- `src/features/ai-operator/scenario-replay-background.js`
- `src/ui/ai-operator-scenario-replay.js`

The background entry loads Scenario Replay alongside the existing Lab and HelpCrunch Replay. The two replay systems remain separate.

### Execution semantics

Inside one scenario:

```text
turn N
  → await the same runIsolatedLabCase used by Lab
  → preserve transcript
  → preserve returned toolState
  → next turn
```

No turn concurrency is allowed inside a dialogue. Each fresh scenario starts from a fresh transcript/tool state; state is shared only between turns of that scenario.

The preserved state includes subscriber/domain context and dialogue state. Checkpoints are saved before turns so a failed/incomplete path can be replayed from the same conversation state.

### Controls

Lab UI provides:

- Run scenario
- Run all
- Stop
- Rerun failed
- Compare last 2
- Export JSON

The backend also supports single-turn rerun from checkpoint.

### Scenario catalog

10 realistic scenarios × 8 turns:

1. neutral dialogue;
2. colloquial wording;
3. typos;
4. very short follow-ups;
5. multiple questions in one turn;
6. irony/jokes;
7. frustrated customer;
8. terminology correction;
9. returning to an earlier topic;
10. gradual context with a named login.

They exercise identity, finance, tariff/current-vs-general scope, building availability, access family, memory, repetition, corrections and Dialogue Police behavior.

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

## Verification performed

Pure Scenario Replay regression tests were executed locally and passed:

- catalog contains exactly 10 scenarios with 8 turns each;
- turns are strictly sequential (max in-flight = 1);
- tool state produced by one turn is received by the next;
- checkpoint state is restored correctly;
- Stop prevents the next turn from starting;
- compare reports reply/policy changes;
- failed/incomplete rerun target selection works.

New test files include:

- `tests/ai_operator_scenario_replay_test.mjs`
- `tests/ai_operator_dialogue_runtime_state_test.mjs`
- `tests/ai_operator_finance_decision_nodes_test.mjs`
- `tests/ai_operator_dialogue_fact_carry_test.mjs`

No GitHub Actions workflow/status is configured for the current branch, so a full repository CI run was not observed from GitHub. The next local checkout should run `npm test` before merge.

## Important remaining live checks

1. Run `new_home_correction` in real Lab and confirm turn 7 reuses `subscriber.access.connectionFamily` and triggers the correct READ path without cancelling the intent.
2. Run `named_login_gradual` and confirm identity is established before subscriber facts.
3. Run the frustrated/irony scenarios and inspect Dialogue Police counts for repeated offers, unnecessary address requests and capability overclaims.
4. Validate the general tariff catalog against current SIMNET KB data; do not treat `[ПАУЗА]` or any other current service state as the tariff catalog.
5. Verify the real Billing source/semantics for service-consumption start day before adding a canonical fact.
6. Run the repository-wide tests locally before any merge.

## Recent implementation commits

- `3db50be` — dialogue memory + deterministic finance decisions
- `93a2edb` — sequential Scenario Replay backend and scenarios
- `4d4645f` — Lab Scenario Replay controls
- `a123f74` — corrected-intent facts carried before resolver; finance canonical inputs corrected
- `f972bf0` — Replay report/status semantics and 30-run history

No merge to `main` was performed.
