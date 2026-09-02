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
 *
 * **No field here carries a hint of its own.** Every input used to have a sentence under
 * it — nine things to read to write down one price, every visit, by everybody. #91's rule
 * is what settles which survive: **a hint attached to a field goes, a hint attached to a
 * section stays.** A field hint is re-read by everyone every time and says nothing the
 * label did not; a section hint teaches a concept once, at the top of the group where it
 * is used. What is left on this screen is three sentences, none of them under an input:
 * what a Quote is entered in, above the form; what an Alternative is, above the radio
 * group; and when the photos upload, above the picker.
 *
 * The Alternative's own name is the one that argues for an exception and does not get one.
 * It is a field like the others, and the sentence above the radio group — "an alternative
 * is a different product from the one asked for; it carries its own name" — is where that
 * concept is taught, once, on the beat somebody chooses it. `quote-hints.test.tsx` counts
 * what the form draws and `messages.test.ts` holds the retired strings out of the files.
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
        <Field id="supplierName" label={t("supplier")}>
          <Input
            id="supplierName"
            name="supplierName"
            defaultValue={fields.supplierName}
            autoComplete="off"
            className="h-11"
          />
        </Field>

        <Field id="quotedAt" label={t("quotedAt")}>
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

        <Field id="quotedUnit" label={t("quotedUnit")}>
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
        <Field id="alternativeProductName" label={t("alternativeProductName")}>
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
        <Field id="leadTimeDays" label={t("leadTimeDays")}>
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

        <Field id="detailNotes" label={t("detailNotes")}>
          <Textarea id="detailNotes" name="detailNotes" defaultValue={fields.detailNotes} />
        </Field>
      </div>
    </>
  );
}

/**
 * One labelled input.
 *
 * Exported because the currency cell is passed in from outside — the entry form's picker
 * and the correction form's read-only value have to sit in the same grid column, wearing
 * the same label and spacing, or the two screens stop looking like one form.
 *
 * It took an optional `hint` until #91, and the prop went with the last string that used
 * it. Leaving it would have left the form one prop away from filling back up, which is
 * the whole of what that ticket was about; a field that genuinely needs a sentence can
 * have the prop back, and whoever adds it has to say why this one is different.
 */
export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
