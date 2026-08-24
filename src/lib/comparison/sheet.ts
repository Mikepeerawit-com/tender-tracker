import "server-only";

import { currentUser } from "@/lib/auth/session";
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
 * Nothing is pre-filled here. Landed Cost following the new Selected Quote is #28's, and
 * it has a rule this function is in no position to apply — it must not overwrite a cost a
 * human has already edited.
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
    .select("selected_quote_id")
    .eq("id", tenderItemId)
    .maybeSingle();

  // Another org's Item and a deleted one are the same answer through RLS, and the same
  // answer is the right one to give.
  if (!item) return { ok: false, reason: "not_found" };

  const selection = item.selected_quote_id === quoteId ? null : quoteId;
  const { data, error } = await supabase
    .from("tender_items")
    .update({ selected_quote_id: selection })
    .eq("id", tenderItemId)
    .select("id")
    .maybeSingle();

  // A Quote belonging to a *different* Item fails the composite foreign key rather than
  // being written, which is the schema doing what a check here would have had to. From
  // this side it is the same thing as no such Quote, and says so.
  if (error !== null) return { ok: false, reason: "not_found" };

  return data ? { ok: true } : { ok: false, reason: "failed" };
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
