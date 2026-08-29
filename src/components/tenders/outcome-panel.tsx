import { getFormatter, getTranslations } from "next-intl/server";

import {
  ClearSubmissionButton,
  ItemOutcomePicker,
  RecordSubmissionButton,
} from "@/components/tenders/outcome-controls";
import { instantDayFormat } from "@/lib/calendar-date";
import { tenderOutcome } from "@/lib/tenders/outcome";
import type { Tender } from "@/lib/tenders/tenders";

/**
 * What happened: the Bid going out, and how each Item ended.
 *
 * Two facts, recorded by hand, and nothing on the screen infers either. `submitted_at` is
 * what tells "submitted on time" from "never submitted" once the Client Submission
 * Deadline has passed — no column says a submission was missed, its absence does
 * (ADR-0003) — and an Outcome is a client's decision, which nothing in the data implies.
 *
 * **The Outcome picker is per Item**, because clients award part of a Tender to us and
 * part to a competitor (ADR-0001). What the Tender as a whole came to is read off those
 * Items underneath them, the way the comparison sheet's totals bar sits under the rows it
 * is made of — including `partial`, which is shown here and stored nowhere.
 */
export async function OutcomePanel({
  tender,
  /** The org's, never the server's: Vercel runs UTC and would date a Bid a day early. */
  timezone,
}: {
  tender: Tender;
  timezone: string;
}) {
  const t = await getTranslations("tenders.outcome");
  const format = await getFormatter();
  const day = (instant: string) =>
    format.dateTime(new Date(instant), instantDayFormat(timezone));
  const verdict = await tenderVerdict(tender);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("hint")}</p>
      </div>

      <div className="border-border flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            {tender.submittedAt === null
              ? t("notSubmitted")
              : t("submittedOn", { date: day(tender.submittedAt) })}
          </span>
          <span className="text-muted-foreground text-xs">{t("submittedHint")}</span>
        </div>

        {tender.submittedAt === null ? (
          <RecordSubmissionButton tenderId={tender.id} />
        ) : (
          <ClearSubmissionButton tenderId={tender.id} />
        )}
      </div>

      <ul className="border-border flex flex-col rounded-lg border">
        {tender.items.map((item) => (
          <li
            key={item.id}
            className="border-border flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t px-4 py-3 first:border-t-0"
          >
            {/* The name and nothing else. Quantity, unit, Quotes and money are all on
                the working sheet above, and repeating them here would draw a second
                Tender under the first. */}
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{item.productName}</span>
              {/* The day the client decided, which is what "won this month" is counted
                  on. `updated_at` is not a decision date. */}
              {item.outcomeAt === null ? null : (
                <span className="text-muted-foreground text-xs">
                  {t("decidedOn", { date: day(item.outcomeAt) })}
                </span>
              )}
            </div>

            <ItemOutcomePicker
              tenderId={tender.id}
              itemId={item.id}
              productName={item.productName}
              outcome={item.outcome}
            />
          </li>
        ))}
      </ul>

      {/* The Tender's own Outcome, read off the Items above it and stored nowhere. */}
      <div className="border-border bg-muted/40 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border px-4 py-3">
        <span className="text-muted-foreground text-xs">{t("tenderOutcome")}</span>
        {/* Ink, for every Outcome. This was green for won and red for lost until
            ADR-0019: in Chinese financial convention red is up and green is down — the
            inverse of the Western reading — so the two colours said the opposite thing to
            half the people reading them. Alarm is reserved for time and there is no hue
            meaning "this went well", so the words carry it, which they always did.
            `partial` was already unstyled for a neighbouring reason: a split award is not
            a qualified win, and colouring it as one is how "we won that tender" gets said
            about a Tender we mostly lost. */}
        <span className="text-sm font-semibold">{verdict.label}</span>
        <span className="text-muted-foreground text-sm">{verdict.note}</span>
      </div>
    </section>
  );
}

/**
 * What the bar under the Items says, resolved once.
 *
 * Three readings, and only one of them is the derived Outcome: a Tender with an Item
 * still undecided has none, and what to say about it turns on whether the Bid has gone
 * out. **This is not #31's Awaiting Decision block rule** and must not be mistaken for
 * it — that one decides which group of the worklist a Tender lands in and takes a Tender
 * with *any* Outcome recorded out of it. This one is about the Tender in front of you,
 * where a client who has ruled on two Items of four is still being waited on. Two
 * definitions of a state coexisting on purpose is the same shape the buildspec draws
 * around Sourcing Overdue.
 */
async function tenderVerdict(tender: Tender) {
  const t = await getTranslations("tenders.outcome");
  const derived = tenderOutcome(tender.items);

  if (derived !== null) {
    return {
      label: t(`value.${derived}`),
      note: t(`explain.${derived}`),
    };
  }

  const awaited = tender.submittedAt !== null;

  return {
    label: awaited ? t("awaitingDecision") : t("noOutcome"),
    note: awaited ? t("awaitingDecisionNote") : t("noOutcomeNote"),
  };
}
