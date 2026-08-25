"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { runInstantFromHeaders } from "@/lib/run-instant";

import {
  refused,
  submittedItems,
  submittedTender,
  type Submitted,
  type TenderFormState,
} from "@/lib/tenders/tender-form";
import {
  addAssignee,
  addTenderItem,
  createTender,
  recordSubmission,
  removeAssignee,
  removeTenderItem,
  setItemOutcome,
  updateTender,
  updateTenderItem,
  type TenderFields,
  type TenderItemFields,
  type TenderProblem,
} from "@/lib/tenders/tenders";

/**
 * The request boundary for Tenders. `cookies()` is resolved here and handed down, so
 * everything under `@/lib/tenders` is reachable from a test without a Next request
 * context — the same shape as the auth actions and as ADR-0010's run instant.
 *
 * Every refusal carries back what was typed. React resets an uncontrolled form on every
 * function-action submit, refused ones included, restoring each input from its
 * `defaultValue` — so a refusal that returns only a reason is a refusal that empties the
 * form it is complaining about.
 */

export type { TenderFormState };

export async function createTenderAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const result = await createTender(
    { ...tenderFields(formData), items: itemsFrom(formData) },
    await cookies(),
  );

  if (!result.ok) {
    // The whole screen, not just the reason: a refused create otherwise takes the
    // client, the title, three dates and every Item row down with it.
    return refused(result.reason, {
      tender: submittedTender(formData),
      items: submittedItems(formData),
    });
  }

  revalidatePath("/tenders");

  redirect(`/tenders/${result.tenderId}`);
}

export async function updateTenderAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await updateTender(
    { tenderId, ...tenderFields(formData) },
    // A deadline moved here re-dates every reminder counted back from it, and whether a
    // nudge already marked sent is un-sent by the move is a question about today.
    runInstantFromHeaders(await headers()),
    await cookies(),
  );

  if (!result.ok) return refused(result.reason, { tender: submittedTender(formData) });

  revalidatePath("/tenders");

  redirect(`/tenders/${tenderId}`);
}

export async function addTenderItemAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const result = await addTenderItem(
    { tenderId: text(formData, "tenderId"), ...itemAt(formData, 0) },
    await cookies(),
  );

  // On success nothing is carried back, and the reset React performs anyway is what
  // leaves the panel blank for the next Item.
  return afterTenderWrite(result, text(formData, "tenderId"), {
    items: submittedItems(formData),
  });
}

export async function updateTenderItemAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const result = await updateTenderItem(
    { itemId: text(formData, "itemId"), ...itemAt(formData, 0) },
    await cookies(),
  );

  return afterTenderWrite(result, text(formData, "tenderId"), {
    items: submittedItems(formData),
  });
}

export async function removeTenderItemAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const result = await removeTenderItem(text(formData, "itemId"), await cookies());

  return afterTenderWrite(result, text(formData, "tenderId"));
}

export async function addAssigneeAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await addAssignee(
    { tenderId, userId: text(formData, "userId") },
    await cookies(),
  );

  return afterTenderWrite(result, tenderId);
}

export async function removeAssigneeAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await removeAssignee(
    { tenderId, userId: text(formData, "userId") },
    await cookies(),
  );

  return afterTenderWrite(result, tenderId);
}

/**
 * The Bid went out.
 *
 * The instant is resolved here, at the request boundary, and passed down (ADR-0010) —
 * `submitted_at` is a fact about when something happened, and a clock read further in
 * would put the moment out of reach of any test.
 */
export async function recordSubmissionAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await recordSubmission(
    { tenderId, submittedAt: runInstantFromHeaders(await headers()) },
    await cookies(),
  );

  return afterTenderWrite(result, tenderId);
}

/**
 * It did not, after all.
 *
 * The undo is not a nicety: nothing in the data contradicts a submission recorded in
 * error, and its presence is the only thing standing between a Tender and being reported
 * as Submission Missed.
 */
export async function clearSubmissionAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await recordSubmission({ tenderId, submittedAt: null }, await cookies());

  return afterTenderWrite(result, tenderId);
}

/**
 * How one Tender Item ended, as the picker posted it.
 *
 * An empty field is "not decided yet" and clears both columns. Anything else goes down
 * as it arrived and is checked against the four stored values there — including
 * `partial`, which is a Tender-level display state no row may hold and which only a
 * hand-posted form could offer.
 */
export async function setItemOutcomeAction(
  _previous: TenderFormState,
  formData: FormData,
): Promise<TenderFormState> {
  const tenderId = text(formData, "tenderId");
  const posted = text(formData, "outcome");
  const result = await setItemOutcome(
    {
      itemId: text(formData, "itemId"),
      outcome: posted === "" ? null : posted,
      decidedAt: runInstantFromHeaders(await headers()),
    },
    await cookies(),
  );

  return afterTenderWrite(result, tenderId);
}

/**
 * Report the refusal, or refresh the Tender.
 *
 * The whole `/tenders/[id]` subtree, not just the page the form is on: an Item edited
 * from `/tenders/[id]/edit` changes what `/tenders/[id]` says, and revalidating only the
 * page you can see is how the detail screen ends up showing the Items you just replaced.
 */
function afterTenderWrite(
  result: { ok: true } | { ok: false; reason: TenderProblem },
  tenderId: string,
  submitted: Submitted = {},
): TenderFormState {
  if (!result.ok) return refused(result.reason, submitted);

  revalidatePath(`/tenders/${tenderId}`, "layout");
  revalidatePath("/tenders");

  return {};
}

function tenderFields(formData: FormData): TenderFields {
  return {
    clientName: text(formData, "clientName"),
    title: text(formData, "title"),
    dateReceived: text(formData, "dateReceived"),
    internalQuoteDeadline: text(formData, "internalQuoteDeadline"),
    clientSubmissionDeadline: text(formData, "clientSubmissionDeadline"),
    expectedDecisionDate: optionalText(formData, "expectedDecisionDate"),
    ownerUserId: text(formData, "ownerUserId"),
    notes: optionalText(formData, "notes"),
  };
}

/**
 * The Item rows, read as four parallel lists.
 *
 * A form posts repeated fields in document order, so the nth `itemProductName` belongs
 * with the nth `itemQuantity`. A row where the user typed nothing at all is the blank
 * row the form always offers and is dropped; a row where they typed *something* is
 * kept, so a half-filled row comes back as `incomplete` rather than vanishing.
 */
function itemsFrom(formData: FormData): TenderItemFields[] {
  const count = formData.getAll("itemProductName").length;

  return Array.from({ length: count }, (_unused, index) => index)
    .filter((index) => !isBlankRow(formData, index))
    .map((index) => itemAt(formData, index));
}

function itemAt(formData: FormData, index: number): TenderItemFields {
  return {
    productName: at(formData, "itemProductName", index),
    description: at(formData, "itemDescription", index) || null,
    // `Number("")` is 0, which the quantity check refuses — an Item with no quantity
    // cannot be turned into what the line is worth.
    quantity: Number(at(formData, "itemQuantity", index)),
    unit: at(formData, "itemUnit", index),
  };
}

function isBlankRow(formData: FormData, index: number): boolean {
  return ["itemProductName", "itemDescription", "itemQuantity", "itemUnit"].every(
    (name) => at(formData, name, index) === "",
  );
}

function at(formData: FormData, name: string, index: number): string {
  return String(formData.getAll(name)[index] ?? "").trim();
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function optionalText(formData: FormData, name: string): string | null {
  return text(formData, name) || null;
}
