"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

import { ImageLightbox, type ViewableImage } from "@/components/images/image-lightbox";

/**
 * A count, not a thumbnail strip.
 *
 * buildspec_2.md screen 5 is explicit: "Photos are a count badge (`📷 3`) opening a
 * lightbox, never thumbnails. Thumbnail strips ate the horizontal room the numbers
 * needed." That screen is the comparison working sheet — the densest in v1, one row per
 * Tender Item with six columns of money on it — and a grid of pictures on each row is the
 * thing that was measured taking the room those columns need. It holds for Reference
 * Images and Quote Photos alike, which sit beside each other on the same Item.
 *
 * The edit screen goes the other way and shows the pictures, because assigning one to an
 * Item means looking at it. Same lightbox underneath; the difference is which screen is
 * asking, not which component knows how to open one.
 *
 * `openLabel` is passed in already translated rather than composed here, because "open 3
 * reference images" and "open 3 supplier photos" are different sentences about pictures
 * that are otherwise identical.
 */
export function ImageCountBadge({
  openLabel,
  images,
}: {
  openLabel: string;
  images: ViewableImage[];
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <button
        type="button"
        aria-label={openLabel}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring border-border inline-flex h-11 w-fit items-center gap-1.5 rounded-lg border px-2.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
        onClick={() => setOpenAt(0)}
      >
        <ImageIcon className="size-4" aria-hidden />
        {images.length}
      </button>

      {openAt === null ? null : (
        <ImageLightbox
          images={images}
          at={openAt}
          onMove={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}
