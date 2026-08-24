import { describe, expect, it } from "vitest";

import {
  itemBanners,
  itemsNeedingDecision,
  needsDecision,
  rankQuotes,
  type ComparedItem,
  type ComparedQuote,
} from "./ranking";

/**
 * The rules the comparison working sheet ranks by, and the three it refuses to rank
 * under.
 *
 * These are the assertions the screen is worth having. A working sheet that ranks
 * confidently through a unit mismatch does not look broken — it looks authoritative,
 * puts a `1` beside a price that is per box next to prices that are per piece, and sends
 * somebody to a supplier who is eleven times dearer than the one they were shown. The
 * whole design position of ticket 09 is that being loudly unhelpful beats being quietly
 * wrong, and this file is where that position is enforced rather than described.
 *
 * Nothing here touches a database. Ranking is arithmetic over rows that have already been
 * read, and the interesting cases — eight competing Quotes, one of them in "box of 50",
 * two of them from the same supplier, a 1.3% lead sitting inside a week of rate drift —
 * are ones a fixture states in four lines and a real Tender takes an afternoon to set up.
 */

const item: ComparedItem = {
  quantity: 500,
  unit: "box of 50",
  selectedQuoteId: null,
};

/** A Quote at a THB price, exact and in the Item's own unit unless said otherwise. */
function quote(fields: Partial<ComparedQuote> & { id: string }): ComparedQuote {
  return {
    supplierName: `Supplier ${fields.id}`,
    unitPrice: 100,
    currency: "THB",
    quotedUnit: "box of 50",
    unitPriceThb: 100,
    fxRateAsOf: "2026-08-18",
    fxRateIsStale: false,
    matchType: "exact",
    sourcedByName: `Assignee ${fields.id}`,
    ...fields,
  };
}

describe("ranking cheapest-first in THB", () => {
  it("ranks by the converted price, not the quoted one", () => {
    // The dearer supplier in their own currency is the cheaper one in THB. Sorting on
    // `unitPrice` would rank 2,900 JPY above 620 THB and be wrong by a factor of five.
    const ranked = rankQuotes(item, [
      quote({ id: "a", unitPrice: 620, currency: "THB", unitPriceThb: 620 }),
      quote({ id: "b", unitPrice: 2900, currency: "JPY", unitPriceThb: 690 }),
      quote({ id: "c", unitPrice: 120, currency: "CNY", unitPriceThb: 595 }),
    ]);

    expect(ranked.map((row) => [row.quote.id, row.rank])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("marks the lowest row, and only it", () => {
    const ranked = rankQuotes(item, [
      quote({ id: "a", unitPriceThb: 620 }),
      quote({ id: "b", unitPriceThb: 595 }),
    ]);

    expect(ranked.filter((row) => row.isLowest).map((row) => row.quote.id)).toEqual(["b"]);
  });

  it("marks both when two Quotes are level, rather than picking one", () => {
    // Highlighting one of two identical prices claims a difference the data does not
    // have, and which one got the chip would come down to entry order.
    const ranked = rankQuotes(item, [
      quote({ id: "a", unitPriceThb: 595 }),
      quote({ id: "b", unitPriceThb: 595 }),
    ]);

    expect(ranked.filter((row) => row.isLowest).map((row) => row.quote.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("gives the line total in THB against the Item's quantity", () => {
    const [row] = rankQuotes(item, [quote({ id: "a", unitPriceThb: 620 })]);

    expect(row.lineTotalThb).toBe(620 * 500);
  });

  it("ranks a single Quote first, and an Item with none not at all", () => {
    expect(rankQuotes(item, [quote({ id: "a" })])[0].rank).toBe(1);
    expect(rankQuotes(item, [])).toEqual([]);
  });
});

describe("a unit mismatch removes ranking from the whole Item", () => {
  const mixed = [
    quote({ id: "a", quotedUnit: "box of 50", unitPriceThb: 620 }),
    quote({ id: "b", quotedUnit: "piece", unitPriceThb: 14 }),
    quote({ id: "c", quotedUnit: "box of 50", unitPriceThb: 595 }),
  ];

  it("puts no rank number anywhere on it — including on the Quotes that do agree", () => {
    // The refusal is Item-wide on purpose. Ranking the two boxes against each other and
    // quietly leaving the piece out would still be a ranking somebody reads as complete.
    expect(rankQuotes(item, mixed).map((row) => row.rank)).toEqual([null, null, null]);
  });

  it("marks nothing as lowest", () => {
    expect(rankQuotes(item, mixed).some((row) => row.isLowest)).toBe(false);
  });

  it("leaves the Quotes in entry order, which claims nothing", () => {
    expect(rankQuotes(item, mixed).map((row) => row.quote.id)).toEqual(["a", "b", "c"]);
  });

  it("still gives a line total to the Quotes in the Item's own unit, and none to the others", () => {
    const totals = rankQuotes(item, mixed).map((row) => row.lineTotalThb);

    // 14 THB per piece against a quantity counted in boxes is not a line total, it is a
    // number that would be out by fifty.
    expect(totals).toEqual([620 * 500, null, 595 * 500]);
  });

  it("reads the unit as a person would, ignoring case and stray spaces", () => {
    const same = rankQuotes(item, [
      quote({ id: "a", quotedUnit: " Box of 50 ", unitPriceThb: 620 }),
      quote({ id: "b", quotedUnit: "box of 50", unitPriceThb: 595 }),
    ]);

    expect(same.map((row) => [row.quote.id, row.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("raises the banner that refuses, and no ranking banner beneath it", () => {
    expect(itemBanners(item, mixed)).toEqual([{ kind: "unit_mismatch" }]);
  });
});

describe("the banner that says the ranking is comparing different products", () => {
  it("is raised when every Quote is an Alternative", () => {
    const alternatives = [
      quote({ id: "a", matchType: "alternative" }),
      quote({ id: "b", matchType: "alternative" }),
    ];

    expect(itemBanners(item, alternatives)).toEqual([
      { kind: "all_alternatives", quoteCount: 2 },
    ]);
  });

  it("is not raised when one Quote is for what was actually asked for", () => {
    // Row tinting carries the mixed case perfectly well: the amber rows stand out against
    // the exact one. It is when *every* row is tinted that the tint stops saying anything.
    const mixed = [
      quote({ id: "a", matchType: "alternative" }),
      quote({ id: "b" }),
    ];

    expect(itemBanners(item, mixed)).toEqual([]);
  });

  it("is not raised on an Item nobody has quoted", () => {
    expect(itemBanners(item, [])).toEqual([]);
  });
});

describe("too close to call on frozen rates", () => {
  const leader = quote({
    id: "a",
    supplierName: "Ace Medical",
    unitPriceThb: 595,
    fxRateAsOf: "2026-08-11",
    fxRateIsStale: true,
  });
  const runnerUp = quote({ id: "b", supplierName: "Beta Supply", unitPriceThb: 603 });

  it("is raised when the top two are within 3% and one of them carries a stale rate", () => {
    // 1.34% between them, on rates frozen a week apart. The lead is smaller than the
    // drift it is being measured through, so the ranking cannot settle this.
    expect(itemBanners(item, [leader, runnerUp])).toEqual([
      {
        kind: "too_close_to_call",
        leader: "Ace Medical",
        runnerUp: "Beta Supply",
        gapPct: (8 / 595) * 100,
        staleSupplier: "Ace Medical",
        staleAsOf: "2026-08-11",
      },
    ]);
  });

  it("is not raised when the gap is wide enough to survive the drift", () => {
    const clear = quote({ id: "b", supplierName: "Beta Supply", unitPriceThb: 700 });

    expect(itemBanners(item, [leader, clear])).toEqual([]);
  });

  it("is not raised when both rates are current, however close the two are", () => {
    const current = quote({ ...leader, fxRateIsStale: false });

    expect(itemBanners(item, [current, runnerUp])).toEqual([]);
  });

  it("ignores a stale rate below the top two, which cannot change the lead", () => {
    const third = quote({ id: "c", unitPriceThb: 900, fxRateIsStale: true });
    const current = quote({ ...leader, fxRateIsStale: false });

    expect(itemBanners(item, [current, runnerUp, third])).toEqual([]);
  });

  it("is not raised on an Item that has no ranking to be close in", () => {
    const unrankable = [
      quote({ ...leader, quotedUnit: "piece" }),
      quote({ ...runnerUp, unitPriceThb: 603 }),
    ];

    expect(itemBanners(item, unrankable)).toEqual([{ kind: "unit_mismatch" }]);
  });
});

describe("the same supplier, quoted twice", () => {
  it("is named out loud, with both Assignees and both prices", () => {
    // ADR-0004: there is deliberately no unique index behind this, because two Assignees
    // getting different prices from one supplier is the most interesting signal in the
    // dataset. The sheet surfaces the duplication rather than hiding it.
    const twice = [
      quote({
        id: "a",
        supplierName: "Ace Medical",
        unitPrice: 620,
        currency: "THB",
        unitPriceThb: 620,
        sourcedByName: "Mali",
      }),
      quote({
        id: "b",
        supplierName: "Ace Medical",
        unitPrice: 595,
        currency: "THB",
        unitPriceThb: 595,
        sourcedByName: "Nok",
      }),
    ];

    expect(itemBanners(item, twice)).toEqual([
      {
        kind: "duplicate_supplier",
        supplier: "Ace Medical",
        quotes: [
          { sourcedByName: "Mali", unitPrice: 620, currency: "THB" },
          { sourcedByName: "Nok", unitPrice: 595, currency: "THB" },
        ],
      },
    ]);
  });

  it("is the same supplier however it was typed", () => {
    const twice = [
      quote({ id: "a", supplierName: "Ace Medical" }),
      quote({ id: "b", supplierName: "ace medical" }),
    ];

    expect(itemBanners(item, twice).map((banner) => banner.kind)).toEqual([
      "duplicate_supplier",
    ]);
  });

  it("says nothing about two different suppliers", () => {
    const distinct = [
      quote({ id: "a", supplierName: "Ace Medical", unitPriceThb: 620 }),
      quote({ id: "b", supplierName: "Beta Supply", unitPriceThb: 900 }),
    ];

    expect(itemBanners(item, distinct)).toEqual([]);
  });
});

describe("banners stack, refusal first", () => {
  it("puts the one that refuses to rank above the ones that qualify a ranking", () => {
    const both = [
      quote({
        id: "a",
        supplierName: "Ace Medical",
        quotedUnit: "piece",
        matchType: "alternative",
      }),
      quote({
        id: "b",
        supplierName: "Ace Medical",
        matchType: "alternative",
      }),
    ];

    expect(itemBanners(item, both).map((banner) => banner.kind)).toEqual([
      "unit_mismatch",
      "all_alternatives",
      "duplicate_supplier",
    ]);
  });
});

describe("openness is derived from the work left", () => {
  it("opens an Item with no Selected Quote and folds a decided one", () => {
    expect(needsDecision(item)).toBe(true);
    expect(needsDecision({ ...item, selectedQuoteId: "a" })).toBe(false);
  });

  it("counts the Items the header is about", () => {
    const items = [
      item,
      { ...item, selectedQuoteId: "a" },
      { ...item, selectedQuoteId: "b" },
      item,
    ];

    expect(itemsNeedingDecision(items)).toBe(2);
  });
});
