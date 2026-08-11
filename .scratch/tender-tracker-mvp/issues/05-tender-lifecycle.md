# 05 — Tender lifecycle and status model

Type: grilling
Status: open
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
