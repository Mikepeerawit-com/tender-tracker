"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

import {
  selectQuote,
  setLandedCost,
  setSellingPrice,
  type PricingProblem,
  type PricingResult,
  type SelectionProblem,
} from "@/lib/comparison/sheet";
import { runInstantFromHeaders } from "@/lib/run-instant";

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

export type PricingState = { error?: PricingProblem };

/**
 * The Landed Cost somebody has typed into an Item's row.
 *
 * Writing it is what confirms it (ADR-0014), so this is also the moment a provisional
 * Margin becomes a number — which is why the instant is resolved here, at the request
 * boundary, and passed down (ADR-0010).
 */
export async function setLandedCostAction(
  _previous: PricingState,
  formData: FormData,
): Promise<PricingState> {
  return priced(
    formData,
    await setLandedCost(
      {
        tenderItemId: text(formData, "tenderItemId"),
        landedCostPerUnit: amount(formData, "landedCostPerUnit"),
        confirmedAt: runInstantFromHeaders(await headers()),
      },
      await cookies(),
    ),
  );
}

/** The selling price beside it. Nothing is confirmed by one and no Margin is stored. */
export async function setSellingPriceAction(
  _previous: PricingState,
  formData: FormData,
): Promise<PricingState> {
  return priced(
    formData,
    await setSellingPrice(
      {
        tenderItemId: text(formData, "tenderItemId"),
        sellingPricePerUnit: amount(formData, "sellingPricePerUnit"),
      },
      await cookies(),
    ),
  );
}

/**
 * What both prices do after a write: nothing, or re-draw the sheet where it stands.
 *
 * The totals bar under the Item rows is server-rendered from these figures, so the
 * revalidation is what moves it. The Margin *in the row* has already moved — it is
 * computed in the browser as the digits are typed, and the saved figure only has to
 * agree with what the person is already looking at.
 */
function priced(formData: FormData, result: PricingResult): PricingState {
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/tenders/${text(formData, "tenderId")}`, "layout");
  revalidatePath("/tenders");

  return {};
}

/**
 * A THB amount as somebody typed one, or null for a field they have emptied.
 *
 * Anything that is not a number arrives as `NaN` and is refused, rather than silently
 * becoming zero — a silently-zero landed cost reports the entire selling price as Margin.
 */
function amount(formData: FormData, name: string): number | null {
  const typed = text(formData, name);

  return typed === "" ? null : Number(typed);
}
