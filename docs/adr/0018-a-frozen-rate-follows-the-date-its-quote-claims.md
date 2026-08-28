# A Frozen Rate follows the date its Quote claims

Ticket 55 ([#55](https://github.com/Mikepeerawit-com/tender-tracker/issues/55)) makes a Quote correctable for the first time. That reopens a rule `CONTEXT.md` states flatly — a **Frozen Rate** is *"never re-fetched"* — because until now nothing could change about a Quote after it was written, and the rule never had to say what it was refusing.

**It is refusing time, not arithmetic.** Correcting a price keeps the rate. Correcting `quoted_at` re-freezes it against the new date.

## Why the date is the exception and the price is not

`createQuote` does not freeze *today's* rate. It calls `freezeRate` with `on: input.quotedAt`, and `freezeRate` fetches the rate published for that day. `fx_rate_as_of` has therefore never meant "the day somebody typed this in" — it means **"the rate for the day this Quote claims the supplier gave the price"**. The two fields are one fact recorded twice.

So a `quoted_at` edit that leaves the rate alone produces a row the create path could not produce: a Quote dated one day carrying the rate for another. That is not an inconsistency of taste. It is a row that fails the invariant every other row in the table satisfies, and nothing downstream is written to notice — the comparison sheet renders `fx_rate_as_of` beside the converted figure exactly as if it still matched.

A price edit has the opposite shape. The date is unchanged, so the rate for that date is unchanged, and re-fetching could only introduce a difference — a later ECB revision, or a **Stale Rate** where the original was live. Keeping it is what the glossary is protecting.

## This is not the rule being weakened

The reason a Frozen Rate exists is that *no total may move because a currency did*. Somebody read a ranking; the ranking must still be reproducible from the row a year later. Every hazard that guards against is a hazard of **elapsed time acting on an unchanged Quote** — and none of them is in play here, because the Quote did not sit still. A human asserted that the supplier gave this price on a different day than the record says.

Once that assertion is accepted, the old rate is not the reproducible one. It is the rate for a day this Quote no longer refers to. Re-freezing is what keeps the row honest, and refusing to re-freeze would preserve the letter of "never re-fetched" by breaking the thing it was written to guarantee.

## What follows from it

- **Editing `quoted_at` re-runs the freeze** — `fx_rate_mid`, `fx_rate_applied`, `fx_rate_as_of` and `fx_rate_is_stale` are all rewritten from the new date. Rewriting some but not others would leave the buffer visible against the wrong mid, and `fx_rate_is_stale` asserting freshness the new pair may not have.
- **Editing anything else leaves all four untouched**, price included. A correction to a digit is not a claim about a currency.
- **A re-freeze can fail the same way the first one can.** The new date may fall where Frankfurter is unreachable and the currency has never been quoted, which is the existing `no_rate` refusal. An edit that cannot be converted is refused and the row is left as it was — the same trade the create path already makes, for the same reason.
- **A re-freeze can land on a Stale Rate**, and it is recorded as stale rather than refused. An Assignee fixing a date must no more be stopped by a service in Frankfurt than one entering a price was.
- **The currency is not editable by this route.** Changing the currency changes what the stored `unit_price` *means*, which is a different Quote rather than a correction to this one; delete and re-enter is the honest path and #55 provides it.
- **Nothing recomputes historically.** A Quote nobody edited is bit-for-bit what it was, which is the whole guarantee. Re-freezing is triggered by a human editing the date and never by a clock, a cron or a backfill.
