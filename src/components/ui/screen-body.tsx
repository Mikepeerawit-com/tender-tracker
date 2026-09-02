import type { ReactNode } from "react";

/**
 * How wide the column is allowed to grow.
 *
 * Full Tailwind class names rather than names of our own, so that a page states its
 * measurement in the same words the stylesheet does and the scanner can see it. Three
 * values because three is what the app really uses, and since #97 each names a device
 * rather than a screen:
 *
 * - `max-w-3xl` — **the phone's column, 768px.** My work and the quote form are composed
 *   at 390px and this is the width they are allowed to grow to on the way out (ADR-0021).
 *   It is also the default, and so what the two screens standing in for a page get.
 * - `max-w-2xl` — the same column, tighter, for the one screen that is a short form and
 *   nothing else.
 * - `max-w-7xl` — **the desk, 1280px.** The tender list and the Tender detail, which are
 *   the Owner's two screens: comparing Quotes and typing prices at a monitor. It was the
 *   working sheet's alone until #97, when the list stopped being a centred phone column
 *   on a 1440px screen.
 *
 * They are caps, not widths: below the number the column is whatever the viewport leaves,
 * which is why one design carries both devices rather than two.
 */
export type ScreenWidth = "max-w-2xl" | "max-w-3xl" | "max-w-7xl";

/** The space between a screen's blocks. `gap-6` is the one form that sets its own. */
export type ScreenGap = "gap-6" | "gap-8";

/**
 * The wrapper a screen's body is drawn inside: a padded full-height box, and a centred
 * column within it.
 *
 * Split out from `Screen` rather than living inside it, because two screens draw this
 * wrapper *without* the app bar above it — `ScreenSkeleton` and `ScreenError`, which
 * stand in for a page and so have their bar drawn by `(app)/loading.tsx` and
 * `(app)/error.tsx` instead (#73). `ScreenError` is also a Client Component, and `Screen`
 * reaches for the session, so it could not import from there at all.
 *
 * **Width and gap are the seam.** The screens under `(app)` are not one shape: the
 * Assignee's are the phone's column, the Group Robot screen is narrower, and the Owner's
 * two are the desk's (ADR-0021). Hardcoding one width here would have forced them back
 * out of the component.
 *
 * **The same width reaches the bar**, which is what makes the two agree about where the
 * page's edge is. `Screen` hands this value to `AppHeader` too, and the `p-6` below is the
 * padding that bar matches — change one and the other has to move with it, which is why
 * `screens.layout.test.tsx` measures the two columns against each other rather than
 * trusting that they were kept in step.
 *
 * `gap` reaches the `main` and not the `div` above it, and the `gap-8` on that `div` is
 * inert — it has one child, so there is no pair of siblings for it to sit between. It is
 * kept because it is the class every one of the eight pages carried, and this ticket moved
 * the wrapper without changing a pixel of it.
 */
export function ScreenBody({
  width = "max-w-3xl",
  gap = "gap-8",
  children,
}: {
  width?: ScreenWidth;
  gap?: ScreenGap;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className={`mx-auto flex w-full flex-col ${width} ${gap}`}>{children}</main>
    </div>
  );
}
