"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// From `@/lib/quotes/quote-form` rather than from `@/lib/quotes/quotes`, which re-exports
// it: this runs in the browser, and that module is `server-only`.
import { matchTypes, type MatchType, type SubmittedQuote } from "@/lib/quotes/quote-form";

/**
 * The fields a Quote is made of, on the form that enters one and the form that corrects
 * one.
 *
 * Shared rather than copied, for the reason the server shares its validation between the
 * two paths: a correction form that drifted from the entry form is one that accepts what
 * entry refuses, and the drift shows up as a Quote nobody can explain rather than as a
 * failing build.
 *
 * **`matchType` is lifted rather than owned here.** It decides whether the Alternative's
 * name is on the form at all, and the two forms want different things from it after a
 * submit — entry clears back to `exact` for the next supplier, a correction stays as the
 * user left it. Owning it here would make one of those impossible to express.
 *
 * **The currency is a slot, not a field.** Entry picks one; a correction cannot change it,
 * because changing it changes what the stored price means (ADR-0018). Passing the cell in
 * is what keeps "there is no currency input on the edit form" a fact about the markup
 * rather than a `disabled` attribute a posted form could ignore.
 */
export function QuoteFieldInputs({
  fields,
  matchType,
  onMatchType,
  currency,
}: {
  /** The form as it should be seeded — a refused submit's values, or the stored Quote. */
  fields: SubmittedQuote;
  matchType: MatchType;
  onMatchType: (next: MatchType) => void;
  /** The currency cell: a picker when entering, the frozen value when correcting. */
  currency: React.ReactNode;
}) {
  const t = useTranslations("quotes");

  return (
    <>
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

        {currency}

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
          {matchTypes.map((option) => (
            <label
              key={option}
              className="border-input has-checked:border-ring has-checked:bg-muted focus-within:ring-ring/50 flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm focus-within:ring-3"
            >
              <input
                type="radio"
                name="matchType"
                value={option}
                checked={matchType === option}
                onChange={() => onMatchType(option)}
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
          <Textarea id="detailNotes" name="detailNotes" defaultValue={fields.detailNotes} />
        </Field>
      </div>
    </>
  );
}

export function Field({
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
