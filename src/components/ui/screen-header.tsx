import type { ReactNode } from "react";

import { Measure } from "@/components/ui/screen-body";

/**
 * The block at the top of a screen: what this is, and what can be done to it.
 *
 * The tender list, the Tender detail and the item sourcing screen drew this same shape
 * independently — an optional reference above a heading above a line or two of detail,
 * with the screen's buttons pushed to the end — so it is one component rather than three
 * copies that drift.
 *
 * It is also the seam that makes those screens measurable. All three pages are `async`
 * Server Components, two of them gated on `currentUser`, so a browser test cannot reach
 * them; this is sync, takes only what it draws, and is guarded by
 * `screen-header.layout.test.tsx` at 390px.
 *
 * **The heading spans the region; the lines under it do not** (ADR-0022, #131). The text
 * column grows to fill what the actions leave, so the heading starts at the region's left
 * edge and is bounded by nothing but the screen — and the detail lines beneath it are
 * prose, so they sit in the screen's {@link Measure}. Without the `grow` the column is
 * shrink-to-fit and a measure inside it would report whatever the longest line happened to
 * need, which is not a width anybody committed to.
 *
 * **Why `min-w-0` is on the text column.** A flex item's `min-width` defaults to `auto`,
 * which means it refuses to shrink below its own longest unbroken word. A client name or
 * a product name with no space in it would otherwise hold this column wider than the
 * phone and push the page sideways — the failure #56 was raised for. `min-w-0` lets the
 * column shrink and `break-words` gives the word somewhere to break, which is the same
 * structural hold `working-sheet.tsx` puts on its own cells rather than trusting the
 * arithmetic of the columns.
 */
export function ScreenHeader({
  eyebrow,
  heading,
  actions,
  children,
}: {
  /**
   * The reference, and whatever else identifies the record above its name. Omitted on
   * the screens that are not about one record — the tender list has no reference of its
   * own to show.
   */
  eyebrow?: ReactNode;
  /**
   * The big line: what this screen is about. Deliberately not called `title` — a Tender
   * *has* a `title` (see `CONTEXT.md`), and on the detail screen this slot holds the
   * client name while that `title` sits underneath as a detail line. Two different
   * things wanting the same word is how the wrong one gets rendered.
   */
  heading: ReactNode;
  /** The screen's buttons. They wrap to their own line before the heading gives way. */
  actions?: ReactNode;
  /** The detail lines under the heading. Prose, and so drawn at the screen's measure. */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 grow flex-col gap-2">
        {eyebrow ? (
          <span className="text-muted-foreground font-mono text-xs break-words">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight break-words">{heading}</h1>
        {children ? (
          <Measure className="flex flex-col gap-2">{children}</Measure>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
