import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { ReferenceImageBadge } from "@/components/tenders/reference-image-badge";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/session";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import { listReferenceImages } from "@/lib/images/reference-images";
import { listMembers } from "@/lib/org/members";
import { getTender } from "@/lib/tenders/tenders";

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
  // Signed URLs, minted on this render and good for the hour. They are why this page
  // cannot be cached beyond the request that drew it.
  const referenceImages = await listReferenceImages(tender.id, store);
  const unassignedImages = referenceImages.filter(
    (image) => image.tenderItemId === null,
  );

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
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

        <dl className="grid gap-4 sm:grid-cols-2">
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

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">
            {t("itemCount", { count: tender.items.length })}
          </h2>
          <ul className="flex flex-col gap-3">
            {tender.items.map((item) => (
              <li
                key={item.id}
                className="border-border flex flex-col gap-1 rounded-lg border p-4"
              >
                <span className="font-medium">{item.productName}</span>
                {item.description ? (
                  <span className="text-muted-foreground text-sm">
                    {item.description}
                  </span>
                ) : null}
                <span className="text-muted-foreground text-sm">
                  {t("item.quantified", { quantity: item.quantity, unit: item.unit })}
                </span>

                {/* On the Item, and a count rather than a strip — buildspec_2.md screen 5.
                    This screen becomes the comparison working sheet, where thumbnails were
                    measured eating the horizontal room the money columns need. */}
                <ReferenceImageBadge
                  label={item.productName}
                  images={referenceImages.filter(
                    (image) => image.tenderItemId === item.id,
                  )}
                />
              </li>
            ))}
          </ul>
        </section>

        {/* Unassigned images are shown on the Tender rather than held back until somebody
            places them: they are the ones with work outstanding, and the placing itself
            happens on the edit screen, where the pictures can be looked at. */}
        {unassignedImages.length > 0 ? (
          <section className="flex flex-col items-start gap-2">
            <h2 className="text-sm font-medium">
              {t("referenceImages.unassigned")}
            </h2>
            <ReferenceImageBadge
              label={t("referenceImages.unassigned")}
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
