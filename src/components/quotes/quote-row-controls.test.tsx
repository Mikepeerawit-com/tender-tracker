import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { QuoteRowControls } from "./quote-row-controls";

/**
 * **What the confirm row does while the delete is away** (#144).
 *
 * The rest of this component's behaviour — when the second press is asked for, and what it
 * warns about — is argued at the component and proved against the real database in
 * `@/lib/quotes/quotes`. What only exists once the row is interactive is the beat between
 * the press and the revalidated screen, and there are two claims about it worth holding.
 *
 * **The button that was pressed says what it is doing.** Every other control in this ticket
 * is walked by `pending.layout.test.tsx`, which presses each submit on each screen in the
 * shared record; this one is here as well because *Keep it* is the case that suite cannot
 * see. It goes dim for a press that landed on a different button, so nothing that measures
 * the control a thumb hit would ever ask about it.
 *
 * **And *Keep it* is taken away rather than greyed out.** It is the one control in the row
 * that does no work of its own: it takes back a question, and the question is gone the
 * moment the answer has been sent. Left drawn and disabled it would be exactly the fade
 * this ticket is about, on a control with nothing it could honestly say — so the row
 * collapses to the one word that is true, and the cancel comes back with the screen.
 */

vi.mock("@/app/actions/quotes", () => ({
  // Never settles, so the beat lasts as long as the assertions need it to.
  deleteQuoteAction: () => new Promise(() => {}),
}));

function draw() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QuoteRowControls
        tenderId="a-tender"
        tenderItemId="an-item"
        quoteId="a-quote"
        supplierName="Bangkok Medical Supply"
        isSelected
      />
    </NextIntlClientProvider>,
  );
}

/** Through the confirm the Selected Quote asks for, and out the other side. */
async function confirmTheDelete(): Promise<void> {
  const user = userEvent.setup();

  draw();
  await user.click(screen.getByRole("button", { name: messages.quotes.delete }));
  await user.click(screen.getByRole("button", { name: messages.quotes.deleteConfirm }));
}

describe("deleting the Selected Quote", () => {
  it("says it is deleting, rather than only fading", async () => {
    await confirmTheDelete();

    // Disabled *and* saying so, which is the whole of the claim: the fade was never the
    // fault, the silence beside it was.
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: messages.quotes.deleting })
        .disabled,
    ).toBe(true);
  });

  it("takes the cancel away rather than leaving it dim", async () => {
    await confirmTheDelete();

    expect(
      screen.queryByRole("button", { name: messages.quotes.deleteCancel }),
    ).toBeNull();
  });

  it("offers the cancel right up until the press", async () => {
    // So the test above cannot pass on a row that had stopped drawing one at all.
    const user = userEvent.setup();

    draw();
    await user.click(screen.getByRole("button", { name: messages.quotes.delete }));

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.quotes.deleteCancel,
      }).disabled,
    ).toBe(false);
  });
});
