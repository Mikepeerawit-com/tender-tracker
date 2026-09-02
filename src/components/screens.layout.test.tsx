import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "@/components/app-header";
import { QuoteForm } from "@/components/quotes/quote-form";
import { blankQuote } from "@/lib/quotes/quote-form";
import { Body, itemBar, locales, Screen, screens, tender } from "@/test/screens";
import { controlRows, expectNoSidewaysScroll, phone } from "@/test/layout";

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
    expect(controlRows(document.querySelector("header")!)).toBe(1);
  });
});

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
        <Body width="max-w-3xl" bar={<AppHeader isOrgAdmin location={itemBar} />}>
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
