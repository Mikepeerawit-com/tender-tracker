import { describe, expect, it } from "vitest";

import { marginOf, prefillLandedCost, sheetTotals } from "./pricing";

/** A priced Item, as the arithmetic wants one. */
function anItem(overrides: Partial<Parameters<typeof marginOf>[0]> = {}) {
  return {
    quantity: 500,
    landedCostPerUnit: 620,
    landedCostConfirmed: true,
    sellingPricePerUnit: 700,
    ...overrides,
  };
}

/** The same Item as a row stores it, for the totals bar. */
function aStoredItem(overrides: Partial<Parameters<typeof sheetTotals>[0][number]> = {}) {
  return {
    quantity: 500,
    landedCostPerUnit: 620,
    landedCostConfirmedAt: "2026-08-22T09:00:00Z",
    sellingPricePerUnit: 700,
    ...overrides,
  };
}

describe("margin", () => {
  it("is the selling price less the landed cost, per unit and on the line", () => {
    expect(marginOf(anItem())).toEqual({
      perUnit: 80,
      onLine: 40_000,
      provisional: false,
    });
  });

  it("is provisional while the landed cost is unconfirmed", () => {
    // Still sitting at its pre-filled value: nothing has been added for shipping, duty
    // or handling, so the figure is understated in cost and overstated in profit.
    expect(marginOf(anItem({ landedCostConfirmed: false }))).toEqual({
      perUnit: 80,
      onLine: 40_000,
      provisional: true,
    });
  });

  it("is negative rather than absent when we would be bidding under cost", () => {
    expect(marginOf(anItem({ sellingPricePerUnit: 600 }))?.perUnit).toBe(-20);
  });

  it("is nothing at all until both figures are there", () => {
    expect(marginOf(anItem({ sellingPricePerUnit: null }))).toBeNull();
    expect(marginOf(anItem({ landedCostPerUnit: null }))).toBeNull();
  });
});

/** The Selected Quote, in the shape the sheet holds one. */
function aQuote(overrides: Partial<{ quotedUnit: string; unitPriceThb: number }> = {}) {
  return { quotedUnit: "box of 50", unitPriceThb: 620, ...overrides };
}

describe("pre-filling the landed cost from the Selected Quote", () => {
  it("fills it from the Quote's THB price when nobody has confirmed a cost", () => {
    expect(
      prefillLandedCost({ unit: "box of 50", landedCostConfirmedAt: null }, aQuote()),
    ).toEqual({ landedCostPerUnit: 620 });
  });

  it("leaves a hand-edited cost alone", () => {
    // The edit is the more recent human judgment — it carries shipping, duty and
    // handling the supplier's price excludes, and re-prefilling would discard it
    // silently at the exact moment somebody is choosing between two suppliers.
    expect(
      prefillLandedCost(
        { unit: "box of 50", landedCostConfirmedAt: "2026-08-22T09:00:00Z" },
        aQuote({ unitPriceThb: 595 }),
      ),
    ).toBeNull();
  });

  it("clears an unconfirmed pre-fill when the selection comes back off", () => {
    // The basis for the number has gone. Leaving the old Quote's price sitting in the
    // field would be a cost derived from a Quote nobody chose.
    expect(
      prefillLandedCost({ unit: "box of 50", landedCostConfirmedAt: null }, null),
    ).toEqual({ landedCostPerUnit: null });
  });

  it("fills nothing from a Quote priced in another unit", () => {
    // "Box of 50" against "piece" is refused rather than divided by fifty, exactly as
    // the ranking refuses it: the fifty is a guess at what the supplier meant.
    expect(
      prefillLandedCost(
        { unit: "box of 50", landedCostConfirmedAt: null },
        aQuote({ quotedUnit: "piece" }),
      ),
    ).toEqual({ landedCostPerUnit: null });
  });

  it("reads the Item's unit and the Quote's as a person does", () => {
    expect(
      prefillLandedCost(
        { unit: "Box of 50", landedCostConfirmedAt: null },
        aQuote({ quotedUnit: " box of 50 " }),
      ),
    ).toEqual({ landedCostPerUnit: 620 });
  });
});

describe("the totals bar under the Item rows", () => {
  it("multiplies every per-unit figure by the Item's quantity", () => {
    // The one arithmetic mistake this bar could make that nobody would catch by eye: a
    // sum of per-unit prices reads as a plausible total and is out by three orders of
    // magnitude on a Tender for 500 boxes.
    const totals = sheetTotals([
      aStoredItem({ quantity: 500, landedCostPerUnit: 620, sellingPricePerUnit: 700 }),
      aStoredItem({ quantity: 200, landedCostPerUnit: 310, sellingPricePerUnit: 400 }),
    ]);

    expect(totals.bidTotal).toBe(500 * 700 + 200 * 400);
    expect(totals.landedCostTotal).toBe(500 * 620 + 200 * 310);
    expect(totals.marginTotal).toBe(500 * 80 + 200 * 90);
  });

  it("counts how many Items carry a selling price at all", () => {
    const totals = sheetTotals([
      aStoredItem(),
      aStoredItem({ sellingPricePerUnit: null }),
      aStoredItem({ sellingPricePerUnit: null, landedCostPerUnit: null }),
    ]);

    expect(totals).toMatchObject({ pricedCount: 1, itemCount: 3 });
  });

  it("leaves an unpriced Item out of every total rather than counting it as zero", () => {
    const totals = sheetTotals([
      aStoredItem({ quantity: 500, landedCostPerUnit: 620, sellingPricePerUnit: 700 }),
      aStoredItem({ quantity: 200, sellingPricePerUnit: null }),
    ]);

    expect(totals.bidTotal).toBe(350_000);
    expect(totals.marginTotal).toBe(40_000);
  });

  it("shows the total margin as provisional when any Item's landed cost is unconfirmed", () => {
    // One understated cost understates the whole bar. The total is no more final than
    // the least final figure in it.
    const totals = sheetTotals([
      aStoredItem(),
      aStoredItem({ landedCostConfirmedAt: null }),
    ]);

    expect(totals.marginProvisional).toBe(true);
    expect(sheetTotals([aStoredItem(), aStoredItem()]).marginProvisional).toBe(false);
  });

  it("counts an Item priced but not costed in the Bid total and in nothing else", () => {
    // The bar is three sums, not one subtraction. Reading the missing cost as zero
    // would report the whole selling price as Margin — the one arithmetic here that
    // flatters us.
    const totals = sheetTotals([
      aStoredItem({ quantity: 200, landedCostPerUnit: null, sellingPricePerUnit: 400 }),
    ]);

    expect(totals).toMatchObject({
      pricedCount: 1,
      bidTotal: 80_000,
      landedCostTotal: 0,
      marginTotal: 0,
    });
  });

  it("says nothing is priced on a Tender nobody has priced yet", () => {
    expect(sheetTotals([])).toEqual({
      itemCount: 0,
      pricedCount: 0,
      bidTotal: 0,
      landedCostTotal: 0,
      marginTotal: 0,
      marginProvisional: false,
    });
  });
});
