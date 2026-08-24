import type { MatchType } from "@/lib/quotes/quotes";

/**
 * What the comparison working sheet ranks by, and the three things it refuses to rank
 * under.
 *
 * The design position this module exists to hold is ticket 09's: **being loudly unhelpful
 * beats being quietly wrong**. A sheet that ranks through a unit mismatch does not look
 * broken, it looks authoritative — a `1` beside a price that is per box, sitting above
 * prices that are per piece — and the person reading it rings a supplier who is fifty
 * times dearer than the one they thought they were shown. So the refusal here is
 * Item-wide and total: no rank numbers, no `lowest` chip, nothing on the Item ordered.
 *
 * Arithmetic only, over rows something else has already read. Nothing in here reaches for
 * a database, a translation or a request, which is what lets the interesting cases — one
 * Quote in "box of 50" among seven in pieces, the same supplier quoted twice, a 1.3% lead
 * sitting inside a week of rate drift — be stated as fixtures rather than staged as
 * Tenders.
 *
 * The two conversions this module never does are as load-bearing as the ones it does.
 * **Pack sizes are never converted**: "box of 50" against "piece" is refused, not divided
 * by fifty, because the fifty is a guess at what the supplier meant. **Rates are never
 * re-marked to today**: every THB figure comes from the Frozen Rate on the Quote, so a
 * ranking somebody saw is reproducible from the stored data a year later.
 */

/** What the rules need of a Tender Item. A `TenderItem` with its selection satisfies it. */
export type ComparedItem = {
  quantity: number;
  /** The Item's own unit. A Quote priced in any other one stops the Item being ranked. */
  unit: string;
  selectedQuoteId: string | null;
};

/**
 * What the rules need of a Quote — a subset of `Quote`, so a real one is assignable and a
 * fixture is four lines rather than twenty.
 */
export type ComparedQuote = {
  id: string;
  supplierName: string;
  unitPrice: number;
  currency: string;
  quotedUnit: string;
  /** `unit_price * fx_rate_applied`, computed by the database at the frozen rate. */
  unitPriceThb: number;
  fxRateAsOf: string;
  fxRateIsStale: boolean;
  matchType: MatchType;
  sourcedByName: string;
};

/** One Quote in the order the sheet shows it, with what the row is allowed to claim. */
export type RankedQuote<Q extends ComparedQuote> = {
  quote: Q;
  /** 1-based, cheapest-first in THB — and `null` on every row of an unrankable Item. */
  rank: number | null;
  /** Never true on an unrankable Item. True on both rows when two Quotes are level. */
  isLowest: boolean;
  /** `null` when this Quote's unit is not the Item's, where a total would be nonsense. */
  lineTotalThb: number | null;
};

/**
 * The Item-level banners, in the order they stack above the quote table.
 *
 * Never on rows. A row-level warning is read as being about that supplier, and two of
 * these three are statements about the *ranking* — which is a property of the Item.
 */
export type ItemBanner =
  | { kind: "unit_mismatch" }
  | { kind: "all_alternatives"; quoteCount: number }
  | {
      kind: "too_close_to_call";
      leader: string;
      runnerUp: string;
      gapPct: number;
      staleSupplier: string;
      staleAsOf: string;
    }
  | {
      kind: "duplicate_supplier";
      supplier: string;
      quotes: { sourcedByName: string; unitPrice: number; currency: string }[];
    };

/**
 * A lead this narrow can be an artifact of two rates frozen on different days rather than
 * a real difference in price. Three percent is ticket 09's number, taken from the drift
 * measured across a week of ECB publications on the currencies this org actually buys in.
 */
const tooCloseGap = 0.03;

/**
 * Every Quote on one Item, cheapest-first in THB — or in entry order, unranked, when the
 * Item cannot be ranked at all.
 *
 * Entry order is the fallback because it is the one order that claims nothing. Leaving
 * the rows sorted by price with the numbers taken off would still read as a ranking.
 */
export function rankQuotes<Q extends ComparedQuote>(
  item: ComparedItem,
  quotes: Q[],
): RankedQuote<Q>[] {
  const lineTotal = (quote: Q): number | null =>
    sameUnit(quote.quotedUnit, item.unit) ? quote.unitPriceThb * item.quantity : null;

  if (!isRankable(item, quotes)) {
    return quotes.map((quote) => ({
      quote,
      rank: null,
      isLowest: false,
      lineTotalThb: lineTotal(quote),
    }));
  }

  const ordered = [...quotes].sort((a, b) => a.unitPriceThb - b.unitPriceThb);
  const lowest = ordered[0].unitPriceThb;

  return ordered.map((quote, index) => ({
    quote,
    rank: index + 1,
    // Every Quote at the lowest price, not the first of them. Which of two identical
    // prices got the chip would otherwise come down to who typed theirs in first.
    isLowest: quote.unitPriceThb === lowest,
    lineTotalThb: lineTotal(quote),
  }));
}

/**
 * Can this Item be ranked at all?
 *
 * One Quote in a unit the Item is not counted in poisons the whole Item, including the
 * Quotes that do agree. Ranking those against each other and quietly dropping the odd one
 * out would still produce a ranking somebody reads as complete.
 */
export function isRankable(item: ComparedItem, quotes: ComparedQuote[]): boolean {
  return (
    quotes.length > 0 && quotes.every((quote) => sameUnit(quote.quotedUnit, item.unit))
  );
}

/** The banners this Item raises, refusal first. */
export function itemBanners(item: ComparedItem, quotes: ComparedQuote[]): ItemBanner[] {
  const banners: ItemBanner[] = [];

  if (quotes.length > 0 && !isRankable(item, quotes)) {
    banners.push({ kind: "unit_mismatch" });
  }

  // Row tinting carries a mixed Item perfectly well — the amber rows stand out against
  // the exact ones. It is when every row is tinted that the tint stops saying anything,
  // which is the case this banner exists for.
  if (quotes.length > 0 && quotes.every((quote) => quote.matchType === "alternative")) {
    banners.push({ kind: "all_alternatives", quoteCount: quotes.length });
  }

  const close = tooCloseToCall(item, quotes);

  if (close) banners.push(close);

  banners.push(...duplicateSuppliers(quotes));

  return banners;
}

/**
 * The top two within 3%, with a Stale Rate under one of them.
 *
 * Only the top two are looked at: a stale rate on the sixth-cheapest Quote cannot move
 * the lead, and warning about it would train people to ignore the banner. Re-marking both
 * to today's rate instead was rejected on ticket 09 — it would make the ranking on screen
 * unreproducible from the rows it was drawn from.
 */
function tooCloseToCall(
  item: ComparedItem,
  quotes: ComparedQuote[],
): ItemBanner | null {
  if (!isRankable(item, quotes) || quotes.length < 2) return null;

  const [leader, runnerUp] = [...quotes].sort((a, b) => a.unitPriceThb - b.unitPriceThb);
  const gap = (runnerUp.unitPriceThb - leader.unitPriceThb) / leader.unitPriceThb;
  const stale = [leader, runnerUp].find((quote) => quote.fxRateIsStale);

  if (gap >= tooCloseGap || !stale) return null;

  return {
    kind: "too_close_to_call",
    leader: leader.supplierName,
    runnerUp: runnerUp.supplierName,
    gapPct: gap * 100,
    staleSupplier: stale.supplierName,
    staleAsOf: stale.fxRateAsOf,
  };
}

/**
 * One banner per supplier who appears on this Item more than once.
 *
 * ADR-0004: there is deliberately no unique index on `(tender_item_id, supplier_id)`,
 * because two Assignees ringing the same supplier and being given different prices is
 * expected and is the most interesting signal in the dataset. Two rows that differ only
 * in who sourced them read as a data-entry mistake unless something says otherwise, so
 * this is what says otherwise.
 */
function duplicateSuppliers(quotes: ComparedQuote[]): ItemBanner[] {
  const bySupplier = new Map<string, ComparedQuote[]>();

  for (const quote of quotes) {
    // Suppliers are unique on `lower(name)` in the database, so two spellings of one
    // supplier are already one row. Matching that here keeps the banner honest against
    // the names as they were typed.
    const key = quote.supplierName.trim().toLowerCase();

    bySupplier.set(key, [...(bySupplier.get(key) ?? []), quote]);
  }

  return [...bySupplier.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      kind: "duplicate_supplier",
      supplier: group[0].supplierName,
      quotes: group.map((quote) => ({
        sourcedByName: quote.sourcedByName,
        unitPrice: quote.unitPrice,
        currency: quote.currency,
      })),
    }));
}

/**
 * Does this Item still need a Quote selected?
 *
 * The whole of the sheet's openness, and it is derived on every render rather than
 * remembered. An Item with no Selected Quote opens expanded and a decided one folds away,
 * so the page opens showing exactly the work that is left. A stored "is expanded" flag
 * would drift from that within a visit.
 */
export function needsDecision(item: ComparedItem): boolean {
  return item.selectedQuoteId === null;
}

/** What the header counts: "2 of 4 Items still need a Quote selected". */
export function itemsNeedingDecision(items: ComparedItem[]): number {
  return items.filter(needsDecision).length;
}

/**
 * The Item's unit and the Quote's, as a person reads them.
 *
 * "Box of 50" and "box of 50" are one unit, and refusing to rank over the capital B would
 * be the false refusal that teaches people to ignore the true ones. Anything beyond case
 * and surrounding space is left alone: "box of 50" and "box of 100" differ by a character
 * and by a factor of two.
 */
function sameUnit(one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase();
}
