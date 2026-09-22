# Contextual reasoning — next steps (after spike deliverables)

**Branch:** `research/contextual-reasoning-finance-spike`  
**Date:** 2026-09-22

## What can be shipped now without architecture-core changes

1. **`billing.settlement-cycle` KB article** (already on branch) — domain model with CONFIRMED / WORKING HYPOTHESIS / NEEDS SIMNET VERIFICATION.
2. **L2/L3 eval fixtures** — behavior contracts for field discipline, temporary payment Case A/B, debt wording, dialogue continuity.
3. **Token measurement script** — `scripts/measure-lab-token-usage.mjs` against Lab/apiCost exports.
4. Prompt packaging cleanups that only **tag non-evidence** (customer claims, prior assistant text) and **strip Lab diagnostics** from model-facing synthesis input.
5. Optional deterministic **finance situation card** projection (compact evidence object) — still no third LLM stage.

## What to postpone

- New LLM stage for contextual financial interpretation.
- Resolver / canonical pipeline rewrite.
- Changing `accountBalance` semantics.
- Phrase-level intent matrices.
- Full temporal algebra (`eventAt` / `effectiveUntil`) until evals prove which fields are required.
- Merge into `main` or `feat/context-finance-identity-integration` before owner review.

## What requires SIMNET / operator confirmation

- Auto-block trigger when temporary payment is active.
- Temporary payment duration and removal conditions.
- Official wording: «долг» vs «недостаточно для периода».
- Prorate rules for new connection and pause resume.
- Whether `requiredForAccess` is a real Billing concept or operator heuristic.
- Payment posting SLA (if any official).
- Recalculation authority for first-line.

## Highest quality win

**Settlement-cycle knowledge + eval locks on expectation-mismatch** (especially temporary present/absent and debt confirmation probes).  
This improves explanations without touching core code paths.

## Highest token win

1. Measure real Lab turns with the new script.  
2. Remove duplicated instruction/diagnostics from model-facing final synthesis.  
3. Keep deterministic KB retrieval (already done).  
4. Compact evidence only — do not add another LLM pass.

## Architecture note

No structural defect requiring immediate core fix was found. Gaps are domain clarity, eval coverage, and prompt footprint — not the canonical/resolver polarity.
