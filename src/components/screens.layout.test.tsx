import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { QuoteForm } from "@/components/quotes/quote-form";
import { blankQuote } from "@/lib/quotes/quote-form";
import { Body, itemBar, locales, Screen, screens, tender } from "@/test/screens";
import { controlRows, desk, expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * **Whole screens, header and body together** — the shape hand-check 1 of #48 actually
 * reported.
 *
 * The per-component suites each measure one thing in isolation, and that is exactly how
 * #56 got through: `working-sheet.layout.test.tsx` rendered the sheet on a bare page and
 * passed, while the real screen carried the app shell's header above it and overflowed.
 * A guard that never composes the two cannot see the bug the user saw.
 *
 * The screens themselves live in `@/test/screens`, shared with the contact sheet (#78) so
 * that what somebody photographs and what this measures cannot drift apart.
 *
 * **And at two widths, since #97.** ADR-0021 designs each destination for the device its
 * role uses, so a suite that only ever stood at 390px could report green on an app with no
 * desktop design at all — which is exactly what it did. The second `describe` below stands
 * at a desk and asserts the width each screen commits to.
 *
 * Both locales, for the reason #56 gives — *"the labels are translated, so English is not
 * the worst case"*. A Han glyph is about twice the width of a Latin letter, so a shorter
 * Chinese string is not automatically a narrower button.
 */

// Hoisted per file and therefore not shareable: the contact sheet declares its own copy
// of this block for the same components. See the note in `@/test/screens`.
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));
vi.mock("@/app/actions/tenders", () => ({
  addAssigneeAction: async () => ({}),
  removeAssigneeAction: async () => ({}),
}));
vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: async () => ({}),
  updateQuoteAction: async () => ({}),
  deleteQuoteAction: async () => ({}),
  // The reduced sourcing screen draws `NoSupplierFoundForm`, which reaches for both of
  // these through `useActionState` — an undefined action there throws on render.
  recordNoSupplierFoundAction: async () => ({}),
  clearNoSupplierFoundAction: async () => ({}),
}));
// `QuoteList` draws each Quote's photo controls, which reach for these.
vi.mock("@/app/actions/quote-photos", () => ({
  recordQuotePhotosAction: async () => ({}),
  removeQuotePhotoAction: async () => ({}),
  signQuotePhotoUploadsAction: async () => ({}),
}));

describe(`a whole screen at ${phone.width}×${phone.height}`, () => {
  it.each(
    locales.flatMap(([locale, messages]) =>
      Object.entries(screens(messages)).map(
        ([name, body]) => [`${name}, in ${locale}`, locale, messages, body] as const,
      ),
    ),
  )("does not scroll sideways: %s", (_case, locale, messages, body) => {
    render(
      <Screen locale={locale} messages={messages}>
        {body}
      </Screen>,
    );

    expectNoSidewaysScroll();

    // The bar stays one row on every screen, not just when measured on its own.
    expect(controlRows(appBar())).toBe(1);

    // And both destinations are on every screen behind the login, including the two that
    // replace a page (ADR-0021). Exactly one of each is *drawn* at 390px — `getAllByRole`
    // does not see the copy on the app bar, which is `display: none` below `md` — so this
    // fails both ways: on a screen the bottom bar never reached, and on one where the two
    // bars were somehow drawn at once.
    for (const destination of [messages.myWork.title, messages.tenders.title]) {
      expect(screen.getAllByRole("link", { name: destination })).toHaveLength(1);
    }

    // The bar and the body agree about where the page's edge is, on a phone as well as at
    // a desk. Here the two columns are the whole width and the claim is nearly free; the
    // suite below is where it has something to catch.
    expectOneColumn();
  });
});

/**
 * **The Owner's two screens, at the monitor they are actually read on** (ADR-0021, #97).
 *
 * The suite above is the phone's, and until #97 it was the only one there was: six of the
 * eight screens rendered as a 768px column at every viewport, and nothing could see it,
 * because the one wider test in the repo asserted only that nothing overflowed — which a
 * centred phone column on a 1440px monitor passes perfectly. ADR-0016 calls that a check
 * that cannot fail, and this is the replacement.
 *
 * **What it pins is a committed width, screen by screen.** Not a floor, not "wide enough":
 * the table below is the composition ADR-0021 decided, so widening My work or narrowing
 * the tender list fails here rather than being noticed later by somebody with a monitor.
 */
const columnAtADesk: Record<string, 768 | 1280> = {
  // The Assignee's two, composed at 390px and allowed to grow no further than the phone's
  // column. A five-field form and a finishable list are not improved by a monitor.
  "my work": 768,
  "my work, finished": 768,
  "sourcing an item": 768,
  "sourcing an item on a tender somebody else owns": 768,
  "correcting a quote": 768,
  // The Owner's, at a desk: comparing Quotes and typing prices.
  "the tender list": 1280,
  "a tender": 1280,
  "a tender somebody else owns": 1280,
  // The two that stand in for a page. They are drawn before anybody knows which screen is
  // coming, so they get the default — and what matters about them here is that their bar
  // and their skeleton agree with *each other*, which `expectOneColumn` checks.
  "the loading fallback": 768,
  "a screen that threw": 768,
};

describe(`a whole screen at ${desk.width}×${desk.height}`, () => {
  // The layout project's viewport is the phone and every other suite in it depends on
  // that, so whatever this does to the window is undone before the next file runs.
  afterEach(async () => {
    await page.viewport(phone.width, phone.height);
  });

  it("states a column for every screen and for no screen that has gone", () => {
    // A table of expectations that has quietly stopped naming the app is the check that
    // cannot fail (ADR-0016): a renamed screen would drop out of the walk below and take
    // its assertion with it, silently.
    expect(Object.keys(columnAtADesk).sort()).toEqual(
      Object.keys(screens(locales[0][1])).sort(),
    );
  });

  it.each(
    locales.flatMap(([locale, messages]) =>
      Object.entries(screens(messages)).map(
        ([name, body]) => [`${name}, in ${locale}`, name, locale, messages, body] as const,
      ),
    ),
  )("is composed at the width it commits to: %s", async (_case, name, locale, messages, body) => {
    await page.viewport(desk.width, desk.height);

    render(
      <Screen locale={locale} messages={messages}>
        {body}
      </Screen>,
    );

    expect(document.querySelector("main")!.getBoundingClientRect().width).toBe(
      columnAtADesk[name],
    );

    // The header stops disagreeing with the page about where its left edge is, which is
    // the other half of #97 and the half only a wide viewport can see: below the cap the
    // two columns are both simply the window.
    expectOneColumn();

    expectNoSidewaysScroll();
    expect(controlRows(appBar())).toBe(1);
  });
});

/**
 * The app bar, told apart from the headings that share its tag.
 *
 * `ScreenHeader` is a `header` too, so `document.querySelector("header")` is the app bar
 * only by document order — true today and true by accident. The app bar is the one that is
 * not inside the body's `main`, which is a structural fact rather than a position.
 */
function appBar(): HTMLElement {
  return [...document.querySelectorAll("header")].find(
    (header) => header.closest("main") === null,
  )!;
}

/**
 * The bar's contents and the body's sit in one column, with the same two edges.
 *
 * The measurement #97 exists for. On a 1440px monitor the body centred itself at 1280
 * while the bar stayed pinned to the window, so the page gave two different answers to
 * *where is my left edge* — visible on every screen, asserted by nothing.
 *
 * Border boxes, and they are the content edges because neither element pads itself: the
 * bar's `px-6` is on the `header` outside the column, and the body's is on the wrapper
 * outside the `main`. That is not incidental — a `max-w-*` sizes the border box, so a
 * column carrying its own padding would be capped *including* it and would land exactly
 * one padding inside the other. This assertion is what caught that while #97 was written.
 */
function expectOneColumn(): void {
  const bar = appBar().querySelector("div")!.getBoundingClientRect();
  const body = document.querySelector("main")!.getBoundingClientRect();

  expect([bar.left, bar.right]).toEqual([body.left, body.right]);
}

/**
 * The sourcing screen once photos have been picked on the way in.
 *
 * Separate from the table above because it is the only case that has to *do* something
 * before it can be measured: the held-photo list does not exist until somebody picks a
 * file, and it is the part of #60 that is new markup on the screen the complaint came
 * from. A camera hands over names nobody chose the width of — `IMG_20260812_143507.jpg`
 * off an Android, and worse off anything that syncs — beside a Remove button on a 390px
 * phone, which is the row that has to hold.
 */
describe(`the create-a-Quote form with photos held, at ${phone.width}×${phone.height}`, () => {
  it.each(locales)("does not scroll sideways: in %s", async (locale, m) => {
    const user = userEvent.setup();

    render(
      <Screen locale={locale} messages={m}>
        <Body width="max-w-3xl" location={itemBar}>
          <QuoteForm
            tenderId={tender.id}
            tenderItemId="item-gloves"
            defaults={blankQuote({ unit: "piece", today: "2026-08-12" })}
          />
        </Body>
      </Screen>,
    );

    await user.upload(screen.getByLabelText(m.quotes.photos.choose), heldPhotos);

    // The list is really there, so a picker that silently dropped the files would fail
    // here rather than pass by measuring nothing.
    expect(screen.getAllByRole("button", { name: /IMG[-_]2026/ })).toHaveLength(2);

    expectNoSidewaysScroll();
  });
});

/**
 * Two names of the kind a phone actually produces: one an Android camera's, one the
 * unbroken run a sync client makes of a shared album. Neither is invented.
 */
const heldPhotos = [
  new File([new Uint8Array([0xff, 0xd8])], "IMG_20260812_143507.jpg", {
    type: "image/jpeg",
  }),
  new File(
    [new Uint8Array([0xff, 0xd8])],
    "IMG-20260812-WA0043-ShanghaiKindlyMedicalNitrileGloveCartonLabel.jpg",
    { type: "image/jpeg" },
  ),
];
