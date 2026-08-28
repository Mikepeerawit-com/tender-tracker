"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { updateQuoteAction, type QuoteFormState } from "@/app/actions/quotes";
import { Field, QuoteFieldInputs } from "@/components/quotes/quote-fields";
import { QuoteProblemNotice } from "@/components/quotes/quote-problem";
import { Button } from "@/components/ui/button";
import { type MatchType, type SubmittedQuote } from "@/lib/quotes/quote-form";

const initialState: QuoteFormState = {};

/**
 * Correcting a Quote that is already written down.
 *
 * The same fields as the entry form, seeded from the stored Quote instead of from a blank,
 * and refused submits carry back what was typed for the same reason they do there.
 *
 * **No currency input, and no photo picker.** The currency is shown and not offered: it
 * decides what the stored `unit_price` means, so changing it is a different Quote rather
 * than a correction (ADR-0018), and the server has no field to read it from on this path.
 * Photos are attached from the Quote's own row on the sourcing screen, which is where they
 * already live — an edit form that also uploaded would be a second way to do one thing.
 *
 * A plain server action, unlike the entry form: nothing here has to be sequenced in the
 * browser, so this one keeps the progressive enhancement that one gives up.
 */
export function EditQuoteForm({
  tenderId,
  tenderItemId,
  quoteId,
  currency,
  defaults,
}: {
  tenderId: string;
  tenderItemId: string;
  quoteId: string;
  /** Shown, never posted. The stored value is the only one the server will use. */
  currency: string;
  /** The Quote as it stands, in the shape the inputs seed from. */
  defaults: SubmittedQuote;
}) {
  const t = useTranslations("quotes");
  const [state, formAction, isPending] = useActionState(updateQuoteAction, initialState);

  // Seeded from the stored Quote, and afterwards the user's own. Unlike the entry form
  // this never resets: a correction ends by leaving the page, so there is no next one.
  const [matchType, setMatchType] = useState<MatchType>(
    defaults.matchType === "alternative" ? "alternative" : "exact",
  );

  const fields = state.submitted ?? defaults;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderItemId" value={tenderItemId} />
      <input type="hidden" name="quoteId" value={quoteId} />

      <QuoteProblemNotice error={state.error} />

      <QuoteFieldInputs
        fields={fields}
        matchType={matchType}
        onMatchType={setMatchType}
        currency={
          // A read-only cell rather than a disabled select. A disabled input posts
          // nothing, but a select that merely *looks* settled invites the question; this
          // says the currency is a fact about the Quote, and the hint below the form says
          // what to do when it is the wrong one.
          <Field id="currency" label={t("currency")}>
            <p
              id="currency"
              className="border-input text-muted-foreground flex h-11 items-center rounded-lg border px-3 text-sm"
            >
              {t("editCurrency", { currency })}
            </p>
          </Field>
        }
      />

      <p className="text-muted-foreground text-xs">{t("editHint")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("saving") : t("saveCorrection")}
        </Button>

        <Button
          variant="ghost"
          className="h-11"
          nativeButton={false}
          render={<Link href={`/tenders/${tenderId}/items/${tenderItemId}/quote`} />}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
