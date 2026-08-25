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

import { WorkingSheet } from "./working-sheet";

/**
 * **The project's one automated UI assertion**, and the only test in the repo that needs
 * a real browser: at 390×844, on eight competing Quotes, the comparison working sheet
 * never scrolls sideways.
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

const phone = { width: 390, height: 844 };

describe(`the working sheet at ${phone.width}×${phone.height}`, () => {
  it("never scrolls sideways, anywhere on the page", () => {
    const { container } = renderSheet();
    const sheet = container.querySelector("section")!;

    // The criterion, stated as ADR-0009 states it.
    expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);

    // And "anywhere", which is the half a single element's measurement would miss: one
    // cell wider than its column overflows the page just as surely as the table does.
    expect(overflowing(document.body)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
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
      expect(overflowing(document.body)).toEqual([]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    } finally {
      // Put the phone back, so a width set here is not what the next test measures.
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

/**
 * Every element whose own content is wider than the box drawn for it.
 *
 * Two things are excluded, and only two. `.sr-only` *is* a one-pixel box with its content
 * clipped out of it, so overflowing is how it works rather than a way it has failed. And
 * a form control scrolls its own value by design — a price longer than its field is a
 * text box doing its job, not a page pushed sideways, and how wide the value measures
 * depends on the font that happened to load. Neither can push the page out: an element
 * too wide for its parent is caught on the parent, and the page itself is measured
 * separately by the caller.
 */
function overflowing(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element.closest(".sr-only") === null)
    .filter((element) => !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
    .filter((element) => element.scrollWidth > element.clientWidth)
    .map(describeElement);
}

/** Enough of an element to find it in the markup from a failure message. */
function describeElement(element: Element): string {
  const text = (element.textContent ?? "").trim().slice(0, 40);

  // `getAttribute`, not `className`: on an SVG — and lucide's chevrons are in this tree —
  // `className` is an `SVGAnimatedString` and stringifies to nothing anybody can search for.
  return `${element.tagName.toLowerCase()}.${element.getAttribute("class")} — "${text}"`;
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
    quotedAt: "2026-08-12T03:00:00.000Z",
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
