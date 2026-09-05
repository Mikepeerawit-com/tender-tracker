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
 *
 * **It says which of the two it is doing** (#144). Choosing the winning Quote is the
 * Owner's decisive act and it writes a Selected Quote the rest of the screen keys off, so
 * the beat between the press and the revalidated row is the one place a fade would be read
 * as a button that had stopped working — and read that way on a phone network, where the
 * beat is longest. The undo is a different sentence from the choice, so it gets its own
 * word rather than a shared one.
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
        {isSelected
          ? isPending
            ? t("deselecting")
            : t("selected")
          : isPending
            ? t("selecting")
            : t("select")}
      </Button>

      <SelectionProblemNotice error={state.error} />
    </form>
  );
}
