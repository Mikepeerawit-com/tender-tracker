"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  refusedQuote,
  savedQuote,
  submittedQuote,
  type QuoteFormState,
} from "@/lib/quotes/quote-form";
import {
  clearNoSupplierFound,
  createQuote,
  deleteQuote,
  recordNoSupplierFound,
  updateQuote,
  type MatchType,
  type QuoteCorrection,
  type QuoteFields,
  type QuoteProblem,
} from "@/lib/quotes/quotes";

/**
 * The request boundary for Quotes. `cookies()` is resolved here and handed down, so
 * everything under `@/lib/quotes` is reachable from a test without a Next request
 * context — the same shape as the Tender actions and as ADR-0010's run instant.
 *
 * A refused Quote carries back every field that was typed. React resets an uncontrolled
 * form on every function-action submit, refused ones included, so a refusal that returned
 * only a reason would empty the form it is complaining about — and this form is typed on
 * a phone, once, holding a price the supplier may not repeat today.
 */

export type { QuoteFormState };

export async function createQuoteAction(
  _previous: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const tenderId = text(formData, "tenderId");
  const tenderItemId = text(formData, "tenderItemId");
  const result = await createQuote(quoteFields(formData, tenderItemId), await cookies());

  if (!result.ok) return refusedQuote(result.reason, submittedQuote(formData));

  revalidatePath(`/tenders/${tenderId}`, "layout");
  revalidatePath("/tenders");

  // The id, rather than a redirect back to the Item's sourcing screen at this Quote's
  // anchor. The redirect existed to put somebody beside the photo input of the row that
  // had just appeared — a second pass through the screen for one supplier call, which is
  // the thing #60 removes. The photos are now picked on the way in and uploaded against
  // this id the moment it exists, on the page the browser never left.
  //
  // One or the other, never both: `redirect()` throws, so an action that redirects has no
  // return value for a caller to read an id out of.
  return savedQuote(result.quoteId);
}

/**
 * A correction to a Quote already written, ending back on the Item's sourcing screen.
 *
 * A redirect rather than an id, which is the opposite of what the create action does and
 * for the opposite reason: this form is a page of its own, opened from a Quote's row, so
 * the thing to do after a correction lands is to put somebody back where they pressed
 * Edit. Nothing is uploaded against the result, so there is no id for a caller to need.
 */
export async function updateQuoteAction(
  _previous: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const tenderId = text(formData, "tenderId");
  const tenderItemId = text(formData, "tenderItemId");
  const result = await updateQuote(
    { quoteId: text(formData, "quoteId"), ...correctableFields(formData) },
    await cookies(),
  );

  if (!result.ok) return refusedQuote(result.reason, submittedQuote(formData));

  revalidatePath(`/tenders/${tenderId}`, "layout");
  revalidatePath("/tenders");

  redirect(`/tenders/${tenderId}/items/${tenderItemId}/quote`);
}

/**
 * Take a Quote back, from its own row on the sourcing screen.
 *
 * Stays where it is rather than redirecting: the row simply goes, and the person deleting
 * it is usually part-way through a run of supplier calls on that Item.
 *
 * `clearingSelection` is the second press. The module refuses the first one when the Quote
 * is its Item's Selected Quote, and this carries back the confirmation that answers it.
 */
export async function deleteQuoteAction(
  _previous: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const result = await deleteQuote(
    {
      quoteId: text(formData, "quoteId"),
      clearingSelection: formData.get("clearingSelection") === "true",
    },
    await cookies(),
  );

  return afterQuoteWrite(result, text(formData, "tenderId"));
}

export async function recordNoSupplierFoundAction(
  _previous: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const result = await recordNoSupplierFound(
    {
      tenderItemId: text(formData, "tenderItemId"),
      note: optionalText(formData, "note"),
    },
    await cookies(),
  );

  return afterQuoteWrite(result, text(formData, "tenderId"));
}

export async function clearNoSupplierFoundAction(
  _previous: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const result = await clearNoSupplierFound(
    text(formData, "tenderItemId"),
    await cookies(),
  );

  return afterQuoteWrite(result, text(formData, "tenderId"));
}

/**
 * Report the refusal, or refresh the Tender.
 *
 * The whole `/tenders/[id]` subtree: sourcing is recorded on the Item's own screen and
 * read on the Tender detail screen, and the list's worklist blocks turn on whether an
 * Item is Not Yet Sourced.
 */
function afterQuoteWrite(
  result: { ok: true } | { ok: false; reason: QuoteProblem },
  tenderId: string,
): QuoteFormState {
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/tenders/${tenderId}`, "layout");
  revalidatePath("/tenders");

  return {};
}

function quoteFields(formData: FormData, tenderItemId: string): QuoteFields {
  return {
    tenderItemId,
    // Read here and nowhere else. A correction has no currency field, because changing it
    // changes what the stored price means (ADR-0018) — and a shared reader that pulled it
    // out of the form anyway is how a hidden input would come to be honoured.
    currency: text(formData, "currency"),
    ...correctableFields(formData),
  };
}

/** Everything both forms post, read once so entry and correction cannot drift apart. */
function correctableFields(formData: FormData): Omit<QuoteCorrection, "quoteId"> {
  return {
    supplierName: text(formData, "supplierName"),
    // `Number("")` is 0, which the price check refuses: a Quote is a price, and not
    // having one is recorded as No Supplier Found rather than as free.
    unitPrice: Number(text(formData, "unitPrice")),
    quotedUnit: text(formData, "quotedUnit"),
    leadTimeDays: optionalNumber(formData, "leadTimeDays"),
    // Anything that is not the word `alternative` is an exact match. The toggle only ever
    // posts one of the two, and a Quote silently recorded as an Alternative would tint a
    // row amber and claim a substitute nobody offered.
    matchType: (text(formData, "matchType") === "alternative"
      ? "alternative"
      : "exact") satisfies MatchType,
    alternativeProductName: optionalText(formData, "alternativeProductName"),
    detailNotes: optionalText(formData, "detailNotes"),
    quotedAt: text(formData, "quotedAt"),
  };
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function optionalText(formData: FormData, name: string): string | null {
  return text(formData, name) || null;
}

/** Blank is "not stated", which is what a nullable column means. Anything else is parsed. */
function optionalNumber(formData: FormData, name: string): number | null {
  const raw = text(formData, name);

  return raw === "" ? null : Number(raw);
}
