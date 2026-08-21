import type { MatchType, QuoteProblem } from "./quotes";

/**
 * The add-quote form's half of a submit: what was typed, and what came back.
 *
 * Separate from `@/app/actions/quotes` because that file is `"use server"`, where every
 * export is an endpoint — and because the shape of what a refused form gives back is the
 * part worth testing, which a module that reaches for `cookies()` cannot be.
 *
 * Everything here is raw strings, exactly as the browser posted them. The parsed
 * `QuoteFields` are the wrong thing to hand back: `Number("")` is 0, so a price left
 * blank would return pre-filled with a zero nobody typed — and a zero is the one value
 * this form must never appear to have accepted.
 *
 * The stakes are higher here than on the Tender forms. This is typed on a phone, once,
 * while the supplier is still on the line or has just rung off; a refusal that empties
 * the form loses a price that may not be obtainable again today.
 */
export type SubmittedQuote = {
  supplierName: string;
  unitPrice: string;
  currency: string;
  quotedUnit: string;
  leadTimeDays: string;
  matchType: string;
  alternativeProductName: string;
  detailNotes: string;
  quotedAt: string;
};

export type QuoteFormState = {
  error?: QuoteProblem;
  /**
   * What the user typed, when the server refused it. React resets an uncontrolled form
   * on every function-action submit, restoring each input from its `defaultValue`, so
   * this is what those defaults are read from.
   */
  submitted?: SubmittedQuote;
};

/** The refusal, and the form as the user left it. */
export function refusedQuote(
  error: QuoteProblem,
  submitted: SubmittedQuote,
): QuoteFormState {
  return { error, submitted };
}

/** The form exactly as posted. */
export function submittedQuote(formData: FormData): SubmittedQuote {
  return {
    supplierName: text(formData, "supplierName"),
    unitPrice: text(formData, "unitPrice"),
    currency: text(formData, "currency"),
    quotedUnit: text(formData, "quotedUnit"),
    leadTimeDays: text(formData, "leadTimeDays"),
    matchType: text(formData, "matchType"),
    alternativeProductName: text(formData, "alternativeProductName"),
    detailNotes: text(formData, "detailNotes"),
    quotedAt: text(formData, "quotedAt"),
  };
}

/**
 * A blank form, with the two fields that have a sensible starting point filled in.
 *
 * The Item's own unit, because a supplier usually prices in what was asked for and
 * typing it again is a chance to type it differently — and the two not matching is what
 * refuses to rank the whole Item. Today's date, because a Quote is written down the day
 * it is given, and the rate that gets frozen follows from it.
 */
export function blankQuote({
  unit,
  today,
}: {
  unit: string;
  today: string;
}): SubmittedQuote {
  return {
    supplierName: "",
    unitPrice: "",
    currency: "THB",
    quotedUnit: unit,
    leadTimeDays: "",
    matchType: "exact" satisfies MatchType,
    alternativeProductName: "",
    detailNotes: "",
    quotedAt: today,
  };
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
