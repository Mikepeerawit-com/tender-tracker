"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { selectQuote, type SelectionProblem } from "@/lib/comparison/sheet";

/**
 * The request boundary for the comparison working sheet. `cookies()` is resolved here and
 * handed down, so everything under `@/lib/comparison` is reachable from a test without a
 * Next request context — the same shape as the Tender and Quote actions.
 */

export type SelectionState = { error?: SelectionProblem };

/**
 * No redirect: the sheet re-renders with the Item now decided, in place. Being sent
 * somewhere else would cost the person the comparison they were in the middle of reading.
 * Why there is no confirm step either is argued at `selectQuote`.
 */
export async function selectQuoteAction(
  _previous: SelectionState,
  formData: FormData,
): Promise<SelectionState> {
  const result = await selectQuote(
    {
      tenderItemId: text(formData, "tenderItemId"),
      quoteId: text(formData, "quoteId"),
    },
    await cookies(),
  );

  if (!result.ok) return { error: result.reason };

  // The whole `/tenders/[id]` subtree, and the list with it: a Selected Quote moves the
  // Tender's derived Progress, which the worklist on the list screen is drawn from.
  revalidatePath(`/tenders/${text(formData, "tenderId")}`, "layout");
  revalidatePath("/tenders");

  return {};
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
