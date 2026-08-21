import { getFormatter, getTranslations } from "next-intl/server";

import { QuotePhotoControls } from "@/components/quotes/quote-photos";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import { reportingCurrency, type Quote } from "@/lib/quotes/quotes";

/**
 * Every Quote already recorded against one Tender Item, on the screen where the next one
 * gets entered.
 *
 * Deliberately unranked, and it is worth saying why on the screen that most invites a
 * ranking. Cheapest-first in THB belongs to the comparison working sheet (#27), which
 * knows the two things this list does not: that an Item carrying one Quote in "box of 50"
 * and another in "piece" cannot be ranked at all, and that a top two within 3% on rates
 * frozen on different days is too close to call. A number beside each row here would be
 * making both of those claims by accident. Entry order claims nothing.
 *
 * What it does carry is the pair of facts that make two near-identical rows different:
 * **who sourced it**, which is never dropped, and the frozen rate the THB figure came
 * from. Two Assignees ringing the same supplier and getting different prices is expected,
 * and reading it as a duplicate is the mistake this column exists to prevent.
 */
export async function QuoteList({
  tenderId,
  quotes,
  photos,
}: {
  tenderId: string;
  quotes: Quote[];
  /** Every Quote's photos, keyed by Quote — one query for the whole Item. */
  photos: Map<string, QuotePhoto[]>;
}) {
  const t = await getTranslations("quotes");
  const format = await getFormatter();

  if (quotes.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("none")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {quotes.map((quote) => (
        <li
          key={quote.id}
          // The anchor a just-saved Quote is redirected to, so the price lands on screen
          // beside its own camera button rather than somewhere below the fold.
          id={`quote-${quote.id}`}
          className={`flex flex-col gap-2 rounded-lg border p-4 ${
            quote.matchType === "alternative"
              ? // Amber, per screen 5, and for the same reason here: this row is not a
                // price for what was asked for.
                "border-amber-500/40 bg-amber-500/5"
              : "border-border"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{quote.supplierName}</span>
            <span className="text-muted-foreground text-xs">
              {t("sourcedBy", { name: quote.sourcedByName })}
            </span>
          </div>

          {quote.matchType === "alternative" ? (
            <p className="text-sm">
              <span className="mr-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase">
                {t("matchType.alternative")}
              </span>
              <span className="font-medium">{quote.alternativeProductName}</span>
            </p>
          ) : null}

          <div className="flex flex-col gap-0.5">
            {/* Original amount primary and bold, THB beneath it in grey with `≈` — screen
                5's rule, and it starts here so the two screens never disagree about which
                number is the real one. */}
            <span className="text-base font-semibold">
              {format.number(quote.unitPrice, {
                style: "currency",
                currency: quote.currency,
              })}
              <span className="text-muted-foreground text-sm font-normal">
                {" "}
                {t("perUnit", { unit: quote.quotedUnit })}
              </span>
            </span>

            {quote.currency === reportingCurrency ? (
              // No fake conversion. A THB Quote is not converted, and repeating the same
              // number underneath with a `≈` in front of it would imply it had been.
              <span className="text-muted-foreground text-sm">{t("quotedInThb")}</span>
            ) : (
              <span className="text-muted-foreground text-sm">
                {t("approx", {
                  amount: format.number(quote.unitPriceThb, {
                    style: "currency",
                    currency: reportingCurrency,
                  }),
                })}{" "}
                <span className="text-xs">
                  {t("atRate", {
                    rate: format.number(quote.fxRateApplied, {
                      maximumFractionDigits: 4,
                    }),
                    date: format.dateTime(
                      calendarDate(quote.fxRateAsOf),
                      calendarDateFormat,
                    ),
                  })}
                </span>
                {quote.fxRateIsStale ? (
                  // Said out loud rather than left in the column. A stale rate is what
                  // makes a 1.3% lead on the comparison sheet meaningless, and the person
                  // who entered this is the only one who can remember why it happened.
                  <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.7rem]">
                    {t("staleRate")}
                  </span>
                ) : null}
              </span>
            )}
          </div>

          <dl className="text-muted-foreground grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <Fact
              label={t("quotedAt")}
              value={format.dateTime(calendarDate(quote.quotedAt), calendarDateFormat)}
            />
            <Fact
              label={t("leadTimeDays")}
              value={
                quote.leadTimeDays === null
                  ? t("notStated")
                  : t("days", { count: quote.leadTimeDays })
              }
            />
            {quote.detailNotes ? (
              <Fact label={t("detailNotes")} value={quote.detailNotes} />
            ) : null}
          </dl>

          <QuotePhotoControls
            tenderId={tenderId}
            quoteId={quote.id}
            photos={photos.get(quote.id) ?? []}
          />
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
