"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { deleteQuoteAction, type QuoteFormState } from "@/app/actions/quotes";
import { QuoteProblemNotice } from "@/components/quotes/quote-problem";
import { Button } from "@/components/ui/button";

const initialState: QuoteFormState = {};

/**
 * Edit and delete, on the row of the Quote they act on.
 *
 * Drawn only for the Assignee who sourced the Quote and for the Tender's Owner. That is
 * the same rule the server enforces and not a substitute for it — the point of hiding the
 * controls is that nobody is invited to correct a Quote that is not theirs to correct, not
 * that the refusal would be unsafe without it.
 *
 * ## Deleting asks twice, and only when it costs something
 *
 * A Quote that is its Item's **Selected** Quote takes the selection with it. Nothing
 * dangles — the foreign key clears it — but the Item loses the one decision anybody made
 * about it, so the first press swaps in a sentence naming that and a confirm beside it.
 *
 * The confirm is drawn from what the row already knows rather than from a refused round
 * trip, so the warning arrives before the press rather than after it. `deleteQuote` refuses
 * an unconfirmed delete of a Selected Quote anyway, and `clears_selection` renders through
 * the same notice as every other refusal — so a stale row that has become Selected since
 * the page was drawn is told, rather than quietly getting its way.
 */
export function QuoteRowControls({
  tenderId,
  tenderItemId,
  quoteId,
  supplierName,
  isSelected,
}: {
  tenderId: string;
  tenderItemId: string;
  quoteId: string;
  /** Named in the confirmation, so a row of four Quotes says which one is going. */
  supplierName: string;
  /** Whether this Quote is the Item's Selected Quote, and so costs a decision to delete. */
  isSelected: boolean;
}) {
  const t = useTranslations("quotes");
  const [state, formAction, isPending] = useActionState(deleteQuoteAction, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link
              href={`/tenders/${tenderId}/items/${tenderItemId}/quote/${quoteId}/edit`}
            />
          }
        >
          {t("edit")}
        </Button>

        {/* A Quote nobody selected goes on one press. The second press exists to report a
            cost, and inventing one where there is none teaches people to click through
            it — which is exactly what would make the Selected case fail to land. */}
        {isSelected && !confirming ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            {t("delete")}
          </Button>
        ) : (
          <form action={formAction} className="contents">
            <input type="hidden" name="tenderId" value={tenderId} />
            <input type="hidden" name="quoteId" value={quoteId} />
            {confirming ? (
              <input type="hidden" name="clearingSelection" value="true" />
            ) : null}

            <Button
              type="submit"
              variant={confirming ? "destructive" : "ghost"}
              size="sm"
              disabled={isPending}
            >
              {confirming ? t("deleteConfirm") : t("delete")}
            </Button>
          </form>
        )}

        {confirming ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => setConfirming(false)}
          >
            {t("deleteCancel")}
          </Button>
        ) : null}
      </div>

      {/* Which Quote, then what it costs. Four rows on an Item can carry the same supplier
          name twice over, so the question names the one whose button was pressed. */}
      {confirming ? (
        <p role="alert" className="flex flex-col gap-1 text-sm break-words">
          <span className="font-medium">
            {t("deletePrompt", { supplier: supplierName })}
          </span>
          <span>{t("error.clears_selection")}</span>
        </p>
      ) : null}

      <QuoteProblemNotice error={state.error} />
    </div>
  );
}
