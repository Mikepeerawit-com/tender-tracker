import { expect } from "vitest";

export { phone } from "./phone.mjs";

/**
 * The shared half of the `layout` project: the viewports, and the measurements every
 * suite in it makes.
 *
 * `overflowing` began at the bottom of `working-sheet.layout.test.tsx`, where it guarded
 * the only screen anybody measured. #56 was the bill for that — the tender list, the
 * Tender detail and the app shell had never been measured at all — so it lives here now,
 * to be pointed at anything drawn.
 */

/**
 * The wide viewport every screen is judged at (ADR-0022, #97). It was the Owner's two
 * alone until #131, when they stopped being the only screens with a width to commit to.
 *
 * ADR-0022 caps the region **at 1280px**, and this is deliberately wider than that. At
 * exactly 1280 a column capped at 1280 and a column that simply took whatever the window
 * gave it measure the same number, so a suite standing there could not tell a committed
 * width from no cap at all — and the fault it is guarding against is the one #97 was raised
 * for, a screen that never says how wide it means to be. The 160px of daylight is what
 * lets the assertion fail (ADR-0016).
 *
 * 1440×900 rather than a round number, because it is the default logical resolution of the
 * laptop an Owner in this org actually has open.
 */
export const desk = { width: 1440, height: 900 };

/**
 * The `main` a screen's body is drawn inside, without the bars the shell draws around it.
 *
 * **The region**, since ADR-0022: one column at `max-w-7xl`, the same on every screen
 * behind the login, which is what `ScreenBody` caps it at. It was a per-screen number
 * until #131 and this is where that was measured. The signed-out screens are the exception
 * worth naming — `AuthScreen` draws its own `main` at `max-w-sm`, with no shell around it
 * at all — and they are measured through this too, because it is the same element the
 * suites want either way. What varies inside the region is {@link measures}.
 *
 * Not `body`, which is taken twice over — `document.body` is what
 * {@link expectNoSidewaysScroll} measures, and `Body` is the page wrapper
 * `@/test/screens` exports.
 *
 * **Exactly one `main` on the page** is the assumption, and today the tag carries it on
 * its own. `screens.layout.test.tsx` cannot say that of its `appBar()`: `ScreenHeader`
 * and `AuthScreen` both draw a `header` *inside* the column, so finding the bar means
 * asking which `header` is outside a `main` rather than which comes first. Nothing else
 * on a screen is a `main`, so this needs no such question — and asking it in one place
 * is what makes the day a screen draws a second column, or a fallback draws none, a
 * single edit here rather than three suites quietly disagreeing about what they measured.
 *
 * The element, not its rect. The two width suites take `getBoundingClientRect()` at the
 * call site; one that handed back a `DOMRect` could not serve `controlRows(column())`.
 */
export function column(): HTMLElement {
  return document.querySelector("main")!;
}

/**
 * The distinct widths of the **measure** columns a screen drew, inside {@link column}.
 *
 * The narrower column ADR-0022 puts a screen's prose and its form fields in. `Measure` in
 * `screen-body.tsx` marks each one and takes its cap from a custom property the screen
 * sets once, so a screen that has more than one of them still has one width — and this
 * returns a set rather than a list so that saying so costs a caller nothing.
 *
 * **Distinct widths, not a count.** How many blocks of prose a screen happens to draw is
 * composition and moves whenever the screen does; what ADR-0022 commits to is the number
 * they are all drawn at. A screen that drew none at all answers `[]`, which is a real
 * answer and a failing one wherever a measure was declared.
 */
export function measures(): number[] {
  const widths = [...column().querySelectorAll<HTMLElement>("[data-measure]")].map(
    (element) => element.getBoundingClientRect().width,
  );

  return [...new Set(widths)].sort((a, b) => a - b);
}

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
 * How many rows a bar laid its controls out on.
 *
 * Every link and button inside `root`, grouped by the top edge they were drawn at: one
 * distinct top edge means one row. This is the half `expectNoSidewaysScroll` cannot see —
 * a header allowed to wrap never overflows, it just gets taller, and #56's first fix did
 * exactly that and cost three rows on a phone. Measuring the outcome rather than the
 * `flex-wrap` property keeps the assertion about what a reader sees.
 *
 * **Controls that are not {@link drawn} are not counted.** Since #96 the app bar carries
 * the two destinations at `md` and up and hides them below it, and a `display: none`
 * element reports `offsetTop` of `0` — so an undrawn control would invent a second row on
 * a phone out of a bar that renders one.
 */
export function controlRows(root: HTMLElement): number {
  const tops = [...root.querySelectorAll<HTMLElement>("a, button")]
    .filter(drawn)
    .map((control) => control.offsetTop);

  return new Set(tops).size;
}

/**
 * Whether an element was given a box on the page at all.
 *
 * The question every measurement here is really asking — *did a reader see this* — and
 * since #96 it is a question with two answers at one width: the two destinations exist
 * twice in the markup, on the app bar and in the bottom bar, and exactly one of the pair
 * is drawn at any viewport.
 *
 * `checkVisibility`, not `offsetParent !== null`. The two agree on `display: none`, which
 * is the case this exists for, and disagree on `position: fixed` — which has no offset
 * parent and is nonetheless on the screen. Nothing in the app is fixed today, and a helper
 * that would quietly stop counting it the day something is would be a budget with a hole
 * in it (#98 sets budgets with `controlRows`).
 */
export function drawn(element: HTMLElement | undefined | null): boolean {
  return element != null && element.checkVisibility();
}

/**
 * Every element whose own content is wider than the box drawn for it.
 *
 * Three things are excluded, and only three. `.sr-only` *is* a one-pixel box with its
 * content clipped out of it, so overflowing is how it works rather than a way it has
 * failed. A form control scrolls its own value by design — a price longer than its field
 * is a text box doing its job, not a page pushed sideways, and how wide the value
 * measures depends on the font that happened to load. And an element clipping on its own
 * x-axis is doing the same: `truncate` is `overflow: hidden` plus an ellipsis, so a
 * truncating element *always* measures wider than its box — that is the mechanism, not a
 * fault. The app bar's member name is one, deliberately (#56).
 *
 * What unites all three is that none can widen the page: an element too wide for its
 * parent is caught on the parent, one that clips has already given up the excess, and the
 * page itself is measured separately by {@link expectNoSidewaysScroll}.
 */
export function overflowing(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element.closest(".sr-only") === null)
    .filter((element) => !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
    .filter((element) => !clipsHorizontally(element))
    .filter((element) => element.scrollWidth > element.clientWidth)
    .map(describeElement);
}

/** Whether the element hides its own horizontal overflow rather than passing it on. */
function clipsHorizontally(element: HTMLElement): boolean {
  return ["hidden", "clip"].includes(getComputedStyle(element).overflowX);
}

/** Enough of an element to find it in the markup from a failure message. */
function describeElement(element: Element): string {
  const text = (element.textContent ?? "").trim().slice(0, 40);

  // `getAttribute`, not `className`: on an SVG — and lucide's chevrons are in this tree —
  // `className` is an `SVGAnimatedString` and stringifies to nothing anybody can search for.
  return `${element.tagName.toLowerCase()}.${element.getAttribute("class")} — "${text}"`;
}

/**
 * A font stack token as the browser really substitutes it.
 *
 * Resolved through a real element rather than read off the custom property, because it is
 * the *substituted* value that decides what gets drawn: a `var()` that fell through to
 * nothing serialises as the token's own text and would pass a string comparison while the
 * page rendered in Times. Which is the whole fault `type.layout.test.tsx` exists for, so
 * the probe it uses and the one the working sheet compares its figures against have to be
 * the same probe.
 */
export function fontStack(token: string): string {
  const probe = document.createElement("span");

  probe.style.fontFamily = `var(${token})`;
  document.body.append(probe);

  const substituted = getComputedStyle(probe).fontFamily;

  probe.remove();

  return substituted;
}

/** A computed `font-family` as the families a browser will try, in order, unquoted. */
export function familiesIn(fontFamily: string): string[] {
  return fontFamily
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter((family) => family !== "");
}
