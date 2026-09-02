import "server-only";

import { getComparisonSheet, type ComparisonSheet } from "@/lib/comparison/sheet";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import { listReferenceImages, type ReferenceImage } from "@/lib/images/reference-images";
import { listMembers, type Member } from "@/lib/org/members";
import { getOrgSettings } from "@/lib/org/org";
import type { NoSupplierFound, Quote } from "@/lib/quotes/quotes";
import type { SessionCookieStore } from "@/lib/supabase/session-client";
import { getTender, type Tender } from "@/lib/tenders/tenders";
import { ownsTender, yourQuotes } from "@/lib/tenders/viewer";

/** Everything screen 5 draws whoever is reading it. */
type TenderScreenFacts = {
  /** Null when there is no such Tender *for this caller* — see the note below. */
  tender: Tender | null;
  members: Member[];
  timezone: string;
  referenceImages: ReferenceImage[];
  /** The ones nobody has said which Item they are of. Split here so the screen does not. */
  unassignedImages: ReferenceImage[];
  /**
   * The Items **this reader** has neither Quoted nor recorded No Supplier Found on.
   *
   * Empty for a reader who owes nothing, for anybody who is not an Assignee on this
   * Tender, and for a Tender whose Bid has gone out — see {@link outstandingFor}.
   */
  outstandingForYou: OutstandingItem[];
};

/**
 * Screen 5, in the two shapes it has — **and they are shapes, not permissions**.
 *
 * ADR-0020: on a Tender they are an Assignee but not the Owner of, a user sees their own
 * Quotes and no money at all. The rule is expressed here, once, by the loader answering a
 * different shape rather than the same shape with parts of it flagged. There is no
 * `canSeeMoney: false` beside a Landed Cost anywhere below, because a flag beside the
 * money is still the money: it reaches the component, it is serialised into the client
 * payload, and it is one forgotten `if` away from being drawn. What is not in the object
 * cannot be rendered by mistake.
 *
 * `screen` is the discriminant that makes the two halves reachable, which is a different
 * thing from a permission field — it is how the page says which screen it is drawing, and
 * TypeScript refuses to let it read `sheet` without asking.
 *
 * **It names the two screens, not two roles.** `CONTEXT.md` fixes **Assignee** as a user
 * working a Tender, and `sourcing` is handed to more people than that: the Assignees it
 * was designed for, a colleague who has not enrolled on this Tender yet, an Org Admin —
 * who gets nothing extra for being one, because the tier here is Owner-versus-
 * everybody-else on *one Tender* and never a rank in the organisation. Calling the shape
 * after a role it does not always describe would be borrowing a glossary word to mean
 * something looser than the glossary means.
 */
export type TenderScreenData =
  | (TenderScreenFacts & {
      screen: "comparison";
      /** The whole Tender's commercial apparatus: every Quote ranked, and the money. */
      sheet: ComparisonSheet;
    })
  | (TenderScreenFacts & {
      screen: "sourcing";
      /** Every Item on the Tender, carrying this reader's own work and nobody else's. */
      items: SourcingItem[];
      /**
       * The photos on this reader's own Quotes, keyed by Quote.
       *
       * Narrowed with the Quotes rather than passed through: these are signed read URLs
       * good for the hour, and a map still keyed by a colleague's Quote would hand one
       * out to somebody the rest of this shape was built to keep it from.
       */
      photos: Map<string, QuotePhoto[]>;
    });

/**
 * One Tender Item as somebody sourcing it sees it: what the client asked for, and what
 * **they themselves** have found so far.
 *
 * Deliberately not a {@link import("@/lib/comparison/sheet").SheetItem} with fields
 * removed. It is a smaller thing with a different job, and writing it out is what makes
 * adding a money column to the sheet a decision about this type rather than a leak into
 * it — `landedCostPerUnit`, `sellingPricePerUnit` and `selectedQuoteId` are absent here
 * because none of them is any of this reader's business, and there is no path by which
 * they arrive anyway.
 *
 * "This reader" and not "this Assignee": whoever is not the Owner gets this, and some of
 * them are Assignees on nothing.
 */
export type SourcingItem = {
  id: string;
  productName: string;
  quantity: number;
  unit: string;
  /** Only the Quotes this reader entered. Another Assignee's never reach this shape. */
  yourQuotes: Quote[];
  /**
   * This reader's own "I could not source this", or null if they have not said it.
   *
   * Their own, and not a count of everybody's — because here a refusal is one line of a
   * per-Item summary of *your* work, and a colleague's belongs in nobody's summary but
   * theirs.
   *
   * **#93 answered the same question the other way, deliberately.** On the item sourcing
   * screen the refusal notes are shown whole, to everybody: that is where they are
   * written, and "I rang everybody I know and none of them stock it" is the most useful
   * sentence on the page for the reader about to ring the same suppliers. A refusal is
   * not a price and there is nothing in one to undercut, so ADR-0020 does not reach it.
   * See `refusals` in `@/lib/quotes/item-sourcing-screen` for the decision in full.
   */
  yourNoSupplierFound: NoSupplierFound | null;
};

/** One Item a reader still owes an answer on, and enough of it to name and link to. */
export type OutstandingItem = { id: string; productName: string };

/**
 * Everything screen 5 draws, read in one round trip's worth of time instead of five.
 *
 * The page awaited six times in a row before it rendered anything — `currentUser`, then
 * `getTender`, then `listMembers`, then `getOrgSettings`, then `listReferenceImages`,
 * then `getComparisonSheet` — each one waiting on the last for no reason but the order
 * they happened to be written in. This is the same fix #57 applied to the item sourcing
 * screen in `loadItemSourcingScreen`; the detail page simply never got it, and it is the
 * slowest screen in the app because of it.
 *
 * **Why every read is in one batch, including the two that look like they cannot be.**
 * `listReferenceImages` and `getComparisonSheet` were written as `tender.id`, which reads
 * like a dependency on `getTender` having returned. It is not one: `tender.id` is the `id`
 * out of the route params, the same string that was just passed *to* `getTender`. So they
 * take `tenderId` directly and start with the others.
 *
 * The cost of that, stated plainly: when the Tender does not exist — a bad link, or
 * another org's id — this does the other four reads anyway rather than bailing after the
 * first. They come back empty through RLS and are thrown away. That is a wasted round trip
 * on the 404 path in exchange for removing four from every single successful load, which
 * is the trade every visit but the mistaken one wants.
 *
 * `currentUser` is deliberately *not* in here. It stays on the page as the gate, and it is
 * free by then: `(app)/layout.tsx` has already asked, and `currentUser` is wrapped in
 * React `cache()`, so the page's call is answered from the request rather than the network.
 * The caller's id arrives as an argument for that reason — the "outstanding for you" band
 * is per-viewer, and asking again in here would undo the arrangement above.
 *
 * **The viewer decides the shape, not the reads** (ADR-0020, #92). The same five queries
 * run for everybody; what changes is what is assembled out of them, and a non-Owner is
 * handed an object with no comparison sheet and no money in it. Reading the sheet and
 * then narrowing it looks wasteful and is the honest arrangement: an Assignee's own
 * Quotes, their own refusals and the "outstanding for you" band are all read out of it,
 * so the alternative is three narrower queries in place of one — more round trips on the
 * slowest screen in the app, to save none.
 *
 * **Not enforced in RLS, deliberately.** Org isolation stays exactly as it is: one policy
 * per table on `current_org_id()`, fail-closed. This is a per-Tender viewer distinction
 * inside a single org, and expressing it as policy would mean an Owner and an Assignee
 * needing different policies on the same rows. The Owner check belongs in the query layer
 * where it already lives — `mayCorrectQuote` is the precedent, and `ownsTender` is now the
 * one sentence both it and this ask.
 *
 * A function rather than the top of the page, for the reason `vitest.config.mts` gives:
 * an `async` Server Component behind `currentUser` is reachable by no test in this repo,
 * so the ordering would otherwise be guarded by nothing at all.
 */
export async function loadTenderScreen(
  tenderId: string,
  callerId: string,
  store: SessionCookieStore,
): Promise<TenderScreenData> {
  const [tender, members, settings, referenceImages, sheet] = await Promise.all([
    getTender(tenderId, store),
    listMembers(store),
    getOrgSettings(store),
    listReferenceImages(tenderId, store),
    getComparisonSheet(tenderId, store),
  ]);

  const facts = {
    tender,
    members,
    // The org's timezone, because `submitted_at` and `outcome_at` are instants and the day
    // they land on is the day it was in Bangkok — never the day it was on a Vercel box.
    timezone: settings.timezone,
    referenceImages,
    unassignedImages: referenceImages.filter((image) => image.tenderItemId === null),
    // A filter over data already in hand, not a sixth read. The sheet carries every
    // Quote's `sourcedByUserId` and every No Supplier Found record's `userId` because the
    // screen already draws both — so who owes what is a question the batch can already
    // answer, and asking the database again would put a round trip back on the slowest
    // screen in the app to learn something it had just been told.
    outstandingForYou: outstandingFor(callerId, tender, sheet),
  };

  // `tender?.ownerUserId ?? null` rather than a separate check for the 404: a Tender
  // nobody can read is nobody's to own, so a bad link and another org's id both fall to
  // the reduced shape. Fail-closed is the right default even on a path where the page is
  // about to call `notFound()` and draw neither.
  if (!ownsTender({ ownerUserId: tender?.ownerUserId ?? null, callerId })) {
    return { ...facts, screen: "sourcing", ...yourWorkOnly(callerId, sheet) };
  }

  return { ...facts, screen: "comparison", sheet };
}

/**
 * The Tender's Items with everything but this reader's own work taken off them.
 *
 * The subtraction is done once, here, over the sheet the batch already read — so there is
 * exactly one place that decides what survives into {@link SourcingItem}, and it is a
 * place a test can call. *Which* Quotes survive is not decided here at all: that is
 * `yourQuotes` in `./viewer`, the one sentence the item sourcing screen asks too. Adding a field to {@link SourcingItem} is an edit to this function; a
 * field added to the sheet reaches nobody until somebody edits it.
 */
function yourWorkOnly(
  callerId: string,
  sheet: ComparisonSheet,
): { items: SourcingItem[]; photos: Map<string, QuotePhoto[]> } {
  const items = sheet.items.map((item) => ({
    id: item.id,
    productName: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    yourQuotes: yourQuotes(item.quotes, callerId),
    yourNoSupplierFound:
      item.sourcing.noSupplierFound.find((refusal) => refusal.userId === callerId) ??
      null,
  }));

  const yours = new Set(items.flatMap((item) => item.yourQuotes.map((quote) => quote.id)));

  return {
    items,
    photos: new Map(
      [...sheet.photos].filter(([quoteId]) => yours.has(quoteId)),
    ),
  };
}

/**
 * What one reader still owes on this Tender.
 *
 * An Assignee who is nagged, taps the Group Robot link and arrives here was shown the
 * Owner's price-comparison sheet with no statement anywhere of what **they personally**
 * had to do. This is that statement, and it is deliberately *personal*: an Owner who is
 * also an Assignee sees what they owe, never what the team owes. A band that reported the
 * team's outstanding work would be a status report, and it would never be empty, which is
 * what makes it mean something when it is there.
 *
 * **No Supplier Found counts as an answer, not a gap.** "Nobody could supply this" and
 * "nobody tried" mean opposite things — only one of them is worth chasing somebody about,
 * and treating the first as the second is how a team learns to ignore the nag.
 *
 * **Somebody who is not an Assignee owes nothing**, and gets no band. Under ADR-0004 only
 * an Assignee may enter a Quote and Assignees enrol themselves, so every Item would
 * otherwise read as outstanding for an Owner who never took one on — nagging them about
 * work they cannot do, with links to a screen that would refuse them.
 *
 * **Nothing is owed on work that is over**, which is two conditions and not one:
 *
 * 1. **The Bid has gone out.** Sourcing a price for a Tender already with the client
 *    changes nothing, so a submitted Tender owes nobody anything — the same reading
 *    ADR-0005 takes when it stops nagging one, and the same one `worklistGroup` takes when
 *    it refuses to call a submitted Tender "coming up".
 * 2. **The Item has an Outcome.** An Item marked `no_bid` is one somebody decided not to
 *    price; `won`, `lost` and `cancelled` are all likewise finished. Naming any of them
 *    would link an Assignee to a sourcing screen for work that will never be done.
 *
 * Both are what keeps the band's *emptiness* meaningful, which is the whole of why it is
 * personal: a band that outlived the work it described would be back to being a status
 * report, and one that nagged forever about a Tender lost in March would be worse.
 */
function outstandingFor(
  callerId: string,
  tender: Tender | null,
  sheet: ComparisonSheet,
): OutstandingItem[] {
  if (tender === null) return [];
  if (tender.submittedAt !== null) return [];
  if (!tender.assignees.some((assignee) => assignee.id === callerId)) return [];

  // The Outcome is on the Tender's Items and the sourcing is on the sheet's, so the two
  // are matched by id rather than one being read off the other. Both are already in hand.
  const decided = new Set(
    tender.items.filter((item) => item.outcome !== null).map((item) => item.id),
  );

  return sheet.items
    .filter(
      (item) =>
        !decided.has(item.id) &&
        !item.quotes.some((quote) => quote.sourcedByUserId === callerId) &&
        !item.sourcing.noSupplierFound.some((refusal) => refusal.userId === callerId),
    )
    .map((item) => ({ id: item.id, productName: item.productName }));
}
