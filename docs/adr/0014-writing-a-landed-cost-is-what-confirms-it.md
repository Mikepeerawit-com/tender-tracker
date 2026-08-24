# Writing a Landed Cost by hand is what confirms it

Ticket 28 ([#28](https://github.com/Mikepeerawit-com/tender-tracker/issues/28)) asks for two things that look separate and are not. Selecting a different Quote must **re-prefill the Landed Cost unless it has been hand-edited**, and a Margin derived from an **Unconfirmed** Landed Cost must render as provisional until `landed_cost_confirmed_at` is set. The first needs a stored answer to "has a human touched this figure?"; the second needs a stored answer to "has a human vouched for this figure?".

**They are the same question, and `landed_cost_confirmed_at` answers both.** Writing a Landed Cost — from the row, in the one field there is — stamps it. Emptying the field takes the stamp off with it.

## Why one fact rather than two

`CONTEXT.md` already defines Unconfirmed as *"a Landed Cost still sitting at its pre-filled value, which nobody has yet added shipping, duty or handling to"*. That is a definition of **untouched**, not of some further ceremony beyond touching it. Splitting the two apart would mean a third state — edited but unvouched — that the glossary has no word for and that nothing on the screen could act on differently.

The alternative was a separate confirm control beside the field, plus a `landed_cost_edited_at` column (or a heuristic) to keep an edited-but-unconfirmed cost from being overwritten by the next selection. That buys one thing: the ability to type a number and explicitly not stand behind it. It costs a migration, a second control in the densest row on the screen, and a nag — and ticket 28 is explicit that **nothing is blocked and nobody is nagged**.

**Confirming an unchanged pre-fill still works, and is the case this has to get right.** When freight genuinely is zero, the person tabs into the field, leaves the digits alone, and presses Enter: the figure is written back identical and the stamp lands. That is why the check is "did this field change since it was last saved?" rather than "does this value differ from the Quote's". Inferring untouched by comparing against the frozen Quote price is the thing the ticket rules out, and this is why: it is wrong precisely when shipping is genuinely nothing.

## What follows from it

- **`setLandedCost` stamps; `setSellingPrice` does not.** The selling price is not a claim about cost and confirms nothing.
- **`prefillLandedCost` reads `landed_cost_confirmed_at` as "hand-edited".** An Unconfirmed cost is by definition one still sitting at a pre-filled value, so overwriting it loses nothing.
- **Deselecting a Quote clears an Unconfirmed cost.** The basis for the number has gone, and a cost pre-filled from a Quote nobody chose is worse than an empty field.
- **A pre-fill never stamps.** `selectQuote` writes `landed_cost_per_unit` and never `landed_cost_confirmed_at`, which is what keeps the Margin provisional until a human has been near it.
- **The row shows the Margin as a number the moment the cost is edited**, before the save lands. That is what the pending write is about to record, and it is the figure the person is watching as they type.
- **A Quote priced in a unit the Item is not counted in pre-fills nothing.** The sheet refuses to rank that Item at all (ADR-0009, ticket 09); a Landed Cost quietly out by a pack size would be the same sin with none of the noise.
