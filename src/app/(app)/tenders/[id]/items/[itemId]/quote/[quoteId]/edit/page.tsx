import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppHeader } from "@/components/app-header";
import { EditQuoteForm } from "@/components/quotes/edit-quote-form";
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

  return (
    <>
      <AppHeader
        isOrgAdmin={user.isOrgAdmin}
        location={{
          kind: "record",
          backHref: sourcing,
          reference: tender.reference,
          detail: `${tender.clientName} · ${item.productName}`,
        }}
      />
      <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs break-words">
            {`${tender.reference} · ${item.productName}`}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle")}</h1>
          <p className="text-muted-foreground text-sm break-words">
            {t("sourcedBy", { name: quote.sourcedByName })}
          </p>
        </header>

        <EditQuoteForm
          tenderId={tender.id}
          tenderItemId={item.id}
          quoteId={quote.id}
          currency={quote.currency}
          defaults={quoteAsSubmitted(quote)}
        />
      </main>
      </div>
    </>
  );
}
