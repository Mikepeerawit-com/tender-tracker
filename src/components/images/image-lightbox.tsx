"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * One picture, at the size of the screen.
 *
 * Shared by Reference Images and Quote Photos, and typed on what a lightbox actually
 * needs rather than on either of them: a signed URL and whose picture it is. Nothing here
 * can tell a client's picture of what they asked for from a supplier's picture of what
 * they can supply, and nothing here should — they are the same photograph opened the same
 * way, and the comparison view puts them side by side on purpose.
 *
 * Its own file because no screen owns it: the Tender detail screen reaches it from a
 * count badge, the edit screen from a thumbnail, the Item's sourcing screen from a Quote,
 * and there is exactly one full-size fetch either way — there are no generated
 * derivatives, so what opens here is the same object a thumbnail would have loaded.
 *
 * A positioned overlay rather than `<dialog>`: this is opened almost entirely inside the
 * WeCom in-app webview, and a plain fixed element with its own Escape handler has no
 * support question attached to it. Paging has tap targets as well as keys, because on the
 * phone there is no keyboard to page with.
 */

/** What a lightbox needs of a picture, and no more. */
export type ViewableImage = {
  /** A signed URL, or "" when Storage would not sign one. */
  url: string;
  uploadedByName: string;
};

export function ImageLightbox({
  images,
  at,
  onMove,
  onClose,
}: {
  images: ViewableImage[];
  at: number;
  onMove: (at: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("images");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onMove(Math.min(at + 1, images.length - 1));
      if (event.key === "ArrowLeft") onMove(Math.max(at - 1, 0));
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [at, images.length, onMove, onClose]);

  const image = images[at];

  // The set can shrink under an open lightbox — a colleague removing a picture, or a
  // revalidation landing — and there is nothing left to show when it empties.
  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("viewing", { position: at + 1, total: images.length })}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
    >
      <div className="flex items-center justify-between gap-3 text-white">
        <span className="text-sm">
          {t("viewing", { position: at + 1, total: images.length })}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-white hover:bg-white/15 hover:text-white"
          onClick={onClose}
        >
          {t("close")}
        </Button>
      </div>

      {image.url === "" ? (
        <p className="flex min-h-0 flex-1 items-center justify-center text-sm text-white">
          {t("unavailable")}
        </p>
      ) : (
        /* Tapping the picture closes, the way every other viewer on a phone behaves. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={image.url}
          alt={t("altUploaded", { name: image.uploadedByName })}
          className="min-h-0 flex-1 object-contain"
          onClick={onClose}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-white hover:bg-white/15 hover:text-white"
          disabled={at === 0}
          onClick={() => onMove(at - 1)}
        >
          {t("previous")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 text-white hover:bg-white/15 hover:text-white"
          disabled={at === images.length - 1}
          onClick={() => onMove(at + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
