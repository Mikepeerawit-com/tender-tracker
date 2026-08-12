# 05 — Tender lifecycle and status model

Type: grilling
Status: resolved
Blocked by: —

## Question

`status: new | sourcing | quoted | won | lost | cancelled` is asserted as an enum with no workflow attached. An enum without transition rules is a free-text field with extra steps — and every dashboard metric depends on it meaning something.

Decide:

1. **Which transitions are legal**, and can a tender regress? (A "quoted" tender whose supplier withdraws goes back to `sourcing` — or does it?)
2. **Stored or derived?** This is the load-bearing part. Is a tender `sourcing` because someone set it, or because it has zero quotes? Is it `quoted` because it has ≥1 quote? Is it `won` only once a quote `is_selected` **and** cost/selling price are entered? A status users maintain by hand will drift from the data within a month, and then the dashboard lies. A fully derived status can't express intent. Most likely answer is a hybrid — name exactly which parts are which.
3. **`cancelled` vs `lost`.** These are different events (we withdrew / the client chose someone else) and conflating them destroys any future win-rate analysis. Confirm both are needed and define each.
4. **The deadline passes with nothing submitted.** What state is that? It is neither won nor lost nor cancelled, and it will happen.
5. **Does `won`/`lost` need a date of its own?** `updated_at` is not a decision date, and ticket 10's "won this month" needs a real column to filter on.

Model the states explicitly (a small state diagram in `CONTEXT.md` is worth more than prose here). Ticket 10 cannot define a single metric until this is settled.

---

## Resolution

**The single `status` enum is split in two and only half is stored.** See [ADR-0001](../../../docs/adr/0001-derived-progress-stored-outcome.md) and [ADR-0003](../../../docs/adr/0003-three-date-lifecycle.md).

**Progress — derived, never stored.** `new` (no Quotes) → `sourcing` (some Items quoted) → `quoted` (every Item that isn't `no_bid` has ≥1 Quote) → `submitted` (`submitted_at` set). Computed on read, so it cannot drift. Question 1 (legal transitions) dissolves: derived state has no transitions to police, and regression is automatic and correct — delete the last Quote on an Item and the Tender is `sourcing` again.

**Outcome — stored, human-set, nullable, and per Tender Item.** Values: `won | lost | no_bid | cancelled`. Per-Item because clients do split awards across suppliers. `no_bid` = we chose not to bid; `cancelled` = the client pulled it — both confirmed necessary (question 3), and both excluded from the win-rate denominator, which is `won / (won + lost)`.

**Tender-level outcome is derived** by this rule, in order:
1. Any Item with null Outcome → the Tender has no Outcome; it is still open.
2. Else consider only Items whose Outcome is `won` or `lost`. If empty → `no_bid` if any Item is `no_bid`, else `cancelled`.
3. Else all `won` → **won**; all `lost` → **lost**; mixed → **partial**.

`partial` is display-only and can never be stored.

**Question 4 — the deadline passing — was the wrong question**, because there is more than one deadline. `buildspec_1`'s single `submission_deadline` conflated three moments: `internal_quote_deadline` (per Tender), `client_submission_deadline`, and a client decision on a date we don't control (`expected_decision_date`, nullable, usually unknown). Plus actuals `submitted_at` and per-Item `outcome_at`.

So "overdue" is **three unrelated derived conditions**, none stored:
- **Sourcing Overdue** — internal deadline passed, an Assignee has entered no Quotes at all. Ours, fixable, concerns that Assignee.
- **Submission Missed** — client deadline passed with `submitted_at` null. Fatal; concerns the Owner. This is the failure the product exists to prevent.
- **Awaiting Decision** — submitted, Outcomes unrecorded. Not a failure; the normal resting state of a live Tender. `buildspec_1` had no name for the state the business spends most of its time in.

**Question 5 — yes.** `outcome_at` sits on `tender_items` beside `outcome`. `updated_at` is not a decision date. Consequence for ticket 10: "won this month" must pick a grain, and the money lives at the Item grain.
