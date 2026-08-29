import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { IndicatorLamp } from "@/components/ui/indicator-lamp";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import type { DeadlineKind, RowStatus } from "@/lib/tenders/progress";
import type { WorklistRow } from "@/lib/tenders/worklist";

/**
 * One Tender, as a row on the worklist.
 *
 * **The row states its own urgency.** Until the 29 August 2026 amendment to ADR-0007 it
 * inherited urgency from the heading it was filed under, and a Tender whose sourcing was
 * overdue looked exactly like one with a fortnight of slack — the same rectangle, one
 * word apart. Now the heading is Progress and the row carries the trouble: an indicator
 * lamp, and a sentence naming the date and how far off it is.
 *
 * The sentence carries strictly more than the chip it replaced. The chip said *which*
 * deadline; the sentence says which **and how far** — "Quotes due tomorrow", "Deadline
 * passed 6 days ago" — which is the difference between a row you have to open and a row
 * you can act on.
 *
 * The arithmetic behind it is not here. `rowStatus` in `@/lib/tenders/progress` decides
 * which sentence and how loud, as arithmetic over dates and sourcing counts, and is
 * tested as arithmetic. This file only turns that answer into words, which is why the
 * *today / tomorrow / a date* choice lives here beside the message keys rather than in
 * the rules.
 *
 * **No Progress on the row.** Inside a group every row has the same Progress, so a
 * per-row chip or scale would repeat the heading on every line. The scale is drawn once,
 * on the group heading.
 *
 * **Why every text-bearing child carries `min-w-0`.** A flex item's `min-width` defaults
 * to `auto`, which means it refuses to shrink below its own longest unbroken word. A
 * client reference and a client name are whatever the client calls them and neither has
 * to contain a space, so without this a row holds itself wider than the phone and takes
 * the page with it (#56). `break-words` then gives the word somewhere to break.
 *
 * Rendered on the server, which is why it is sync rather than `async`: `useTranslations`
 * and `useFormatter` work in a Server Component, and keeping it synchronous is what lets
 * `tender-row.layout.test.tsx` measure it in a real browser at 390px. The page it sits on
 * is `async` and unreachable from a browser test; this is the seam that is not.
 */
export function TenderRow({ tender }: { tender: WorklistRow }) {
  const t = useTranslations("tenders");
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(calendarDate(value), calendarDateFormat);
  const deadlines: Record<DeadlineKind, string> = {
    internal_quote: tender.internalQuoteDeadline,
    client_submission: tender.clientSubmissionDeadline,
  };
  const tone = {
    alarm: "text-alarm-ink font-medium",
    signal: "text-signal-ink font-medium",
    calm: "text-ink-faint",
  }[tender.status.tone];

  // `prefetch={false}` because the prefetch is bought and then thrown away. Every route
  // here is dynamic, so Next prefetches the shell down to `(app)/loading.tsx` — which
  // still runs the proxy and the layout's `currentUser()` — and then keeps it for
  // `staleTimes.dynamic`, which has defaulted to 0 seconds since Next 15. Measured on
  // production: the row was prefetched twice, and the tap 2.5s later re-fetched from
  // scratch anyway and took 652ms. One row is one wasted invocation; a worklist is one per
  // row, all landing on a Free-tier database at the moment the screen opens — which is the
  // moment somebody is about to tap. Turning this back on wants `staleTimes.dynamic` set
  // with it, and that is a staleness decision worth an ADR.
  return (
    <Link
      href={`/tenders/${tender.id}`}
      prefetch={false}
      className="hover:bg-signal/5 flex min-w-0 items-start gap-3 p-3.5 transition-colors"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="text-ink-faint min-w-0 font-mono text-xs font-medium break-words">
            {tender.reference}
          </span>
          <span className="min-w-0 text-[15px] font-semibold break-words">
            {tender.clientName}
          </span>
        </div>

        <span className="text-muted-foreground min-w-0 text-[13px] leading-snug break-words">
          {tender.title}
        </span>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          <IndicatorLamp tone={tender.status.tone} />
          <span className={`min-w-0 break-words ${tone}`}>
            {statusSentence(t, day, deadlines, tender.status)}
          </span>
          <span className="text-ink-faint min-w-0 break-words">
            {t("itemCount", { count: tender.itemCount })}
          </span>
          {/* Whole sentences, not a label glued to a value with a literal colon: Chinese
              wants a full-width one, and punctuation composed in JSX is a string no
              translator can reach. */}
          <span className="text-ink-faint min-w-0 break-words">
            {t("ownedBy", { name: tender.ownerName })}
          </span>
        </div>
      </div>

      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="text-border mt-3 shrink-0"
      >
        <path
          d="M9 5l7 7-7 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

/**
 * The one sentence the row states, chosen from what {@link rowStatus} worked out.
 *
 * The *today / tomorrow / a date* reading is made here rather than in the rules because
 * it is a wording decision: "tomorrow" is a word, and which day counts as tomorrow is
 * arithmetic somebody else already did. A date already gone by gets its own reading
 * rather than a negative number of days — nobody says a deadline is due in minus six.
 *
 * The keys are built rather than written out, so `messages.test.ts` cannot see them by
 * scanning the source. That is what the walk over `deadlineKinds` × the four readings is
 * there for: it holds both locales to all eight without any of them being a literal here.
 */
function statusSentence(
  t: ReturnType<typeof useTranslations<"tenders">>,
  day: (value: string) => string,
  deadlines: Record<DeadlineKind, string>,
  status: RowStatus,
): string {
  if (status.kind === "submission_missed") {
    return t("row.submissionMissed", { days: status.days });
  }

  if (status.kind === "unsourced") {
    return t("row.unsourced", { count: status.count, total: status.total });
  }

  if (status.kind === "with_client") return t("row.withClient");

  const when =
    status.days < 0
      ? "passed"
      : status.days === 0
        ? "today"
        : status.days === 1
          ? "tomorrow"
          : "on";

  return t(`row.due.${status.deadline}.${when}`, {
    date: day(deadlines[status.deadline]),
  });
}
