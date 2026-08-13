# The dashboard is an action board, and every metric is a query

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
- **The margin card is only as good as Landed Cost discipline.** Landed Cost is pre-filled from the Selected Quote and then hand-edited to add shipping, duty and handling. If nobody edits it, the card overstates margin — silently. Whether v1 nags for it is a scope question for ticket 11.
- **Counting is not worth a card at this volume.** One win a month tells a ten-person team nothing. Where a metric is money, it shows money.
