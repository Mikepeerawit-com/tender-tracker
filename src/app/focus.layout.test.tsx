import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { alphaOf, backgrounds, contrast, flatten, groundUnder } from "@/test/colour";
import { describeElement, desk, drawn, phone } from "@/test/layout";
import {
  locales,
  Screen,
  screens,
  signedOutScreens,
  SignedOut,
  themes,
} from "@/test/screens";

/**
 * **Every screen worked from the keyboard, in both themes** — Tab pressed until the page
 * runs out of controls, and every stop asked to show where it is.
 *
 * A reader who cannot see the caret cannot use the screen at all, and the failure this
 * catches is the one a repaint makes and nobody notices: a ring that reads perfectly over
 * the paper ground and vanishes into the dark one. That is a colour fault, so it is asked
 * of both palettes and of nothing else — the ring is not translated and its geometry does
 * not move with the script, which is why this walk stands in `en` alone while the width
 * and contrast suites stand in both locales.
 *
 * **Tab, not `focus()`.** `:focus-visible` is the selector every ring in this app is
 * written against, and it is a claim about *how* focus arrived: a browser is entitled to
 * draw nothing when a control is focused by a script or a pointer. A walk that called
 * `focus()` would be asking a different question from the one a reader asks, and would
 * report a ring on an app that never draws one. Tabbing also answers the half of the
 * criterion a per-control assertion cannot — that the control is *reachable* at all.
 *
 * **Both widths, because a control that is not drawn is not focusable.** Since #96 the two
 * destinations exist twice in the markup and exactly one pair is drawn at any viewport, so
 * a walk that stood only at 390px would never reach the app bar's copies and would never
 * ask whether they ring.
 *
 * **What it asserts is a property, not a value.** No token is named, no width is pinned
 * and no shape is compared to a baseline: the indicator may be an outline, a ring or a
 * border, and it may move whenever the design does. What is pinned is that focus changes
 * something a reader can see, and that whatever it changed reaches 3:1 against the surface
 * it is drawn over.
 *
 * **What it does not reach, stated so nobody reads the green as wider than it is:**
 * controls that exist only after an interaction. The lightbox opened by an image count,
 * and the Remove button on a photo somebody has just picked, are drawn by no screen at
 * rest and are therefore in no record this walks. They are not a separate risk today —
 * every ring in the app comes from the two mechanisms this file does measure, the base
 * `:focus-visible` outline and `focus-visible:ring-ring` — but the day one of them draws
 * its own, this will not be what catches it.
 */

/**
 * WCAG 2.2 SC 1.4.11, which is the floor a focus indicator is held to: it is not text, so
 * 4.5:1 is not the bar — but it is information rather than decoration, so 3:1 is.
 */
const indicatorContrast = 3;

/**
 * **The ring as it settles, not as it arrives.**
 *
 * Every control in this app fades its ring in — `transition-all` on the button,
 * `transition-colors` on the fields and the links — and a computed style read the instant
 * after Tab is a sample taken partway through that fade. The first shape of this suite
 * read one, and reported a 1:1 ring on controls that ring perfectly a tenth of a second
 * later.
 *
 * Waiting for the transitions instead was the other way, and it is what a walk of every
 * control on nineteen screens at two widths cannot afford: 150ms a stop is minutes. So the
 * sheet below takes the duration out, and the question the suite asks becomes the one it
 * meant to ask — *what does a reader looking at a focused control see* — rather than a
 * question about frame timing.
 *
 * **Deliberately not `prefers-reduced-motion` over CDP**, which since #135 would still the
 * app through its own stylesheet and is the obvious move. It would make this file fail for
 * somebody else's fault: delete the reduced-motion block in `globals.css` and
 * `motion.layout.test.tsx` goes red, correctly, while *this* file also goes red — sampling
 * mid-fade again — and says the app has no focus ring, which is a lie about a working ring.
 * One fault, two red suites, one of them pointing at the wrong thing. The sheet below
 * belongs to this suite and answers to nothing else.
 */
const settled = `*, *::before, *::after {
  transition-duration: 0s !important;
  animation-duration: 0s !important;
}`;

let settling: HTMLStyleElement;

beforeAll(() => {
  settling = document.createElement("style");
  settling.textContent = settled;
  document.head.append(settling);
});

afterAll(() => settling.remove());

/** Both widths every screen is read at, as the contrast walk names them. */
const widths = [phone, desk];

/**
 * The keyboard walk is a colour claim, so one locale is enough — and `en` is the record's
 * first. A Han glyph changes how wide a button is, which is the width suites' business,
 * and changes nothing about the ring drawn round it.
 */
const [[locale, messages]] = locales;

describe.each(themes)("the %s theme", (theme) => {
  // The layout project's viewport is the phone and every other suite in it depends on
  // that, so whatever this does to the window is undone before the next file runs.
  afterEach(async () => {
    await page.viewport(phone.width, phone.height);
  });

  it.each(Object.entries(screens(messages)).map(([name, entry]) => [name, entry.body]))(
    "rings every control a reader can tab to on %s",
    async (name, body) => {
      const { container } = render(
        <Screen theme={theme} locale={locale} messages={messages}>
          {body}
        </Screen>,
      );

      await expectEveryStopRings(container, name);
    },
  );

  /**
   * The signed-out screens, from the record beside the other one. They are the screens
   * that are *most* keyboard — four of the five things on `/setup` are fields — and the
   * first any reader meets, on the one path where a ring nobody can see means somebody
   * cannot get into the app at all.
   */
  it.each(
    Object.entries(signedOutScreens(messages)).map(
      ([name, entry]) => [name, entry.body] as const,
    ),
  )(
    "rings every control a reader can tab to on %s",
    async (name, body) => {
      const { container } = render(
        <SignedOut theme={theme} locale={locale} messages={messages}>
          {body}
        </SignedOut>,
      );

      await expectEveryStopRings(container, name);
    },
  );
});

/** Tab from the top of the page to the bottom of it, at every width, and report the stops. */
async function expectEveryStopRings(container: HTMLElement, name: string): Promise<void> {
  for (const width of widths) {
    await page.viewport(width.width, width.height);

    const resting = restingStyles(container);
    const user = userEvent.setup();
    const faults: string[] = [];
    const visited: HTMLElement[] = [];

    // One press past the number of controls that are drawn, so the walk ends by coming
    // back round to where it started rather than by running out of a budget somebody
    // guessed. A screen that grew a control does not quietly stop being fully walked.
    const stops = focusable(container).length;

    for (let press = 0; press <= stops; press++) {
      await user.tab();

      const stop = document.activeElement;

      if (!(stop instanceof HTMLElement) || stop === document.body) break;
      if (visited.includes(stop)) break;

      visited.push(stop);

      const fault = indicatorFault(stop, container, resting);

      if (fault !== null) faults.push(fault);
    }

    // Every drawn control was reached, and the walk really walked to the end of the page
    // rather than to the end of a budget. A tab order that dead-ends — a wrapper that
    // swallowed focus, a control behind something that took it — would otherwise let this
    // file report a clean bill of health on the controls it never got to (ADR-0016).
    expect(
      focusable(container)
        .filter((control) => !visited.includes(control))
        .map(describeElement),
      `${name} at ${width.width}px has controls no Tab reaches`,
    ).toEqual([]);
    expect(stops, `${name} at ${width.width}px drew nothing to focus`).toBeGreaterThan(0);
    expect(faults, `${name} at ${width.width}px`).toEqual([]);

    // Focus is a property of the document rather than of the render, so a caret left on
    // the last control would be where the next width's walk started from.
    (document.activeElement as HTMLElement | null)?.blur();
  }
}

/**
 * Why this stop shows a reader nothing, or `null` if it shows them something.
 *
 * The indicator is looked for on the control **and on its ancestors**, because not every
 * ring in this app is drawn on the thing that took focus: a radio inside a bordered label
 * rings the label, under `focus-within`. The nearest element whose drawing changed is the
 * indicator, whichever of the two it turns out to be.
 */
function indicatorFault(
  stop: HTMLElement,
  container: HTMLElement,
  resting: Map<Element, Drawing>,
): string | null {
  for (
    let node: HTMLElement | null = stop;
    node !== null && node !== container.parentElement;
    node = node.parentElement
  ) {
    const before = resting.get(node);
    const now = drawingOf(node);

    if (before === undefined || same(before, now)) continue;

    return markFault(node, before, now, stop);
  }

  return `nothing on the page changed — ${describeElement(stop)}`;
}

/** Whether the mark this element grew on focus is one a reader can pick out. */
function markFault(
  node: HTMLElement,
  before: Drawing,
  now: Drawing,
  stop: HTMLElement,
): string | null {
  const mark = markColour(before, now);

  if (mark === null) {
    return `focus changed nothing a reader can pick out — ${describeElement(stop)}`;
  }

  // An outline, a ring and a border are all drawn at the element's edge, over whatever
  // its parent is painted on — never over the element's own background, which is inside
  // them. `bg-clip-padding` on this app's buttons is what makes that true of the border
  // as well as of the other two.
  const behind = groundUnder(node.parentElement);
  const ratio = contrast(flatten([...backgrounds(node.parentElement), mark.colour]), behind);

  if (ratio >= indicatorContrast) return null;

  return `${ratio.toFixed(2)}:1 (needs ${indicatorContrast}) — the ${mark.kind} on ${describeElement(stop)}`;
}

/**
 * Which of the three marks focus **put there**, and in what colour.
 *
 * **Each candidate has to have changed**, and that is the whole of why `before` is here.
 * The first shape of this graded whichever mark the element happened to be showing, which
 * on a control that already had a border at rest meant grading *that* border — a mark the
 * reader had been looking at before they pressed Tab — and calling it a focus indicator.
 * A control whose only answer to focus was a slightly different background would have
 * passed on the strength of a hairline it never changed, which is a check that cannot fail
 * on exactly the fault it exists to catch (ADR-0016).
 *
 * A background that moved on its own is therefore **not** a mark here. WCAG 2.4.11 does
 * allow one, at an area and a contrast this walk does not measure; nothing in this app
 * indicates focus that way, and the day something does, this should be taught the rule
 * rather than quietly widened to accept it.
 *
 * Order matters only in that the first one found is the one reported: an element drawing
 * two is drawing at least one, and a reader needs one.
 */
function markColour(
  before: Drawing,
  now: Drawing,
): { kind: string; colour: string } | null {
  const grew = (key: keyof Drawing) => before[key] !== now[key];

  if (
    (grew("outlineStyle") || grew("outlineWidth") || grew("outlineColor")) &&
    now.outlineStyle !== "none" &&
    alphaOf(now.outlineColor) > 0
  ) {
    return { kind: "focus outline", colour: now.outlineColor };
  }

  const ring = grew("boxShadow") ? shadowColour(now.boxShadow) : null;

  if (ring !== null) return { kind: "focus ring", colour: ring };

  if (grew("borderColor") && alphaOf(now.borderColor) > 0) {
    return { kind: "focused border", colour: now.borderColor };
  }

  return null;
}

/**
 * The first colour in a computed `box-shadow` that would actually paint.
 *
 * Tailwind composes the ring out of three shadows and leaves the two it is not using at
 * `0 0 #0000`, so the string is nearly always longer than the one shadow that matters and
 * the transparent ones have to be skipped rather than counted as a mark.
 */
function shadowColour(boxShadow: string): string | null {
  const colours =
    boxShadow.match(
      /(?:rgba?|hsla?|oklch|oklab|lch|lab|color|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-fA-F]{3,8}/g,
    ) ?? [];

  return colours.find((colour) => alphaOf(colour) > 0) ?? null;
}

type Drawing = {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  borderColor: string;
  backgroundColor: string;
};

function drawingOf(element: HTMLElement): Drawing {
  const style = getComputedStyle(element);

  return {
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
    boxShadow: style.boxShadow,
    borderColor: style.borderTopColor,
    backgroundColor: style.backgroundColor,
  };
}

function same(a: Drawing, b: Drawing): boolean {
  return (Object.keys(a) as (keyof Drawing)[]).every((key) => a[key] === b[key]);
}

/**
 * How every element on the screen is drawn while nothing is focused.
 *
 * Taken once, before the first Tab, because the alternative is blurring between stops —
 * and a blur puts the walk back at the top of the document, so the page could never be
 * walked to its end.
 */
function restingStyles(container: HTMLElement): Map<Element, Drawing> {
  return new Map(
    [...container.querySelectorAll<HTMLElement>("*")].map((element) => [
      element,
      drawingOf(element),
    ]),
  );
}

/**
 * Every control a Tab really stops at — the list the walk is checked against.
 *
 * Three exclusions, and each is a control that is *deliberately* not a stop rather than a
 * control this walk is letting itself off:
 *
 * - **`drawn`**, which is what keeps the list honest at 390px: since #96 the app bar's copy
 *   of each destination is `display: none` and no keyboard will ever reach it.
 * - **`tabindex="-1"`**, which is the photo picker's two file inputs. They are off-screen
 *   and pressed by the buttons beside them, because a bare file input cannot be given a
 *   label a thumb can find — so they are reachable, through something else.
 * - **A radio group is one stop, not one per radio.** The browser moves between the
 *   options with the arrow keys and Tab enters and leaves the group as a whole, stopping
 *   at whichever is checked. Counting each option would report the quote form as having
 *   controls the keyboard cannot reach, on a form the keyboard works perfectly.
 */
function focusable(container: HTMLElement): HTMLElement[] {
  const controls = [
    ...container.querySelectorAll<HTMLElement>(
      "a[href], button, input:not([type='hidden']), select, textarea, summary, [tabindex]",
    ),
  ].filter(
    (control) =>
      drawn(control) &&
      !control.matches(":disabled") &&
      control.tabIndex >= 0,
  );

  const groups = new Set<string>();

  return controls.filter((control) => {
    if (!(control instanceof HTMLInputElement) || control.type !== "radio") return true;

    // The one the browser would stop at: the checked option, or the first when the group
    // has no answer yet.
    const group = control.name;
    const checked = controls.find(
      (other) =>
        other instanceof HTMLInputElement &&
        other.type === "radio" &&
        other.name === group &&
        other.checked,
    );

    if (groups.has(group)) return false;

    groups.add(group);

    return checked === undefined || checked === control;
  });
}
