import "server-only";

import { currentUser } from "@/lib/auth/session";
import { answeredBy } from "@/lib/quotes/quotes";
import {
  sourcingDeadlineStatus,
  type SourcingDeadlineStatus,
} from "@/lib/tenders/progress";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

/**
 * **My work** — the Tender Items one Assignee still owes an answer on.
 *
 * The peer of `listWorklist` next door, and the app's second nav destination (ADR-0021).
 * The two are the same altitude and the same shape of read, and they answer different
 * questions because they are made of different things: the worklist holds **Tenders** and
 * answers "which Tender needs somebody", which is an Owner's question. This holds
 * **Items** and answers "which prices do I still owe", which is an Assignee's. No filter
 * over a list of Tenders produces this one, because filtering Tenders yields Tenders.
 *
 * **Not Yet Sourced is per reader, not per Item.** `CONTEXT.md` defines it as an Item an
 * Assignee has neither Quoted nor marked No Supplier Found, and the Assignee in that
 * sentence is load-bearing: Assignees compete rather than divide (ADR-0004), so a
 * colleague's Quote is not this reader's answer and does not take the row away. The
 * worklist's `notYetSourced` counts the same word across everybody, which is the right
 * count for the Owner's question and the wrong one for this list.
 *
 * **The list is finishable, and that is the requirement.** Entering a Quote empties a
 * row; recording No Supplier Found empties it too, because both are answers and only
 * silence is not. Already-answered Items are not shown so that they could be revisited —
 * a list that never reaches zero stops being work-to-do and becomes another thing to
 * scan. Correcting a Quote is rare and keeps its route through the Tender.
 *
 * Two more things end the work and so end the row, and neither is the reader's doing: an
 * Item with an **Outcome** recorded is decided, and an Item on a Tender whose **Bid has
 * gone out** is past being priced. Leaving either on would put a row on a finishable list
 * that no honest act of the reader's could ever clear — they would have to claim they
 * could not source something nobody is asking them for.
 *
 * Nothing is stored and nothing is built for scale: no search, no filters, no pagination.
 * Under ~25 open Tenders they solve a problem that does not exist (ADR-0021).
 *
 * `today` is a `yyyy-mm-dd` day **already resolved in the org's timezone** and passed in
 * from the request boundary (ADR-0010), for the reason `worklist.ts` gives at length:
 * Vercel runs UTC, and a day boundary computed server-local rolls seven hours early for
 * everybody in Bangkok.
 */

/** One Item this reader still owes a price on, as a row on My work. */
export type MyWorkRow = {
  itemId: string;
  /** Where the row links to — the quote form for this Item, on this Tender. */
  tenderId: string;
  /** The Item, which is what the reminder that summoned them named. */
  productName: string;
  /** Whose enquiry it is, and the reference the supplier conversation is filed under. */
  clientName: string;
  reference: string;
  /**
   * The day this reader's answer is due. Carried as the day rather than as a rendered
   * sentence, because the *today / tomorrow / a date* reading is a wording decision and
   * belongs beside the message keys.
   */
  internalQuoteDeadline: string;
  /** How far off that day is, and how loudly the row says so. */
  status: SourcingDeadlineStatus;
};

/**
 * Every Item this reader is an Assignee on and has not answered for, soonest first.
 *
 * A plain array rather than the sectioned object `listWorklist` returns: there are no
 * groups here and there is no second count to carry, because the two emptinesses the
 * worklist has to tell apart do not exist on this screen. An empty My work means one
 * thing — this reader owes nobody a price — and it says so in one sentence.
 *
 * Three round trips however many Items there are: the Tenders this reader is on, those
 * Tenders' Items, and then — in one `answeredBy`, which issues its two queries together —
 * which of those Items they have already answered for. That last question is the whole of
 * "per reader" and the reason this cannot be assembled from the worklist's counts, which
 * count everybody's answers.
 */
export async function listMyWork(
  today: string,
  store: SessionCookieStore,
): Promise<MyWorkRow[]> {
  const caller = await currentUser(store);

  // Nobody is an Assignee on anything, which is the honest answer for a signed-out
  // reader. RLS would return nothing anyway; this is what stops three queries being
  // issued to find that out.
  if (!caller) return [];

  const supabase = createSessionClient(store);
  const { data: assigned } = await supabase
    .from("tender_assignees")
    .select("tender_id")
    .eq("user_id", caller.id);

  const tenderIds = (assigned ?? []).map((row) => row.tender_id);

  if (tenderIds.length === 0) return [];

  const { data: items } = await supabase
    .from("tender_items")
    .select(
      "id, product_name, ordinal, outcome, " +
        "tender:tenders!inner(id, reference, client_name, internal_quote_deadline, submitted_at)",
    )
    .in("tender_id", tenderIds)
    .overrideTypes<MyWorkDbRow[], { merge: false }>();

  // An Item that is decided, or that sits on a Tender already bid, is not work anybody
  // can do. Dropped before the reader's own answers are looked up rather than after, so
  // that the question below is asked about the Items actually in play.
  const answerable = (items ?? []).filter(
    (item) => item.outcome === null && item.tender.submitted_at === null,
  );

  if (answerable.length === 0) return [];

  const answered = await answeredBy(
    answerable.map((item) => item.id),
    caller.id,
    store,
  );

  return answerable
    .filter((item) => !answered.has(item.id))
    .sort(bySoonestDeadline)
    .map((item) => ({
      itemId: item.id,
      tenderId: item.tender.id,
      productName: item.product_name,
      clientName: item.tender.client_name,
      reference: item.tender.reference,
      internalQuoteDeadline: item.tender.internal_quote_deadline,
      status: sourcingDeadlineStatus(item.tender.internal_quote_deadline, today),
    }));
}

/**
 * Soonest Internal Quote Deadline first, then whole Tenders together in their own order.
 *
 * Sorted here rather than by the query, because the deadline lives on the Tender and
 * PostgREST orders parent rows by their own columns only. The two tie-breaks are what
 * keeps a list of Items readable: a Tender's Items sit next to each other rather than
 * interleaved with another client's on the same day, and within one they keep the order
 * they were typed in — `(ordinal, id)`, never `ordinal` alone, which ties.
 */
function bySoonestDeadline(a: MyWorkDbRow, b: MyWorkDbRow): number {
  return (
    compare(a.tender.internal_quote_deadline, b.tender.internal_quote_deadline) ||
    compare(a.tender.reference, b.tender.reference) ||
    a.ordinal - b.ordinal ||
    compare(a.id, b.id)
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type MyWorkDbRow = {
  id: string;
  product_name: string;
  ordinal: number;
  outcome: string | null;
  tender: {
    id: string;
    reference: string;
    client_name: string;
    internal_quote_deadline: string;
    submitted_at: string | null;
  };
};
