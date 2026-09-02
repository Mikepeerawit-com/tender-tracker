import { existsSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import type { MyWorkRow } from "@/lib/tenders/my-work";
import en from "@/messages/en.json";

import { MyWorkList } from "./my-work-list";

/**
 * Where a row on **My work** actually goes.
 *
 * The one claim ADR-0021 makes that no other test in this repo can see. The layout guard
 * measures this screen and the read decides what is on it; neither looks at an `href`, and
 * a row pointing at the Tender instead of the quote form would pass both while leaving an
 * Assignee exactly where they started — three levels down, navigating a Tender to reach
 * an Item the reminder already named.
 *
 * So the destination is asserted twice over: that the row builds the Item's quote-form
 * path, and that a page really sits at that path on disk. The second half is what makes
 * the first mean anything — a `<Link>` to a route nobody has written is a 404 no type
 * checks and no render can notice, and this list is the only screen in the app that links
 * straight into an Item.
 */

const row: MyWorkRow = {
  itemId: "9a1f8c3e-2b47-4d10-8e56-7c0b3d9f4a21",
  tenderId: "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90",
  productName: "Nitrile examination gloves, powder-free, size M",
  clientName: "Bangkok Metropolitan Administration",
  reference: "TR-2026-0142",
  internalQuoteDeadline: "2026-08-13",
  status: { tone: "signal", days: 1 },
};

function renderList(items: MyWorkRow[] = [row]) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
      <MyWorkList items={items} />
    </NextIntlClientProvider>,
  );
}

describe("a row on My work", () => {
  it("links straight to the quote form for its own Item", () => {
    renderList();

    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `/tenders/${row.tenderId}/items/${row.itemId}/quote`,
    );
  });

  it("links at a path this app actually serves", () => {
    // The route the href above is built for, held against the file on disk. Moving the
    // quote form and leaving this list behind is the failure; nothing else would report
    // it until somebody tapped a row in production.
    expect(
      existsSync(
        join(
          process.cwd(),
          "src/app/(app)/tenders/[id]/items/[itemId]/quote/page.tsx",
        ),
      ),
    ).toBe(true);
  });

  it("says so when there is nothing left, rather than drawing an empty box", () => {
    renderList([]);

    // The requirement, not a fallback: the list is meant to reach zero, and a reader who
    // has finished has to be told they have.
    expect(screen.getByText(en.myWork.empty)).toBeDefined();
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("names the Item, its client and its Tender reference", () => {
    renderList();

    // Read off the link rather than the document, so that a string drawn *beside* the
    // row would not satisfy it: what the criterion asks is that the thing you tap says
    // which Item it is about.
    const said = screen.getByRole("link").textContent ?? "";

    // The Item is the subject — it is what the reminder that summoned somebody named —
    // and the other two say which supplier conversation the row belongs to.
    expect(said).toContain(row.productName);
    expect(said).toContain(row.clientName);
    expect(said).toContain(row.reference);
    // The deadline that applies, and how far off it is, in the tender row's own words.
    expect(said).toContain(en.tenders.row.due.internal_quote.tomorrow);
  });
});
