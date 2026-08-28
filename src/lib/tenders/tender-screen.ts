import "server-only";

import { getComparisonSheet, type ComparisonSheet } from "@/lib/comparison/sheet";
import { listReferenceImages, type ReferenceImage } from "@/lib/images/reference-images";
import { listMembers, type Member } from "@/lib/org/members";
import { getOrgSettings } from "@/lib/org/org";
import type { SessionCookieStore } from "@/lib/supabase/session-client";
import { getTender, type Tender } from "@/lib/tenders/tenders";

export type TenderScreenData = {
  /** Null when there is no such Tender *for this caller* — see the note below. */
  tender: Tender | null;
  members: Member[];
  timezone: string;
  referenceImages: ReferenceImage[];
  /** The ones nobody has said which Item they are of. Split here so the screen does not. */
  unassignedImages: ReferenceImage[];
  sheet: ComparisonSheet;
};

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
 *
 * A function rather than the top of the page, for the reason `vitest.config.mts` gives:
 * an `async` Server Component behind `currentUser` is reachable by no test in this repo,
 * so the ordering would otherwise be guarded by nothing at all.
 */
export async function loadTenderScreen(
  tenderId: string,
  store: SessionCookieStore,
): Promise<TenderScreenData> {
  const [tender, members, settings, referenceImages, sheet] = await Promise.all([
    getTender(tenderId, store),
    listMembers(store),
    getOrgSettings(store),
    listReferenceImages(tenderId, store),
    getComparisonSheet(tenderId, store),
  ]);

  return {
    tender,
    members,
    // The org's timezone, because `submitted_at` and `outcome_at` are instants and the day
    // they land on is the day it was in Bangkok — never the day it was on a Vercel box.
    timezone: settings.timezone,
    referenceImages,
    unassignedImages: referenceImages.filter((image) => image.tenderItemId === null),
    sheet,
  };
}
