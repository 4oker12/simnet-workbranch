# Contextual Reasoning / Finance Architecture Spike

**Branch:** `research/contextual-reasoning-finance-spike`  
**Base HEAD:** `e4bd884` — `test(ai-operator): lock exact balance fallback semantics`  
**Date:** 2026-09-22  
**Status:** Research (no production code changes yet)

---

## 1. Executive summary

The current SIMNET Autonomous AI Operator already implements the correct **architectural polarity**:

```
LLM = meaning + contextual explanation
Code = canonical facts + deterministic resolution
```

Finance is the hardest practical domain because one stable field (`accountBalance`) answers a simple question, but the *same* field is only one input into a multi-factor explanation when the user expresses **expectation mismatch** (“я же платил”, “вчера работало”, “откуда минус”).

**Recommendation (high level):**

1. **Do not** add a third LLM stage (`contextual financial interpretation`).
2. **Do** strengthen domain model + evidence projection + KB (`billing.settlement-cycle`) so the **existing final synthesis** can reason over relationships and time.
3. **Do** keep finance bundle + strict field semantics; expand temporal metadata only where real cases need it.
4. **Do** treat “expected financial state ≠ observed Billing/service state” as one generalized reasoning task, not N phrase scenarios.
5. Token cost is dominated by multi-stage prompts and repeated context; compact evidence and avoid duplicate diagnostics in final synthesis.

The foundation (canonical catalog, finance bundle, balance semantics, safety guards, instruction v6) is sound and must be preserved.

---

## 2. Current pipeline map

Observed production-oriented path (semantic runtime, not legacy `fact-runtime` recipe engine):

```
USER MESSAGE
    ↓
UNDERSTANDING (LLM) — semantic probe
  • whatUserWants / latestMessageMeans
  • knowledgeNeed gate
    ↓
DETERMINISTIC KB RETRIEVAL (no separate LLM knowledge-reflection)
  • searchKnowledgeLibrary → ≤3 candidate articles
    ↓
INFORMATION NEEDS → TOOL BROKER (deterministic mapping)
    ↓
CANONICAL FACT RESOLVER
  • expandFinanceBundleFacts when any finance path requested
  • source groups → billing.mainSummary / customer / userside / network
  • cache by entity key + TTL
  • evidence: status known | absent | unknown
    ↓
READ adapters (billing-summary-live, etc.)
    ↓
COMPACT EVIDENCE + KB snippets
    ↓
FINAL SYNTHESIS / REPLY (LLM)
  • central AUTONOMOUS_OPERATOR instruction
  • compact transcript + analysis + capabilities
```

Legacy / parallel paths still present in repo:

| Path | Role |
|------|------|
| `fact-runtime.js` + `fact-catalog.js` + recipes | Older deterministic turn engine; **not** driving current knowledge-probe experiment |
| `groq-planner.js` | Alternate planning JSON decision surface (tools + reply) |
| `basic-case-router.js` | Deterministic reply shaping for some finance cases |
| `finance-safety-policy.js` | Guard against unsupported future-payment claims |

**Important:** Knowledge reflection is already **direct retrieval**, not a full extra LLM pass — this aligns with the preference not to add stages.

---

## 3. Existing strengths

### 3.1 Canonical fact ownership

`canonical-fact-catalog.js` defines stable paths, e.g.:

- `subscriber.finance.balance.account` → `finance.accountBalance` (money)
- `subscriber.finance.balance.afterTariff` → `finance.balanceAfterTariff`
- `subscriber.finance.balance.withoutTemporary`
- `subscriber.finance.temporaryPayment`
- `subscriber.finance.totalDue` / `recurringTotal` / `payments`
- `subscriber.tariff.current.*`
- `subscriber.service.accessState` / `serviceState`

Legacy aliases (`accountBalance`, `balanceAfterCurrentPeriod`) map into canonical paths without changing meaning.

### 3.2 Finance bundle

`canonical-fact-resolver.js` expands any finance request into the full neighbor set in **one** Billing main-summary read. This is exactly the right pattern for contextual explanation without parallel resolvers.

### 3.3 Live read semantics

`billing-summary-live.js` explicitly indexes the **whole page** for “На счету, грн.” so account balance is never confused with derived rows. Zero is a real observed value; missing/unparseable rows are omitted (→ UNKNOWN / fallback).

### 3.4 KB style

`knowledge/README.md` and articles (`billing-finance.js`, `billing.js`) describe **concepts and boundaries**, not phrasebooks. Instruction v6 enforces:

- meaning → logic → evidence → reply  
- UNKNOWN ≠ NO  
- customer claim ≠ verified fact  
- prior AI reply ≠ evidence  

### 3.5 Safety

`finance-safety-policy.js` blocks invented future amounts while allowing arithmetic from confirmed price / period / balanceAfterTariff.

### 3.6 Tests locking critical semantics

- balance fallback regression  
- finance semantics (future payment uses balanceAfterTariff, not raw accountBalance)  
- named-login finance integration  
- canonical resolver characterization  

---

## 4. Current gaps

| Gap | Impact |
|-----|--------|
| No explicit **discrepancy frame** (user expectation vs system state) | Model must invent the task structure every time |
| Settlement-cycle knowledge split across several articles | Incomplete / inconsistent explanations for mid-month connect, pause, period boundary |
| Temporal metadata limited (`observedAt`; weak eventAt / period / effectiveUntil) | Hard to ground “вчера работало”, payment date vs block date |
| Negative display not always framed as “insufficient for period” vs “confirmed debt” | Risk of “у вас долг” from balanceAfterTariff alone |
| temporaryPayment presence is fact-gated in data, but explanation quality depends on synthesis | Case A vs B (“вчера работало” ± temporary) needs eval lock |
| Assistant history can still bias synthesis if not clearly tagged non-evidence | Self-correction path needs explicit prompt + eval |
| Token footprint: large system instruction + understanding + synthesis + evidence + diagnostics | Lab turns 10k–28k for short replies |
| Generalization pattern not named | Network/PON/tariff “yesterday vs today” reimplemented ad hoc |

---

## 5. Finance domain model

### 5.1 Stable fields (CONFIRMED in code + KB)

| Concept | Canonical path | Meaning |
|---------|----------------|---------|
| Account balance | `subscriber.finance.balance.account` | Money on account *now* (ЛК / “На счету”) |
| Tariff price | `subscriber.tariff.current.price` | Monthly internet tariff price |
| Total due | `subscriber.finance.totalDue` | Amount charged for **current calendar month** (end of month) |
| After tariff | `subscriber.finance.balance.afterTariff` | **Calculated** remainder after applying current-month charge — not “cash on hand” |
| Without temporary | `subscriber.finance.balance.withoutTemporary` | Same view with temporary credit removed |
| Temporary payment | `subscriber.finance.temporaryPayment` | Short internal credit, **not** subscriber’s own money |
| Recurring total | `subscriber.finance.recurringTotal` | Tariff + active add-ons when price is authoritative |
| Access / service state | `subscriber.service.accessState` / `serviceState` | Billing permission vs service lifecycle |

**Invariant (must never change):**  
`accountBalance` semantics must not be rewritten to mean “after tariff” or “required for access” for answer convenience.

### 5.2 Derived / interpretive notions (WORKING HYPOTHESIS)

| Notion | Status | Notes |
|--------|--------|-------|
| `requiredForAccess` | Hypothesis | Often ≈ amount needed so post-charge balance ≥ 0 or to lift block; may equal `|balanceAfterTariff|` or `|balanceWithoutTemporary|` when negative — **must verify per Billing behavior** |
| `confirmed debt` | Hypothesis | Negative display ≠ automatic debt narrative; need accessState + period + payments |
| Prorated mid-month charge | Partially in KB (`billing.billing-cycle`) | Tied to **confirmed start of consumption**, not late payment alone |
| Period boundary (1st of month) | Confirmed in practice/KB | New calendar month restarts full monthly requirement |

### 5.3 Relationship sketch (for synthesis, not code rules)

```
accountBalance          — cash now
totalDue / tariffPrice  — what this month costs
balanceAfterTariff      — cash after applying this month’s charge (projection)
temporaryPayment        — temporary mask on risk view
balanceWithoutTemporary — risk view without mask
accessState             — whether Billing allows service
payments[]              — history events (dates/amounts), not proof of expectation
```

Contextual questions recombine these; simple balance questions use only `accountBalance`.

---

## 6. Temporary payment model

**CONFIRMED (from KB + fields):**

- Temporary payment is a short internal credit, often near month start.
- It can keep access while masking a negative “without temporary” view.
- `temporaryPayment ≠ ordinary payment`; must not be added into “own money” narrative.
- Auto-block rule: any negative on the **relevant** balance can block (KB: even −0.01).

**Eval discipline:**

| Case | Evidence | Allowed explanation |
|------|----------|---------------------|
| A | “вчера работало” + temporaryPayment present | May use temporary coverage in explanation |
| B | same phrase + temporaryPayment absent/unknown | Must **not** invent temporary payment |

Do not invent duration, end date, or reason for temporary payment without evidence.

---

## 7. Settlement-cycle proposal

### Proposed article: `billing.settlement-cycle`

**Purpose:** single domain model page (not canned answers).

**Draft outline:**

1. **What is actual account balance** (`accountBalance`).
2. **What is tariff price / recurring total.**
3. **What balanceAfterTariff means** (projection after current-month charge).
4. **Insufficient funds vs confirmed debt** — negative display is not automatic “debt” wording.
5. **Calendar month as settlement unit** — payment date does not shift the period.
6. **New connection / mid-period activation** — proportional charge only when consumption start is confirmed (WORKING HYPOTHESIS / needs verification).
7. **Temporary payment** — mask, not real money.
8. **Pause / suspension** — effect on charge and access (mark needs verification where unknown).
9. **When operator must check payments / traffic / statuses.**
10. **When finance department / recalculation is required** — never invent refund amounts.

Every claim tagged:

- `CONFIRMED SIMNET RULE`  
- `WORKING HYPOTHESIS / NEEDS VERIFICATION`

**Migration:** fold overlapping content from `billing.balance`, `billing.billing-cycle`, `billing.temporary-payment`, `billing.auto-block`, `billing.insufficient-funds` into this article or cross-link with clear ownership to avoid drift.

---

## 8. Contextual reasoning architecture

### 8.1 Target capability (general)

```
understand task
+ hold conversation context
+ fetch correct facts
+ understand relations among facts
+ account for time
+ detect contradictions
+ explain situation to human
```

### 8.2 Finance instantiation of the general task

Many surface phrases collapse to:

```
User-expected financial / access state
        ≠
Observed Billing / service state
        →
explain nature of mismatch using verified evidence
```

**Not** nine hardcoded scenarios.

### 8.3 Stage question (section 17 of brief)

**Is a new stage `contextual financial interpretation` needed?**

**Recommendation: No.**

Reasons:

- Final synthesis already receives compact evidence + KB + transcript + understanding frame.
- Adding a third LLM pass increases tokens and risk of re-interpreting semantics.
- Domain structure belongs in **evidence shape + KB + light deterministic projections**, not another generative stage.
- Preference in brief matches current direction (knowledge reflection already removed).

**When a separate stage would be justified (not recommended now):**

- Only if evals prove final synthesis systematically fails relation reasoning *despite* rich evidence — then prefer **deterministic relation projection** (e.g. compact “finance situation card”) over a full LLM stage.

### 8.4 Proposed “finance situation card” (optional, deterministic, not LLM)

If needed later, a compact projection from evidence:

```json
{
  "accountBalance": 150,
  "balanceAfterTariff": -20,
  "temporaryPayment": 30,
  "balanceWithoutTemporary": -50,
  "totalDue": 250,
  "accessState": "...",
  "recentPayments": [{ "date": "...", "amount": ... }],
  "flags": ["post_tariff_negative", "temporary_present"]
}
```

Fed into final synthesis as structured evidence — still one LLM reply pass.

---

## 9. Evidence conflict strategy

```
do not auto-argue with the user
do not treat customer words as verified system fact
do not treat prior AI reply as evidence
↓
record discrepancy
↓
choose source that can verify
↓
refresh if needed
↓
use most relevant verified evidence
↓
explain confirmed part
↓
leave unknown as unknown
```

**Precedence notes (aligned with current resolver):**

- Fresh successful read beats stale cache.
- `known` + later `NOT_FOUND` must **not** auto-delete prior confirmed fact without explicit invalidation / refresh policy (already partially handled via `invalidatedAt` and TTL).
- Customer “у меня было 2000” → claim in context; live balance is authoritative for *current* state; history may support partial narrative if payments evidence exists.

---

## 10. Temporal reasoning

### Currently available

- `observedAt` on evidence / tool results  
- Payment row dates in `payments[]`  
- Scheduled tariff `effective` period (next month inference)  

### Needed for real cases (investigate before implementing all)

| Property | Use |
|----------|-----|
| `eventAt` | Payment / charge / block time |
| `effectiveFrom` / `effectiveUntil` | Temporary payment window, pause |
| `billingPeriod` | Calendar month of charge |
| `observedAt` | Snapshot freshness (already present) |

**Rule:** add only properties that evals show are required; do not build a full temporal algebra “because it looks clean.”

---

## 11. Generalization beyond Finance

Same pattern: stable measurement + contextual role.

| Domain | Stable fact | Contextual task |
|--------|-------------|-----------------|
| Network | session status / last event | “вчера работало, сегодня нет” |
| PON | RX = −25 dBm | “сигнал вроде нормальный, почему рвётся?” |
| Tariff | price / name | “мне обещали другую цену” |
| Equipment | link speed / ports | “роутер гигабитный, почему 100?” |
| Coverage | building GPON flag | “у соседа оптика есть” |

Architecture recommendation: one **discrepancy / expectation-mismatch** reasoning pattern + domain evidence bundles (finance already has the best bundle example).

---

## 12. Token audit

### Observed pressure points (from code structure)

| Stage | Input bulk | Notes |
|-------|------------|-------|
| Central instruction | Full AUTONOMOUS_OPERATOR (~large) | Repeated on understanding + synthesis |
| Understanding | transcript window + probe schema | Already compacted in places |
| Knowledge | ≤3 articles × ~900 chars | Deterministic; good |
| Tool / evidence | toolResults / compact facts | Must stay compact; avoid full HTML |
| Final synthesis | instruction + analysis + capabilities + transcript + evidence | Highest cost surface |
| Diagnostics | traces, candidates, gate metadata | Useful in Lab; strip from model-facing final prompt |

### Target classification

| Class | Examples |
|-------|----------|
| Model absolutely needs | Latest user text, semantic frame, compact verified finance fields, relevant KB snippets, short transcript |
| Can be compacted | Full tool payloads → evidence projection; long article text → summary + key rules |
| Can be omitted from model | SourceTrace internals, broadPayloadChars, HTML, duplicate diagnostics |
| Duplicated | Instruction text across stages; same facts in analysis and toolResults |
| Should be deterministic | Finance bundle expansion, field money parsing, future-payment arithmetic |

**Goal:** preserve reasoning quality while cutting Lab-turn tokens substantially — **without** returning to phrasebook rules.

**Practical next measurements (implementation later):**

For 3–5 real Lab turns build:

```
STAGE | INPUT_TOKENS | OUTPUT_TOKENS | WHAT IS IN INPUT
```

---

## 13. External research findings

*(Industry concepts only — not SIMNET rules.)*

### Common telecom/billing concepts

- Prepaid vs postpaid; advance / cycle billing  
- Prorating / partial month  
- Account credit; temporary credit / promise-to-pay  
- Authorization / soft reservation  
- Suspension / pause vs hard disconnect  
- Outstanding balance vs insufficient balance for next cycle  
- Billing / settlement cycle  

### What appears to match SIMNET (hypothesis)

- Calendar-month oriented recurring charge  
- Negative balance → service restriction (auto-block)  
- Temporary credit-like mechanism (`temporaryPayment`)  
- Projection of post-charge balance (`balanceAfterTariff`)  

### SIMNET-specific / still unknown

- Exact definition of when negative display is “debt” vs “insufficient for period”  
- Temporary payment duration and removal triggers  
- Precise prorate rules for new connect / pause resume  
- Payment posting SLA  

### Must verify from real Billing behavior

- Interaction of temporary payment with accessState  
- Whether balanceWithoutTemporary is the block trigger while temporary is active  
- Mid-month activation charge calculation source fields  

**Do not import another ISP’s policy as SIMNET fact.**

---

## 14. Proposed minimal code changes

**Phase R0 — research only (this doc).**

**Phase R1 — knowledge (low risk):**

1. Add `billing.settlement-cycle` article with CONFIRMED vs HYPOTHESIS tags.  
2. Align overlapping finance articles; avoid contradictory wording on debt vs insufficient funds.

**Phase R2 — evidence projection (optional, small):**

1. Deterministic compact finance situation object for synthesis input.  
2. Ensure temporaryPayment absence is explicit (`absent` / `unknown`) in projection.

**Phase R3 — prompt / token (no new LLM stage):**

1. Tag prior assistant claims as non-evidence in synthesis context.  
2. Strip Lab diagnostics from model-facing messages.  
3. Measure token table for sample turns.

**Phase R4 — evals only until green:**

1. L1/L2/L3 scenarios from section 16.  
2. No resolver rewrite unless evals prove structural failure.

**Explicitly deferred:**

- Second parallel resolver  
- Phrase-level intent matrix  
- Third LLM interpretation stage  
- Changing `accountBalance` meaning  

---

## 15. Files that would change (if proceeding)

| File | Change type |
|------|-------------|
| `src/features/ai-operator/knowledge/billing-finance.js` or new module | settlement-cycle article |
| `src/features/ai-operator/knowledge/index.js` | register article |
| `src/features/ai-operator/runtime-projection.js` (or similar) | optional finance situation card |
| `src/features/ai-operator/semantic-probe-runtime-base.js` / reply builders | non-evidence tagging, token trim |
| `tests/ai_operator_*finance*` / new eval fixtures | L1–L3 |
| **Not** `canonical-fact-resolver.js` core | unless proven necessary |
| **Not** catalog field meanings | locked |

---

## 16. Regression / eval plan

### L1 — deterministic regression

- Parsing money rows; zero vs missing  
- Canonical mapping + finance bundle expansion  
- Null does not overwrite real balance (existing lock)  
- Fallback to full Billing page  
- Cache TTL / refresh  
- Evidence precedence  

### L2 — semantic eval (paraphrase classes)

Same task, different wording — assert **task understanding + fact selection**, not exact reply string:

- balance amount  
- post-tariff vs account balance distinction  
- expectation mismatch after payment  
- negative display ≠ automatic debt  
- temporary present / absent for “вчера работало”  

### L3 — dialogue replay (5–15 turns)

balance → payment claim → temporary → “вчера работало” → new period → pause → recalculation question → topic switch → return to finance  

### Mandatory scenarios (from brief)

| Scenario | Must not |
|----------|----------|
| «сколько на счету?» | confuse with afterTariff |
| «что по балансу?» | same |
| «почему не работает, я же пополнил?» | invent payment posting |
| «у меня же деньги были» | invent cause without history |
| «почему опять минус?» | auto “долг” |
| «я только подключился, откуда минус?» | hardcoded new-connect rule without evidence |
| «вчера работало» ± temporary | invent temporary when absent |
| «две недели назад 1000 кидал» | date alone as full explanation |
| «там было две тысячи» | treat claim as live balance |
| «то есть у меня долг 170?» | confirm debt from afterTariff alone |
| «почему 0.99 показывает?» | explain field difference |
| «пауза в середине месяца» | invent exact refund |

### Generalization eval seeds

- Network: «вчера всё работало»  
- PON: «сигнал вроде нормальный, почему рвётся?»  
- Tariff: «мне же обещали другую цену»  
- Equipment: «роутер гигабитный, почему больше 100 нет?»  

---

## 17. What should NOT be changed

| Item | Rationale |
|------|-----------|
| Canonical field meanings (`accountBalance` etc.) | Stability of all downstream reasoning |
| Finance bundle expansion in resolver | Correct one-read neighbor pattern |
| Live page-wide index for “На счету” | Prevents derived-row confusion |
| Instruction polarity (meaning → evidence → reply) | Core product principle |
| Deterministic KB retrieval (no forced LLM reflection) | Token + control |
| Future-payment safety guard | Prevents hallucinated money |
| Rejection of regex intent matrices | Scalability |
| IDENTITY / subscriber binding rules | Safety |
| Existing green regression suite as baseline | Guardrail for any later code |

**Safe to extend:** KB articles, evidence projection compactness, evals, prompt packaging.

**Dangerous now:** rewriting resolver pipeline, adding LLM stages, soft-changing field semantics for nicer answers.

---

## 18. Open questions requiring SIMNET confirmation

1. Exact trigger field(s) for auto-block when temporary payment is active.  
2. Temporary payment typical duration and removal events.  
3. Official wording: when is negative balance “задолженность” vs “недостаточно для периода”?  
4. Prorate formula and required operator actions for mid-month activation / pause resume.  
5. Whether `requiredForAccess` exists as a Billing concept or only as operator heuristic.  
6. Payment posting delay / visibility rules (if any official).  
7. Recalculation authority and what first-line may promise.  

---

## 19. Recommendation

1. **Ship knowledge first:** `billing.settlement-cycle` with strict CONFIRMED vs HYPOTHESIS labeling.  
2. **Keep single final LLM synthesis**; invest in better evidence cards and conflict framing inside that pass.  
3. **Lock evals** for expectation-mismatch and temporary payment Case A/B before any structural code change.  
4. **Measure tokens** on real Lab turns; cut duplicates and diagnostics from model input.  
5. **Generalize** the discrepancy pattern beyond finance only after finance evals are green.  
6. **Do not** merge this research branch into main or `feat/context-finance-identity-integration` until owner review.

**One-line principle retained:**

> Canonical facts = stable reality. LLM reasoning = interpretation of that reality in a specific human context.

---

## Appendix A — Key source files reviewed

- `src/features/ai-operator/canonical-fact-catalog.js`  
- `src/features/ai-operator/canonical-fact-resolver.js`  
- `src/features/ai-operator/billing-summary-live.js`  
- `src/features/ai-operator/billing-tariff-normalizer.js`  
- `src/features/ai-operator/finance-safety-policy.js`  
- `src/features/ai-operator/knowledge/billing-finance.js`  
- `src/features/ai-operator/knowledge/billing.js`  
- `src/features/ai-operator/knowledge/README.md`  
- `src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md`  
- `src/features/ai-operator/semantic-probe.js`  
- `src/features/ai-operator/groq-planner.js`  
- `src/features/ai-operator/fact-runtime.js` (legacy path awareness)  
- `tests/ai_operator_finance_semantics_test.mjs`  
- `tests/ai_operator_reasoning_pipeline_test.mjs`  

## Appendix B — Next immediate actions on this branch

1. Owner review of sections 7, 8, 17–19.  
2. Confirm open questions (section 18) with Billing operators.  
3. Optionally add empty eval fixture skeleton (no behavior change).  
4. Token measurement script against Lab traces (read-only).  
