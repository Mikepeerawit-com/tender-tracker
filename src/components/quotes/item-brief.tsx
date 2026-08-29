import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";

/**
 * What the client actually asked for, above the form that prices it.
 *
 * The Assignee using this screen is standing in front of a supplier on a phone, and the
 * question they are about to answer is *how much for this*. So the screen opens by saying
 * what **this** is — the product, how many and in what unit, and whatever the client said
 * about it — before anything asks them to type a number. Pricing the wrong thing is a
 * mistake nobody notices until the Bid is out.
 *
 * The client's **Reference Images belong in this block**, not in a section of their own
 * further down: the pictures are part of the brief, and the Quote Photos that come back
 * are only judgeable next to the picture the client sent. They stay a count badge that
 * opens a lightbox rather than thumbnails (ADR-0009) — a row of thumbnails is a column of
 * megabytes on the connection this screen is read over.
 *
 * The Internal Quote Deadline sits at the bottom of the block because it is the one thing
 * here that is about *when* rather than *what*, and it is the sentence that decides
 * whether this call happens today.
 *
 * This screen draws its own brief rather than the shared `ScreenHeader`, because the
 * label above the name is doing real work here — "what the client asked for" is a claim
 * about whose words these are, and the shared header's eyebrow is a reference in mono.
 * The reference and the client name are not repeated: since #73 the app bar carries them
 * on every screen about one record, and saying them twice on a 390px phone spends a row
 * on something already on screen.
 */
export function ItemBrief({
  productName,
  quantity,
  unit,
  description,
  internalQuoteDeadline,
  images,
}: {
  productName: string;
  quantity: number;
  unit: string;
  description: string | null;
  internalQuoteDeadline: string;
  /** The client's Reference Images for this Item, as a count badge. Omitted when none. */
  images?: ReactNode;
}) {
  const t = useTranslations("quotes");
  const tenders = useTranslations("tenders");
  const format = useFormatter();

  // Stretched, not `items-start`. A column that aligns its children to the start gives
  // each one `fit-content`, and a product name with no space in it measures at its
  // max-content width — so `break-words` never gets a constrained line box to break in,
  // and the block holds itself wider than the phone. The one child that must not stretch
  // is the image badge, which is `w-fit` in its own right.
  return (
    <section className="border-hairline bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-4">
      <span className="field-label">{t("asked")}</span>

      <h1 className="min-w-0 text-xl leading-tight font-semibold tracking-tight break-words">
        {productName}
      </h1>

      <p className="min-w-0 font-mono text-[13px] font-medium tabular-nums break-words">
        {tenders("item.quantified", { quantity, unit })}
      </p>

      {description ? (
        <p className="text-muted-foreground min-w-0 text-sm break-words">{description}</p>
      ) : null}

      {images}

      <p className="text-ink-faint min-w-0 text-xs break-words">
        {tenders("internalQuoteDue", {
          date: format.dateTime(
            calendarDate(internalQuoteDeadline),
            calendarDateFormat,
          ),
        })}
      </p>
    </section>
  );
}
