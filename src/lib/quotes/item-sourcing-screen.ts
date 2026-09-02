import "server-only";

import { listQuotePhotosByQuote, type QuotePhoto } from "@/lib/images/quote-photos";
import { listReferenceImages, type ReferenceImage } from "@/lib/images/reference-images";
import { listMembers, type Member } from "@/lib/org/members";
import { getOrgSettings } from "@/lib/org/org";
import type { SessionCookieStore } from "@/lib/supabase/session-client";
import { ownsTender, yourQuotes } from "@/lib/tenders/viewer";

import {
  listItemSourcing,
  listQuotes,
  selectedQuoteId,
  type NoSupplierFound,
  type Quote,
} from "./quotes";

/**
 * Everything the item sourcing screen draws, once the Tender and the Item are known.
 *
 * `…Data` rather than `ItemSourcingScreen`, for two collisions it would otherwise walk
 * into: `Screen…` names a component everywhere else in this codebase (`ScreenHeader`,
 * `ScreenSkeleton`, `ScreenError`), and `ItemSourcing` next door in `quotes.ts` is a
 * narrower thing entirely — what is known about one Item's sourcing, not what the screen
 * about it renders.
 */
export type ItemSourcingScreenData = {
  /**
   * The Quotes on the Item **this reader may see**, in entry order — unranked, as
   * `listQuotes` leaves them.
   *
   * Every one of them for the Owner; for everybody else, their own and no others
   * (ADR-0020, #93). The same field either way, because a non-Owner is not being shown a
   * different kind of thing — they are shown less of it, and a discriminant here would be
   * a union of two identical shapes.
   */
  quotes: Quote[];
  /**
   * Whether `quotes` is this reader's own work rather than the Item's whole record.
   *
   * The loader's answer to who asked, handed back so that the screen's words and its list
   * cannot disagree. It is emphatically **not** a flag beside hidden data — there is no
   * rival's price behind it to be drawn by a forgotten `if`, because there is no rival's
   * price in this object at all. It exists because a heading reading "3 quotes recorded"
   * over a list holding two of them would be the screen asserting something about the
   * Item that ADR-0020 has just decided this reader does not get told.
   */
  yourQuotesOnly: boolean;
  /** Those Quotes' photos, keyed by Quote. A Quote with none is absent, not empty. */
  photos: Map<string, QuotePhoto[]>;
  /**
   * Who said they could not source *this* Item, and why — **everybody's, whoever is
   * reading**. The one thing on this screen ADR-0020 does not narrow, and that is a
   * decision rather than an oversight.
   *
   * A refusal is not a price. What ADR-0020 protects is a rival's commercial position:
   * the reason an Assignee may not read a colleague's Quote is that knowing they were
   * undercut by 4% is a thing to act on. "I rang everybody I know and none of them stock
   * it" states no position, leaves nothing to undercut, and is the most useful sentence
   * on this screen for the person about to ring the same suppliers. Hiding it would buy
   * no confidentiality at all and cost the team duplicated calls.
   *
   * It is also what the screen was already built to say. `NoSupplierFoundForm` is per
   * Assignee and never per Item — Assignees compete rather than divide (ADR-0004), so one
   * of them failing says nothing about whether the Item can be sourced — and it already
   * draws other people's records "as fact rather than as something to act on". That is
   * exactly the reading taken here.
   *
   * **The cost, stated.** The note is free text, so somebody may one day type a number
   * into it ("supplier wanted 300, way over"). Accepted: it is written by an Assignee who
   * knows their colleagues read it, it is not a Quote on this Item, and blanking the
   * field on the chance that it holds a price would take the screen's most useful signal
   * away for a guess.
   *
   * **This is why the Tender detail differs**, and it is not an inconsistency. Screen 5
   * hands a non-Owner only their own refusal, because there it is one line of a per-Item
   * summary of *your* work. Here it is the Item's sourcing notes, on the screen where
   * those notes are written and where the next call is about to be made.
   */
  refusals: NoSupplierFound[];
  /** The client's own pictures, narrowed to this Item. */
  referenceImages: ReferenceImage[];
  /** The org's timezone, which is where the screen's idea of "today" comes from. */
  timezone: string;
  /**
   * The Item's Selected Quote, or null when nobody has chosen one **or when the one
   * chosen is not among the Quotes above**.
   *
   * Read rather than derived from `quotes`, because it is a fact about the *Item* — a
   * Quote does not know it was picked. The screen needs it for one thing only: deleting
   * the Selected Quote clears the selection, and the row that offers that delete is the
   * only place able to say so before it happens.
   *
   * Which is why it is dropped when it names a Quote this reader was not handed: an id
   * pointing into a list it is not in is a dangling reference, and the row it was for is
   * not on the screen to warn anybody. The reader whose own Quote was picked keeps it,
   * and keeps the warning. Unchanged for the Owner, who has every Quote.
   */
  selectedQuoteId: string | null;
  /**
   * Everyone who can still be given work, for the enrol-yourself control.
   *
   * `null` when the caller said the screen would not draw that control, which is not the
   * same answer as `[]` and must not be flattened into it: an empty array is an org whose
   * every member is already an Assignee, and this is an org nobody asked about.
   */
  members: Member[] | null;
};

/**
 * The item sourcing screen's reads, issued together where they can be.
 *
 * The page did all of this inline and awaited eight times in a row, each one a separate
 * trip to Supabase (#57). On office wifi that is invisible; inside the WeCom webview on
 * mobile data, which is where this screen is actually used, it is eight round-trips
 * stacked end to end before anything paints.
 *
 * **The one read that cannot join the batch.** `listQuotePhotosByQuote` takes the ids of
 * the Quotes that came back, so it is a second stage rather than a sixth member of the
 * first. Folding it in would hand it an empty list, and it answers an empty list with an
 * empty map — no error, no throw, just every Quote on the screen rendered with no photos.
 * That is the failure this function exists as a named, tested unit to prevent, and
 * `item-sourcing-screen.test.ts` pins it.
 *
 * **`withMembers`, and why it is a flag rather than always-on.** The page awaited
 * `listMembers` *inside JSX*, on the branch that draws the enrol-yourself control, so it
 * did not begin until React rendered that far down — later than serial. Hoisting it here
 * fixes that, but hoisting it *unconditionally* would read the org's members on every
 * visit, including the one this screen exists for: an Assignee entering price after price
 * off a run of supplier calls, who never sees that control at all. The flag keeps both —
 * the read starts with the others when it is wanted, and does not happen when it is not.
 *
 * The caller already knows the answer. Whether the control renders is exactly
 * `!isAssignee`, computed on the page before this is called, so nothing is being worked
 * out twice.
 *
 * It is a function rather than the top of the page for the reason `vitest.config.mts`
 * gives: an `async` Server Component behind `currentUser` is reachable by no test in this
 * repo, so the ordering above would be guarded by nothing at all.
 *
 * **The viewer decides what survives the reads** (ADR-0020, #93). #92 closed the
 * comparison sheet on the Tender detail; this screen is one tap further in and had the
 * same leak in the worse place, because an Assignee with a price to enter opens it
 * several times per Item and read their rivals' suppliers and prices on every visit. The
 * same queries run for everybody — `listQuotes` cannot be narrowed by RLS without an
 * Owner and an Assignee needing different policies on the same rows — and the subtraction
 * happens here, through the one predicate #92 introduced rather than a second copy of it.
 *
 * **It happens before the photos read, not after.** Narrowing first means the ids handed
 * to `listQuotePhotosByQuote` are only this reader's, so no signed read URL is ever
 * minted for a picture of a rival's price list. Filtering the map afterwards would have
 * produced the same object having already asked Storage to hand those URLs out.
 */
export async function loadItemSourcingScreen(
  {
    tenderId,
    tenderItemId,
    withMembers,
    ownerUserId,
    callerId,
  }: {
    tenderId: string;
    tenderItemId: string;
    /** Whether the screen will draw the enrol-yourself control, which is the only thing
     * the org's members are read for. */
    withMembers: boolean;
    /**
     * The Owner of the Tender this Item is on, as the page already read it.
     *
     * Passed in rather than read again: the page has the Tender in hand — it needs it to
     * find the Item at all — and asking for it a second time here would put a round trip
     * back on the screen this function exists to take them off.
     */
    ownerUserId: string | null;
    /** Who is reading. Never a role — see `ownsTender`. */
    callerId: string;
  },
  store: SessionCookieStore,
): Promise<ItemSourcingScreenData> {
  const [everyQuote, sourcing, referenceImages, settings, members, selected] =
    await Promise.all([
      listQuotes(tenderItemId, store),
      listItemSourcing(tenderId, store),
      listReferenceImages(tenderId, store),
      getOrgSettings(store),
      // In the batch rather than after it: when it is wanted it starts with the others, and
      // when it is not there is no round trip to start.
      withMembers ? listMembers(store) : null,
      selectedQuoteId(tenderItemId, store),
    ]);

  // Fail-closed, and `ownsTender` is what makes it so: a Tender that could not be read is
  // nobody's to own, so a caller who arrived with nothing is handed the reduced list.
  const yourQuotesOnly = !ownsTender({ ownerUserId, callerId });
  const quotes = yourQuotesOnly ? yourQuotes(everyQuote, callerId) : everyQuote;

  const photos = await listQuotePhotosByQuote(
    quotes.map((quote) => quote.id),
    store,
  );

  return {
    quotes,
    yourQuotesOnly,
    photos,
    refusals: sourcing.get(tenderItemId)?.noSupplierFound ?? [],
    referenceImages: referenceImages.filter(
      (image) => image.tenderItemId === tenderItemId,
    ),
    timezone: settings.timezone,
    members,
    // Kept only when it names a Quote in the list above, which for the Owner is always: a
    // Quote can only be selected on the Item it belongs to, so every Selected Quote is
    // one `listQuotes` returned. It is the reader who has just lost the others that this
    // drops it for.
    selectedQuoteId:
      selected !== null && quotes.some((quote) => quote.id === selected)
        ? selected
        : null,
  };
}
