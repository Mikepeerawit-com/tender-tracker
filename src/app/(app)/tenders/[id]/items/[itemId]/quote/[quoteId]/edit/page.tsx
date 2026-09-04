import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EditQuoteForm } from "@/components/quotes/edit-quote-form";
import { Screen } from "@/components/screen";
import { Measure } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { mayCorrectQuote, quoteAsSubmitted } from "@/lib/quotes/quote-form";
import { listQuotes } from "@/lib/quotes/quotes";
import { getTender } from "@/lib/tenders/tenders";

/**
 * Correcting one Quote, on a page of its own.
 *
 * A page rather than an inline form on the sourcing screen, which is where the Edit
 * control lives. That screen is a list of what has been recorded plus the form for the
 * next supplier, and an editable row inside it would put two forms on screen that post
 * different things and look the same — on a phone, mid-call.
 *
 * **Who gets here.** The Assignee who sourced the Quote, and the Tender's Owner. Anybody
 * else is sent back to the sourcing screen rather than shown a form the server will
 * refuse. `updateQuote` makes the same check and is the one that decides; this is so the
 * refusal is not discovered after re-typing a price.
 */
export default async function EditQuotePage({
  params,
}: PageProps<"/tenders/[id]/items/[itemId]/quote/[quoteId]/edit">) {
  const { id, itemId, quoteId } = await params;
  const store = await cookies();
  const user = await currentUser(store);

  if (!user) redirect("/login");

  const tender = await getTender(id, store);

  // Another org's Tender and a deleted one are the same answer through RLS, and the same
  // answer is the right one to give.
  if (!tender) notFound();

  const item = tender.items.find((candidate) => candidate.id === itemId);

  if (!item) notFound();

  // Read from the Item's own list rather than by id: it is the read this screen's sibling
  // already makes, and it settles in one query that the Quote exists *and* belongs to the
  // Item in the URL. A Quote of another Item reached through this path is not found.
  const quote = (await listQuotes(itemId, store)).find(
    (candidate) => candidate.id === quoteId,
  );

  if (!quote) notFound();

  const sourcing = `/tenders/${tender.id}/items/${item.id}/quote`;

  if (
    !mayCorrectQuote({
      sourcedByUserId: quote.sourcedByUserId,
      callerId: user.id,
      ownerUserId: tender.ownerUserId,
    })
  ) {
    redirect(sourcing);
  }

  const t = await getTranslations("quotes");
  const nav = await getTranslations("nav");

  return (
    <Screen
      location={{
        kind: "record",
        backHref: sourcing,
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
      {/* `ScreenHeader` rather than a header of its own, which is what keeps ADR-0022's
          split — the heading spanning the region, the line under it at the measure — in one
          place instead of six copies of it. */}
      <ScreenHeader
        eyebrow={`${tender.reference} · ${item.productName}`}
        heading={t("editTitle")}
      >
        <p className="text-muted-foreground text-sm break-words">
          {t("sourcedBy", { name: quote.sourcedByName })}
        </p>
      </ScreenHeader>

      <Measure>
        <EditQuoteForm
          tenderId={tender.id}
          tenderItemId={item.id}
          quoteId={quote.id}
          currency={quote.currency}
          defaults={quoteAsSubmitted(quote)}
        />
      </Measure>
    </Screen>
  );
}
