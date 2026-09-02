import "server-only";

import { currentUser } from "@/lib/auth/session";
import { isCalendarDate } from "@/lib/calendar-date";
import { isConvertibleCurrency, reportingCurrency } from "@/lib/fx/currencies";
import { freezeRate, type FxBoundary } from "@/lib/fx/rates";
import { getOrgSettings } from "@/lib/org/org";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

// Not `server-only`, unlike this module: the add-quote form renders the radio group in
// the browser. Re-exported below so server-side callers keep reading it from the module
// that owns Quotes.
import { mayCorrectQuote, matchTypes, type MatchType } from "./quote-form";

/**
 * Recording what a supplier said, and recording that nobody would say anything.
 *
 * An Assignee comes off the phone holding a price. The job of this module is to get that
 * price written down in the currency and the unit the supplier actually used, without
 * anybody doing conversion arithmetic mid-call and without anything in the way — which
 * is why the rate is frozen here rather than looked up at render time, and why a rate
 * service being down is not a refusal (see `@/lib/fx/rates`).
 *
 * Two rules from `CONTEXT.md` are enforced here and nowhere else:
 *
 * **Only an Assignee may enter a Quote on a Tender.** They are the one who actually rang
 * the supplier, and every Quote records which of them it was — because two Assignees
 * ringing the same supplier and getting different prices is expected, informative, and
 * the only thing distinguishing two otherwise identical rows.
 *
 * **No Supplier Found is a third state, not an absence.** "Nobody could supply this" and
 * "nobody tried" mean opposite things when deciding whether to Bid at all, and only one
 * of them is worth chasing an Assignee about.
 *
 * Everything reads and writes through the *session* client, so RLS is what keeps one org
 * out of another's Quotes; the checks in this file are the ones RLS cannot express.
 */

export { mayCorrectQuote, matchTypes, type MatchType };

export type QuoteFields = {
  tenderItemId: string;
  /** Found or created within the org by name; see `findOrCreateSupplier`. */
  supplierName: string;
  unitPrice: number;
  /** ISO 4217, and one ECB publishes — otherwise the price cannot be converted. */
  currency: string;
  /** The unit the *supplier* priced in, which is not always the Item's own. */
  quotedUnit: string;
  leadTimeDays: number | null;
  matchType: MatchType;
  /** Required when `matchType` is `alternative`, and never buried in the notes. */
  alternativeProductName: string | null;
  detailNotes: string | null;
  /** `yyyy-mm-dd`. The day the supplier gave the price, which sets the rate. */
  quotedAt: string;
};

/**
 * A correction to a Quote that already exists: every field of it that may be changed.
 *
 * Derived from {@link QuoteFields} rather than written out beside it, so a field added to
 * entry is a field this has to decide about rather than one it silently omits. Two are
 * subtracted, for different reasons:
 *
 * **`tenderItemId`** — moving a Quote to another Item is not a correction to this Quote.
 * The Item it was entered against is what it is a price *for*.
 *
 * **`currency`** — changing it changes what the stored `unit_price` means, which is a
 * different Quote rather than a correction to this one (ADR-0018). Delete and re-enter is
 * the honest path, and this module provides it.
 */
export type QuoteCorrection = Omit<QuoteFields, "tenderItemId" | "currency"> & {
  quoteId: string;
};

/**
 * Every way a write here can be refused, as a list rather than a bare union: the wording
 * lives in the message files, and a reason with none renders to the user as its own key.
 * `messages.test.ts` walks this to hold both locales to it.
 */
export const quoteProblems = [
  "forbidden",
  "not_found",
  "not_assignee",
  "not_sourced_by_you",
  "clears_selection",
  "incomplete",
  "invalid_price",
  "invalid_lead_time",
  "invalid_date",
  "unsupported_currency",
  "alternative_unnamed",
  "no_rate",
  "failed",
] as const;

export type QuoteProblem = (typeof quoteProblems)[number];

export type QuoteResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: QuoteProblem };

/** One Quote as a screen needs it. */
export type Quote = {
  id: string;
  tenderItemId: string;
  supplierName: string;
  unitPrice: number;
  currency: string;
  quotedUnit: string;
  /** `unit_price * fx_rate_applied`, computed by the database and never by hand. */
  unitPriceThb: number;
  fxRateMid: number;
  fxRateApplied: number;
  fxRateAsOf: string;
  fxRateIsStale: boolean;
  leadTimeDays: number | null;
  matchType: MatchType;
  alternativeProductName: string | null;
  detailNotes: string | null;
  quotedAt: string;
  /** Who rang the supplier. A column, never dropped, never derived from anything else. */
  sourcedByUserId: string;
  sourcedByName: string;
};

/** One Assignee's "I could not source this", with whatever they said about it. */
export type NoSupplierFound = {
  userId: string;
  name: string;
  note: string | null;
  createdAt: string;
};

/** What is known about one Tender Item's sourcing: the third state included. */
export type ItemSourcing = {
  quoteCount: number;
  noSupplierFound: NoSupplierFound[];
};

const quoteColumns =
  "id, tender_item_id, unit_price, currency, quoted_unit, unit_price_thb, " +
  "fx_rate_mid, fx_rate_applied, fx_rate_as_of, fx_rate_is_stale, lead_time_days, " +
  "match_type, alternative_product_name, detail_notes, quoted_at, created_by_user_id";

/**
 * Record one supplier's price for one Tender Item.
 *
 * The rate is frozen into the row as it is written — `fx_rate_mid`, `fx_rate_applied` and
 * `fx_rate_as_of` — so the ranking somebody saw today is reproducible from the row a year
 * from now, and no dashboard total moves because a currency did. A THB Quote stores both
 * rates as 1 and is not converted at all.
 *
 * Nothing about a supplier being quoted twice on the same Item is refused. There is no
 * unique index behind it and there is deliberately no check here either: the divergence
 * is the most interesting signal in the dataset, and the comparison view surfaces it with
 * a banner naming both Assignees rather than hiding it.
 */
export async function createQuote(
  input: QuoteFields,
  store: SessionCookieStore,
  boundary: FxBoundary = {},
): Promise<QuoteResult<{ quoteId: string }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const standing = await assigneeProblem(input.tenderItemId, caller.id, supabase);

  if (standing) return { ok: false, reason: standing };

  const problem = fieldProblem(input, input.currency);

  if (problem) return { ok: false, reason: problem };

  const { fxBufferPct } = await getOrgSettings(store);
  const rate = await freezeRate(
    { currency: input.currency, on: input.quotedAt, bufferPct: fxBufferPct },
    supabase,
    boundary,
  );

  // Frankfurter was unreachable *and* this currency has never been quoted before, so
  // there is no rate to freeze. `fx_rate_mid` is `not null` and every total in the app is
  // built on it, so the alternative to refusing is a stored price nothing can convert.
  if (rate === null) return { ok: false, reason: "no_rate" };

  const supplierId = await findOrCreateSupplier(
    input.supplierName,
    caller.orgId,
    supabase,
  );

  if (supplierId === null) return { ok: false, reason: "failed" };

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      org_id: caller.orgId,
      tender_item_id: input.tenderItemId,
      supplier_id: supplierId,
      created_by_user_id: caller.id,
      unit_price: input.unitPrice,
      currency: input.currency,
      quoted_unit: input.quotedUnit.trim(),
      fx_rate_mid: rate.mid,
      fx_rate_applied: rate.applied,
      fx_rate_as_of: rate.asOf,
      fx_rate_is_stale: rate.isStale,
      lead_time_days: input.leadTimeDays,
      match_type: input.matchType,
      alternative_product_name:
        input.matchType === "alternative"
          ? (input.alternativeProductName?.trim() ?? null)
          : null,
      detail_notes: blankToNull(input.detailNotes),
      quoted_at: input.quotedAt,
    })
    .select("id")
    .single();

  if (error !== null || !data) return { ok: false, reason: "failed" };

  // The Assignee said they could not source this Item and has just sourced it. Leaving
  // both would have the Item read as Quoted and as impossible at the same time, and the
  // record is only ever an Assignee's own statement about their own attempt — so this
  // clears theirs and touches nobody else's.
  await supabase
    .from("no_supplier_found")
    .delete()
    .eq("tender_item_id", input.tenderItemId)
    .eq("user_id", caller.id);

  return { ok: true, quoteId: data.id };
}

/**
 * Correct a Quote that is already written down.
 *
 * A Quote used to be written once and never touched again, which mattered more than a
 * typo usually does: a wrong Quote is not inert. It feeds the comparison working sheet,
 * it can be an Item's Selected Quote, and a wrong price that happens to be the lowest is
 * the one most likely to be picked.
 *
 * ## The rate follows the date the Quote claims (ADR-0018)
 *
 * `createQuote` freezes against `quotedAt`, not against today, so `fx_rate_as_of` has
 * never meant "the day somebody typed this in" — it means the rate for the day this Quote
 * claims the supplier gave the price. Two rules follow, and both are here:
 *
 * - **`quotedAt` moved**, so the freeze is re-run against the new date and all four rate
 *   fields are rewritten together. Rewriting some but not others would leave the buffer
 *   applied to a mid it was not computed from.
 * - **Anything else moved**, so the rate is left exactly as it is — the price included. A
 *   correction to a digit is not a claim about a currency, and re-fetching could only
 *   introduce a later ECB revision or a Stale Rate where the original was live.
 *
 * A re-freeze can fail the way the first one can, and is refused the same way: the row is
 * left as it was, in every field, rather than half-corrected around a price nothing can
 * convert. A re-freeze that falls back to a last-known rate is recorded as stale rather
 * than refused — an Assignee fixing a date must no more be stopped by a service in
 * Frankfurt than one entering a price was.
 */
export async function updateQuote(
  input: QuoteCorrection,
  store: SessionCookieStore,
  boundary: FxBoundary = {},
): Promise<QuoteResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const standing = await correctableQuote(input.quoteId, caller.id, supabase);

  if ("reason" in standing) return { ok: false, reason: standing.reason };

  const problem = fieldProblem(input, null);

  if (problem) return { ok: false, reason: problem };

  // The stored currency, never one from the caller: `QuoteCorrection` has no field for it
  // and this is the only place the value could otherwise come from.
  const rate =
    input.quotedAt === standing.quote.quoted_at
      ? null
      : await freezeRate(
          {
            currency: standing.quote.currency,
            on: input.quotedAt,
            bufferPct: (await getOrgSettings(store)).fxBufferPct,
          },
          supabase,
          boundary,
        );

  // Refused before anything is written, which is what makes "the row is left as it was"
  // true of the price as well as of the rate — they moved in the same submit.
  if (input.quotedAt !== standing.quote.quoted_at && rate === null) {
    return { ok: false, reason: "no_rate" };
  }

  const supplierId = await findOrCreateSupplier(
    input.supplierName,
    caller.orgId,
    supabase,
  );

  if (supplierId === null) return { ok: false, reason: "failed" };

  const { error } = await supabase
    .from("quotes")
    .update({
      supplier_id: supplierId,
      unit_price: input.unitPrice,
      quoted_unit: input.quotedUnit.trim(),
      lead_time_days: input.leadTimeDays,
      match_type: input.matchType,
      // Cleared when a correction takes the Quote back to an exact match. Left behind, it
      // is a substitute's name on a row that no longer offers one — and the comparison
      // view's QUOTED PRODUCT column reads this and nothing else.
      alternative_product_name:
        input.matchType === "alternative"
          ? (input.alternativeProductName?.trim() ?? null)
          : null,
      detail_notes: blankToNull(input.detailNotes),
      quoted_at: input.quotedAt,
      // All four together or none of them, which is why this is one spread rather than
      // four assignments guarded separately.
      ...(rate === null
        ? {}
        : {
            fx_rate_mid: rate.mid,
            fx_rate_applied: rate.applied,
            fx_rate_as_of: rate.asOf,
            fx_rate_is_stale: rate.isStale,
          }),
    })
    .eq("id", input.quoteId);

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * Take a Quote back.
 *
 * The path for the corrections an edit cannot make — a Quote entered against the wrong
 * Item, or in the wrong currency, both of which change what the row *is* rather than what
 * it says.
 *
 * **Deleting an Item's Selected Quote is refused until it is asked for twice.** Nothing
 * dangles either way: `tender_items.selected_quote_id` has a composite foreign key with
 * `on delete set null`, so the selection clears itself and no orphan is possible. The
 * refusal is not about integrity. It is that the Item would otherwise lose the one
 * decision anybody made about it with nothing said to anyone — so the first attempt
 * reports what the delete would cost, and `clearingSelection` is the caller having been
 * told and come back.
 *
 * Deleting the last Quote on an Item takes it back to **Not Yet Sourced**, which regresses
 * the Tender's derived Progress. That needs nothing here: the derivation counts Quote
 * rows, and there is one fewer.
 */
export async function deleteQuote(
  {
    quoteId,
    clearingSelection = false,
  }: {
    quoteId: string;
    /** The caller has been told this clears the Item's selection, and means it. */
    clearingSelection?: boolean;
  },
  store: SessionCookieStore,
): Promise<QuoteResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const standing = await correctableQuote(quoteId, caller.id, supabase);

  if ("reason" in standing) return { ok: false, reason: standing.reason };

  if (standing.quote.isSelected && !clearingSelection) {
    return { ok: false, reason: "clears_selection" };
  }

  const { error } = await supabase.from("quotes").delete().eq("id", quoteId);

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * An Assignee's explicit "I could not source this", with an optional note.
 *
 * Idempotent, and an upsert rather than an insert: pressing it twice is not a conflict to
 * report, and pressing it again with a note is somebody adding the reason they did not
 * have the first time.
 */
export async function recordNoSupplierFound(
  { tenderItemId, note }: { tenderItemId: string; note: string | null },
  store: SessionCookieStore,
): Promise<QuoteResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const standing = await assigneeProblem(tenderItemId, caller.id, supabase);

  if (standing) return { ok: false, reason: standing };

  const { error } = await supabase.from("no_supplier_found").upsert(
    {
      tender_item_id: tenderItemId,
      user_id: caller.id,
      org_id: caller.orgId,
      note: blankToNull(note),
    },
    { onConflict: "tender_item_id,user_id" },
  );

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * Take back your own No Supplier Found.
 *
 * Yours and only yours: the record is one Assignee's statement about their own attempt,
 * so one of them giving up says nothing about what another has tried. There is no
 * standing check beyond that, because clearing a record you left is not an act anybody
 * has to approve — and it has to keep working after you have been taken off the Tender.
 */
export async function clearNoSupplierFound(
  tenderItemId: string,
  store: SessionCookieStore,
): Promise<QuoteResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const { error } = await createSessionClient(store)
    .from("no_supplier_found")
    .delete()
    .eq("tender_item_id", tenderItemId)
    .eq("user_id", caller.id);

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * Every Quote on one Tender Item, oldest first.
 *
 * Deliberately *not* ranked. Cheapest-first in THB is the comparison view's job and it
 * cannot be done here: an Item carrying one Quote in "box of 50" and another in "piece"
 * has no ranking at all, and a list that quietly sorted by `unit_price_thb` would put a
 * number beside two prices that are not comparable. Entry order is the one order that
 * claims nothing.
 */
export async function listQuotes(
  tenderItemId: string,
  store: SessionCookieStore,
): Promise<Quote[]> {
  const { data } = await createSessionClient(store)
    .from("quotes")
    .select(
      `${quoteColumns}, supplier:suppliers(name), ` +
        "sourcedBy:users!quotes_created_by_user_id_fkey(name)",
    )
    .eq("tender_item_id", tenderItemId)
    .order("created_at")
    .order("id")
    .overrideTypes<QuoteDbRow[], { merge: false }>();

  return (data ?? []).map(asQuote);
}

/**
 * Every Quote on a set of Tender Items, keyed by Item.
 *
 * One query for a whole Tender's worth of Items rather than one per Item, and it takes
 * the ids rather than a Tender because its caller has already read them — the same shape,
 * and for the same reason, as `listQuotePhotosByQuote`.
 *
 * Unranked here for the same reason `listQuotes` is — ordering is `@/lib/comparison`'s
 * job, and it is the only caller in a position to know that an Item carrying one Quote in
 * "box of 50" cannot be ranked at all.
 */
export async function listQuotesByItem(
  itemIds: string[],
  store: SessionCookieStore,
): Promise<Map<string, Quote[]>> {
  const byItem = new Map<string, Quote[]>();

  if (itemIds.length === 0) return byItem;

  const { data } = await createSessionClient(store)
    .from("quotes")
    .select(
      `${quoteColumns}, supplier:suppliers(name), ` +
        "sourcedBy:users!quotes_created_by_user_id_fkey(name)",
    )
    .in("tender_item_id", itemIds)
    .order("created_at")
    .order("id")
    .overrideTypes<QuoteDbRow[], { merge: false }>();

  for (const row of data ?? []) {
    const quote = asQuote(row);

    byItem.set(quote.tenderItemId, [...(byItem.get(quote.tenderItemId) ?? []), quote]);
  }

  return byItem;
}

/**
 * What is known about the sourcing of every Item on a Tender, in two queries.
 *
 * Returns an entry only for Items something is known about. An Item absent from the map
 * is **Not Yet Sourced** — the third state, and the only one that is overdue: nobody has
 * quoted it and nobody has said they could not. That absence is the whole point, so it is
 * left as an absence rather than materialised into a row of zeroes.
 */
export async function listItemSourcing(
  tenderId: string,
  store: SessionCookieStore,
): Promise<Map<string, ItemSourcing>> {
  const supabase = createSessionClient(store);
  const { data: items } = await supabase
    .from("tender_items")
    .select("id")
    .eq("tender_id", tenderId);

  const itemIds = (items ?? []).map((item) => item.id);
  const sourcing = new Map<string, ItemSourcing>();

  if (itemIds.length === 0) return sourcing;

  const entry = (itemId: string): ItemSourcing => {
    const existing = sourcing.get(itemId) ?? { quoteCount: 0, noSupplierFound: [] };

    sourcing.set(itemId, existing);

    return existing;
  };

  const { data: quotes } = await supabase
    .from("quotes")
    .select("tender_item_id")
    .in("tender_item_id", itemIds);

  for (const quote of quotes ?? []) entry(quote.tender_item_id).quoteCount += 1;

  const { data: refusals } = await supabase
    .from("no_supplier_found")
    .select("tender_item_id, user_id, note, created_at, user:users(name)")
    .in("tender_item_id", itemIds)
    .order("created_at")
    .overrideTypes<NoSupplierFoundDbRow[], { merge: false }>();

  for (const refusal of refusals ?? []) {
    entry(refusal.tender_item_id).noSupplierFound.push({
      userId: refusal.user_id,
      name: refusal.user?.name ?? "",
      note: refusal.note,
      createdAt: refusal.created_at,
    });
  }

  return sourcing;
}

/**
 * Which Quote an Item has been **Selected** from, or null when nobody has chosen yet.
 *
 * A fact about the Item rather than about any Quote — a Quote does not know it was picked,
 * which is why this cannot be read off {@link listQuotes}. `tender_items.selected_quote_id`
 * is the single column A8 chose over a `quotes.is_selected` boolean, so that "one Selected
 * Quote per Item" is structural rather than a rule the app has to remember.
 *
 * Named here rather than issued inline by the screen that wants it: every other read the
 * sourcing screen makes is a function in this module, and a raw table query in a loader is
 * how the next one comes to be written there too.
 */
export async function selectedQuoteId(
  tenderItemId: string,
  store: SessionCookieStore,
): Promise<string | null> {
  const { data } = await createSessionClient(store)
    .from("tender_items")
    .select("selected_quote_id")
    .eq("id", tenderItemId)
    .maybeSingle();

  return data?.selected_quote_id ?? null;
}

/** How one Item's sourcing stands, counted rather than read. */
export type ItemSourcingCount = { quoteCount: number; noSupplierFoundCount: number };

/**
 * The same two facts as {@link listItemSourcing}, counted rather than read, across as
 * many Items as you like rather than one Tender's.
 *
 * The worklist asks this of every Item in the org at once, and only ever asks whether a
 * row *exists*: pulling prices, notes and names back to answer that would be most of the
 * Quote table for a screen that shows none of it. The refusals are still counted
 * separately and never folded in with the Quotes — "nobody could supply this" and
 * "nobody tried" mean opposite things, and Sourcing Overdue is exactly the difference.
 *
 * An Item absent from the map is **Not Yet Sourced**, as it is in `listItemSourcing`, and
 * for the same reason: the absence is the state, not a gap in the answer.
 */
export async function countItemSourcing(
  itemIds: string[],
  store: SessionCookieStore,
): Promise<Map<string, ItemSourcingCount>> {
  const counts = new Map<string, ItemSourcingCount>();

  if (itemIds.length === 0) return counts;

  const supabase = createSessionClient(store);
  const entry = (itemId: string): ItemSourcingCount => {
    const existing = counts.get(itemId) ?? { quoteCount: 0, noSupplierFoundCount: 0 };

    counts.set(itemId, existing);

    return existing;
  };

  // Independent of each other, so they go together rather than one after the other.
  const [quotes, refusals] = await Promise.all([
    supabase.from("quotes").select("tender_item_id").in("tender_item_id", itemIds),
    supabase
      .from("no_supplier_found")
      .select("tender_item_id")
      .in("tender_item_id", itemIds),
  ]);

  for (const quote of quotes.data ?? []) entry(quote.tender_item_id).quoteCount += 1;

  for (const refusal of refusals.data ?? []) {
    entry(refusal.tender_item_id).noSupplierFoundCount += 1;
  }

  return counts;
}

/**
 * Which of these Items **one Assignee** has already answered for — Quoted, or marked No
 * Supplier Found.
 *
 * The per-reader half of the sourcing read, and it lives here beside
 * {@link countItemSourcing} for the reason `worklist.ts` gives about its own half: the
 * third sourcing state is defined in this module, so every question about it is asked
 * here. What My work needs is the same two tables narrowed by one column each —
 * `created_by_user_id` on the Quote, `user_id` on the refusal — and that column is the
 * whole of the difference between the two screens.
 *
 * **A set rather than counts, and the two folded together**, which is where this parts
 * company with `countItemSourcing`. That one keeps Quotes and refusals apart because the
 * worklist has to tell "nobody could supply this" from "nobody tried", and Sourcing
 * Overdue is exactly the difference. Here the distinction has already been made, by the
 * reader, and either answer ends their row: both are answers and only silence is not.
 */
export async function answeredBy(
  itemIds: string[],
  userId: string,
  store: SessionCookieStore,
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();

  const supabase = createSessionClient(store);
  // Independent of each other, so they go together rather than one after the other.
  const [quotes, refusals] = await Promise.all([
    supabase
      .from("quotes")
      .select("tender_item_id")
      .in("tender_item_id", itemIds)
      .eq("created_by_user_id", userId),
    supabase
      .from("no_supplier_found")
      .select("tender_item_id")
      .in("tender_item_id", itemIds)
      .eq("user_id", userId),
  ]);

  return new Set([
    ...(quotes.data ?? []).map((quote) => quote.tender_item_id),
    ...(refusals.data ?? []).map((refusal) => refusal.tender_item_id),
  ]);
}

/**
 * A supplier by name within the org, created if this is the first time anybody rang
 * them.
 *
 * Suppliers became a table so that one supplier cannot split across rows, and
 * `unique (org_id, lower(name))` is what holds that — case-insensitively, because "Ace
 * Medical" and "ACE Medical" are one company and a comparison view that ranked them as
 * two would be comparing a supplier against themselves. The constraint will reject
 * genuinely distinct suppliers who share a name; that is the accepted cost (A7).
 *
 * The lookup comes first because the common case by far is a supplier who has been rung
 * before. The insert's own failure is the second chance rather than the first: the index
 * is on `lower(name)` and only the database can arbitrate its own collation, so a
 * duplicate that slipped past the lookup — or two Assignees ringing a new supplier at
 * once — is answered by asking again rather than by reporting a conflict at somebody
 * holding a price.
 */
async function findOrCreateSupplier(
  name: string,
  orgId: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<string | null> {
  const trimmed = name.trim();
  const existing = await supplierNamed(trimmed, supabase);

  if (existing !== null) return existing;

  const { data, error } = await supabase
    .from("suppliers")
    .insert({ org_id: orgId, name: trimmed })
    .select("id")
    .single();

  if (error === null && data) return data.id;

  return supplierNamed(trimmed, supabase);
}

async function supplierNamed(
  name: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<string | null> {
  // `ilike` is a pattern match, so a supplier legitimately called "50% Medical" would
  // otherwise match half the org. Escaped, it is exactly a case-insensitive equality.
  const pattern = name.replace(/[\\%_]/g, "\\$&");
  const { data } = await supabase
    .from("suppliers")
    .select("id")
    .ilike("name", pattern)
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * Is the caller an Assignee on the Tender this Item belongs to?
 *
 * Asked as one embedded read rather than two: RLS turns another org's Item into no row,
 * which is the same answer as an Item deleted while the form was open, and the embed
 * turns "not on this Tender" into an empty array without a second round trip.
 *
 * `not_assignee` is a different refusal from `forbidden` on purpose. Nothing is wrong
 * with the person — Assignees enrol themselves (ADR-0004) — so the sentence a user reads
 * is one that tells them to put themselves on the Tender, not one that says no.
 */
async function assigneeProblem(
  tenderItemId: string,
  callerId: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<QuoteProblem | null> {
  if (!tenderItemId) return "not_found";

  const { data } = await supabase
    .from("tender_items")
    .select("id, tender:tenders(assignees:tender_assignees(user_id))")
    .eq("id", tenderItemId)
    .maybeSingle()
    .overrideTypes<
      { id: string; tender: { assignees: { user_id: string }[] } | null },
      { merge: false }
    >();

  if (!data) return "not_found";

  const assignees = data.tender?.assignees ?? [];

  return assignees.some((row) => row.user_id === callerId) ? null : "not_assignee";
}

/**
 * May the caller correct this Quote, and what does correcting it need to know?
 *
 * A narrower question than {@link assigneeProblem}, and deliberately not that one. Being
 * an Assignee is what earns you the right to *enter* a Quote; changing one somebody else
 * entered is a different act.
 *
 * **Only the Assignee who sourced it, with the Tender's Owner as the override.**
 * `created_by_user_id` is
 * "sourced by" and it is load-bearing: there is deliberately no unique index on (Item,
 * supplier) because two Assignees ringing the same supplier is expected and informative
 * (ADR-0004), which makes that column the only thing distinguishing two otherwise
 * identical rows. If any Assignee could edit any Quote, the duplicate banner in the
 * comparison view would stop reporting what it claims.
 *
 * **The Org Admin is not an override.** An Org Admin has no extra visibility and no say
 * over Tenders they do not own, so there is nothing to read here about them — which is
 * why this asks only two questions and neither of them is about a role.
 *
 * One embedded read rather than three. RLS turns another org's Quote into no row, which
 * is the same answer as a Quote already deleted, and is the right answer to give.
 */
async function correctableQuote(
  quoteId: string,
  callerId: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<
  | { reason: QuoteProblem }
  | { quote: { currency: string; quoted_at: string; isSelected: boolean } }
> {
  if (!quoteId) return { reason: "not_found" };

  const { data } = await supabase
    .from("quotes")
    .select(
      // Named rather than inferred: `quotes` and `tender_items` reference each other —
      // this Quote's Item, and that Item's Selected Quote — so an unqualified embed is
      // ambiguous and PostgREST refuses it, which arrives here as no row at all.
      "id, currency, quoted_at, created_by_user_id, " +
        "item:tender_items!quotes_tender_item_id_fkey(" +
        "selected_quote_id, tender:tenders(owner_user_id))",
    )
    .eq("id", quoteId)
    .maybeSingle()
    .overrideTypes<CorrectableQuoteDbRow, { merge: false }>();

  if (!data) return { reason: "not_found" };

  const permitted = mayCorrectQuote({
    sourcedByUserId: data.created_by_user_id,
    callerId,
    ownerUserId: data.item?.tender?.owner_user_id ?? null,
  });

  if (!permitted) return { reason: "not_sourced_by_you" };

  return {
    quote: {
      currency: data.currency,
      quoted_at: data.quoted_at,
      isSelected: data.item?.selected_quote_id === quoteId,
    },
  };
}

/**
 * What both write paths refuse, and the one thing only entry can.
 *
 * `currency` is null on a correction — there is no field for it there, so there is
 * nothing to check — and a string on entry, where it is checked in the position it has
 * always been checked in: before the rate is fetched, so a currency ECB does not publish
 * is refused with a sentence about the currency rather than after a round trip that could
 * not have helped.
 */
function fieldProblem(
  input: Omit<QuoteFields, "tenderItemId" | "currency">,
  currency: string | null,
): QuoteProblem | null {
  if (!input.supplierName.trim() || !input.quotedUnit.trim()) return "incomplete";

  // `Number("")` is 0, which this refuses: a Quote *is* a price, and the absence of one
  // is recorded as No Supplier Found, never as zero.
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) return "invalid_price";

  if (
    input.leadTimeDays !== null &&
    (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0)
  ) {
    return "invalid_lead_time";
  }

  if (!isCalendarDate(input.quotedAt)) return "invalid_date";

  // THB is in the set and never fetched — it is not converted at all.
  if (currency !== null && !isConvertibleCurrency(currency)) {
    return "unsupported_currency";
  }

  // An Alternative carries the substitute's own name, in its own column. Buried in the
  // notes it is invisible to the comparison view's `QUOTED PRODUCT` column, which is the
  // one place a reviewer finds out they are being shown a different product.
  if (
    input.matchType === "alternative" &&
    !(input.alternativeProductName ?? "").trim()
  ) {
    return "alternative_unnamed";
  }

  return null;
}

function asQuote(row: QuoteDbRow): Quote {
  return {
    id: row.id,
    tenderItemId: row.tender_item_id,
    // A supplier or sourcer with no name means the embed came back empty, which RLS
    // cannot produce for a Quote the caller can already see.
    supplierName: row.supplier?.name ?? "",
    // `numeric` crosses the wire as a JSON number in a type wider than these columns
    // hold. Narrowing here keeps the coercion out of every caller.
    unitPrice: Number(row.unit_price),
    currency: row.currency,
    quotedUnit: row.quoted_unit,
    unitPriceThb: Number(row.unit_price_thb),
    fxRateMid: Number(row.fx_rate_mid),
    fxRateApplied: Number(row.fx_rate_applied),
    fxRateAsOf: row.fx_rate_as_of,
    fxRateIsStale: row.fx_rate_is_stale,
    leadTimeDays: row.lead_time_days,
    matchType: row.match_type,
    alternativeProductName: row.alternative_product_name,
    detailNotes: row.detail_notes,
    quotedAt: row.quoted_at,
    sourcedByUserId: row.created_by_user_id,
    sourcedByName: row.sourcedBy?.name ?? "",
  };
}

/**
 * The row shapes the reads come back as, written out rather than inferred: this project
 * has no generated `Database` types, so PostgREST reports a to-one embed as an array and
 * `overrideTypes` is where the two are reconciled.
 */
type QuoteDbRow = {
  id: string;
  tender_item_id: string;
  unit_price: number;
  currency: string;
  quoted_unit: string;
  unit_price_thb: number;
  fx_rate_mid: number;
  fx_rate_applied: number;
  fx_rate_as_of: string;
  fx_rate_is_stale: boolean;
  lead_time_days: number | null;
  match_type: MatchType;
  alternative_product_name: string | null;
  detail_notes: string | null;
  quoted_at: string;
  created_by_user_id: string;
  supplier: { name: string } | null;
  sourcedBy: { name: string } | null;
};

/** What {@link correctableQuote} reads: the permission facts, and the two an edit needs. */
type CorrectableQuoteDbRow = {
  id: string;
  currency: string;
  quoted_at: string;
  created_by_user_id: string;
  item: {
    selected_quote_id: string | null;
    tender: { owner_user_id: string } | null;
  } | null;
} | null;

type NoSupplierFoundDbRow = {
  tender_item_id: string;
  user_id: string;
  note: string | null;
  created_at: string;
  user: { name: string } | null;
};

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

/** Re-exported so a screen can say "quoted in THB" without reaching into the fx module. */
export { reportingCurrency };
