import "server-only";

import { listQuotePhotosByQuote, type QuotePhoto } from "@/lib/images/quote-photos";
import { listReferenceImages, type ReferenceImage } from "@/lib/images/reference-images";
import { listMembers, type Member } from "@/lib/org/members";
import { getOrgSettings } from "@/lib/org/org";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

import { listItemSourcing, listQuotes, type NoSupplierFound, type Quote } from "./quotes";

/** Everything the item sourcing screen draws, once the Tender and the Item are known. */
export type ItemSourcingScreen = {
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
  /** Everyone who can still be given work, for the enrol-yourself control. */
  members: Member[];
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
 * **Why `listMembers` is unconditional.** The page awaited it *inside JSX*, on the branch
 * that draws the enrol-yourself control, so it did not begin until React rendered that
 * far down — later than serial. Reading it here costs an Assignee, who never sees that
 * control, one extra query; it costs them no extra time, because it runs alongside four
 * reads the screen always needs. The alternative is a flag threaded through this
 * signature to save a small query on the org's own `users` table, which is a worse trade
 * than the query.
 *
 * It is a function rather than the top of the page for the reason `vitest.config.ts`
 * gives: an `async` Server Component behind `currentUser` is reachable by no test in this
 * repo, so the ordering above would be guarded by nothing at all.
 */
export async function loadItemSourcingScreen(
  { tenderId, tenderItemId }: { tenderId: string; tenderItemId: string },
  store: SessionCookieStore,
): Promise<ItemSourcingScreen> {
  const [quotes, sourcing, referenceImages, settings, members] = await Promise.all([
    listQuotes(tenderItemId, store),
    listItemSourcing(tenderId, store),
    listReferenceImages(tenderId, store),
    getOrgSettings(store),
    listMembers(store),
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
  };
}
