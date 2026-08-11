# 10 — Dashboard metrics: definitions

Type: prototype
Status: open
Blocked by: 04, 05

## Question

"Active tenders, due this week, won this month, total quoted value" are **labels, not definitions**. Each needs an exact query, and each needs to justify its place on the screen. Build a rough dashboard to react to (`/prototype`) with realistic fake data — including the awkward cases, not just the tidy ones.

Using the settled status model (05) and currency decision (04), pin down:

1. **"Active tenders"** — which statuses count? Is a `quoted` tender awaiting a client decision active? Is one past its deadline with no outcome recorded still active, or does it need its own treatment (see 05, question 4)?
2. **"Due this week"** — rolling 7 days or calendar week (and starting Monday or Sunday)? **In whose timezone?** Users may be in different countries; a deadline stored as a date has no timezone, and "due this week" computed client-side will differ per user. Decide where this is computed.
3. **"Won this month"** — by what date? `updated_at` is not a decision date. If 05 didn't add a `decided_at`/`won_at` column, this metric has nothing honest to filter on, and that's a finding to send back.
4. **"Total quoted value"** — does it survive 04 at all? If there's no reporting currency, this metric cannot exist as stated. Replace it (count of open tenders? value of *selected* quotes only, which is a smaller and more meaningful number?) or cut it.
5. **Does each card earn its place?** Four cards is a default, not a decision. With under 10 users tracking a modest tender volume, a metric nobody acts on is clutter. Cutting is a valid outcome — scope is negotiable.

**Output:** the prototype linked from this ticket, plus a written definition per surviving metric precise enough to write the query from. If a metric requires a schema change, say so explicitly — ticket 12 needs to carry it.
