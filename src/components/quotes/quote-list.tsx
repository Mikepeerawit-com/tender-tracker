import { useFormatter, useTranslations } from "next-intl";

import { QuotePhotoControls } from "@/components/quotes/quote-photos";
import { QuoteRowControls } from "@/components/quotes/quote-row-controls";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import type { QuotePhoto } from "@/lib/images/quote-photos";
// `reportingCurrency` from its own module, not the re-export on `@/lib/quotes/quotes`:
// that module is `server-only`, and a value import from it is what made this component
// unrenderable in a browser test. The type still comes from there — types are erased.
import { reportingCurrency } from "@/lib/fx/currencies";
// The predicate from `@/lib/quotes/quote-form`, not the re-export on
// `@/lib/quotes/quotes`: that module is `server-only`, and a value import from it is what
// made this component unrenderable in a browser test.
import { mayCorrectQuote } from "@/lib/quotes/quote-form";
import type { Quote } from "@/lib/quotes/quotes";

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
 *
 * Rendered on the server, and sync rather than `async` so that `screens.layout.test.tsx`
 * can measure it at 390px: `useTranslations` and `useFormatter` work in a Server
 * Component, and an `async` one is unreachable from a browser test (#56).
 */
export function QuoteList({
  tenderId,
  tenderItemId,
  quotes,
  photos,
  callerId,
  ownerUserId,
  selectedQuoteId,
}: {
  tenderId: string;
  tenderItemId: string;
  quotes: Quote[];
  /** Every Quote's photos, keyed by Quote — one query for the whole Item. */
  photos: Map<string, QuotePhoto[]>;
  /** Who is reading. A Quote is correctable by whoever sourced it, and by nobody else. */
  callerId: string;
  /** Who owns the Tender — the one override on sourced-by, and never a role. */
  ownerUserId: string;
  /** The Item's Selected Quote, whose deletion costs a decision and so asks twice. */
  selectedQuoteId: string | null;
}) {
  const t = useTranslations("quotes");
  const format = useFormatter();

  if (quotes.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("none")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {quotes.map((quote) => (
        <li
          key={quote.id}
          // A stable handle on one Quote's row. It was the anchor a successful create
          // redirected to, back when a photo could only be attached from here; the create
          // form takes photos on the way in now (#60) and stays where it is, so nothing
          // navigates to this any more — but a row worth linking to is worth naming.
          id={`quote-${quote.id}`}
          className={`flex flex-col gap-2 rounded-lg border p-4 ${
            quote.matchType === "alternative"
              ? // Flag, per screen 5, and for the same reason here: this is a property of
                // the Quote — a substitute was offered — and not something wrong with it.
                "border-flag/40 bg-flag/5"
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
              <span className="bg-flag-wash text-flag-ink mr-2 rounded px-1.5 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase">
                {t("matchType.alternative")}
              </span>
              <span className="font-medium">{quote.alternativeProductName}</span>
            </p>
          ) : null}

          <div className="flex flex-col gap-0.5">
            {/* Original amount primary and bold, THB beneath it in grey with `≈` — screen
                5's rule, and it starts here so the two screens never disagree about which
                number is the real one. */}
            {/* Mono, tabular, display size — the same treatment the working sheet gives
                it, because this card is the other place where the price *is* the
                decision. An Assignee rings several suppliers in a row for one Item, and
                the cards they come back to have to read as a column of numbers. */}
            <span className="money text-xl leading-tight font-medium">
              {format.number(quote.unitPrice, {
                style: "currency",
                currency: quote.currency,
              })}
              <span className="text-muted-foreground font-sans text-sm font-normal tracking-normal">
                {" "}
                {t("perUnit", { unit: quote.quotedUnit })}
              </span>
            </span>

            {quote.currency === reportingCurrency ? (
              // No fake conversion. A THB Quote is not converted, and repeating the same
              // number underneath with a `≈` in front of it would imply it had been.
              <span className="text-muted-foreground text-sm">{t("quotedInThb")}</span>
            ) : (
              <span className="text-muted-foreground money text-sm">
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
                  <span className="bg-flag-wash text-flag-ink ml-2 rounded px-1.5 py-0.5 text-[0.7rem] font-medium">
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

          {/* Correcting belongs to the Assignee who sourced it, with the Owner
              as the override. Everybody else
              sees the Quote and no controls — the server refuses them either way, and an
              Edit button that leads to a refusal is worse than no button. */}
          {mayCorrectQuote({
            sourcedByUserId: quote.sourcedByUserId,
            callerId,
            ownerUserId,
          }) ? (
            <QuoteRowControls
              tenderId={tenderId}
              tenderItemId={tenderItemId}
              quoteId={quote.id}
              supplierName={quote.supplierName}
              isSelected={quote.id === selectedQuoteId}
            />
          ) : null}
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
