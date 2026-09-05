"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import {
  assignReferenceImageAction,
  removeReferenceImageAction,
  type ReferenceImageFormState,
} from "@/app/actions/reference-images";
import { ImageLightbox } from "@/components/images/image-lightbox";
import { ImageProblemNotice } from "@/components/images/image-problem-notice";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { ReferenceImage } from "@/lib/images/reference-images";

/**
 * The client's pictures on the edit screen, grouped by the Item each is of, with a picker
 * on every one.
 *
 * Unassigned first, deliberately. That is the state every picture arrives in — five in one
 * email, none of them labelled — so it is the group with work outstanding in it, and
 * listing the placed ones first would bury the five that just landed under the ones
 * already dealt with.
 *
 * The pictures are shown here rather than counted, which is the opposite of the Tender
 * detail screen (see `image-count-badge.tsx`). Assigning needs *seeing*: nobody can
 * say which Item a picture is of from a filename. There are no generated derivatives to
 * show instead, so each tile loads the full compressed upload — hence `loading="lazy"` on
 * every one of them, and hence tapping one being what opens it at size rather than a
 * second, larger fetch happening up front.
 */

const initialState: ReferenceImageFormState = {};

/** A Tender Item, as the picker offers it. */
export type ItemOption = { id: string; productName: string };

export function ReferenceImageGallery({
  tenderId,
  images,
  items,
}: {
  tenderId: string;
  images: ReferenceImage[];
  items: ItemOption[];
}) {
  const t = useTranslations("tenders.referenceImages");
  // The wording shared with Quote Photos: what a lightbox says, and what a picture that
  // will not load says.
  const shared = useTranslations("images");
  const [openAt, setOpenAt] = useState<number | null>(null);

  const groups = [
    { key: "unassigned", label: t("unassigned"), of: null as string | null },
    ...items.map((item) => ({ key: item.id, label: item.productName, of: item.id })),
  ]
    .map((group) => ({
      ...group,
      images: images.filter((image) => image.tenderItemId === group.of),
    }))
    .filter((group) => group.images.length > 0);

  // The lightbox walks the pictures in the order they are on screen, not the order they
  // were uploaded in — arrow-right has to go to the one on the right.
  const ordered = groups.flatMap((group) => group.images);

  if (images.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("none")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          {/* `min-w-0 break-words`, the way every other client-supplied string in the app
              carries it (#56, and the note in `my-work-list.tsx`). The label is a product
              name — whatever the client called it — and a run with nothing in it to break
              at pushes this heading past the column and takes the page sideways with it.
              It was drawn on no measured screen until #143 put the edit screen into
              `@/test/screens`, and it went red on the runner rather than locally: the
              harness resolves no Latin webfont, so the same string is narrower here than
              a reader ever sees it. */}
          <h3 className="text-muted-foreground min-w-0 text-xs font-medium break-words">
            {group.label}
          </h3>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {group.images.map((image) => (
              <li key={image.id} className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="focus-visible:ring-ring border-border bg-muted flex aspect-square items-center justify-center overflow-hidden rounded-lg border focus-visible:ring-3 focus-visible:outline-none"
                  onClick={() => setOpenAt(ordered.indexOf(image))}
                >
                  {image.url === "" ? (
                    // Storage would not sign a read: the object behind this row has gone.
                    // Said out loud, because the alternative is a picture that quietly
                    // disappears off the Tender and cannot be removed.
                    <span className="text-muted-foreground p-2 text-center text-xs">
                      {shared("unavailable")}
                    </span>
                  ) : (
                    /* A plain `img`, not `next/image`: the source is a signed URL that
                       expires, and the ticket rules out generated derivatives, so there
                       is nothing for an optimiser to do but proxy bytes it must not
                       cache. */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={image.url}
                      alt={t("altOf", { label: group.label })}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  )}
                </button>

                <AssignForm tenderId={tenderId} image={image} items={items} />
                <RemoveForm tenderId={tenderId} imageId={image.id} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {openAt === null ? null : (
        <ImageLightbox
          images={ordered}
          at={openAt}
          onMove={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}

function AssignForm({
  tenderId,
  image,
  items,
}: {
  tenderId: string;
  image: ReferenceImage;
  items: ItemOption[];
}) {
  const t = useTranslations("tenders.referenceImages");
  const [state, formAction, isPending] = useActionState(
    assignReferenceImageAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="imageId" value={image.id} />

      <NativeSelect
        name="tenderItemId"
        aria-label={t("assignTo")}
        className="h-11"
        disabled={isPending}
        // Uncontrolled, and re-read from here on every submit: React resets the form each
        // time, and the value it resets to is whatever the server has just revalidated
        // into these props.
        defaultValue={image.tenderItemId ?? ""}
        // Two taps rather than three. A picker with a separate Save beside it is one more
        // thing to miss on a phone, and "which Item is this of" has no draft state worth
        // keeping — the answer is either right or corrected.
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">{t("unassignedOption")}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.productName}
          </option>
        ))}
      </NativeSelect>

      <ImageProblemNotice error={state.error} />
    </form>
  );
}

/**
 * Taking a picture off the Tender.
 *
 * Beyond ticket #25's acceptance criteria, and here anyway: these are somebody else's
 * pictures arriving by email, so the wrong five get attached to the wrong Tender, and on
 * an editing screen with no way back that mistake is permanent. It is also the only path
 * that can orphan bytes — the row goes first and the object second, which the module's own
 * comment explains.
 */
function RemoveForm({ tenderId, imageId }: { tenderId: string; imageId: string }) {
  const t = useTranslations("tenders.referenceImages");
  const [state, formAction, isPending] = useActionState(
    removeReferenceImageAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="imageId" value={imageId} />

      <Button type="submit" variant="ghost" size="sm" className="h-11" disabled={isPending}>
        {t("remove")}
      </Button>

      <ImageProblemNotice error={state.error} />
    </form>
  );
}
