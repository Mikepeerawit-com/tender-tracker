# One region, one left edge, and a measure inside it

_Written by [#131](https://github.com/Mikepeerawit-com/tender-tracker/issues/131), ticket 2 of [#129](https://github.com/Mikepeerawit-com/tender-tracker/issues/129)._

**Status:** accepted. Supersedes the per-screen committed widths that [ADR-0021](0021-two-destinations-and-the-device-follows-the-role.md)'s 2 September 2026 amendment and [#97](https://github.com/Mikepeerawit-com/tender-tracker/issues/97) settled. Everything else in ADR-0021 stands: two destinations, the bottom bar below `md`, and the device following the role.

On a monitor this did not look like one app. The tender list began a padding's width from the window edge; My work, the quote form and the three Org Admin screens sat in a 768px column with a wide empty gutter either side. Nothing was misaligned in the stylesheet — every screen was padded identically — but the reader is not looking at padding. They are looking at where the page begins, and it moved when they changed screen.

## The decision

**Every screen behind the login draws its content in one region, capped at the desk's 1280px.** `ScreenBody` writes it and `AppHeader` writes the same number for the bar's inner column, so the two halves of a screen cannot be handed different answers. A page no longer states a width at all.

**Prose and form fields sit in a narrower measure column inside that region.** Headings, lists, tables and sub-navigation span it. The measure is `48rem` by default and `42rem` on a screen that is a short form and nothing else — the three Org Admin screens are the ones that are.

That rule is about a **screen's** structure, not about everything with a heading tag in it. A card whose content is a form is measured whole, its own label included: a 672px panel with a 1280px heading floating above it is not a heading that spans, it is a label that has come off the thing it names. `ScreenHeader` is where the distinction is enforced — the screen's heading grows to fill what its actions leave, and only the detail lines beneath it are measured — which is why every screen composes that rather than a header of its own.

**A screen states its measure once**, on `ScreenBody`, as a `--measure` custom property that every `Measure` inside it reads. Handing each block its own width is what would let a screen's header and the form beneath it disagree, which is the same fault as the one this ADR is about, one level down.

## Why per-screen widths were right then and are wrong now

They were not a mistake, and reading this ADR as though they were is how it gets reverted.

Before #97 the app had **no desktop design at all**: six of eight screens were a 768px column at every viewport and the one wide test asserted only that nothing overflowed, which a centred phone column on a 1440px monitor passes perfectly. The fix that was available then was to make each screen *say* how wide it meant to be — and saying it per screen was the honest form, because at that moment the screens genuinely disagreed. The working sheet was composed for a desk and the quote form was composed at 390px, and no single number was true of both.

What changed is that **the disagreement was about content, and the width was being asked to carry it**. A quote form does not want 1280px of input; it wants a readable field. A worklist does want the monitor. Expressing both as one cap per screen forces the *page's edge* to move in order to say something about the *paragraph's* width — and the page's edge is the one thing on a screen that a reader tracks between screens without being asked to. Splitting the two says both things at once: the region never moves, and the measure varies exactly where the content does.

The second reason is that the per-screen rule had stopped being able to grow. Every new screen had to pick a width, nobody could say from the file what the right pick was, and the guard behind it was a hand-maintained table with a row per screen. Ticket 3 and ticket 6 of [#129](https://github.com/Mikepeerawit-com/tender-tracker/issues/129) each add screens; under the old rule each would have added a row somebody had to remember.

## What this does not buy

**Nothing was redesigned to fill 1280.** ADR-0021's closing note still holds: a tender row rearranged for the desk is a second design of the thing [ADR-0009](0009-comparison-sheet-reflows-at-768px.md) says should be one, and is a decision for its own ticket. What changed here is where a screen begins and how wide a line of it is, and nothing else. My work lists exactly what it listed; the tender list is still grouped by Progress; the working sheet is still the dense desk composition reflowing to cards below 768px.

**The cap and the horizontal padding stay on different elements.** A `max-w-*` sizes the border box, so a column carrying its own padding is capped *including* it and lands exactly one padding inside the column it was aligned to. That trap was found while #97 was written and is the reason the bar pads its `header` and caps the `div` inside it.

## Consequences

- **The guard changed shape, and that is half of what this ticket was for.** The region is a single invariant asserted once and walked over every screen; the measure is declared per screen in `@/test/screens`, beside the composition it is a claim about. The reconciliation test that kept a separate table naming every screen went with the table — a check that a record agrees with itself is a check that cannot fail ([ADR-0016](0016-a-check-must-be-able-to-fail.md)). Both remaining assertions were confirmed by producing their failures: a screen that stops declaring the tighter measure, and a screen that draws no measure column at all.
- **A screen added to the shared screen record inherits every layout guard**, with no per-screen table entry to maintain. The three Org Admin screens joined that record here, which is how the acceptance criterion about their left edge is checked rather than asserted in prose. Reaching them meant giving the People screen's member list the same sync seam every other measured component has.
- **`data-measure` is production markup that exists for the test**, and it is the price of measuring the rule rather than a class name. There is no role, tag or accessible name that means "this is the column the prose is in" — it is a layout fact and nothing else.
- **The two screens that stand in for a page now match the region of whatever they replace**, which removes the column jump #97 left on the Owner's two screens. What is left of that trade is the measure: `loading.tsx` cannot see which page is coming, so on the three tighter screens its grey lines are slightly wider than the words that land.
- **`MeasureWidth` has two values and should stay small.** A third is a reason to ask what the screen is really made of, not a free addition — the whole point of one region is that a reader stops having to learn each screen's shape.
