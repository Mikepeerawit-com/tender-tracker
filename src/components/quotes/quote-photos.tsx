"use client";

import { useActionState, useRef } from "react";
import { Camera, Images } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  recordQuotePhotosAction,
  removeQuotePhotoAction,
  signQuotePhotoUploadsAction,
  type QuotePhotoFormState,
} from "@/app/actions/quote-photos";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { ImageProblemNotice } from "@/components/images/image-problem-notice";
import { useImageUpload } from "@/components/images/use-image-upload";
import { Button } from "@/components/ui/button";
import { photoAccept } from "@/lib/images/images";
import type { QuotePhoto } from "@/lib/images/quote-photos";

/**
 * The supplier's own pictures, on the Quote they belong to.
 *
 * Load-bearing rather than decorative: on an Alternative these are often the only way to
 * judge how far the substitute really is from what the client asked for.
 *
 * ## Two inputs, and the second one is required
 *
 * The camera input carries `accept="image/*" capture`, because on a phone the gesture
 * here is *take one now* — the supplier is on the line or has just rung off. But
 * **`capture` is a hint, not a guarantee** (buildspec_2.md A4): the WeCom webview was
 * measured opening the camera straight away on an iPhone, Android was never measured at
 * all, and the research on Android WebView is bad enough that a camera hint is the
 * sharper risk of the two. So the library picker sits beside it, visible, always, rather
 * than as something to find when the first button does nothing.
 *
 * The picker is also the honest control for the common desktop case, where a supplier
 * emailed a photograph and somebody is entering the Quote at a desk.
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
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const { error, progress, busy, upload } = useImageUpload({
    sign: (images) => signQuotePhotoUploadsAction({ quoteId, images }),
    record: (storagePaths) =>
      recordQuotePhotosAction({ quoteId, storagePaths, tenderId }),
  });

  async function onPicked(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];

    if (files.length === 0) return;

    try {
      await upload(files);
    } finally {
      // Cleared however it ended: the input keeps its old FileList otherwise, so
      // re-taking the same photo fires no `change` event and the retry looks like a hang.
      input.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ImageCountBadge
          openLabel={t("openCount", { count: photos.length })}
          images={photos}
        />

        {/* Both inputs are off-screen and driven by their buttons, because a bare file
            input cannot be given a label a thumb can find. Neither is *hidden* in the
            sense that matters: both buttons are visible, side by side, always. */}
        <input
          ref={camera}
          type="file"
          accept={photoAccept}
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => void onPicked(event.currentTarget)}
        />
        <input
          ref={library}
          type="file"
          multiple
          accept={photoAccept}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => void onPicked(event.currentTarget)}
        />

        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={() => camera.current?.click()}
        >
          <Camera className="size-4" aria-hidden />
          {t("take")}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={() => library.current?.click()}
        >
          <Images className="size-4" aria-hidden />
          {t("choose")}
        </Button>
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
        disabled={isPending}
        aria-label={t("removeNumbered", { position })}
      >
        {t("remove")}
      </Button>

      <ImageProblemNotice error={state.error} />
    </form>
  );
}
