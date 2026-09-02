import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MyWorkList } from "@/components/tenders/my-work-list";
import { Screen } from "@/components/screen";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { todayIn } from "@/lib/calendar-date";
import { getOrgSettings } from "@/lib/org/org";
import { listMyWork } from "@/lib/tenders/my-work";
import { runInstantFromHeaders } from "@/lib/run-instant";

/**
 * **My work** — the app's second destination, and an Assignee's own.
 *
 * The Items this reader is an Assignee on and has not answered for, each linking straight
 * to the quote form. The peer of `/tenders`, which is the same work at the Tender grain
 * and is the Owner's question (ADR-0021).
 *
 * **It is meant to reach empty**, and the empty sentence is the point rather than a
 * fallback: a list that never reaches zero stops being work-to-do. That sentence is drawn
 * by `MyWorkList` rather than branched on here, so that the finished screen is a thing a
 * test can render — this page cannot be reached by one.
 *
 * Composed at 390px, one-handed, inside the WeCom webview.
 *
 * The day is resolved once here, at the top of the render, from an injected instant and
 * the org's timezone (ADR-0010) — Vercel runs UTC, and a server-local boundary would age
 * every deadline on this screen by a day the previous afternoon.
 */
export default async function MyWorkPage() {
  const t = await getTranslations("myWork");
  const store = await cookies();
  // Free: `(app)/layout.tsx` has already asked and `currentUser` is wrapped in React
  // `cache()`, so this is answered from the request rather than the network.
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const { timezone } = await getOrgSettings(store);
  const today = todayIn(timezone, runInstantFromHeaders(await headers()));
  const items = await listMyWork(today, store);

  return (
    <Screen>
      <ScreenHeader heading={t("title")}>
        <p className="text-muted-foreground text-sm break-words">{t("description")}</p>
      </ScreenHeader>

      <MyWorkList items={items} />
    </Screen>
  );
}
