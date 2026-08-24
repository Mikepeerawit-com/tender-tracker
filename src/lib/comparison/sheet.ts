import "server-only";

import { currentUser } from "@/lib/auth/session";
import { prefillLandedCost } from "@/lib/comparison/pricing";
import { listQuotePhotosByQuote, type QuotePhoto } from "@/lib/images/quote-photos";
import {
  listItemSourcing,
  listQuotesByItem,
  type ItemSourcing,
  type Quote,
} from "@/lib/quotes/quotes";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

/**
 * The comparison working sheet's read, and the one decision it records.
 *
 * The whole Tender on one page: every Item, every competing Quote against it, and every
 * Quote's photos — assembled in a fixed six queries however many Items and Quotes there
 * are, because eight competing Quotes on each of four Items is what ADR-0004's
 * compete-not-divide model makes an ordinary Tender, and a per-Item read would be dozens
 * of round trips to draw one screen.
 *
 * Ranking is not done here. `@/lib/comparison/ranking` is where cheapest-first lives and
 * where the three refusals live with it, so that the rules can be tested as arithmetic
 * rather than staged as Tenders.
 */

/** One Tender Item as the sheet draws it: the row, and everything under the twisty. */
export type SheetItem = {
  id: string;
  productName: string;
  description: string | null;
  quantity: number;
  unit: string;
  /** Null means the Item still needs a decision, which is what opens it expanded. */
  selectedQuoteId: string | null;
  /** THB, per unit. Pre-filled from the Selected Quote and then edited — see #28. */
  landedCostPerUnit: number | null;
  /** Null means Unconfirmed: nothing has been added for shipping, duty or handling. */
  landedCostConfirmedAt: string | null;
  sellingPricePerUnit: number | null;
  quotes: Quote[];
  sourcing: ItemSourcing;
};

export type ComparisonSheet = {
  items: SheetItem[];
  /** Every Quote's photos on the whole Tender, keyed by Quote. */
  photos: Map<string, QuotePhoto[]>;
};

/**
 * Every reason selecting a Quote can be refused. Deliberately short: this is a decision,
 * not a workflow, and there is no confirm step for a refusal to interrupt.
 */
export const selectionProblems = ["forbidden", "not_found", "failed"] as const;

export type SelectionProblem = (typeof selectionProblems)[number];

export type SelectionResult = { ok: true } | { ok: false; reason: SelectionProblem };

/**
 * Every reason a price can be refused. Short for the same reason the selection's list is:
 * these are two numbers typed into a row, not a form with a workflow behind it.
 *
 * There is no `failed` here, unlike the selection's list: a write that changes no row is
 * an Item this caller cannot see, which is `not_found` and is the answer to give.
 */
export const pricingProblems = [
  "forbidden",
  "not_found",
  "invalid_amount",
] as const;

export type PricingProblem = (typeof pricingProblems)[number];

export type PricingResult = { ok: true } | { ok: false; reason: PricingProblem };

const itemColumns =
  "id, product_name, description, quantity, unit, selected_quote_id, " +
  "landed_cost_per_unit, landed_cost_confirmed_at, selling_price_per_unit";

/** The whole Tender, ready to rank. */
export async function getComparisonSheet(
  tenderId: string,
  store: SessionCookieStore,
): Promise<ComparisonSheet> {
  const supabase = createSessionClient(store);
  const { data } = await supabase
    .from("tender_items")
    .select(itemColumns)
    .eq("tender_id", tenderId)
    // `(ordinal, id)`, as every read of a Tender's Items sorts: the order somebody typed
    // them in is a stored fact, and ties are possible because two concurrent adds can read
    // the same max, so `ordinal` alone is not an order.
    .order("ordinal")
    .order("id")
    .overrideTypes<SheetItemDbRow[], { merge: false }>();

  const itemIds = (data ?? []).map((row) => row.id);
  // Independent of each other, so they go together rather than one after the other.
  const [quotes, sourcing] = await Promise.all([
    listQuotesByItem(itemIds, store),
    listItemSourcing(tenderId, store),
  ]);
  // Signed URLs, minted on this render and good for the hour — the same reason this page
  // cannot be cached beyond the request that drew it.
  const photos = await listQuotePhotosByQuote(
    [...quotes.values()].flat().map((quote) => quote.id),
    store,
  );

  const items = (data ?? []).map((row) => ({
    id: row.id,
    productName: row.product_name,
    description: row.description,
    // `numeric` crosses the wire as a JSON number in a type wider than these columns
    // hold, and nullable ones cross as null. Narrowing here keeps it out of every caller.
    quantity: Number(row.quantity),
    unit: row.unit,
    selectedQuoteId: row.selected_quote_id,
    landedCostPerUnit: asNumber(row.landed_cost_per_unit),
    landedCostConfirmedAt: row.landed_cost_confirmed_at,
    sellingPricePerUnit: asNumber(row.selling_price_per_unit),
    quotes: quotes.get(row.id) ?? [],
    sourcing: sourcing.get(row.id) ?? { quoteCount: 0, noSupplierFound: [] },
  }));

  return { items, photos };
}

/**
 * Select the winning Quote for one Tender Item — or, on the Quote already Selected, take
 * the selection back off it.
 *
 * One click, no confirmation. Deciding is not a workflow: the person doing it is looking
 * at eight ranked prices and has already decided, and a dialog asking whether they meant
 * it is a step that only ever gets clicked through. Pressing the Selected row again is
 * the undo, which is why this toggles rather than only ever setting.
 *
 * There is no Assignee check. Entering a Quote is restricted because the Assignee is the
 * one who actually rang the supplier and attribution is destroyed by anyone entering on
 * their behalf; choosing between Quotes already recorded is nobody's private act. Org
 * membership through RLS is the whole gate, as it is everywhere else a Tender is edited.
 *
 * Selecting also **pre-fills the Landed Cost**, in the same statement — see
 * `prefillLandedCost` for the rule and for why a hand-edited cost is never overwritten by
 * one. It is one statement rather than two because a selection the composite foreign key
 * refuses must not leave a cost behind from the Quote it refused.
 */
export async function selectQuote(
  { tenderItemId, quoteId }: { tenderItemId: string; quoteId: string },
  store: SessionCookieStore,
): Promise<SelectionResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const { data: item } = await supabase
    .from("tender_items")
    .select("selected_quote_id, unit, landed_cost_confirmed_at")
    .eq("id", tenderItemId)
    .maybeSingle();

  // Another org's Item and a deleted one are the same answer through RLS, and the same
  // answer is the right one to give.
  if (!item) return { ok: false, reason: "not_found" };

  const selection = item.selected_quote_id === quoteId ? null : quoteId;
  // The frozen THB price of the Quote being selected — never re-marked to today's rate,
  // so the cost pre-filled here is the one the ranking was drawn from. A Quote on another
  // Item is readable through RLS and is refused below by the composite foreign key, which
  // rolls this pre-fill back with the selection that asked for it.
  const quote = selection === null ? null : await readQuoteForPrefill(selection, store);
  const prefill = prefillLandedCost(
    { unit: item.unit, landedCostConfirmedAt: item.landed_cost_confirmed_at },
    quote,
  );

  const { data, error } = await supabase
    .from("tender_items")
    .update({
      selected_quote_id: selection,
      // Absent, not null: a hand-edited cost is left exactly as it was found.
      ...(prefill === null ? {} : { landed_cost_per_unit: prefill.landedCostPerUnit }),
    })
    .eq("id", tenderItemId)
    .select("id")
    .maybeSingle();

  // A Quote belonging to a *different* Item fails the composite foreign key rather than
  // being written, which is the schema doing what a check here would have had to. From
  // this side it is the same thing as no such Quote, and says so.
  if (error !== null) return { ok: false, reason: "not_found" };

  return data ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * Write the Landed Cost somebody has typed onto an Item, and confirm it by that act.
 *
 * **Hand-edited and Confirmed are one fact** (ADR-0014). Somebody who has typed a Landed
 * Cost has looked at the supplier's price and said what the goods actually cost us, so
 * the same call stamps `landed_cost_confirmed_at` — which is what turns a provisional
 * Margin into a number, and what stops the next Selected Quote overwriting the figure.
 *
 * Emptying the field takes the confirmation off with it: there is nothing left to have
 * confirmed, and a stamp over a null cost would silence the provisional Margin for a
 * Landed Cost that no longer exists.
 *
 * `confirmedAt` is passed in rather than read here — the clock belongs to the request
 * boundary (ADR-0010).
 */
export async function setLandedCost(
  {
    tenderItemId,
    landedCostPerUnit,
    confirmedAt,
  }: { tenderItemId: string; landedCostPerUnit: number | null; confirmedAt: Date },
  store: SessionCookieStore,
): Promise<PricingResult> {
  if (!isMoney(landedCostPerUnit)) return { ok: false, reason: "invalid_amount" };

  return writePricing(
    tenderItemId,
    {
      landed_cost_per_unit: landedCostPerUnit,
      landed_cost_confirmed_at:
        landedCostPerUnit === null ? null : confirmedAt.toISOString(),
    },
    store,
  );
}

/**
 * Write the selling price somebody has typed onto an Item.
 *
 * Nothing is confirmed by it and no Margin is stored beside it: the Margin is this figure
 * less the Landed Cost, computed wherever it is shown.
 */
export async function setSellingPrice(
  {
    tenderItemId,
    sellingPricePerUnit,
  }: { tenderItemId: string; sellingPricePerUnit: number | null },
  store: SessionCookieStore,
): Promise<PricingResult> {
  if (!isMoney(sellingPricePerUnit)) return { ok: false, reason: "invalid_amount" };

  return writePricing(
    tenderItemId,
    { selling_price_per_unit: sellingPricePerUnit },
    store,
  );
}

/**
 * The one write both prices go through: signed in, RLS, and the row was really there.
 *
 * There is no Assignee check, for the reason `selectQuote` gives — the price we bid is
 * not one person's private act, and everyone on the Tender sees cost and Margin alike.
 */
async function writePricing(
  tenderItemId: string,
  patch: PricingPatch,
  store: SessionCookieStore,
): Promise<PricingResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const { data, error } = await supabase
    .from("tender_items")
    .update(patch)
    .eq("id", tenderItemId)
    .select("id")
    .maybeSingle();

  // A CHECK the app did not catch first, which is the schema being the last word on what
  // a price may be rather than this function being the only word.
  if (error !== null) return { ok: false, reason: "invalid_amount" };

  return data ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * An amount in THB, or the field left empty.
 *
 * Zero is allowed and is not an oversight: a line bid at nothing is a real way to bid,
 * and the schema says the same with `>= 0`. The ceiling is `numeric(14,4)`'s — a figure
 * past it is refused here rather than by a database error somebody has to read.
 */
function isMoney(amount: number | null): boolean {
  return (
    amount === null ||
    (Number.isFinite(amount) && amount >= 0 && amount < 10 ** 10)
  );
}

/** The three columns a price may touch, named so a fourth cannot arrive by typo. */
type PricingPatch = {
  landed_cost_per_unit?: number | null;
  landed_cost_confirmed_at?: string | null;
  selling_price_per_unit?: number | null;
};

/** The Selected Quote's frozen THB price and the unit it was given in. */
async function readQuoteForPrefill(
  quoteId: string,
  store: SessionCookieStore,
): Promise<{ quotedUnit: string; unitPriceThb: number } | null> {
  const supabase = createSessionClient(store);
  const { data } = await supabase
    .from("quotes")
    .select("quoted_unit, unit_price_thb")
    .eq("id", quoteId)
    .maybeSingle();

  if (!data) return null;

  return {
    quotedUnit: data.quoted_unit,
    // `numeric` crosses the wire in a type wider than the column holds.
    unitPriceThb: Number(data.unit_price_thb),
  };
}

type SheetItemDbRow = {
  id: string;
  product_name: string;
  description: string | null;
  quantity: number;
  unit: string;
  selected_quote_id: string | null;
  landed_cost_per_unit: number | null;
  landed_cost_confirmed_at: string | null;
  selling_price_per_unit: number | null;
};

function asNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}
