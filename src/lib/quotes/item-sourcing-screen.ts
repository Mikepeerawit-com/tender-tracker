import "server-only";

import { listQuotePhotosByQuote, type QuotePhoto } from "@/lib/images/quote-photos";
import { listReferenceImages, type ReferenceImage } from "@/lib/images/reference-images";
import { listMembers, type Member } from "@/lib/org/members";
import { getOrgSettings } from "@/lib/org/org";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

import { listItemSourcing, listQuotes, type NoSupplierFound, type Quote } from "./quotes";

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
  /** Every Quote on the Item, in entry order — unranked, as `listQuotes` leaves them. */
  quotes: Quote[];
  /** Those Quotes' photos, keyed by Quote. A Quote with none is absent, not empty. */
  photos: Map<string, QuotePhoto[]>;
  /** Who said they could not source *this* Item, and why. */
  refusals: NoSupplierFound[];
  /** The client's own pictures, narrowed to this Item. */
  referenceImages: ReferenceImage[];
  /** The org's timezone, which is where the screen's idea of "today" comes from. */
  timezone: string;
  /**
   * The Item's Selected Quote, or null when nobody has chosen one.
   *
   * Read here rather than derived from `quotes`, because it is a fact about the *Item* —
   * a Quote does not know it was picked. The screen needs it for one thing only: deleting
   * the Selected Quote clears the selection, and the row that offers that delete is the
   * only place able to say so before it happens.
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
 */
export async function loadItemSourcingScreen(
  {
    tenderId,
    tenderItemId,
    withMembers,
  }: {
    tenderId: string;
    tenderItemId: string;
    /** Whether the screen will draw the enrol-yourself control, which is the only thing
     * the org's members are read for. */
    withMembers: boolean;
  },
  store: SessionCookieStore,
): Promise<ItemSourcingScreenData> {
  const [quotes, sourcing, referenceImages, settings, members, selection] =
    await Promise.all([
      listQuotes(tenderItemId, store),
      listItemSourcing(tenderId, store),
      listReferenceImages(tenderId, store),
      getOrgSettings(store),
      // In the batch rather than after it: when it is wanted it starts with the others, and
      // when it is not there is no round trip to start.
      withMembers ? listMembers(store) : null,
      createSessionClient(store)
        .from("tender_items")
        .select("selected_quote_id")
        .eq("id", tenderItemId)
        .maybeSingle(),
    ]);

  const photos = await listQuotePhotosByQuote(
    quotes.map((quote) => quote.id),
    store,
  );

  return {
    quotes,
    photos,
    refusals: sourcing.get(tenderItemId)?.noSupplierFound ?? [],
    referenceImages: referenceImages.filter(
      (image) => image.tenderItemId === tenderItemId,
    ),
    timezone: settings.timezone,
    members,
    selectedQuoteId: selection.data?.selected_quote_id ?? null,
  };
}
