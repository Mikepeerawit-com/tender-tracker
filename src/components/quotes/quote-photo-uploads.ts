"use client";

import {
  recordQuotePhotosAction,
  signQuotePhotoUploadsAction,
} from "@/app/actions/quote-photos";
import type { ImageDestination } from "@/components/images/use-image-upload";
import type { PendingImage } from "@/lib/images/images";

/**
 * Where one Quote's photos are signed and recorded.
 *
 * Both entry points need exactly this pair — the row of a Quote recorded last week, and
 * the create form a beat after it wrote one — and they differ only in when they can name
 * the id. Written out twice, the pair would be two places to update when either action's
 * arguments move, and the half that was missed would be the one nobody had a picture
 * from.
 *
 * A client module rather than a helper in `@/lib/images/quote-photos`: that one is
 * `server-only`, and this is the browser's half of the same round trip.
 */
export function quotePhotoDestination({
  quoteId,
  tenderId,
}: {
  quoteId: string;
  /** Only the revalidation needs it: photos are counted on screens above this one. */
  tenderId: string;
}): ImageDestination {
  return {
    sign: (images: PendingImage[]) => signQuotePhotoUploadsAction({ quoteId, images }),
    record: (storagePaths: string[]) =>
      recordQuotePhotosAction({ quoteId, storagePaths, tenderId }),
  };
}
