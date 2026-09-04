import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { WorkingSheet } from "@/components/comparison/working-sheet";
import { Screen } from "@/components/screen";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { OutcomePanel } from "@/components/tenders/outcome-panel";
import { OutstandingBand } from "@/components/tenders/outstanding-band";
import { SourcingList } from "@/components/tenders/sourcing-list";
import { TenderFacts } from "@/components/tenders/tender-facts";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { loadTenderScreen } from "@/lib/tenders/tender-screen";
import { ownsTender } from "@/lib/tenders/viewer";

/**
 * Screen 5: the Tender detail — the comparison working sheet for the Owner, and the
 * Items with your own sourcing on them for everybody else (ADR-0020).
 *
 * The Tender's own facts sit above both, and for the Owner everything that decides
 * anything sits in the sheet — one row per Tender Item, undecided Items open, every
 * competing Quote ranked cheapest-first in THB underneath. The layout is wide on purpose
 * and it is one design at every width: the Item's blocks wrap into a column where there is
 * no room for a row, and below 768px the quote table reflows into stacked cards (ADR-0009,
 * #30). Nothing else about the screen changes, and nothing on it scrolls sideways.
 *
 * Everybody else gets {@link SourcingList} in the sheet's place and no Outcome panel:
 * their own Quotes, their own refusals, and no money anywhere. The page never works out
 * which of the two it is drawing — the loader hands it one shape or the other, and
 * `screen` is how it says which.
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
  const view = await loadTenderScreen(id, user.id, store);
  const { tender, members, timezone, referenceImages, unassignedImages, outstandingForYou } =
    view;

  // Another org's Tender and a deleted one are the same answer through RLS, and the
  // same answer is the right one to give.
  if (!tender) notFound();

  const t = await getTranslations("tenders");

  return (
    <Screen
      location={{
        kind: "record",
        backHref: "/tenders",
        reference: tender.reference,
        detail: tender.clientName,
      }}
    >
      {/* No reference in the eyebrow and no way back in the actions: the app bar
          carries both on every screen about one record (#73), and drawing the same
          journey twice spends a row of a 390px phone on something already on screen. */}
      <ScreenHeader
        heading={tender.clientName}
        actions={
          <Button
            variant="outline"
            className="h-11"
            nativeButton={false}
            render={<Link href={`/tenders/${tender.id}/edit`} />}
          >
            {t("edit")}
          </Button>
        }
      >
        <p className="text-muted-foreground text-sm break-words">{tender.title}</p>
      </ScreenHeader>

      {/* First thing under the header, because arriving from a reminder is the most
          common way this screen is opened and "what do I owe" is the question that
          arrival is asking. It draws nothing at all when the reader owes nothing. */}
      <OutstandingBand tenderId={tender.id} items={outstandingForYou} />

      <TenderFacts tender={tender} />

      {/* The one branch on this page, and it is a branch on the *shape* rather than on a
          permission: ADR-0020 gives the comparison sheet, the money and the Outcome panel
          to the Owner, and `loadTenderScreen` answers a shape with none of them in it for
          everybody else. Neither arm can draw what it was not handed, which is why the
          rule is a discriminant here and not an `isOwner` threaded through four
          components. */}
      {view.screen === "comparison" ? (
        <>
          <WorkingSheet
            tenderId={tender.id}
            items={view.sheet.items}
            photos={view.sheet.photos}
            referenceImages={referenceImages}
          />

          <OutcomePanel tender={tender} timezone={timezone} />
        </>
      ) : (
        <SourcingList
          tenderId={tender.id}
          items={view.items}
          photos={view.photos}
          referenceImages={referenceImages}
        />
      )}

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
        // The same sentence the loader asked, asked again rather than a second copy of
        // it written out: `ownsTender` is where "is this reader the Owner" lives, here and
        // in `mayCorrectQuote` both.
        isOwner={ownsTender({ ownerUserId: tender.ownerUserId, callerId: user.id })}
      />
    </Screen>
  );
}

