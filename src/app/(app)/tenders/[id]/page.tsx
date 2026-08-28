import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { WorkingSheet } from "@/components/comparison/working-sheet";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { OutcomePanel } from "@/components/tenders/outcome-panel";
import { TenderFacts } from "@/components/tenders/tender-facts";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { loadTenderScreen } from "@/lib/tenders/tender-screen";

/**
 * Screen 5: the Tender detail, which *is* the comparison working sheet.
 *
 * The Tender's own facts sit above it and everything that decides anything sits in the
 * sheet — one row per Tender Item, undecided Items open, every competing Quote ranked
 * cheapest-first in THB underneath. The layout is wide on purpose and it is one design at
 * every width: the Item's blocks wrap into a column where there is no room for a row, and
 * below 768px the quote table reflows into stacked cards (ADR-0009, #30). Nothing else
 * about the screen changes, and nothing on it scrolls sideways.
 */
export default async function TenderPage({ params }: PageProps<"/tenders/[id]">) {
  const { id } = await params;
  const store = await cookies();
  const user = await currentUser(store);

  if (!user) redirect("/login");

  // One batch, not six reads in a row: `loadTenderScreen` holds the ordering and the
  // reason for it. The signed URLs among the Reference Images are minted on this render
  // and good for the hour, which is why this screen cannot be cached beyond the request
  // that drew it.
  const { tender, members, timezone, referenceImages, unassignedImages, sheet } =
    await loadTenderScreen(id, store);

  // Another org's Tender and a deleted one are the same answer through RLS, and the
  // same answer is the right one to give.
  if (!tender) notFound();

  const t = await getTranslations("tenders");

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <ScreenHeader
          eyebrow={tender.reference}
          heading={tender.clientName}
          actions={
            <>
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
            </>
          }
        >
          <p className="text-muted-foreground text-sm break-words">{tender.title}</p>
        </ScreenHeader>

        <TenderFacts tender={tender} />

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

