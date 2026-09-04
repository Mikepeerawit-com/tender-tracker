"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  removeQuotePhotoAction,
  type QuotePhotoFormState,
} from "@/app/actions/quote-photos";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { ImageProblemNotice } from "@/components/images/image-problem-notice";
import { useImageUpload } from "@/components/images/use-image-upload";
import { QuotePhotoPicker } from "@/components/quotes/quote-photo-picker";
import { quotePhotoDestination } from "@/components/quotes/quote-photo-uploads";
import { Button } from "@/components/ui/button";
import type { QuotePhoto } from "@/lib/images/quote-photos";

/**
 * The supplier's own pictures, on the Quote they belong to.
 *
 * Load-bearing rather than decorative: on an Alternative these are often the only way to
 * judge how far the substitute really is from what the client asked for.
 *
 * ## This is the *afterwards* path, and it is not a workaround
 *
 * Photos are also picked on the create-a-Quote form now, in the same pass as the price
 * (#60), which is the path the phone case wanted. This one stays because photos genuinely
 * do arrive later: by email, from a supplier who rang back, from a colleague who took
 * them. Both entry points are permanent, and both draw the same {@link QuotePhotoPicker}
 * — the camera hint and the visible library fallback are required in both places for the
 * reason that component gives.
 *
 * What only exists here is everything about photos that are already stored: the count
 * badge, the thumbnails, and the way to take one back off.
 */
export function QuotePhotoControls({
  tenderId,
  quoteId,
  photos,
}: {
  tenderId: string;
  quoteId: string;
  photos: QuotePhoto[];
}) {
  const t = useTranslations("quotes.photos");
  const shared = useTranslations("images");
  const { error, progress, busy, upload } = useImageUpload();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ImageCountBadge
          openLabel={t("openCount", { count: photos.length })}
          images={photos}
        />

        <QuotePhotoPicker
          disabled={busy}
          onPicked={(files) =>
            upload(files, quotePhotoDestination({ quoteId, tenderId }))
          }
        />
      </div>

      {progress ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("uploading", { done: progress.done, total: progress.total })}
        </p>
      ) : null}

      <ImageProblemNotice error={error ?? undefined} />

      {/* Thumbnails here and a count badge on the comparison sheet, which is not a
          contradiction: screen 5 rejected strips because they ate the room the money
          columns need, and this is the sourcing screen, where the only way to know which
          photo to remove is to look at it. Same argument as the Reference Image gallery. */}
      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-col gap-1">
              <div className="border-border bg-muted flex aspect-square items-center justify-center overflow-hidden rounded-lg border">
                {photo.url === "" ? (
                  <span className="text-muted-foreground p-2 text-center text-xs">
                    {shared("unavailable")}
                  </span>
                ) : (
                  /* A plain `img`, not `next/image`: the source is a signed URL that
                     expires, and there are no generated derivatives, so there is nothing
                     for an optimiser to do but proxy bytes it must not cache. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photo.url}
                    alt={t("alt", { position: index + 1 })}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}
              </div>

              <RemovePhotoForm
                tenderId={tenderId}
                photoId={photo.id}
                position={index + 1}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const initialState: QuotePhotoFormState = {};

/**
 * Taking one photo back off a Quote.
 *
 * A supplier photo is the attachment most likely to be taken with the wrong thing in
 * frame — on a phone, in a hurry, mid-call — so it has to come off again. The visible
 * label stays short beside a thumbnail; the accessible name carries the position, so a
 * screen reader hears four distinct buttons rather than "Remove" four times.
 */
function RemovePhotoForm({
  tenderId,
  photoId,
  position,
}: {
  tenderId: string;
  photoId: string;
  /** Its place in the grid, so several remove buttons are not the same button. */
  position: number;
}) {
  const t = useTranslations("quotes.photos");
  const [state, formAction, isPending] = useActionState(
    removeQuotePhotoAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="photoId" value={photoId} />

      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="h-11"
        disabled={isPending}
        aria-label={t("removeNumbered", { position })}
      >
        {t("remove")}
      </Button>

      <ImageProblemNotice error={state.error} />
    </form>
  );
}
