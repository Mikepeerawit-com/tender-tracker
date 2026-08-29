import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ImageCountBadge } from "@/components/images/image-count-badge";
import { ItemBrief } from "@/components/quotes/item-brief";
import { NoSupplierFoundForm } from "@/components/quotes/no-supplier-found-form";
import { QuoteForm } from "@/components/quotes/quote-form";
import { QuoteList } from "@/components/quotes/quote-list";
import { Screen } from "@/components/screen";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { currentUser } from "@/lib/auth/session";
import { todayIn } from "@/lib/calendar-date";
import { loadItemSourcingScreen } from "@/lib/quotes/item-sourcing-screen";
import { blankQuote } from "@/lib/quotes/quote-form";
import { runInstantFromHeaders } from "@/lib/run-instant";
import { getTender } from "@/lib/tenders/tenders";

/**
 * Sourcing one Tender Item — buildspec_2.md screen 4.
 *
 * Everything an Assignee does after ringing a supplier is on this one page: what has
 * already been recorded against the Item, the form for what was just heard, and the way
 * to say that nobody could supply it at all. They ring several suppliers in a row for the
 * same Item, so the screen is built for coming back to rather than for one pass through.
 *
 * The client's own Reference Images sit at the top, because the question a supplier is
 * being asked about is *this picture* — and because the Quote Photos that come back are
 * only judgeable next to it.
 */
export default async function ItemSourcingPage({
  params,
}: PageProps<"/tenders/[id]/items/[itemId]/quote">) {
  const { id, itemId } = await params;
  const store = await cookies();
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const tender = await getTender(id, store);

  // Another org's Tender and a deleted one are the same answer through RLS, and the same
  // answer is the right one to give.
  if (!tender) notFound();

  const item = tender.items.find((candidate) => candidate.id === itemId);

  // An Item id that is not on *this* Tender, which is a different page from the one that
  // was asked for whether or not the Item exists somewhere else.
  if (!item) notFound();

  const t = await getTranslations("quotes");
  const tenders = await getTranslations("tenders");
  const nav = await getTranslations("nav");

  // Only an Assignee may enter a Quote on a Tender: they are the one who actually rang
  // the supplier, and every Quote records which of them it was. Nothing is wrong with
  // anybody else — Assignees enrol themselves (ADR-0004) — so the page offers the way in
  // rather than refusing.
  const isAssignee = tender.assignees.some((assignee) => assignee.id === user.id);

  // One call, and every read inside it that can run alongside another does. It is a
  // function rather than a run of awaits here because that ordering has a silent failure
  // in it — see `loadItemSourcingScreen`, which is where it is explained and tested.
  const { quotes, photos, refusals, referenceImages, timezone, members, selectedQuoteId } =
    await loadItemSourcingScreen(
      // The org's members are read only for the enrol-yourself control below, and that
      // control is drawn on exactly one branch of this page. An Assignee — who is who
      // this screen is for — never sees it, and now never pays for it either.
      { tenderId: tender.id, tenderItemId: item.id, withMembers: !isAssignee },
      store,
    );

  // The day the org is having, not the one the server is having: Vercel runs UTC, which
  // would default a Bangkok evening's Quote to yesterday. The instant is resolved once
  // here, at the top of the render, and passed down (ADR-0010).
  const today = todayIn(timezone, runInstantFromHeaders(await headers()));

  return (
    <Screen
      location={{
        kind: "record",
        backHref: `/tenders/${tender.id}`,
        reference: tender.reference,
        // Through a message, not composed here: the separator is punctuation, and
        // Chinese wants a full-width one. A `·` written into JSX is a string no
        // translator can reach.
        detail: nav("itemLocation", {
          client: tender.clientName,
          item: item.productName,
        }),
      }}
    >
      {/* The brief the Assignee checks themselves against before typing a number, with
          the client's own pictures inside it. The reference and the client name are not
          repeated here — the app bar carries them (#73). */}
      <ItemBrief
        productName={item.productName}
        quantity={item.quantity}
        unit={item.unit}
        description={item.description}
        internalQuoteDeadline={tender.internalQuoteDeadline}
        images={
          referenceImages.length > 0 ? (
            <ImageCountBadge
              openLabel={tenders("referenceImages.openCount", {
                label: item.productName,
                count: referenceImages.length,
              })}
              images={referenceImages}
            />
          ) : null
        }
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">
          {t("recorded", { count: quotes.length })}
        </h2>
        <QuoteList
          tenderId={tender.id}
          tenderItemId={item.id}
          quotes={quotes}
          photos={photos}
          callerId={user.id}
          ownerUserId={tender.ownerUserId}
          selectedQuoteId={selectedQuoteId}
        />
      </section>

      {isAssignee ? (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">{t("add")}</h2>
              <p className="text-muted-foreground text-xs">{t("addHint")}</p>
            </div>

            <QuoteForm
              tenderId={tender.id}
              tenderItemId={item.id}
              defaults={blankQuote({ unit: item.unit, today })}
            />
          </section>

          <section className="border-border rounded-lg border border-dashed p-4">
            <NoSupplierFoundForm
              tenderId={tender.id}
              tenderItemId={item.id}
              mine={refusals.find((row) => row.userId === user.id) ?? null}
              others={refusals.filter((row) => row.userId !== user.id)}
            />
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-4">
          <p className="border-border rounded-lg border px-3 py-2 text-sm">
            {t("notAssignee")}
          </p>

          {/* The way in, on the page that just said no — rather than a sentence sending
              somebody back to a screen to find a control they have not seen. */}
          <AssigneeControls
            tenderId={tender.id}
            assignees={tender.assignees}
            members={members ?? []}
            callerId={user.id}
            isOwner={tender.ownerUserId === user.id}
          />
        </section>
      )}
    </Screen>
  );
}
