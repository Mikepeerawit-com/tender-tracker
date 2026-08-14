import { cookies } from "next/headers";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import { listTenders } from "@/lib/tenders/tenders";

/**
 * A plain list, soonest Client Submission Deadline first.
 *
 * Deliberately not yet the worklist: the blocks that say what a Tender is *doing* —
 * Submission Missed, Sourcing Overdue, Coming up — are derived from the Quotes against
 * it, and there are no Quotes to derive from until they can be entered.
 */
export default async function TendersPage() {
  const t = await getTranslations("tenders");
  const format = await getFormatter();
  const tenders = await listTenders(await cookies());

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button className="h-11" nativeButton={false} render={<Link href="/tenders/new" />}>
            {t("record")}
          </Button>
        </header>

        {tenders.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tenders.map((tender) => (
              <li key={tender.id}>
                <Link
                  href={`/tenders/${tender.id}`}
                  className="border-border hover:bg-muted/50 flex flex-col gap-2 rounded-lg border p-4 transition-colors"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-muted-foreground font-mono text-xs">
                      {tender.reference}
                    </span>
                    <span className="font-medium">{tender.clientName}</span>
                    <span className="text-muted-foreground text-sm">{tender.title}</span>
                  </div>
                  <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>{t("itemCount", { count: tender.itemCount })}</span>
                    <span>{t("ownedBy", { name: tender.ownerName })}</span>
                    {/* Whole sentences, not a label glued to a value with a literal
                        colon: Chinese wants a full-width one, and punctuation composed
                        in JSX is a string no translator can reach. */}
                    <span>
                      {t("internalQuoteDue", {
                        date: format.dateTime(
                          calendarDate(tender.internalQuoteDeadline),
                          calendarDateFormat,
                        ),
                      })}
                    </span>
                    <span>
                      {t("clientSubmissionDue", {
                        date: format.dateTime(
                          calendarDate(tender.clientSubmissionDeadline),
                          calendarDateFormat,
                        ),
                      })}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
