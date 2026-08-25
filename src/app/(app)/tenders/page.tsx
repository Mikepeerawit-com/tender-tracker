import { cookies, headers } from "next/headers";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { calendarDate, calendarDateFormat, todayIn } from "@/lib/calendar-date";
import { getOrgSettings } from "@/lib/org/org";
import { runInstantFromHeaders } from "@/lib/run-instant";
import type { DeadlineKind, WorklistBlock } from "@/lib/tenders/progress";
import { listWorklist, type WorklistRow } from "@/lib/tenders/worklist";

/**
 * Screen 2: the tender list, and the app's home.
 *
 * It is a **worklist, not a report**: grouped by what is wrong with each Tender rather
 * than by how the business is doing, so that opening the app at 9am says what to do
 * rather than how we are getting on. Every Tender appears in exactly one block, which is
 * what makes the list a list of jobs — a row in two places is something to read, not
 * something to do.
 *
 * There are **no metric cards** (ADR-0007, as amended by ticket 11). `buildspec_1`'s four
 * were labels rather than definitions, and counting is not worth a card at this volume.
 *
 * Nothing on this screen is stored. Progress and the three overdue conditions are derived
 * on every read by `@/lib/tenders/progress`; the day they are derived against is the day
 * it is **in the org's timezone**, resolved once here at the top of the render from an
 * injected instant (ADR-0010). Vercel runs UTC, so a server-local boundary would roll the
 * day seven hours early and turn this screen red the previous afternoon.
 */
export default async function TendersPage() {
  const t = await getTranslations("tenders");
  const format = await getFormatter();
  const store = await cookies();
  const { timezone } = await getOrgSettings(store);
  const today = todayIn(timezone, runInstantFromHeaders(await headers()));
  const { sections, total } = await listWorklist(today, store);
  const day = (value: string) => format.dateTime(calendarDate(value), calendarDateFormat);
  const filled = sections.filter((section) => section.tenders.length > 0);

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button
            className="h-11"
            nativeButton={false}
            render={<Link href="/tenders/new" />}
          >
            {t("record")}
          </Button>
        </header>

        {filled.length === 0 ? (
          // Two different emptinesses, and they must not read as the same sentence: a
          // team who has recorded nothing yet needs the way in, and a team who has
          // finished everything needs telling that they have.
          <p className="text-muted-foreground text-sm">
            {total === 0 ? t("empty") : t("allClear")}
          </p>
        ) : (
          filled.map((section) => (
            <section key={section.block} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2
                  className={
                    section.block === "submission_missed"
                      ? "text-destructive text-sm font-semibold"
                      : "text-sm font-semibold"
                  }
                >
                  {t(`block.${section.block}.title`)}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {t(`block.${section.block}.hint`)}
                </p>
              </div>

              <ul className="flex flex-col gap-3">
                {section.tenders.map((tender) => (
                  <li key={tender.id}>
                    <TenderRow
                      block={section.block}
                      day={day}
                      t={t}
                      tender={tender}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

/**
 * One Tender, as a row.
 *
 * The only thing that changes between blocks is the loudness of the border and, in
 * "Coming up", a chip naming **which** deadline put it there — because either deadline
 * can, and a row that does not say which is a row you have to open to act on. Both
 * deadlines are shown on every row regardless: they are the two dates the job turns on.
 */
function TenderRow({
  block,
  day,
  t,
  tender,
}: {
  block: WorklistBlock;
  day: (value: string) => string;
  t: Awaited<ReturnType<typeof getTranslations<"tenders">>>;
  tender: WorklistRow;
}) {
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
      className={`${border} hover:bg-muted/50 flex flex-col gap-2 rounded-lg border p-4 transition-colors`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {tender.reference}
        </span>
        <span className="font-medium">{tender.clientName}</span>
        <span className="text-muted-foreground text-sm">{tender.title}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
          {t(`progress.${tender.progress}`)}
        </span>
        {tender.dueDeadlines.map((kind) => (
          <span
            key={kind}
            className="border-border text-foreground rounded border px-2 py-0.5 text-xs"
          >
            {t(`due.${kind}`, { date: day(deadlines[kind]) })}
          </span>
        ))}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>{t("itemCount", { count: tender.itemCount })}</span>
        <span>{t("ownedBy", { name: tender.ownerName })}</span>
        {/* Whole sentences, not a label glued to a value with a literal colon: Chinese
            wants a full-width one, and punctuation composed in JSX is a string no
            translator can reach. */}
        <span>{t("internalQuoteDue", { date: day(tender.internalQuoteDeadline) })}</span>
        <span>
          {t("clientSubmissionDue", { date: day(tender.clientSubmissionDeadline) })}
        </span>
      </div>
    </Link>
  );
}
