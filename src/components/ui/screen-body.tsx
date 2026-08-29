import type { ReactNode } from "react";

/**
 * How wide the column is allowed to grow.
 *
 * Full Tailwind class names rather than names of our own, so that a page states its
 * measurement in the same words the stylesheet does and the scanner can see it. Three
 * values because three is what the app really uses: the reading width, the narrower one
 * a single form gets, and the working sheet's.
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
 * **Width and gap are the seam.** The eight screens under `(app)` were not one shape: five
 * are the common pair, the record form is tighter, the Group Robot screen is narrower and
 * the Tender detail is wide because the comparison sheet needs the room at 1280 (ADR-0009).
 * Hardcoding one width here would have forced three of them back out of the component.
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
