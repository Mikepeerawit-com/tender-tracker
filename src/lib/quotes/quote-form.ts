import type { QuoteProblem } from "./quotes";

/**
 * Whether a Quote answers the Item as asked, or offers something else.
 *
 * Lives here rather than in `./quotes` for the same reason the currency list lives
 * outside it: the radio group on the add-quote form renders these in the browser, and
 * that module is `server-only`. `./quotes` re-exports it, so the server-side check and
 * the picker cannot drift apart.
 *
 * A list rather than a bare union: these are radio labels, and a radio reading
 * `quotes.matchType.alternative` is one nobody can choose deliberately — which turns the
 * single field that warns a reviewer they are being offered a different product into a
 * guess. `messages.test.ts` walks this.
 */
export const matchTypes = ["exact", "alternative"] as const;

export type MatchType = (typeof matchTypes)[number];

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
  /**
   * The Quote that was written, on the submit that wrote it, and the one field that says
   * this submit succeeded.
   *
   * The action used to end a successful create in a `redirect()`, which returns nothing
   * by construction — so the id of the Quote just written was never observable by the
   * browser that wrote it. It has to be now: the photos picked on the same pass are
   * uploaded against it, and there is nothing to key them by until the price exists.
   * Hence an id back rather than a redirect out; the action does one or the other, never
   * both.
   */
  quoteId?: string;
};

/** The refusal, and the form as the user left it. */
export function refusedQuote(
  error: QuoteProblem,
  submitted: SubmittedQuote,
): QuoteFormState {
  return { error, submitted };
}

/**
 * The Quote was written, and here is what it is called.
 *
 * No `submitted`: the form re-seeds from its blank defaults on a success, which is what
 * clears it for the next supplier — an Assignee rings several in a row for one Item.
 */
export function savedQuote(quoteId: string): QuoteFormState {
  return { quoteId };
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
