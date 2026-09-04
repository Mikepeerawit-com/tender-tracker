import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { describeElement, drawn, phone } from "@/test/layout";
import {
  locales,
  Screen,
  screens,
  signedOutScreens,
  SignedOut,
} from "@/test/screens";

/**
 * **The 44px tap floor, as a number the build can fail on.**
 *
 * `buildspec_2` states the floor twice and both times as something a person does: *"judge
 * at 390px on a real phone, not a narrowed desktop window — tap targets are floored at
 * 44px, which a resized browser will not surface"*, and then, in the list of what is left
 * to the eye, *"44px tap targets and the density feel — judged at 390px on a real phone"*.
 * `docs/simplification-scope.md` is the reason that is not good enough: no colleague tests
 * this work before it ships, so a rule whose only enforcement is a judgement nobody is
 * rostered to make is a rule the app is free to drift away from. It did. Four controls on
 * the Assignee's own screens were drawn at 28px high, and the app has been repainted five
 * times since the floor was written down without anybody measuring one of them.
 *
 * **The fault is the one ADR-0019 keeps recording, in its third form.** The chrome was
 * never the problem: `AppNav`, `AppMenu`, `AppHeader`, `ThemeSwitcher` and
 * `LocaleSwitcher` each carry an explicit `min-h-11` or `size-11` *and* a suite asserting
 * it. What had no guard was the page body — the region the Assignee actually works in —
 * and there the floor was reached by remembering to write `className="h-11"` beside
 * `size="sm"`. `SourcingList` remembers. `WorkingSheet` remembers. `QuoteRowControls`,
 * `QuotePhotos`, `ReferenceImageGallery` and `AssigneeControls` did not, and nothing could
 * tell. A floor that is opt-in per call site is a floor the next call site is free to miss;
 * this is what makes it a property of every screen instead.
 *
 * ## What it measures
 *
 * Every control a reader can tap, on every screen in the shared records, held to 44px in
 * **both** dimensions. Not the button's own `h-*` class: the box it was actually drawn at,
 * which is the only number a thumb meets — a control can be given `h-11` and still be
 * squeezed by a parent, and a control given nothing can clear the floor because its
 * padding got it there.
 *
 * **At 390px, and only there.** The floor is a claim about a thumb, and the widths this
 * repo reads a screen at are the phone in the WeCom webview and the Owner's desk
 * (ADR-0021). A mouse is not a thumb and a 28px button under a pointer is not the same
 * fault, so measuring the desk would be asserting a rule nobody wrote. 390px is also where
 * the geometry is worst: controls that share a row at a desk take two on a phone, and the
 * one that gets squeezed is squeezed here.
 *
 * **In both locales**, unlike `focus.layout.test.tsx`, which stands in `en` alone. That
 * suite asks a colour question and a ring does not change width with the script. This one
 * is geometry end to end, and a Han glyph is about twice the width of a Latin letter — the
 * reason `density.layout.test.tsx` budgets the two locales separately rather than taking
 * the larger. A control that clears 44 wide on *Delete* and not on 删除 is a control this
 * would miss by standing in one script.
 *
 * **In one theme**, and that is the opposite trade for the same reason: a theme changes
 * what a control is painted in and nothing about the box it is painted in. Walking both
 * would double the run to re-measure identical rectangles. `light` is the record's default
 * and is named rather than defaulted, so that a day the themes *do* differ in geometry is
 * a day somebody has to come here and say so.
 *
 * ## What it does not reach, stated so nobody reads the green as wider than it is
 *
 * **Controls that exist only after an interaction**, the same blind spot
 * `focus.layout.test.tsx` names: the image lightbox, and the Remove on a photo somebody
 * has just picked but not yet saved. They are drawn by no screen at rest, so they are in
 * no record this walks. `QuoteForm`'s held-photo Remove is the live one — it is the same
 * `size="sm"` as the four this caught, and it is fixed alongside them on the strength of
 * being the same control rather than on the strength of being measured here.
 *
 * **`NewTenderForm`'s per-row Remove was the second of that kind, and is not any more**
 * (#143). The record screen opens on one Item row and draws no Remove beside it; the
 * control appears only once somebody presses *Add an item*. It was `size="sm"` with no
 * `h-11`, exactly like the four above, and the walk over screens at rest cannot see it.
 *
 * So it is measured by pressing the button — the last `describe` in this file. That is
 * `screens.layout.test.tsx`'s own shape, where *the create-a-Quote form with photos held*
 * uploads two files and then measures: a screen a reader reaches in one press is a screen,
 * and the record it is not in is a record of screens **at rest** rather than a list of
 * everything worth measuring. What stays out of reach is what no single press composes —
 * the lightbox, and the held-photo Remove that needs files a fixture cannot hand a file
 * input on every screen it appears on.
 *
 * **And spacing is not a substitute measured here.** WCAG 2.2's own target rule (SC 2.5.8)
 * lets an undersized target pass if nothing else comes within 24px of it. This app's floor
 * is `buildspec_2`'s 44 rather than WCAG's 24, and it is a floor on the target rather than
 * on the gap, so the exception is deliberately not implemented: a control that would need
 * it is a control to make bigger.
 */
const floor = 44;

/**
 * The two exclusions, and both are a control that is *deliberately* not a tap target
 * rather than one this walk is letting itself off.
 *
 * **`.sr-only` is a 1×1 box with its content clipped out of it** — that is the mechanism,
 * not a way it has failed, and `overflowing` in `@/test/layout` excludes it for exactly
 * the same reason. The live case is the submit button under `ItemOutcomePicker`, which
 * exists for a browser running no JavaScript, where changing a `<select>` submits nothing.
 * Six of them are drawn on the Tender detail. A floor applied to those would be a floor on
 * something no thumb can reach and no eye can see.
 *
 * **`tabindex="-1"` is the photo picker's two file inputs**, off-screen and pressed by the
 * buttons beside them, because a bare file input cannot be given a label a thumb can find.
 * The target a reader hits is the button, and the button is measured.
 */
function tappable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      "a[href], button, input:not([type='hidden']), select, textarea, summary",
    ),
  ].filter(
    (control) =>
      drawn(control) &&
      control.tabIndex >= 0 &&
      control.closest(".sr-only") === null,
  );
}

/**
 * The box a thumb actually lands on, which is not always the control's own.
 *
 * A radio input is 13×13 whatever anybody writes on it — the size is the platform's and no
 * stylesheet in this app changes it — and it is wrapped in a `<label>`, so the target is
 * the label: a tap anywhere in it checks the radio. `focus.layout.test.tsx` meets the same
 * fact from the other side, where a radio's focus ring is drawn on the label under
 * `focus-within`. Measuring the input would report the theme and language pickers as
 * failing on every screen that draws one, on controls a thumb hits perfectly.
 *
 * The nearest label, not any ancestor: a control inside a `<div>` is not made bigger by
 * that `div`, because nothing makes the `div` clickable.
 */
function hitArea(control: HTMLElement): HTMLElement {
  return control.closest("label") ?? control;
}

/** Why this control is under the floor, or `null` if it clears it. */
function undersized(control: HTMLElement): string | null {
  const { width, height } = hitArea(control).getBoundingClientRect();

  if (width >= floor && height >= floor) return null;

  return `${Math.round(width)}×${Math.round(height)} — ${describeElement(control)}`;
}

function expectEveryTargetClearsTheFloor(container: HTMLElement, name: string): void {
  const controls = tappable(container);

  // A screen with nothing to tap is a screen this walked past rather than measured, and
  // it would report green for having found no fault (ADR-0016). Every screen in both
  // records draws at least the bottom bar's two destinations.
  expect(controls.length, `${name} drew nothing to tap`).toBeGreaterThan(0);

  expect(
    controls.map(undersized).filter((fault) => fault !== null),
    `${name} at ${phone.width}px has targets under the ${floor}px floor`,
  ).toEqual([]);
}

describe.each(locales)("read in %s", (locale, messages) => {
  it.each(Object.entries(screens(messages)).map(([name, entry]) => [name, entry.body]))(
    "gives every control on %s a thumb-sized target",
    (name, body) => {
      const { container } = render(
        <Screen theme="light" locale={locale} messages={messages}>
          {body}
        </Screen>,
      );

      expectEveryTargetClearsTheFloor(container, name);
    },
  );

  /**
   * The signed-out screens, from the record beside the other one. They are the first
   * screens any reader meets and the ones reached from a phone with no session at all, so
   * a target nobody can hit there is a person who does not get into the app.
   */
  it.each(
    Object.entries(signedOutScreens(messages)).map(
      ([name, entry]) => [name, entry.body] as const,
    ),
  )("gives every control on %s a thumb-sized target", (name, body) => {
    const { container } = render(
      <SignedOut theme="light" locale={locale} messages={messages}>
        {body}
      </SignedOut>,
    );

    expectEveryTargetClearsTheFloor(container, name);
  });
});


/**
 * **The per-row Remove on the record-a-tender form**, which is drawn only after a press
 * and so is on no screen in the record above (#143).
 *
 * `NewTenderForm` opens on one Item row. A Tender needs at least one, so the control that
 * takes a row off is not drawn until there are two — which makes *Add an item* the whole
 * of the distance between the screen the record composes and the screen this measures.
 * One press, and then the same floor over the same screen.
 *
 * In both locales for the reason the walk above gives: this is geometry, and 移除 is not
 * automatically narrower than *Remove*.
 */
describe(`the record-a-tender form with a second Item row, at ${phone.width}px`, () => {
  it.each(locales)(
    "gives the per-row Remove a thumb-sized target: in %s",
    async (locale, messages) => {
      const user = userEvent.setup();
      const { container } = render(
        <Screen theme="light" locale={locale} messages={messages}>
          {screens(messages)["recording a tender"].body}
        </Screen>,
      );

      await user.click(
        screen.getByRole("button", { name: messages.tenders.item.add }),
      );

      // Both rows really drew one, so a form that stopped offering the control would fail
      // here rather than pass by measuring a screen with nothing new on it (ADR-0016).
      expect(
        screen.getAllByRole("button", { name: messages.tenders.item.remove }),
      ).toHaveLength(2);

      expectEveryTargetClearsTheFloor(
        container,
        "recording a tender, with a second Item row",
      );
    },
  );
});
