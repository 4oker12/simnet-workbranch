# Finance decision-node audit — before real Lab tests

Starting revision: `6bbb91e4b21af63a637f707f3715563655b48604`.
Scope: research delta against `e4bd884`, no baseline failure investigation,
no production merge, no changes to PR #27.

## Findings in the research delta

1. **Settlement knowledge lost at synthesis boundary.** The new article started
   with a long explanation of confirmation labels. Both semantic retrieval and
   runtime projection cap article text at 900 characters. The delivered prefix
   lacked `balanceAfterTariff`, `totalDue`, `temporaryPayment`, `unknown`, and the
   access-coverage/final-settlement distinction. A full-article keyword test was
   green without checking the delivered text.
   Fix: put an 822-character domain synopsis first, preserving the existing cap,
   full article, resolver, and number of LLM stages. The regression now checks
   real top-three retrieval plus final runtime projection for the representative
   financial-discrepancy query. This is not a guarantee of retrieval for every
   possible semantic frame.

2. **Reconstructed turn usage was presented as the full session without checking
   the session meter.** On the real `simnet-ai-operator-lab-2026-09-22_11-14-20.json`
   export: 10 customer events, 10 experiment results, 10 reconstructed totals.
   Results sum to **178073**, exactly matching reconstruction. Current-turn
   understanding **14177** + reply **14440** = **28617**, counted once.
   `reply_with_knowledge` is correctly classified as reply. However,
   `apiCost.session.input` **165632** + output **28477** = **194109**.
   Difference: **16036**. The export does not establish the cause or the customer
   turn allocation of that difference. Do not invent retries or allocate the
   residual to a turn. The tool now reports both totals, reconciliation status,
   signed difference, and an explicit warning. Existing `session.total` remains
   the reconstructed total for compatibility. Tests cover matching, larger,
   smaller, zero, missing, and null meter values.

The archived export was used for usage verification only. It does not establish
which Git revision produced its replies and is not an A–D run of this revision.

## Decision nodes and evidence of coverage

| Node | Audit result | Remaining real-Lab check |
|---|---|---|
| Semantic request → requiredFacts | Existing named-login integration checks identity bootstrap before subscriber reads. Semantic frame and final answer are mocked there. | Natural follow-ups, corrections, topic return, wrong subscriber exclusion. |
| Finance bundle | One source read exposes all 11 compact bundle facts; requested account balance retains its identity. | Observe actual tool trace and missing neighbor fields. |
| Canonical money extraction | Targeted probes: accountBalance, balanceAfterTariff, totalDue, temporaryPayment × positive/zero/negative/null/missing = 20 passing cases. Values stay in distinct paths. | Real DOM/source formatting and ambiguity. |
| Evidence availability | Stale → unknown/STALE_FIELD; NOT_FOUND and source failure → unknown with source code: 3 passing probes. | Unknown must remain unknown in the generated explanation. |
| Payments | Empty array, populated array, missing field: 3 passing probes. | No invented posting, debit, date, or causal history. |
| Access and cache | Known access preserved; fresh cache reused; explicit refresh replaces old amount: 3 passing probes. | Correction must actually request/obtain appropriate fresh evidence. Explicit resolver refresh support alone does not prove automatic correction handling. |
| Temporary payment | Numeric/null/missing covered above. Article says present evidence is not proof of the historical cause or expiry. | Present vs absent with identical wording; unknown; historical-only; expired with unknown end; conflicting observations. No expiry fact is manufactured. |
| KB retrieval → synthesis | Confirmed truncation defect fixed and tested at runtime projection boundary. | Real semantic frame must retrieve appropriate rules; generic retrieval still retains only two article bodies in final compact knowledge. |
| User claims and old AI replies | Existing AUTONOMOUS_OPERATOR distinguishes claim, prior answer, knowledge, and evidence; new short KB synopsis preserves that distinction. | User correction versus prior confident AI answer, competing evidence, and a topic switch. |
| Final synthesis | Deterministic evaluator tests are green but use supplied replies, not live model generations. Its text heuristics are review aids, not a semantic oracle. | Brevity, uncertainty, factual grounding, causality, tool necessity, and dialogue continuity must be judged on actual replies and traces. |

Total ad hoc deterministic state probes: **29 passed**. These are synthetic
source responses, not calls to live Billing or LLM.

## Validation

- At starting HEAD, the eight research CI test files passed locally (14 Node test
  entries). No full `npm test` or known baseline failure suite was run.
- After the edits, both modified regression files passed, including the new
  projection and meter reconciliation checks.
- The modified meter was rerun against the real export and the exact four
  reconciliation values above were asserted. `git diff --check` passed.

## Live test handoff

Live A–D tests are **pending**, not passed. This workspace has repository access
and an archived export, but no connection to the operator's local Chrome
extension or authenticated Billing session. No provider credential is needed
in chat; run in the existing local Lab.

1. Update this research branch with a clean working tree and reload the unpacked
   extension so the KB change is loaded. Start a fresh Lab session and record
   the exact Git SHA, model, knowledge mode, and subscriber identity.
2. Scenario A, one message at a time: subscriber login → «что по балансу?» →
   «почему тогда 0.99 показывает?» (use the real displayed value if different) →
   «то есть денег хватает?» → «я должен что-то сейчас?» → «то есть это долг?».
   Compare against the actual Billing fields and export the complete JSON.
3. Scenario B: payment claim → last payment → negative → prior funds → where
   funds went. Compare only to observed current values and dated payment history.
4. Scenario C: separate sessions for a confirmed temporary-payment subscriber
   and a subscriber with confirmed absence. Use the same «а вчера же работало»,
   then own-money, expiry, tariff switch, and finance return follow-ups. Missing
   or failed field extraction does not qualify as confirmed absence.
5. Scenario D: challenge an incorrect amount; inspect refreshed evidence,
   source conflicts, correction, and unsupported historical explanations.
6. Report NEW FAIL or changed behavior with turn, requiredFacts, evidence status,
   KB actually delivered, tool trace, reply, expected property, and base/head
   attribution. Do not label an unversioned historical reply as a regression.

Do not optimize token usage using per-turn reconstructed totals as the full
session cost while reconciliation reports a mismatch.
