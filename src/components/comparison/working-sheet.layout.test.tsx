import { render } from "@testing-library/react";
import { page } from "vitest/browser";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import type { SheetItem } from "@/lib/comparison/sheet";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import type { ReferenceImage } from "@/lib/images/reference-images";
import type { Quote } from "@/lib/quotes/quotes";
import messages from "@/messages/en.json";
import { desk, expectNoSidewaysScroll, fontStack, phone } from "@/test/layout";

import { WorkingSheet } from "./working-sheet";

/**
 * At 390×844, on eight competing Quotes, the comparison working sheet never scrolls
 * sideways.
 *
 * This was for a long time the project's *only* automated UI assertion, and #56 was the
 * bill for that: a hand-check found the tender list, a Tender and this sheet all wider
 * than the phone, because the app shell above them had never been measured by anything.
 * The `layout` project now guards `app-header`, `tender-row` and `screen-header` too, and
 * `overflowing` moved to `@/test/layout` so it can be pointed at any of them.
 *
 * ADR-0009 states the failure bar in exactly those terms — *"a table that works by
 * scrolling sideways is a failure, not a pass"* — and it is the one outcome the design
 * rules out, because a builder told only "make it responsive" reaches for a
 * horizontally-scrolling table. Everything else the ADR settles is a judgement call best
 * made by eye on a real phone; this one is arithmetic, so it is pinned here.
 *
 * It runs under `vitest --project layout`, in headless Chromium at that viewport, with
 * the app's own stylesheet loaded — jsdom has no layout engine, so `scrollWidth` there is
 * `0` and the assertion would pass on a sheet that overflowed by a mile.
 *
 * The dataset is ticket 09's, inherited rather than re-derived: eight Quotes on the first
 * Item, a unit mismatch on the second, an Item where every Quote is an Alternative on the
 * third, and long real supplier and product names throughout — the awkward cases are what
 * push a layout over, not the tidy ones.
 *
 * The two server actions are the seam's edge and are stubbed; nothing here presses
 * anything, it only measures what was drawn.
 *
 * **What is deliberately not here: the 44px tap-target floor.** buildspec_2 puts that in
 * the hand-checked column — *"judged at 390px on a real phone, not a narrowed desktop
 * window"* — and a green CI gate on it is the exact false confidence that line exists to
 * prevent. A browser can measure the pixels and cannot tell you whether the card is
 * reachable with a thumb on a moving bus.
 */

vi.mock("@/app/actions/comparison", () => ({
  selectQuoteAction: async () => ({}),
  setLandedCostAction: async () => ({}),
  setSellingPriceAction: async () => ({}),
}));

describe(`the working sheet at ${phone.width}×${phone.height}`, () => {
  it("never scrolls sideways, anywhere on the page", () => {
    const { container } = renderSheet();
    const sheet = container.querySelector("section")!;

    // The criterion, stated as ADR-0009 states it.
    expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);

    // And "anywhere", which is the half a single element's measurement would miss: one
    // cell wider than its column overflows the page just as surely as the table does.
    expectNoSidewaysScroll();
  });

  it("reflows the quote list into cards rather than keeping a table", () => {
    // The failure bar can also be cleared by a table so squeezed it is unreadable, which
    // is not what the ADR asked for. Below 768px the nine columns are one stacked card
    // per Quote: the heading row is gone and the row itself is laid out as a grid.
    const { container } = renderSheet();
    const heading = container.querySelector("thead")!;
    const row = container.querySelector("tbody tr")!;

    expect(getComputedStyle(heading).display).toBe("none");
    expect(getComputedStyle(row).display).toBe("grid");
  });

  // The same bar, at the other end of the range rather than a second assertion. 768px is
  // the width worth pinning beside 390: it is the first that draws the dense table, and
  // it draws it in the least room that table will ever have — which is where a column of
  // percentages, a photo badge and an `ALTERNATIVE` chip were all found overflowing.
  it.each([768, 1024, 1280])("still fits at %ipx, where the table comes back", async (width) => {
    await page.viewport(width, 900);

    try {
      const { container } = renderSheet();

      expect(getComputedStyle(container.querySelector("thead")!).display).toBe(
        "table-header-group",
      );
      expectNoSidewaysScroll();
    } finally {
      // Put the phone back, so a width set here is not what the next test measures.
      await page.viewport(phone.width, phone.height);
    }
  });
});

/**
 * **Eight competing offers read down the page as a column of numbers** — the one thing
 * the numeral face is chosen for (ADR-0019).
 *
 * A figure is only comparable to the one above it if the digits are the same width: with
 * proportional figures a `1` is narrower than a `0`, every row is a different length, and
 * the eye has to read each number instead of scanning the column. That is what `.money`
 * and the mono half of the type stack are for, and it is invisible in a screenshot of any
 * single row — so the repaint that moved the face is the change that had to state it.
 *
 * **Every figure the sheet drew is asked, and it is asked what it reached for rather than
 * how wide the digits came out.** Measuring the digits was the first shape of this and it
 * measures the wrong machine: no Latin face in either stack — not Fira Code, not SF Mono,
 * not `ui-monospace` — resolves in this headless browser, so a width taken here is a fact
 * about the substitute Chromium picked, and it would be a different fact on the CI runner
 * and a third on a phone. What travels is which stack the figure is pointed at and that it
 * asked for tabular figures; the face itself is judged where ADR-0019 says it is judged,
 * on a device, through the contact sheet.
 */
describe("the figures on the working sheet", () => {
  it("sets every figure in the numeral stack, with tabular digits", async () => {
    await page.viewport(desk.width, desk.height);

    try {
      const { container } = renderSheet();
      const figures = [...container.querySelectorAll<HTMLElement>(".money")];

      // A sheet that drew no money at all would otherwise pass this in silence.
      expect(figures.length).toBeGreaterThan(0);

      const numerals = fontStack("--font-mono");
      const words = fontStack("--font-sans");

      // The two stacks really are different families, so a `.money` that quietly
      // inherited the body face could not pass the walk below by coincidence.
      expect(numerals).not.toBe(words);

      for (const figure of figures) {
        const style = getComputedStyle(figure);

        expect(style.fontFamily, figure.textContent ?? "").toBe(numerals);
        expect(style.fontVariantNumeric, figure.textContent ?? "").toContain(
          "tabular-nums",
        );
      }
    } finally {
      await page.viewport(phone.width, phone.height);
    }
  });
});

function renderSheet() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Bangkok">
      {/* The Tender page's own wrapper, so the sheet is measured inside the padding it
          actually has rather than edge to edge. */}
      <div className="flex flex-1 flex-col gap-8 p-6">
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-8">
          <WorkingSheet
            tenderId={tenderId}
            items={items}
            photos={photos}
            referenceImages={referenceImages}
          />
        </main>
      </div>
    </NextIntlClientProvider>,
  );
}


/* =======================================================================
   Ticket 09's dataset, at the shape the sheet reads it in.
   ======================================================================= */

const tenderId = "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90";

const freshRate = { asOf: "2026-08-11", stale: false };
const staleRate = { asOf: "2026-08-04", stale: true };
/** ECB mid-market, plus the 2% conservative buffer the Quote froze onto itself. */
const mid: Record<string, { fresh: number; stale: number }> = {
  CNY: { fresh: 4.96, stale: 4.91 },
  USD: { fresh: 35.4, stale: 35.1 },
  THB: { fresh: 1, stale: 1 },
};

function quote({
  id,
  tenderItemId,
  supplierName,
  sourcedByName,
  unitPrice,
  currency,
  quotedUnit,
  rate = freshRate,
  alternativeProductName = null,
}: {
  id: string;
  tenderItemId: string;
  supplierName: string;
  sourcedByName: string;
  unitPrice: number;
  currency: string;
  quotedUnit: string;
  rate?: { asOf: string; stale: boolean };
  alternativeProductName?: string | null;
}): Quote {
  const rateMid = mid[currency][rate.stale ? "stale" : "fresh"];
  const applied = rateMid * 1.02;

  return {
    id,
    tenderItemId,
    supplierName,
    unitPrice,
    currency,
    quotedUnit,
    unitPriceThb: unitPrice * applied,
    fxRateMid: rateMid,
    fxRateApplied: applied,
    fxRateAsOf: rate.asOf,
    fxRateIsStale: rate.stale,
    leadTimeDays: 30,
    matchType: alternativeProductName === null ? "exact" : "alternative",
    alternativeProductName,
    detailNotes: null,
    quotedAt: "2026-08-12",
    sourcedByUserId: `user-${sourcedByName}`,
    sourcedByName,
  };
}

const gloves: SheetItem = {
  id: "item-gloves",
  productName: "Nitrile examination glove, powder-free, size M",
  description: "3.5 g, blue, non-sterile, TFDA-registered",
  quantity: 40000,
  unit: "piece",
  selectedQuoteId: null,
  landedCostPerUnit: 1.42,
  landedCostConfirmedAt: null,
  sellingPricePerUnit: 2.6,
  quotes: [
    quote({ id: "q1a", tenderItemId: "item-gloves", supplierName: "Shanghai Kindly Medical", sourcedByName: "Somchai P.", unitPrice: 0.42, currency: "CNY", quotedUnit: "piece" }),
    quote({ id: "q1b", tenderItemId: "item-gloves", supplierName: "Shanghai Kindly Medical", sourcedByName: "Nok W.", unitPrice: 0.455, currency: "CNY", quotedUnit: "piece" }),
    quote({ id: "q1c", tenderItemId: "item-gloves", supplierName: "Hangzhou Sunmed", sourcedByName: "Somchai P.", unitPrice: 0.398, currency: "CNY", quotedUnit: "piece", rate: staleRate }),
    quote({ id: "q1d", tenderItemId: "item-gloves", supplierName: "Bangkok Medline Co.", sourcedByName: "Nok W.", unitPrice: 2.35, currency: "THB", quotedUnit: "piece" }),
    quote({ id: "q1e", tenderItemId: "item-gloves", supplierName: "Guangzhou Improve", sourcedByName: "Wei Zhang", unitPrice: 0.058, currency: "USD", quotedUnit: "piece" }),
    quote({ id: "q1f", tenderItemId: "item-gloves", supplierName: "Zhende Medical", sourcedByName: "Wei Zhang", unitPrice: 0.405, currency: "CNY", quotedUnit: "piece", alternativeProductName: "Zhende nitrile glove, size M, 3.0 g (lighter gauge)" }),
    quote({ id: "q1g", tenderItemId: "item-gloves", supplierName: "Siam Pharma Supply", sourcedByName: "Wei Zhang", unitPrice: 2.28, currency: "THB", quotedUnit: "piece" }),
    quote({ id: "q1h", tenderItemId: "item-gloves", supplierName: "Jiangsu Kanghua", sourcedByName: "Nok W.", unitPrice: 0.389, currency: "CNY", quotedUnit: "piece" }),
  ],
  sourcing: { quoteCount: 8, noSupplierFound: [] },
};

/** One Quote in "box of 50" among two in pieces — the Item nothing on it may rank. */
const syringes: SheetItem = {
  id: "item-syringes",
  productName: "Disposable syringe 5 ml with 23G needle",
  description: "Luer slip, sterile, single use",
  quantity: 20000,
  unit: "piece",
  selectedQuoteId: null,
  landedCostPerUnit: null,
  landedCostConfirmedAt: null,
  sellingPricePerUnit: null,
  quotes: [
    quote({ id: "q2a", tenderItemId: "item-syringes", supplierName: "Jiangsu Kanghua", sourcedByName: "Nok W.", unitPrice: 26.5, currency: "CNY", quotedUnit: "box of 50" }),
    quote({ id: "q2b", tenderItemId: "item-syringes", supplierName: "Bangkok Medline Co.", sourcedByName: "Somchai P.", unitPrice: 2.95, currency: "THB", quotedUnit: "piece" }),
    quote({ id: "q2c", tenderItemId: "item-syringes", supplierName: "Hangzhou Sunmed", sourcedByName: "Wei Zhang", unitPrice: 0.51, currency: "CNY", quotedUnit: "piece" }),
  ],
  sourcing: { quoteCount: 3, noSupplierFound: [] },
};

/** Every Quote an Alternative, which is the banner row tinting alone cannot carry. */
const pumps: SheetItem = {
  id: "item-pumps",
  productName: "Volumetric infusion pump, 2-channel",
  description: "Requested: B.Braun Infusomat Space P",
  quantity: 6,
  unit: "unit",
  selectedQuoteId: null,
  landedCostPerUnit: null,
  landedCostConfirmedAt: null,
  sellingPricePerUnit: null,
  quotes: [
    quote({ id: "q3a", tenderItemId: "item-pumps", supplierName: "Shenzhen Comen", sourcedByName: "Wei Zhang", unitPrice: 4850, currency: "CNY", quotedUnit: "unit", alternativeProductName: "Comen SK-600III volumetric pump" }),
    quote({ id: "q3b", tenderItemId: "item-pumps", supplierName: "Guangzhou Improve", sourcedByName: "Somchai P.", unitPrice: 720, currency: "USD", quotedUnit: "unit", alternativeProductName: "Contec SP750 volumetric pump" }),
    quote({ id: "q3c", tenderItemId: "item-pumps", supplierName: "Siam Pharma Supply", sourcedByName: "Nok W.", unitPrice: 26900, currency: "THB", quotedUnit: "unit", alternativeProductName: "Mindray BeneFusion VP3" }),
  ],
  sourcing: { quoteCount: 3, noSupplierFound: [] },
};

/** One Quote, and one Assignee who looked and could not source it. */
const respirators: SheetItem = {
  id: "item-respirators",
  productName: "Surgical respirator N95 / FFP2, cup style",
  description: "Head-strap, fluid-resistant",
  quantity: 5000,
  unit: "piece",
  selectedQuoteId: "q4a",
  landedCostPerUnit: 4.01,
  landedCostConfirmedAt: "2026-08-12T04:00:00.000Z",
  sellingPricePerUnit: 24,
  quotes: [
    quote({ id: "q4a", tenderItemId: "item-respirators", supplierName: "Zhende Medical", sourcedByName: "Somchai P.", unitPrice: 3.85, currency: "CNY", quotedUnit: "piece" }),
  ],
  sourcing: {
    quoteCount: 1,
    noSupplierFound: [
      {
        userId: "user-wei",
        name: "Wei Zhang",
        note: "No TFDA-registered cup style available inside a 30-day lead time",
        createdAt: "2026-08-10T02:00:00.000Z",
      },
    ],
  },
};

const items = [gloves, syringes, pumps, respirators];

/** Counts are what the sheet draws; the URLs behind them are never fetched here. */
const photos = new Map<string, QuotePhoto[]>(
  [
    ["q1a", 3],
    ["q1b", 1],
    ["q1c", 2],
    ["q1e", 4],
    ["q1f", 2],
    ["q1g", 1],
    ["q2a", 1],
    ["q2c", 2],
    ["q3a", 4],
    ["q3b", 2],
    ["q3c", 3],
    ["q4a", 2],
  ].map(([quoteId, count]) => [
    quoteId as string,
    Array.from({ length: count as number }, (_, index) => ({
      id: `${quoteId}-photo-${index}`,
      url: "",
      uploadedAt: "2026-08-12T03:00:00.000Z",
      uploadedByName: "Somchai P.",
    })),
  ]),
);

const referenceImages: ReferenceImage[] = [
  {
    id: "ref-1",
    tenderItemId: "item-gloves",
    url: "",
    uploadedAt: "2026-08-09T02:00:00.000Z",
    uploadedByName: "Somchai P.",
  },
  {
    id: "ref-2",
    tenderItemId: "item-gloves",
    url: "",
    uploadedAt: "2026-08-09T02:00:00.000Z",
    uploadedByName: "Somchai P.",
  },
];
