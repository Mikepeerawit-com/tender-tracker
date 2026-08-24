import { sameUnit } from "@/lib/comparison/ranking";

/**
 * The money on the comparison working sheet: what a Margin is, when it is allowed to be
 * a number, and what the totals bar underneath the Item rows adds up.
 *
 * Arithmetic only, over rows something else has already read — the same position
 * `@/lib/comparison/ranking` holds next door, and for the same reason: the interesting
 * cases here are a cost nobody has confirmed and a total that must be per-unit × quantity
 * rather than a sum of per-unit figures, and both are worth stating as fixtures rather
 * than staged as Tenders.
 *
 * **Margin is never stored.** It is `selling_price_per_unit − landed_cost_per_unit`, and
 * a stored copy would be a third number to keep in step with two that already move.
 * Nothing in this module writes, and nothing downstream of it persists what it returns.
 */

/** What the money rules need of a Tender Item. */
export type PricedItem = {
  quantity: number;
  landedCostPerUnit: number | null;
  /**
   * False means Unconfirmed: nothing has been added for shipping, duty or handling.
   *
   * A flag rather than the stored `landed_cost_confirmed_at`, because the arithmetic
   * only ever asks whether somebody has vouched for the cost — and the row being edited
   * in the browser knows the answer is about to become yes before any timestamp exists.
   */
  landedCostConfirmed: boolean;
  sellingPricePerUnit: number | null;
};

/** The same figures as a Tender Item stores them. A `SheetItem` satisfies it. */
export type StoredPricing = {
  quantity: number;
  landedCostPerUnit: number | null;
  landedCostConfirmedAt: string | null;
  sellingPricePerUnit: number | null;
};

/** A stored row as the arithmetic wants it: the timestamp read as the fact it records. */
export function pricedItem(row: StoredPricing): PricedItem {
  return {
    quantity: row.quantity,
    landedCostPerUnit: row.landedCostPerUnit,
    landedCostConfirmed: row.landedCostConfirmedAt !== null,
    sellingPricePerUnit: row.sellingPricePerUnit,
  };
}

/** A Margin, and whether it is allowed to be shown as a number. */
export type Margin = {
  perUnit: number;
  /** Always `perUnit × quantity`. Never a figure entered or stored in its own right. */
  onLine: number;
  /**
   * Derived from an Unconfirmed Landed Cost, so understated in cost and overstated in
   * profit. Renders as provisional rather than as a number — nothing is blocked and
   * nobody is nagged; the figure simply stops pretending to be final.
   */
  provisional: boolean;
};

/**
 * The Margin on one Item, or null when there is nothing honest to compute one from.
 *
 * The confirmation is what makes it a number. Inferring "untouched" by comparing the cost
 * against the frozen Quote price breaks the moment shipping is genuinely zero, so it is
 * not done that way.
 */
export function marginOf(item: PricedItem): Margin | null {
  if (item.landedCostPerUnit === null || item.sellingPricePerUnit === null) return null;

  const perUnit = item.sellingPricePerUnit - item.landedCostPerUnit;

  return {
    perUnit,
    onLine: perUnit * item.quantity,
    provisional: !item.landedCostConfirmed,
  };
}

/**
 * What selecting a Quote does to the Landed Cost — or `null` for "leave it alone".
 *
 * The rule is one sentence and the reasoning is the whole of it: **selecting a different
 * Quote re-prefills the Landed Cost unless it has been hand-edited**, because the edit is
 * the more recent human judgment. It carries the shipping, duty and handling a supplier
 * price excludes, and discarding it silently at the moment somebody is switching between
 * two suppliers would understate the cost of the one they just chose.
 *
 * Hand-edited and Confirmed are the same fact here (ADR-0014): the act of writing a
 * Landed Cost by hand is what stamps `landed_cost_confirmed_at`, so an Unconfirmed cost
 * is exactly one still sitting at a pre-filled value and is safe to overwrite.
 *
 * A Quote priced in a unit the Item is not counted in fills nothing, for the reason
 * `rankQuotes` refuses to rank one: the pack size is a guess at what the supplier meant,
 * and a Landed Cost out by a factor of fifty is worse than an empty field.
 */
export function prefillLandedCost(
  item: { unit: string; landedCostConfirmedAt: string | null },
  /** The newly Selected Quote, or null when the selection has just come back off. */
  quote: { quotedUnit: string; unitPriceThb: number } | null,
): { landedCostPerUnit: number | null } | null {
  if (item.landedCostConfirmedAt !== null) return null;

  if (quote === null || !sameUnit(quote.quotedUnit, item.unit)) {
    return { landedCostPerUnit: null };
  }

  return { landedCostPerUnit: quote.unitPriceThb };
}

/** What the totals bar under the Item rows says, and nothing more. */
export type SheetTotals = {
  itemCount: number;
  /** How many Items carry a selling price — the coverage the three money figures cover. */
  pricedCount: number;
  /** Σ `selling_price_per_unit × quantity`, in THB. What the Bid comes to. */
  bidTotal: number;
  landedCostTotal: number;
  marginTotal: number;
  /** True when any Item feeding the margin still has an Unconfirmed Landed Cost. */
  marginProvisional: boolean;
};

/**
 * The whole Tender's money, added up.
 *
 * **Every total is per-unit × quantity.** The per-unit figures are what the rows hold and
 * what people type, so a bar that summed them would read as a plausible total while being
 * out by whatever the quantities are — three orders of magnitude on a Tender for 500
 * boxes, and invisible from the bar itself.
 *
 * **An Item missing a figure is left out of that total rather than counted as zero**: a
 * Tender half-priced is not a Tender with a zero-baht Item in it, and a landed cost read
 * as zero would report the whole selling price as Margin. `pricedCount` beside the figures
 * is what says how much of the Tender they cover.
 *
 * The three money figures are three sums, not one subtraction: an Item with a selling
 * price and no landed cost is counted as covered and joins the Bid total, but adds
 * nothing to the cost or the Margin, so the bar only reads as Bid less cost equals Margin
 * once every covered Item carries both figures. Deriving the Margin total by subtraction
 * instead would report an unknown cost as no cost at all — the one arithmetic here that
 * flatters us.
 */
export function sheetTotals(rows: StoredPricing[]): SheetTotals {
  const items = rows.map(pricedItem);
  const margins = items.map(marginOf);

  return {
    itemCount: items.length,
    pricedCount: items.filter((item) => item.sellingPricePerUnit !== null).length,
    bidTotal: sum(items.map((item) => onLine(item, item.sellingPricePerUnit))),
    landedCostTotal: sum(items.map((item) => onLine(item, item.landedCostPerUnit))),
    marginTotal: sum(margins.map((margin) => margin?.onLine ?? null)),
    // One understated cost understates the whole bar: the total is no more final than the
    // least final figure in it.
    marginProvisional: margins.some((margin) => margin?.provisional ?? false),
  };
}

function onLine(item: { quantity: number }, perUnit: number | null): number | null {
  return perUnit === null ? null : perUnit * item.quantity;
}

function sum(amounts: (number | null)[]): number {
  return amounts.reduce((total: number, amount) => total + (amount ?? 0), 0);
}
