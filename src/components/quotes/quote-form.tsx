"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { createQuoteAction, type QuoteFormState } from "@/app/actions/quotes";
import { QuoteProblemNotice } from "@/components/quotes/quote-problem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/fx/currencies";
import type { SubmittedQuote } from "@/lib/quotes/quote-form";
import type { MatchType } from "@/lib/quotes/quotes";

/**
 * Screen 4: what the supplier said, written down before it is forgotten.
 *
 * The shape of this form is the ticket's whole argument. An Assignee is off the phone
 * holding a price **in the currency the supplier quoted, in the unit the supplier
 * quoted**, and the one thing they must not have to do is arithmetic. So currency and
 * unit are fields rather than conversions, the rate is frozen behind the scenes at the
 * moment of saving, and nothing on this screen can fail because a rate service in
 * Frankfurt is down.
 *
 * Everything is uncontrolled and re-seeded from `state.submitted` on every submit, which
 * is what makes a refusal keep the typed price. React resets a form on each
 * function-action submit, refused ones included, so a refusal that carried back only a
 * reason would empty the form it is complaining about — and this one is filled in once,
 * on a phone, holding a number the supplier may not repeat today.
 */
const initialState: QuoteFormState = {};

export function QuoteForm({
  tenderId,
  tenderItemId,
  defaults,
}: {
  tenderId: string;
  tenderItemId: string;
  /** A blank form with the Item's unit and today's date already in it. */
  defaults: SubmittedQuote;
}) {
  const t = useTranslations("quotes");
  const [state, formAction, isPending] = useActionState(createQuoteAction, initialState);

  const fields = state.submitted ?? defaults;

  // The one piece of state on the form, because it decides what else is on the form. It
  // survives a refusal without being told to: the component does not remount, so what is
  // held here is exactly what was posted.
  const [matchType, setMatchType] = useState<MatchType>(
    fields.matchType === "alternative" ? "alternative" : "exact",
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderItemId" value={tenderItemId} />

      <QuoteProblemNotice error={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supplierName" label={t("supplier")} hint={t("supplierHint")}>
          <Input
            id="supplierName"
            name="supplierName"
            defaultValue={fields.supplierName}
            autoComplete="off"
            className="h-11"
          />
        </Field>

        <Field id="quotedAt" label={t("quotedAt")} hint={t("quotedAtHint")}>
          <Input
            id="quotedAt"
            name="quotedAt"
            type="date"
            defaultValue={fields.quotedAt}
            className="h-11"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="unitPrice" label={t("unitPrice")}>
          <Input
            id="unitPrice"
            name="unitPrice"
            type="number"
            // `decimal` rather than `numeric`: a price has a decimal point in it, and the
            // numeric keypad on iOS does not offer one.
            inputMode="decimal"
            min="0"
            step="any"
            defaultValue={fields.unitPrice}
            className="h-11"
          />
        </Field>

        <Field id="currency" label={t("currency")}>
          <NativeSelect
            id="currency"
            name="currency"
            defaultValue={fields.currency}
            className="h-11"
          >
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field id="quotedUnit" label={t("quotedUnit")} hint={t("quotedUnitHint")}>
          <Input
            id="quotedUnit"
            name="quotedUnit"
            defaultValue={fields.quotedUnit}
            className="h-11"
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("matchType.label")}</legend>
        <p className="text-muted-foreground text-xs">{t("matchType.hint")}</p>

        <div className="flex flex-wrap gap-2">
          {(["exact", "alternative"] satisfies MatchType[]).map((option) => (
            <label
              key={option}
              className="border-input has-checked:border-ring has-checked:bg-muted focus-within:ring-ring/50 flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm focus-within:ring-3"
            >
              <input
                type="radio"
                name="matchType"
                value={option}
                checked={matchType === option}
                onChange={() => setMatchType(option)}
              />
              {t(`matchType.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Revealed, and required once revealed. An Alternative that does not say what was
          actually offered is the one Quote nobody can judge: the comparison view's
          QUOTED PRODUCT column is where a reviewer finds out they are being shown a
          different product, and it reads this column and nothing else. */}
      {matchType === "alternative" ? (
        <Field
          id="alternativeProductName"
          label={t("alternativeProductName")}
          hint={t("alternativeProductHint")}
        >
          <Input
            id="alternativeProductName"
            name="alternativeProductName"
            required
            defaultValue={fields.alternativeProductName}
            className="h-11"
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="leadTimeDays" label={t("leadTimeDays")} hint={t("leadTimeHint")}>
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            defaultValue={fields.leadTimeDays}
            className="h-11"
          />
        </Field>

        <Field id="detailNotes" label={t("detailNotes")} hint={t("detailNotesHint")}>
          <Textarea
            id="detailNotes"
            name="detailNotes"
            defaultValue={fields.detailNotes}
          />
        </Field>
      </div>

      <div>
        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
