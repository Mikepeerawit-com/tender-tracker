# Handoff: ticket 09 — quote comparison view prototype

**What to do in the new session:** run `/prototype` against ticket
[`issues/09-quote-comparison-view.md`](issues/09-quote-comparison-view.md). Everything
it was blocked on (tickets 01 and 04) is now resolved.

**This is a prototype, not the app.** Throwaway code on a `prototype/comparison-view`
branch, with realistic *awkward* fake data — not tidy data. Its value is the argument
it settles, not the code.

## Read these first

| Source | Why |
|---|---|
| `CONTEXT.md` | The vocabulary. Use these words exactly; don't invent synonyms. |
| `docs/adr/0002-tender-item-cardinality.md` | Why a Tender has Items and a Quote prices one Item |
| `docs/adr/0004-assignees-compete-not-divide.md` | Why the same supplier can legitimately appear twice on one Item |
| `issues/01-…md` §Resolution | Cardinality, quantity/unit, unit-mismatch rule, suppliers table |
| `issues/04-…md` §Resolution | THB, frozen rates, the 2% buffer, how "cheapest" may be displayed |

Do **not** build from `tender-tracker-buildspec_1.md`. It is superseded on every point
that matters to this screen and is retained only as provenance.

## Constraints this screen must respect

These are settled. The prototype explores *presentation*, not whether these hold.

- **A Tender has many Tender Items.** The screen is organised by Item; "cheapest" is
  only meaningful within an Item, never across a Tender.
- **Quotes carry a unit price** plus their own `quoted_unit`. Where a Quote's unit
  differs from its Item's unit, **the screen must refuse to rank that Item** and say
  "unit mismatch — compare manually". Never silently convert pack sizes.
- **Reporting Currency is THB, and conversion must never look authoritative.** The
  supplier's original amount and currency is the primary number; the THB figure is
  visually secondary and labelled with its rate and `as_of` date. Highlight the lowest;
  do not stamp it "CHEAPEST".
- **The same supplier can appear twice on one Item**, quoted by two different
  Assignees at different prices. This is expected and informative — surface it
  explicitly ("Shanghai Kindly quoted by Somchai ¥42.00 and Nok ¥45.50"), never dedupe.
- **At most one Selected Quote per Item.** Zero is normal.
- **Cost is Landed Cost** — editable, pre-filled from the Selected Quote's converted
  THB price, because supplier prices often exclude shipping. `selling_price` is on the
  Item. Margin is computed, never entered.
- **An Assignee can record "No Supplier Found"** against an Item. The screen should
  show that state — it is different from, and more useful than, an empty column.

## Questions the prototype exists to answer

1. **Does side-by-side survive reality?** It reads well with 3 suppliers and collapses
   at 8 — and with competing Assignees, 8 is realistic. Prototype both a card layout
   and a dense table. Multi-Item plus multi-supplier is a 2D problem on a 1D screen;
   that tension is the main thing to resolve.
2. **Where does "Requested: X vs Quoted: Y" live?** Alternative-product quotes must be
   impossible to miss — and must still read clearly when *most* quotes are alternatives.
3. **Mixed currencies, honestly.** Per the rules above.
4. **Selection and pricing.** Marking a Quote Selected, then entering Landed Cost and
   selling price with margin computed live. Inline on the selected Quote, or a separate
   step?
5. **Photos without domination.** Multiple images per Quote, several Quotes on screen.
   Thumbnails, lightbox, count badge?
6. **New — attribution.** Every Quote now has a colleague attached to it. Does showing
   who sourced each Quote help the purchasing decision, or is it noise that belongs
   only on the notification? The screen works either way; find out which reads better.

## Fake data to use

Build the awkward case, not the tidy one: a 4-Item Tender, 3 Assignees, 6 suppliers,
quotes in THB / CNY / USD, one Item where two Assignees both quoted the same supplier
at different prices, one Item with a unit mismatch (asked in pieces, quoted per box of
50), one Item with two Alternatives and no exact match, and one Item marked
No Supplier Found by one Assignee but quoted by another.

## Output

The prototype on its branch, linked from ticket 09 (not pasted in), plus the decisions
it settled written into the ticket's Resolution. If it forces a schema change, say so
explicitly — ticket 12 has to carry it.

## After this

Ticket 10 (dashboard metrics prototype) is also unblocked, and should come second —
what this screen turns out to need shapes which metrics are worth building. The map's
remaining path is 09 → 10 → 07 (once 06 is done) → 11 → 12.
