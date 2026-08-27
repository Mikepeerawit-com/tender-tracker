import { useFormatter, useTranslations } from "next-intl";

import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import type { Tender } from "@/lib/tenders/tenders";

/**
 * The Tender's own facts, above the sheet that decides everything else.
 *
 * Rendered on the server and sync rather than `async`, for the reason the rest of this
 * seam is: an `async` Server Component cannot be reached from a browser test, and #56 was
 * what that cost. `screens.layout.test.tsx` measures the detail screen through this.
 *
 * `notes` is the one that can be any length — it is free text somebody typed — so the
 * grid cell holding it is the one that needs `min-w-0` and `break-words`. The dates
 * cannot overflow and the owner's name is short, but they cost nothing to hold the same
 * way and the alternative is a rule that applies to one cell in six.
 */
export function TenderFacts({ tender }: { tender: Tender }) {
  const t = useTranslations("tenders");
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(calendarDate(value), calendarDateFormat);

  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label={t("owner")} value={tender.ownerName} />
      <Fact label={t("dateReceived")} value={day(tender.dateReceived)} />
      <Fact
        label={t("internalQuoteDeadline")}
        value={day(tender.internalQuoteDeadline)}
      />
      <Fact
        label={t("clientSubmissionDeadline")}
        value={day(tender.clientSubmissionDeadline)}
      />
      <Fact
        label={t("expectedDecisionDate")}
        value={
          tender.expectedDecisionDate ? day(tender.expectedDecisionDate) : t("notSet")
        }
      />
      <Fact label={t("notes")} value={tender.notes ?? t("notSet")} />
    </dl>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs break-words">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}
