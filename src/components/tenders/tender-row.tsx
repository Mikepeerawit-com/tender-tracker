import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import type { DeadlineKind, WorklistBlock } from "@/lib/tenders/progress";
import type { WorklistRow } from "@/lib/tenders/worklist";

/**
 * One Tender, as a row on the worklist.
 *
 * The only thing that changes between blocks is the loudness of the border and, in
 * "Coming up", a chip naming **which** deadline put it there — because either deadline
 * can, and a row that does not say which is a row you have to open to act on. Both
 * deadlines are shown on every row regardless: they are the two dates the job turns on.
 *
 * **Why every text-bearing child carries `min-w-0`.** A flex item's `min-width` defaults
 * to `auto`, which means it refuses to shrink below its own longest unbroken word. A
 * client reference and a client name are whatever the client calls them and neither has
 * to contain a space, so without this a row holds itself wider than the phone and takes
 * the page with it (#56). `break-words` then gives the word somewhere to break. It is the
 * same structural hold `working-sheet.tsx` puts on its cells rather than trusting column
 * arithmetic.
 *
 * Rendered on the server, which is why it is sync rather than `async`: `useTranslations`
 * and `useFormatter` work in a Server Component, and keeping it synchronous is what lets
 * `tender-row.layout.test.tsx` measure it in a real browser at 390px. The page it sits on
 * is `async` and unreachable from a browser test; this is the seam that is not.
 */
export function TenderRow({
  block,
  tender,
}: {
  block: WorklistBlock;
  tender: WorklistRow;
}) {
  const t = useTranslations("tenders");
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(calendarDate(value), calendarDateFormat);
  const border =
    block === "submission_missed"
      ? "border-destructive/40 bg-destructive/5"
      : "border-border";
  const deadlines: Record<DeadlineKind, string> = {
    internal_quote: tender.internalQuoteDeadline,
    client_submission: tender.clientSubmissionDeadline,
  };

  return (
    <Link
      href={`/tenders/${tender.id}`}
      className={`${border} hover:bg-muted/50 flex min-w-0 flex-col gap-2 rounded-lg border p-4 transition-colors`}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-muted-foreground min-w-0 font-mono text-xs break-words">
          {tender.reference}
        </span>
        <span className="min-w-0 font-medium break-words">{tender.clientName}</span>
        <span className="text-muted-foreground min-w-0 text-sm break-words">
          {tender.title}
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="bg-muted text-muted-foreground min-w-0 rounded px-2 py-0.5 text-xs break-words">
          {t(`progress.${tender.progress}`)}
        </span>
        {tender.dueDeadlines.map((kind) => (
          <span
            key={kind}
            className="border-border text-foreground min-w-0 rounded border px-2 py-0.5 text-xs break-words"
          >
            {t(`due.${kind}`, { date: day(deadlines[kind]) })}
          </span>
        ))}
      </div>

      <div className="text-muted-foreground flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          {t("itemCount", { count: tender.itemCount })}
        </span>
        <span>
          {t("ownedBy", { name: tender.ownerName })}
        </span>
        {/* Whole sentences, not a label glued to a value with a literal colon: Chinese
            wants a full-width one, and punctuation composed in JSX is a string no
            translator can reach. */}
        <span>
          {t("internalQuoteDue", { date: day(tender.internalQuoteDeadline) })}
        </span>
        <span>
          {t("clientSubmissionDue", { date: day(tender.clientSubmissionDeadline) })}
        </span>
      </div>
    </Link>
  );
}
