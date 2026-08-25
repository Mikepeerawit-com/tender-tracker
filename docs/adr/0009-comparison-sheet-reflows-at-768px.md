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

## Amendment, 25 August 2026 — what building it settled ([#30](https://github.com/Mikepeerawit-com/tender-tracker/issues/30))

The decision above holds unchanged. Three things it left implicit turned out to be forced once the 390px bar was actually measured, and they change what a reader should expect to find on the desktop screen.

**The Item rows are no longer a table.** The ADR says the Item rows are "written once and is not breakpoint-aware" and, in the same breath, that no part of the page may scroll sideways at 390px. A `table-fixed` row of six columns — twisty, Item, Selected Quote, landed cost, selling, two Margins — cannot be both: its columns sum to more than a phone is wide, and a table whose fixed columns overrun their container overflows it. So the Item rows became a **wrapping flex line**: three blocks with matched flex bases, side by side at a desk and stacked on a phone, with no `md:` on them anywhere. The columns still line up across Items at desktop, because every row has the same bases.

**The header strip went with it**, and each block now carries its own caption — which is why `comparison.column.*` was renamed `comparison.label.*` and `column.item` deleted. `buildspec_2`'s screen-5 line, "Columns: Item · Selected Quote · Landed cost/unit · Selling/unit · Margin/unit · Margin on line", describes what those blocks hold, not a header row that still exists.

**Margin below the fields is the rule at every width**, not the phone's version of it. The ADR asks for it on a phone; keeping the desktop arrangement as well would have been the second layout the whole decision exists to avoid.

Two smaller things, recorded so they are not read as drift:

- **The sourced-by avatar renders at both widths.** The ADR specifies it for the card. Written once means the desktop column gets it too — a change to ticket 09's screen, and a small one.
- **The quote table's columns are percentages, not pixels.** Fixed pixel widths overflowed at 768px, which is the failure bar at the narrow end of the desktop range rather than on a phone. Cells also carry `break-words`, because the widths a formatted total needs move with the locale.

The failure bar is now pinned by `working-sheet.layout.test.tsx`, in headless Chromium at 390×844 and again at 768/1024/1280. The 44px tap-target floor is deliberately **not** in it, for the reason the Consequences above give.
