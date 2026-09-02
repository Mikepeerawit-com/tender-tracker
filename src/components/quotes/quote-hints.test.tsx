import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { locales as shipped } from "@/i18n/config";
import { blankQuote } from "@/lib/quotes/quote-form";
import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { QuoteForm } from "./quote-form";

/**
 * What the form asks somebody to read before they can write down a price.
 *
 * Nine sentences, one under nearly every field, read by an Assignee off the phone to
 * enter one number — every visit, in whichever language they chose. Which of them survive
 * is #91's rule, stated where the fields are: see `QuoteFieldInputs` in `quote-fields.tsx`.
 *
 * This counts the sentences rather than naming the keys that were deleted, because the
 * fault it guards against is the form filling back up — with these hints or with new ones
 * written under some later field. `messages.test.ts` holds the other half, that the six
 * retired strings are gone from the files rather than merely unrendered.
 *
 * Two, not the screen's three: `quotes.addHint` is drawn by the page above this form, and
 * that page is an `async` Server Component that cannot be rendered here. It is a section
 * hint over the "Add a quote" heading and is in #91's keep list, so the screen a reader
 * meets says three sentences and this form says two of them.
 *
 * Both locales, because a hint is prose and prose is what a translation is free to keep
 * after English has dropped it. They are read by the class the two call sites share
 * rather than by tag, since that class is how a hint is drawn here and the repo says the
 * same muted line in a `<span>` elsewhere; a third one written tomorrow is counted whether
 * or not anybody thought to add it to this list.
 *
 * It is a `.test.tsx` — the interactive seam — because half of what is being claimed is
 * about the Alternative branch, which exists only once somebody has clicked the radio and
 * the form owns that state. The other assertion needs no interaction and belongs beside
 * it: the two are one claim about how much this screen ever says.
 *
 * The two actions are stubbed because they are server actions and this runs in jsdom.
 * `quote-form.test.tsx` stubs the same two and the mocks are not shared: `vi.mock` is
 * hoisted per file, which is why the blocks look duplicated and are not.
 */

vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: () => ({}),
}));

vi.mock("@/app/actions/quote-photos", () => ({
  signQuotePhotoUploadsAction: () => ({ ok: true, uploads: [] }),
  recordQuotePhotosAction: () => ({}),
}));

/**
 * The messages each locale draws this form with.
 *
 * Written out by hand, because a message file is imported statically or not at all — and
 * so held to naming every locale by the assertion below, which is what `messages.test.ts`
 * does with its own hand-written table. Without it a third locale would ship a quote form
 * nothing here had ever counted.
 */
const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

function renderForm(locale: string, messages: typeof en) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <QuoteForm
        tenderId="a-tender"
        tenderItemId="an-item"
        defaults={blankQuote({ unit: "box of 50", today: "2026-08-21" })}
      />
    </NextIntlClientProvider>,
  );
}

/** Every hint the form drew, in the order a reader meets them. */
function hints(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".text-muted-foreground.text-xs")].map(
    (paragraph) => paragraph.textContent ?? "",
  );
}

it("counts the form in every locale the app ships", () => {
  expect(locales.map(([locale]) => locale).sort()).toEqual([...shipped].sort());
});

describe.each(locales)("the quote form in %s", (locale, messages) => {
  it("says two sentences to somebody entering an ordinary price", () => {
    const { container } = renderForm(locale, messages);

    // The radio group's, which says what an Alternative is, and the photo section's,
    // which says when the pictures actually upload. Both sit above a group rather than
    // under a field, and both are in #91's keep list.
    expect(hints(container)).toEqual([
      messages.quotes.matchType.hint,
      messages.quotes.photos.attachHint,
    ]);
  });

  it("says no more to somebody who priced a different product", async () => {
    const user = userEvent.setup();
    const { container } = renderForm(locale, messages);

    await user.click(container.querySelector("input[value='alternative']")!);

    // A field appears — the Alternative's own name, required once revealed — and no
    // sentence appears with it. The radio hint above already says an Alternative carries
    // its own name, which is the concept, taught on the beat somebody chooses it. This is
    // the branch a hint would come back through first, so it is the branch worth counting.
    expect(hints(container)).toEqual([
      messages.quotes.matchType.hint,
      messages.quotes.photos.attachHint,
    ]);
  });
});
