"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  refusedQuote,
  submittedQuote,
  type QuoteFormState,
} from "@/lib/quotes/quote-form";
import {
  clearNoSupplierFound,
  createQuote,
  recordNoSupplierFound,
  type MatchType,
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

  // Back to the Item's sourcing screen, at the Quote that was just written down — where
  // its photo input is. The price is saved first and the photos second because the path
  // is keyed by the Quote's id, and because that is the order that survives a phone
  // dying halfway.
  redirect(`/tenders/${tenderId}/items/${tenderItemId}/quote#quote-${result.quoteId}`);
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
    supplierName: text(formData, "supplierName"),
    // `Number("")` is 0, which the price check refuses: a Quote is a price, and not
    // having one is recorded as No Supplier Found rather than as free.
    unitPrice: Number(text(formData, "unitPrice")),
    currency: text(formData, "currency"),
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
