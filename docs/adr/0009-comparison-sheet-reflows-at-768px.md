# The comparison sheet is one responsive design, and the table reflows into cards at 768px

Ticket 09 ([#10](https://github.com/Mikepeerawit-com/tender-tracker/issues/10)) settled the comparison working sheet at desktop width and rejected cards explicitly — they *"lost decisively, collapsing at ~4 of the 8 competing Quotes the compete-not-divide model makes normal"* (ADR-0004). Mobile parity arrived after that verdict and re-opened it, because a 9-column table with inline numeric editing does not survive a 390px viewport.

The decision is **one responsive design, not two layouts**. There is a single component tree and a single set of behaviours; below the breakpoint the dense table reflows into stacked quote cards, and nothing else about the screen changes. The thing ticket 09 rejected at 1280px is the thing that works at 390px — the density argument runs the other way once the width is gone.

## What a builder constructs at each breakpoint

**The breakpoint is 768px.** One rule, on the quote list inside an expanded Tender Item. Everything above and outside it — the Item rows, the derived-openness rule, the banners, the pricing fields, the totals strip — is written once and is not breakpoint-aware.

- **≥ 768px — unchanged from ticket 09.** One row per Tender Item; an expanded Item shows the dense 9-column table ranked cheapest-first (rank · supplier · sourced by · quoted product · unit price + THB · line total · photos · Select).
- **< 768px — the same nine columns become one stacked card per Quote**, ranked cheapest-first, rank carried by a numbered pill rather than a column. Each card holds supplier, unit price (with the THB conversion beneath), line total, the Alternative box where it applies, sourced-by as an inline avatar + name, the photo count badge, and a full-width Select button.

Everything ticket 09 settled survives the reflow verbatim: photos stay a **count badge opening a lightbox**, never thumbnails; **sourced by is never dropped**, because under ADR-0004 it is the only thing distinguishing two rows from the same supplier; the three Item-level banners (unit mismatch, all-Alternatives, "too close to call on frozen rates") stay **Item-level**, stacked above the quote cards rather than above a table; and landed cost and selling price stay **inline and editable per unit**, with margin computing live below the fields — which is where it has to be on a phone, since the numeric keyboard covers the bottom of the screen.

## Measured, at 390px, against ticket 09's own dataset

- **No horizontal overflow anywhere on the page.** This was the ticket's explicit failure bar — a table that technically "works" by scrolling sideways is a failure, not a pass — and it is cleared by construction, not by a guard.
- **189px per quote card**, so the 8-quote density stress case is **2,250px ≈ 2.7 phone screens** for a single Tender Item.
- **The derived-openness rule survives.** With decided Items folded, the default landing state across all four Items is ~3,400px ≈ 4 screens. The 2.7-screen case only unfolds for an Item that still needs a decision, which is exactly when someone wants to see all eight.

## The cost, accepted deliberately

**Below 768px, rank 1 and rank 8 are never on screen together.** About four quote cards fit a phone screen, so comparing the cheapest Quote against the dearest means scrolling. At desktop the whole ranked spread is visible at once, and that co-visibility is a real part of why ticket 09 chose a table.

This is accepted rather than solved. Three alternatives were built and set aside — a three-column cut-down rank table with tap-to-open drawers, a two-level drill-down with a sticky pricing bar, and a swipe deck — and each buys back co-visibility by introducing a phone-only interaction the desktop screen does not have. One design that adapts is worth more than the eight ranks being co-visible: it is one thing to build, one thing to change, and one thing to keep correct in two locales.

## Consequences

- **`buildspec_2` states the 768px rule and the cost together.** A builder who knows only "make it responsive" will reach for a horizontally-scrolling table, which is the one outcome ruled out.
- **The reflow is the general answer, not a working-sheet special case.** The comparison sheet is the densest screen in v1 by a wide margin; if reflow carries it, login, the tender list, add/edit tender and add-quote need no separate phone design. Add-quote still gets `accept="image/*" capture` on the Quote Photo input — a camera affordance, not a layout.
- **Judge at 390px on a real phone, not a narrowed desktop window.** Tap targets are floored at 44px, which is a constraint a resized browser will not surface.
- **Nothing in the schema moves.** This is a rendering decision end to end.
