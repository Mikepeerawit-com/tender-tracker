"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { setFxBufferAction, type FxBufferState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: FxBufferState = {};

/**
 * Where the org's FX Buffer is set, as the percentage it is talked about in.
 *
 * **The box is filled from the column and posts back in the same unit.** A screen that
 * showed 0.02 and took 2 would be one keystroke from a 200% buffer, so the round trip is
 * the percentage in both directions and the fraction never appears here at all —
 * `parseBufferPercent` and `asPercent` are the two halves of it, and they are tested
 * against each other in `fx-buffer.test.ts`.
 *
 * **A text box rather than `type="number"`**, deliberately. A number input hands back an
 * empty string for anything it cannot parse, so "2o" arrives at the server
 * indistinguishable from a blank field, and the one refusal that could have said what was
 * wrong with what somebody typed never gets the chance. `inputMode="decimal"` is what
 * gets the numeric keypad on a phone, which is the half of `type="number"` worth having.
 *
 * The `%` beside the box is `aria-hidden` because the label already carries the unit;
 * read aloud it would say the sign twice and mean it once.
 */
export function CurrencyConversionForm({ percent }: { percent: number }) {
  const t = useTranslations("currencyConversion");
  const [state, formAction, isPending] = useActionState(
    setFxBufferAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("current", { percent })}</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="percent">{t("label")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="percent"
            name="percent"
            type="text"
            inputMode="decimal"
            defaultValue={String(percent)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 w-28"
          />
          <span aria-hidden className="text-muted-foreground text-sm">
            {t("percentSign")}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">{t("help")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("saving") : t("save")}
        </Button>
        {state.status ? (
          <span
            role="status"
            className={
              state.status === "saved"
                ? "text-muted-foreground text-xs"
                : "text-destructive text-xs"
            }
          >
            {t(`status.${state.status}`)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
