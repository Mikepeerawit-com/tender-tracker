import { expect } from "vitest";

export { phone } from "./phone.mjs";

/**
 * The shared half of the `layout` project: one viewport and one measurement.
 *
 * `overflowing` began at the bottom of `working-sheet.layout.test.tsx`, where it guarded
 * the only screen anybody measured. #56 was the bill for that — the tender list, the
 * Tender detail and the app shell had never been measured at all — so it lives here now,
 * to be pointed at anything drawn.
 */

/**
 * ADR-0009's bar, as every layout suite states it: nothing on the page scrolls sideways.
 *
 * Both halves are needed and neither implies the other. `overflowing` catches a single
 * element wider than its own box — one cell past its column — which the page-level
 * measurement misses entirely, because an element too wide for its parent is clipped or
 * scrolled by that parent rather than widening the document. The `documentElement` check
 * catches the opposite case: a page pushed out by something that is itself within its
 * box, such as a row of buttons that simply will not wrap.
 */
export function expectNoSidewaysScroll(): void {
  expect(overflowing(document.body)).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );
}

/**
 * Every element whose own content is wider than the box drawn for it.
 *
 * Two things are excluded, and only two. `.sr-only` *is* a one-pixel box with its content
 * clipped out of it, so overflowing is how it works rather than a way it has failed. And
 * a form control scrolls its own value by design — a price longer than its field is a
 * text box doing its job, not a page pushed sideways, and how wide the value measures
 * depends on the font that happened to load. Neither can push the page out: an element
 * too wide for its parent is caught on the parent, and the page itself is measured
 * separately by {@link expectNoSidewaysScroll}.
 */
export function overflowing(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element.closest(".sr-only") === null)
    .filter((element) => !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
    .filter((element) => element.scrollWidth > element.clientWidth)
    .map(describeElement);
}

/** Enough of an element to find it in the markup from a failure message. */
function describeElement(element: Element): string {
  const text = (element.textContent ?? "").trim().slice(0, 40);

  // `getAttribute`, not `className`: on an SVG — and lucide's chevrons are in this tree —
  // `className` is an `SVGAnimatedString` and stringifies to nothing anybody can search for.
  return `${element.tagName.toLowerCase()}.${element.getAttribute("class")} — "${text}"`;
}
