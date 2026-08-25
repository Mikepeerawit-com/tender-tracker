import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { ItemOutcomePicker, RecordSubmissionButton } from "./outcome-controls";

/**
 * The half of recording an Outcome that only exists once it is interactive: a picker with
 * no Save button beside it, which therefore has to be trusted to have saved.
 *
 * The regression the second test is here for is not hypothetical. React resets a form
 * after a function action, and a reset puts a `<select>` back to the option it was
 * mounted with — so the picker read `won` for the beat it took to save, then quietly
 * dropped back to what it had been, beside a row already saying the Item was decided.
 * Nothing about that is visible from the server; it is what the acceptance criteria mean
 * by an Outcome being recorded.
 *
 * The action is the seam's edge and is stubbed. What the four values *mean* is asserted
 * over fixtures in `@/lib/tenders/outcome`.
 */

type OutcomeAction = (previous: unknown, formData: FormData) => Promise<object>;

const posted = {
  outcome: vi.fn<OutcomeAction>(async () => ({})),
  submission: vi.fn<OutcomeAction>(async () => ({})),
};

vi.mock("@/app/actions/tenders", () => ({
  setItemOutcomeAction: (previous: unknown, formData: FormData) =>
    posted.outcome(previous, formData),
  recordSubmissionAction: (previous: unknown, formData: FormData) =>
    posted.submission(previous, formData),
  clearSubmissionAction: (previous: unknown, formData: FormData) =>
    posted.submission(previous, formData),
}));

type Outcome = "won" | "lost" | "no_bid" | "cancelled" | null;

function picked(outcome: Outcome) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ItemOutcomePicker
        tenderId="a-tender"
        itemId="an-item"
        productName="Nitrile gloves, powder-free"
        outcome={outcome}
      />
    </NextIntlClientProvider>
  );
}

function renderPicker(outcome: Outcome) {
  return render(picked(outcome));
}

const picker = () => screen.getByLabelText(/outcome for nitrile gloves/i);

/** The FormData of the last call, as plain fields. */
function lastPost(action: typeof posted.outcome): Record<string, string> {
  const formData = action.mock.calls.at(-1)?.[1];

  return Object.fromEntries([...(formData ?? new FormData())]) as Record<string, string>;
}

describe("the Outcome picker", () => {
  beforeEach(() => {
    posted.outcome.mockClear();
    posted.submission.mockClear();
  });

  it("saves the Outcome as it is picked, with no Save button to press", async () => {
    const user = userEvent.setup();

    renderPicker(null);
    await user.selectOptions(picker(), "won");

    await waitFor(() => expect(posted.outcome).toHaveBeenCalledTimes(1));
    expect(lastPost(posted.outcome)).toEqual({
      tenderId: "a-tender",
      itemId: "an-item",
      outcome: "won",
    });
  });

  it("still shows what was picked once the save has landed", async () => {
    // The regression, and the whole reason this file exists. React resets a form after
    // every action, and a reset puts a `<select>` back to the option it was mounted with
    // — so the picker un-picked itself a beat after saving, beside a row already reading
    // "Decided today". A picker that silently reverts is indistinguishable from one that
    // failed to save, on the one screen where nothing else says whether it did.
    const user = userEvent.setup();
    const { rerender } = renderPicker(null);

    await user.selectOptions(picker(), "won");
    await waitFor(() => expect(posted.outcome).toHaveBeenCalledTimes(1));

    // What the revalidated Tender sends back down once the write has landed.
    rerender(picked("won"));

    await waitFor(() => expect(picker()).toHaveProperty("value", "won"));
  });

  it("posts an empty Outcome when the decision is taken back off", async () => {
    // Which clears `outcome_at` with it — a date with no Outcome is a row the
    // `outcome_dated` CHECK refuses outright.
    const user = userEvent.setup();

    renderPicker("won");
    await user.selectOptions(picker(), "");

    await waitFor(() => expect(posted.outcome).toHaveBeenCalledTimes(1));
    expect(lastPost(posted.outcome).outcome).toBe("");
  });

  it("offers the four stored values and nothing else", async () => {
    // `partial` is a Tender-level display state derived from these rows, and there is no
    // row for it to be written to. It must not be on offer here.
    renderPicker(null);

    expect(
      [...picker().querySelectorAll("option")].map((option) => option.value),
    ).toEqual(["", "won", "lost", "no_bid", "cancelled"]);
  });

  it("records the Bid as having gone out", async () => {
    const user = userEvent.setup();

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RecordSubmissionButton tenderId="a-tender" />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /record the bid as sent/i }));

    await waitFor(() => expect(posted.submission).toHaveBeenCalledTimes(1));
    // No instant in the payload: `submitted_at` is stamped at the request boundary, so a
    // browser clock cannot decide when the Bid went out.
    expect(lastPost(posted.submission)).toEqual({ tenderId: "a-tender" });
  });
});
