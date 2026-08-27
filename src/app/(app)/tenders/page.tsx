import { cookies, headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { TenderRow } from "@/components/tenders/tender-row";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { todayIn } from "@/lib/calendar-date";
import { getOrgSettings } from "@/lib/org/org";
import { runInstantFromHeaders } from "@/lib/run-instant";
import { listWorklist } from "@/lib/tenders/worklist";

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
  const store = await cookies();
  const { timezone } = await getOrgSettings(store);
  const today = todayIn(timezone, runInstantFromHeaders(await headers()));
  const { sections, total } = await listWorklist(today, store);
  const filled = sections.filter((section) => section.tenders.length > 0);

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <ScreenHeader
          heading={t("title")}
          actions={
            <Button
              className="h-11"
              nativeButton={false}
              render={<Link href="/tenders/new" />}
            >
              {t("record")}
            </Button>
          }
        >
          <p className="text-muted-foreground text-sm break-words">{t("description")}</p>
        </ScreenHeader>

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
                    <TenderRow block={section.block} tender={tender} />
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

