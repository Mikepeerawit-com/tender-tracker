import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Screen } from "@/components/screen";
import { TenderGroup } from "@/components/tenders/tender-group";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { todayIn } from "@/lib/calendar-date";
import { currentUser } from "@/lib/auth/session";
import { getOrgSettings } from "@/lib/org/org";
import { runInstantFromHeaders } from "@/lib/run-instant";
import { listWorklist } from "@/lib/tenders/worklist";

/**
 * Screen 2: the tender list, and the app's home.
 *
 * It is a **worklist, not a report**. It is grouped by **Progress** — the vocabulary
 * `CONTEXT.md` already defines, in the order it already defines — with Submission Missed
 * pinned above as the single exception. Every Tender appears in exactly one group, which
 * is what makes the list a list of jobs: a row in two places is something to read, not
 * something to do.
 *
 * Urgency is not the grouping. It is stated on each row, as a lamp and a sentence naming
 * the date and how far off it is — see the 29 August 2026 amendment to ADR-0007 for why
 * the five blocks were two taxonomies wearing one set of headings.
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
  // Free: `(app)/layout.tsx` has already asked and `currentUser` is wrapped in React
  // `cache()`, so this is answered from the request rather than the network.
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const { timezone } = await getOrgSettings(store);
  const today = todayIn(timezone, runInstantFromHeaders(await headers()));
  const { sections, total } = await listWorklist(today, store);
  const filled = sections.filter((section) => section.tenders.length > 0);

  return (
    <Screen>
      <ScreenHeader
        heading={t("title")}
        actions={
          <Button
            className="h-11"
            nativeButton={false}
            render={<Link href="/tenders/new" prefetch={false} />}
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
        // In the order `listWorklist` returns them, which is the order the groups are
        // read in. Empty ones are dropped here rather than there: the ordering is the
        // assembly's decision and drawing it is the screen's.
        filled.map((section) => (
          <TenderGroup key={section.group} section={section} timezone={timezone} />
        ))
      )}
    </Screen>
  );
}

