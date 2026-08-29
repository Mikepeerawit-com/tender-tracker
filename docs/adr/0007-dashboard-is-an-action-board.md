# The dashboard is an action board, and every metric is a query

> **Amended by ticket 11 (v1 scope).** The action board splits in two on cost, and only one half ships in v1. The three **action blocks** — Submission Missed, Sourcing Overdue, Coming up — are the tender list's grouping and sort order, so they ship. The two **money cards** — Bids out with clients, Margin won this month — are deferred to v1.1 on this ADR's own reasoning: it deleted the count cards because *"counting is not worth a card at this volume"*, and two money figures over six tenders are the same argument in a different unit. Deferring costs nothing, because the metrics need **no new columns**. Ticket 11 also settled the Landed Cost question left open below, and its answer **does** add one column — see Consequences.

`buildspec_1` specified four cards — "active tenders, due this week, won this month, total quoted value". Building them against a deliberately awkward dataset showed that all four are **labels, not definitions**, and that three of them are wrong in ways invisible from the card itself. A dashboard that lies quietly is worse than no dashboard, so each surviving number is specified here as a query.

The deeper change is what the cards are *for*. `buildspec_1`'s four answer "how are we doing". Under ten users opening the app at 9am need "what do I do next", so the cards are drawn from ADR-0003's three overdue conditions instead — each names something a specific person does, today.

## The surviving metrics

All date boundaries compute server-side in the org timezone (ADR-0005). All money is THB at the rate frozen on the Quote (ADR-0004 currency decision), and every per-unit figure is multiplied by `tender_items.quantity` — the grain `buildspec_1` never stated anywhere.

- **Submission Missed** (count). `submitted_at IS NULL AND client_submission_deadline < today AND no Item has an Outcome`. The failure the product exists to prevent.
- **Sourcing Overdue** (count). Tenders past `internal_quote_deadline`, not submitted, no Outcome, with at least one Item that has **neither a Quote nor a No Supplier Found**. The third sourcing state is load-bearing: counting "Items with no Quote" nags an Assignee who already answered.
- **Bids out with clients** (THB). Over submitted Tenders with at least one undecided Item: `SUM(selling_price_per_unit × quantity)` for Items whose Outcome is **null**. An already-won Item is money banked, not money at stake.
- **Margin won this month** (THB). Over Items with `outcome = 'won'` and `outcome_at` inside the current month: `SUM((selling_price_per_unit − landed_cost_per_unit) × quantity)`.
- **Coming up** (list, not a card). Both `internal_quote_deadline` and `client_submission_deadline` falling in a **rolling 7 days**, each row labelled with which deadline it is.

## What was cut

**"Total quoted value" is deleted, not repaired.** It does not survive ADR-0004: Assignees compete rather than divide, so one Tender Item routinely carries six to eight Quotes for the same goods — including the same supplier quoted independently by two Assignees. Summing Quotes overstated the test dataset by **7.3×** (฿7.20M against a realistic ฿986K), and it multiplied a per-carton price by a per-box quantity for good measure. "Bids out with clients" replaces it.

**"Active tenders" is deleted as a card** and survives only as the default filter on the tender list: not submitted, not written off (`no_bid`/`cancelled`), and not already Submission Missed. Its four defensible readings gave 8 / 8 / 5 / 7 on ten Tenders, which is the definition of a label. The literal `buildspec_1` reading was the worst of them — it counts Tenders we never sent, declined to bid, and had cancelled, and it only ever decreases when someone submits, so a missed deadline inflates "active" forever.

## Consequences

- **No new columns.** `submitted_at`, `outcome`, `outcome_at`, `quantity`, `selling_price_per_unit` and `landed_cost_per_unit` already carry every metric. ADR-0001's `outcome_at` is what makes "won this month" honest; without it the metric would have had to filter on `updated_at`, which is not a decision date.
- **Submission Missed must be excluded explicitly.** No column implies it — it is the absence of one.
- **A Tender appears in exactly one place.** Submission Missed, Sourcing Overdue and Awaiting Decision each get their own block, and none of those Tenders is repeated in the list below. The list is "work I still have to do".
- **The margin card is only as good as Landed Cost discipline.** Landed Cost is pre-filled from the Selected Quote and then hand-edited to add shipping, duty and handling. If nobody edits it, the card overstates margin — silently. ~~Whether v1 nags for it is a scope question for ticket 11.~~ **Settled by ticket 11: neither nag nor block — mark it.** A Landed Cost still at its pre-filled value is **Unconfirmed**, and any Margin derived from one renders as provisional rather than as a number. This is the **one new column** in v1 (`landed_cost_confirmed_at`), a deliberate exception to "no new columns" above: a silently-wrong margin is precisely the failure this ADR exists to prevent, and inferring "untouched" by comparing against the frozen Quote price breaks the moment shipping happens to be zero. Note this marker matters in the **comparison view** regardless of the money cards being deferred — that is where margin is actually read.
- **Counting is not worth a card at this volume.** One win a month tells a ten-person team nothing. Where a metric is money, it shows money.

## Amendment, 29 August 2026 — the blocks were two taxonomies, and the list now groups by Progress

The decision above holds: this screen answers "what do I do next", every Tender appears in exactly one place, and there are no metric cards. What a design pass found is that the **five blocks were never one taxonomy**, and that the inconsistency is felt by readers as the screen being hard to learn.

Four of the five name **urgency** — how much trouble a Tender is in. `awaiting_decision` names a **phase**, and on this screen it is not merely similar to Progress `submitted`, it is exactly that set: `isAwaitingDecision` is `submittedAt !== null && tenderOutcome === null`, and any Tender with an Outcome has already left the list (`worklistBlock` answers `null`). So one heading in an otherwise urgency-sorted list was a Progress heading wearing different words.

**The list now groups by Progress** — the term `CONTEXT.md` already defines, in the order it already defines: Not started → Sourcing → Quoted → Submitted, each header carrying its count and a four-segment scale showing where in the journey the group sits. "Phase" was considered as the word for this and rejected: `CONTEXT.md` lists *stage* under `_Avoid_` for exactly this concept, and a second name for one idea is how a glossary rots.

**Submission Missed is pinned above the groups as the single exception.** That is this ADR's own strongest claim — it is the failure the product exists to prevent — and a dead Tender rendered as one row inside "Sourcing" with a small red mark is the one outcome the block was invented to stop.

**Urgency did not disappear; it moved from the heading onto the row**, as an indicator lamp plus the sentence naming the date and how far off it is. This is what keeps "a Tender appears in exactly one place" true: it appears once, under its Progress, and its trouble is stated on it rather than by which pile it landed in.

### What this costs and what it buys

- **`coming_up` and `everything_else` stop being headings.** What they encoded moves into the row's own sentence — "Quotes due tomorrow", "Deadline passed 6 days ago" — which carries strictly more than the old chip did: the chip said *which* deadline, the sentence says which **and how far**.
- **Awaiting Decision survives as a term** in `CONTEXT.md`, unchanged. It still names submitted-with-Outcomes-unrecorded. It simply stops being a heading, because Progress `submitted` draws the same set and one of the two had to go.
- **Sort order within a group is unchanged** — soonest Client Submission Deadline first, inherited from `listTenders` exactly as the blocks inherited it. Grouping decides which pile; it never decides the order inside one.
- **Classification order is unchanged where it matters.** Submission Missed is still tested first, and a recorded Outcome is still the only way off the list.
- **A kanban board was considered and rejected.** Progress is derived and never stored (ADR-0001), so a card cannot be dragged between columns — the gesture a board exists to offer is one this domain cannot honour. Four columns also cannot survive 390px without the sideways scrolling ADR-0009 names as its failure bar, and ten Tenders across four columns is two cards a column. The group headers' four-segment scale is what was kept from the idea: the movement is legible, without promising it is draggable.
