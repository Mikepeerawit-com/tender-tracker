import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { WorkingSheet } from "@/components/comparison/working-sheet";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { OutcomePanel } from "@/components/tenders/outcome-panel";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/session";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import { getComparisonSheet } from "@/lib/comparison/sheet";
import { listReferenceImages } from "@/lib/images/reference-images";
import { listMembers } from "@/lib/org/members";
import { getOrgSettings } from "@/lib/org/org";
import { getTender } from "@/lib/tenders/tenders";

/**
 * Screen 5: the Tender detail, which *is* the comparison working sheet.
 *
 * The Tender's own facts sit above it and everything that decides anything sits in the
 * sheet — one row per Tender Item, undecided Items open, every competing Quote ranked
 * cheapest-first in THB underneath. The layout is wide on purpose: six money columns and,
 * under an open Item, eight more. Below 768px the quote table reflows into stacked cards
 * (ADR-0009, #30); nothing else about the screen changes.
 */
export default async function TenderPage({ params }: PageProps<"/tenders/[id]">) {
  const { id } = await params;
  const store = await cookies();
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const tender = await getTender(id, store);

  // Another org's Tender and a deleted one are the same answer through RLS, and the
  // same answer is the right one to give.
  if (!tender) notFound();

  const t = await getTranslations("tenders");
  const format = await getFormatter();
  const day = (value: string) =>
    format.dateTime(calendarDate(value), calendarDateFormat);
  const members = await listMembers(store);
  // The org's timezone, because `submitted_at` and `outcome_at` are instants and the day
  // they land on is the day it was in Bangkok — never the day it was on a Vercel box.
  const { timezone } = await getOrgSettings(store);
  // Signed URLs, minted on this render and good for the hour. They are why this page
  // cannot be cached beyond the request that drew it.
  const referenceImages = await listReferenceImages(tender.id, store);
  // Every Item, every competing Quote and every Quote's photos, in a fixed handful of
  // queries for the whole Tender rather than a handful per Item.
  const sheet = await getComparisonSheet(tender.id, store);
  const unassignedImages = referenceImages.filter(
    (image) => image.tenderItemId === null,
  );

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground font-mono text-xs">
              {tender.reference}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {tender.clientName}
            </h1>
            <p className="text-muted-foreground text-sm">{tender.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="h-11" nativeButton={false} render={<Link href="/tenders" />}>
              {t("backToList")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              nativeButton={false} render={<Link href={`/tenders/${tender.id}/edit`} />}
            >
              {t("edit")}
            </Button>
          </div>
        </header>

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
              tender.expectedDecisionDate
                ? day(tender.expectedDecisionDate)
                : t("notSet")
            }
          />
          <Fact label={t("notes")} value={tender.notes ?? t("notSet")} />
        </dl>

        <WorkingSheet
          tenderId={tender.id}
          items={sheet.items}
          photos={sheet.photos}
          referenceImages={referenceImages}
        />

        <OutcomePanel tender={tender} timezone={timezone} />

        {/* Unassigned images are shown on the Tender rather than held back until somebody
            places them: they are the ones with work outstanding, and the placing itself
            happens on the edit screen, where the pictures can be looked at. */}
        {unassignedImages.length > 0 ? (
          <section className="flex flex-col items-start gap-2">
            <h2 className="text-sm font-medium">
              {t("referenceImages.unassigned")}
            </h2>
            <ImageCountBadge
              openLabel={t("referenceImages.openCount", {
                label: t("referenceImages.unassigned"),
                count: unassignedImages.length,
              })}
              images={unassignedImages}
            />
          </section>
        ) : null}

        <AssigneeControls
          tenderId={tender.id}
          assignees={tender.assignees}
          members={members}
          callerId={user.id}
          isOwner={tender.ownerUserId === user.id}
        />
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
