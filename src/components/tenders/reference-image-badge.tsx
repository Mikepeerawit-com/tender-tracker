"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ReferenceImageLightbox } from "@/components/tenders/reference-image-lightbox";
import type { ReferenceImage } from "@/lib/images/reference-images";

/**
 * A count, not a thumbnail strip.
 *
 * This is the Tender detail screen's shape, and buildspec_2.md screen 5 is explicit about
 * it: "Photos are a count badge (`📷 3`) opening a lightbox, never thumbnails. Thumbnail
 * strips ate the horizontal room the numbers needed." That screen is the comparison
 * working sheet — the densest in v1, one row per Tender Item with six columns of money on
 * it — and a grid of pictures on each row is the thing that was measured taking the room
 * those columns need.
 *
 * The edit screen goes the other way and shows the pictures, because assigning one to an
 * Item means looking at it. Same lightbox underneath; the difference is which screen is
 * asking, not which component knows how to open one.
 */
export function ReferenceImageBadge({
  label,
  images,
}: {
  /** What this handful of pictures is of — a Tender Item, or the Unassigned set. */
  label: string;
  images: ReferenceImage[];
}) {
  const t = useTranslations("tenders.referenceImages");
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <button
        type="button"
        aria-label={t("openCount", { label, count: images.length })}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 border-border inline-flex h-11 w-fit items-center gap-1.5 rounded-lg border px-2.5 text-sm focus-visible:ring-3 focus-visible:outline-none"
        onClick={() => setOpenAt(0)}
      >
        <ImageIcon className="size-4" aria-hidden />
        {images.length}
      </button>

      {openAt === null ? null : (
        <ReferenceImageLightbox
          images={images}
          at={openAt}
          onMove={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}
