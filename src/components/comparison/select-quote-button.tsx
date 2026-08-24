"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { selectQuoteAction, type SelectionState } from "@/app/actions/comparison";
import { SelectionProblemNotice } from "@/components/comparison/selection-problem";
import { Button } from "@/components/ui/button";

const initialState: SelectionState = {};

/**
 * The one act this whole screen exists for: a form with three hidden fields and a button,
 * and nothing between the button and the write. `selectQuote` argues why there is no
 * confirmation step and why pressing the Selected row again is the undo.
 */
export function SelectQuoteButton({
  tenderId,
  tenderItemId,
  quoteId,
  isSelected,
}: {
  tenderId: string;
  tenderItemId: string;
  quoteId: string;
  isSelected: boolean;
}) {
  const t = useTranslations("comparison");
  const [state, formAction, isPending] = useActionState(selectQuoteAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderItemId" value={tenderItemId} />
      <input type="hidden" name="quoteId" value={quoteId} />

      <Button
        type="submit"
        variant={isSelected ? "default" : "outline"}
        disabled={isPending}
        className="h-11 w-full"
      >
        {isSelected ? t("selected") : t("select")}
      </Button>

      <SelectionProblemNotice error={state.error} />
    </form>
  );
}
