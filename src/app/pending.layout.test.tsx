import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import { SelectQuoteButton } from "@/components/comparison/select-quote-button";
import { NoSupplierFoundForm } from "@/components/quotes/no-supplier-found-form";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import {
  ClearSubmissionButton,
  RecordSubmissionButton,
} from "@/components/tenders/outcome-controls";
import { describeElement, drawn, expectNoSidewaysScroll, phone } from "@/test/layout";
import {
  Body,
  locales,
  Screen,
  screens,
  signedOutScreens,
  SignedOut,
  tender,
} from "@/test/screens";

/**
 * **A control that is working says so, rather than only going dim.**
 *
 * `button.tsx` gives every disabled control `disabled:opacity-50`, and for fifteen submit
 * buttons that fade was the whole of what a press produced (#144). On the Owner's desk it
 * reads as a button that has stopped working; in the WeCom webview on a phone network —
 * the connection ADR-0019 designed the visual system around — it is the beat that produces
 * a second press, which on a *Delete* is not harmless.
 *
 * **"Pending" here is React's word, not the domain's.** `CONTEXT.md` keeps the term away
 * from every state a row can be in — a Reference Image nobody has placed is *Unassigned*
 * — and nothing in this file means it that way. It is `useActionState`'s `isPending`: a
 * write is in flight, and the button that started it is greyed out until it lands.
 *
 * **The word, not the spinner, is what is asserted.** #135 took every animation and
 * transition duration to zero under `prefers-reduced-motion`, so a control whose only
 * pending signal is a spinning `Loader2` tells a reader with that preference set nothing at
 * all. `motion.layout.test.tsx` holds the spinner still; this holds the word. Neither claim
 * is safe without the other, which is why they are two suites over the same screens rather
 * than one.
 *
 * ## The claim
 *
 * For every screen in both shared records: press a submit control, and if the press left it
 * **disabled**, what it says has to have changed.
 *
 * The conditional is the whole of the exclusion list, and it is deliberately a property
 * rather than a list of names. A control with no pending state at all is not disabled by
 * its own press and drops out on its own — the sign-out item and the two answers on the
 * choose-a-language screen post straight to an action and never grey out, so there is
 * nothing here for them to say. What cannot drop out is the case this exists for: a
 * control that takes itself away from the reader and does not replace it with anything.
 *
 * **Its own press**, and only its own. A form doing one thing at a time locks its other
 * buttons while it works — the WeCom group's *Remove* greys out while a webhook is being
 * saved — and that is a form being honest about being busy rather than a control that was
 * pressed and went quiet. What this walks is what a thumb landed on.
 *
 * **A fresh render per press.** The pending state never ends here, so a screen that had two
 * of its buttons pressed would be a screen in a state no reader can reach. Each control is
 * measured on a screen where it is the only thing in flight.
 *
 * **In both locales, and at 390px**, for `target.layout.test.tsx`'s reason: this is
 * geometry as much as wording. A pending word is a *longer* word — *Removing…* against
 * *Remove* — and neither script is the worst case for the other: 正在退出… is a glyph
 * shorter than the 退出该招标 it replaces, while *Taking you off…* is four letters longer
 * than *Take me off*. A word that pushed a control under the 44px floor or a row off the
 * side of the phone would be a fix that broke the two guards it was written beside, so the
 * floor and ADR-0009's bar are asserted here too — on the screen mid-press, which is the
 * state neither of those suites can reach, because both photograph a screen at rest.
 *
 * **Green here is not green on the runner, for the width half of it.** The harness
 * resolves no Latin webfont, so every English string measures narrower on a developer's
 * machine than a reader ever sees it — the note in `reference-image-gallery.tsx` records
 * the last time that cost a red build, and #144 spent one too: the Remove under a Quote
 * Photo had two pixels of daylight locally and none on CI once *Remove* became
 * *Removing…*. The lesson is written into the control rather than into this file — that
 * button now takes its width from the cell it sits in — but a width assertion that passes
 * here is evidence and not proof, and the runner is where it is settled.
 *
 * ## What it does not reach, stated so nobody reads the green as wider than it is
 *
 * **Controls that exist only after an interaction the record cannot compose**, the blind
 * spot `target.layout.test.tsx` and `focus.layout.test.tsx` both name: the image lightbox,
 * and `QuoteForm`'s Remove on a photo somebody has picked but not yet saved. The latter is
 * deliberately outside this ticket anyway — it filters client state and takes no round
 * trip, so it has no pending beat to report — but the lightbox is simply out of reach.
 *
 * **Four controls no screen in the record draws at all** are pressed directly instead, in
 * the last `describe` in this file, which says which and why.
 */

/**
 * Never settles, so the pending beat lasts as long as the assertion needs it to.
 *
 * `vitest.setup.layout.ts` stubs all of these to actions that resolve immediately, which is
 * right for every suite that only wants the record to render. A `vi.mock` in a test file is
 * registered after that one and wins — the same override, for the same reason, that both
 * switcher suites use to hold a spinner on screen.
 */
vi.mock("@/app/actions/auth", () => ({
  signOutAction: () => new Promise(() => {}),
  signInAction: () => new Promise(() => {}),
  setPasswordAction: () => new Promise(() => {}),
  chooseLanguageAction: () => new Promise(() => {}),
}));
vi.mock("@/app/actions/setup", () => ({ setUpAction: () => new Promise(() => {}) }));
vi.mock("@/app/actions/admin", () => ({
  inviteAction: () => new Promise(() => {}),
  setWecomUseridAction: () => new Promise(() => {}),
  sendTestMentionAction: () => new Promise(() => {}),
  setMembershipDisabledAction: () => new Promise(() => {}),
  setGroupRobotAction: () => new Promise(() => {}),
  setFxBufferAction: () => new Promise(() => {}),
}));
vi.mock("@/app/actions/locale", () => ({ switchLocale: () => new Promise(() => {}) }));
vi.mock("@/app/actions/theme", () => ({ switchTheme: () => new Promise(() => {}) }));
vi.mock("@/app/actions/tenders", () => ({
  createTenderAction: () => new Promise(() => {}),
  updateTenderAction: () => new Promise(() => {}),
  addTenderItemAction: () => new Promise(() => {}),
  updateTenderItemAction: () => new Promise(() => {}),
  removeTenderItemAction: () => new Promise(() => {}),
  addAssigneeAction: () => new Promise(() => {}),
  removeAssigneeAction: () => new Promise(() => {}),
  recordSubmissionAction: () => new Promise(() => {}),
  clearSubmissionAction: () => new Promise(() => {}),
  setItemOutcomeAction: () => new Promise(() => {}),
}));
vi.mock("@/app/actions/reference-images", () => ({
  signReferenceImageUploadsAction: () => new Promise(() => {}),
  recordReferenceImagesAction: () => new Promise(() => {}),
  assignReferenceImageAction: () => new Promise(() => {}),
  removeReferenceImageAction: () => new Promise(() => {}),
}));
vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: () => new Promise(() => {}),
  updateQuoteAction: () => new Promise(() => {}),
  deleteQuoteAction: () => new Promise(() => {}),
  recordNoSupplierFoundAction: () => new Promise(() => {}),
  clearNoSupplierFoundAction: () => new Promise(() => {}),
}));
vi.mock("@/app/actions/quote-photos", () => ({
  recordQuotePhotosAction: () => new Promise(() => {}),
  removeQuotePhotoAction: () => new Promise(() => {}),
  signQuotePhotoUploadsAction: () => new Promise(() => {}),
}));
vi.mock("@/app/actions/comparison", () => ({
  selectQuoteAction: () => new Promise(() => {}),
  setLandedCostAction: () => new Promise(() => {}),
  setSellingPriceAction: () => new Promise(() => {}),
}));

/** The 44px floor, restated here because a pending label is a way to fall through it. */
const floor = 44;

/**
 * Every control on the screen that posts something, as a thumb can reach it.
 *
 * `.sr-only` is excluded for the reason `target.layout.test.tsx` excludes it: the submit
 * under `ItemOutcomePicker` and the one under `ItemPricing` exist for a browser running no
 * JavaScript, where changing a `<select>` submits nothing. Neither is seen, so neither has
 * anything to say.
 */
function submits(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>("button[type='submit']"),
  ].filter(
    (control) =>
      drawn(control) && control.tabIndex >= 0 && control.closest(".sr-only") === null,
  );
}

/**
 * What this control tells a reader it is, which is not always what it draws.
 *
 * The accessible name where there is one, and the words otherwise. A photo's *Remove* is
 * the live case both ways round: the visible label is short because it sits under a
 * thumbnail, and the name carries the position so that four of them are four buttons. A
 * pending state that moved one and not the other would leave the reader who hears the
 * screen with the fade and none of the news.
 */
function says(control: HTMLElement): string {
  return (control.getAttribute("aria-label") ?? control.textContent ?? "").trim();
}

/** Why this control is under the floor, or `null` if it clears it. */
function undersized(control: HTMLElement): string | null {
  const { width, height } = control.getBoundingClientRect();

  if (width >= floor && height >= floor) return null;

  return `${Math.round(width)}×${Math.round(height)} — ${describeElement(control)}`;
}

/** One press on one screen: what it said before, and what it said after. */
type Press = { screen: string; before: string; after: string };

/**
 * Press each submit control in turn, each on a screen of its own, and report the ones that
 * went dim.
 *
 * A control already disabled before anybody touched it is not pressed: the test-mention
 * button is disabled until a colleague has a WeCom userid, and pressing something that
 * cannot be pressed would ask it to answer for a fade it did not cause.
 */
async function pressEachSubmit(
  name: string,
  draw: () => HTMLElement,
): Promise<Press[]> {
  const user = userEvent.setup();
  const reported: Press[] = [];
  const count = submits(draw()).length;

  for (let index = 0; index < count; index += 1) {
    const control = submits(draw())[index];

    if (control === undefined || control.disabled) continue;

    const before = says(control);

    await user.click(control);

    // The control is still the one that was pressed. Nothing in the app swaps a submit
    // button out for another while its own write is in flight, and a walk that quietly
    // measured a different button would report green about the wrong control.
    expect(control.isConnected, `${name}: the pressed control left the screen`).toBe(true);

    if (!control.disabled) continue;

    reported.push({ screen: name, before, after: says(control) });

    // And it is still a control, at the size and in the row it was drawn in.
    expect(undersized(control), `${name}: "${says(control)}" is under the floor`).toBeNull();
    expectNoSidewaysScroll();
  }

  return reported;
}

/** Everything the walk pressed, kept so the suite below can show it can fail. */
const pressed: Press[] = [];

describe.each(locales)(`read in %s at ${phone.width}px`, (locale, messages) => {
  it.each(Object.entries(screens(messages)).map(([name, entry]) => [name, entry.body]))(
    "says what it is doing, rather than only going dim, on %s",
    async (name, body) => {
      const reported = await pressEachSubmit(name, () => {
        const { container } = render(
          <Screen theme="light" locale={locale} messages={messages}>
            {body}
          </Screen>,
        );

        return container;
      });

      pressed.push(...reported);

      expect(
        reported.filter((press) => press.after === press.before),
        `${name} has a control that went dim and said nothing`,
      ).toEqual([]);
    },
  );

  it.each(
    Object.entries(signedOutScreens(messages)).map(
      ([name, entry]) => [name, entry.body] as const,
    ),
  )("says what it is doing, rather than only going dim, on %s", async (name, body) => {
    const reported = await pressEachSubmit(name, () => {
      const { container } = render(
        <SignedOut theme="light" locale={locale} messages={messages}>
          {body}
        </SignedOut>,
      );

      return container;
    });

    pressed.push(...reported);

    expect(
      reported.filter((press) => press.after === press.before),
      `${name} has a control that went dim and said nothing`,
    ).toEqual([]);
  });
});

/**
 * **And the walk really pressed things** (ADR-0016).
 *
 * Everything above is a claim about controls that went dim, and a run that found none
 * would pass every one of them in silence — which is exactly what a broken stub, a record
 * that stopped composing a form, or a `submits` that matched nothing would look like. The
 * floor is written low against the number the record holds today, so that adding a screen
 * or taking one away is not an edit here, while a walk that quietly stopped pressing
 * anything is a failure.
 */
describe("the walk itself", () => {
  it("found controls that go dim, on both records and in both locales", () => {
    expect(pressed.length).toBeGreaterThan(30);
  });
});

/**
 * **The five controls the record cannot draw**, pressed directly — the shape
 * `target.layout.test.tsx` ends on, and for the same reason: a guard that is a property of
 * every screen still only reaches the screens somebody composed.
 *
 * - **Record the bid as sent**, and **It has not gone out** beside it. `OutcomePanel` is an
 *   `async` Server Component that awaits `tenderVerdict`, so it is on no screen in the
 *   record at all — the note at the head of `@/test/screens` says so and says what it would
 *   take to change. The two buttons inside it are sync and can be drawn here.
 * - **Add me**, which is drawn only for a reader who is not already an Assignee. Every
 *   composition of the Tender detail is read by somebody who is.
 * - **I found one after all**, which is drawn only where the reader has already recorded
 *   that they could not source the Item. The record draws the other half of that pair.
 * - **The undo on a Selected Quote.** The working sheet is in the record and five of its
 *   *Select* buttons are pressed by the walk above — but none of them is the Selected one:
 *   the fixture names a `selectedQuoteId` that no drawn row matches, so the sheet composes
 *   at 390px with nothing chosen on it. That is a gap in the record rather than in this
 *   suite, and it is left alone here; what this presses is the button that row would draw.
 *
 * Each is composed in the same `Body` the record's screens use, so the floor and ADR-0009's
 * bar are asserted against the column a reader really meets rather than against a button
 * floating on a blank page.
 */
describe.each(locales)(`drawn nowhere in the record, read in %s`, (locale, messages) => {
  it.each([
    [
      "the Outcome panel's two buttons",
      <>
        <RecordSubmissionButton tenderId={tender.id} />
        <ClearSubmissionButton tenderId={tender.id} />
      </>,
    ],
    [
      "enrolling yourself on a Tender you are not on",
      <AssigneeControls
        key="assignee"
        tenderId={tender.id}
        assignees={tender.assignees}
        members={tender.assignees}
        callerId="user-ploy"
        isOwner={false}
      />,
    ],
    [
      "taking back the Selected Quote",
      <SelectQuoteButton
        key="select"
        tenderId={tender.id}
        tenderItemId={tender.items[1].id}
        quoteId="q2a"
        isSelected
      />,
    ],
    [
      "taking back a No Supplier Found",
      <NoSupplierFoundForm
        key="no-supplier"
        tenderId={tender.id}
        tenderItemId={tender.items[0].id}
        mine={{
          userId: "user-ploy",
          name: "Ploy Sirikanya",
          note: null,
          createdAt: "2026-08-13T04:00:00Z",
        }}
        others={[]}
      />,
    ],
  ] as const)("says what it is doing: %s", async (name, body) => {
    const reported = await pressEachSubmit(name, () => {
      const { container } = render(
        <Screen theme="light" locale={locale} messages={messages}>
          <Body>{body}</Body>
        </Screen>,
      );

      return container;
    });

    // Unlike the walk above, these are composed here precisely because they draw a control
    // — one that answered nothing would be a fixture that had stopped drawing it.
    expect(reported.length, `${name} pressed nothing that goes dim`).toBeGreaterThan(0);
    expect(
      reported.filter((press) => press.after === press.before),
      `${name} has a control that went dim and said nothing`,
    ).toEqual([]);
  });
});
