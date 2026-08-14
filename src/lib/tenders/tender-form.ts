import type { TenderFields, TenderItemFields, TenderProblem } from "./tenders";

/**
 * The Tender forms' half of a submit: what was typed, and what came back.
 *
 * Separate from `@/app/actions/tenders` because that file is `"use server"`, where every
 * export is an endpoint — and because the shape of what a refused form gives back is the
 * part worth testing, which a module that reaches for `cookies()` cannot be.
 *
 * Everything here is raw strings, exactly as the browser posted them. The parsed
 * `TenderItemFields` are the wrong thing to hand back: `Number("")` is 0, so an Item
 * whose quantity was left blank would return pre-filled with a zero the user never typed.
 */

export type SubmittedItem = {
  productName: string;
  description: string;
  quantity: string;
  unit: string;
};

/** The Tender's own fields, as posted. Every one is a string, `expectedDecisionDate` included. */
export type SubmittedTender = {
  clientName: string;
  title: string;
  dateReceived: string;
  internalQuoteDeadline: string;
  clientSubmissionDeadline: string;
  expectedDecisionDate: string;
  ownerUserId: string;
  notes: string;
};

export type Submitted = { tender?: SubmittedTender; items?: SubmittedItem[] };

export type TenderFormState = {
  error?: TenderProblem;
  /**
   * What the user typed, when the server refused it. React resets the form on every
   * submit, restoring each input from its `defaultValue`, so this is what those defaults
   * are read from — and its absence after a success is what leaves the form blank for
   * the next Item.
   */
  submitted?: Submitted;
};

/** The refusal, and the form as the user left it. */
export function refused(error: TenderProblem, submitted: Submitted): TenderFormState {
  return { error, submitted };
}

/** The Item rows exactly as posted, in document order. */
export function submittedItems(formData: FormData): SubmittedItem[] {
  const count = formData.getAll("itemProductName").length;

  return Array.from({ length: count }, (_unused, index) => ({
    productName: at(formData, "itemProductName", index),
    description: at(formData, "itemDescription", index),
    quantity: at(formData, "itemQuantity", index),
    unit: at(formData, "itemUnit", index),
  }));
}

/** The Tender's own fields exactly as posted. */
export function submittedTender(formData: FormData): SubmittedTender {
  return {
    clientName: text(formData, "clientName"),
    title: text(formData, "title"),
    dateReceived: text(formData, "dateReceived"),
    internalQuoteDeadline: text(formData, "internalQuoteDeadline"),
    clientSubmissionDeadline: text(formData, "clientSubmissionDeadline"),
    expectedDecisionDate: text(formData, "expectedDecisionDate"),
    ownerUserId: text(formData, "ownerUserId"),
    notes: text(formData, "notes"),
  };
}

/**
 * An Item that is already saved, as the form shows it.
 *
 * The domain says `description: string | null` and `quantity: number`; a form has
 * strings and nothing else. Converting in one place is what keeps a null out of a text
 * input, where it renders as the word.
 */
export function itemAsSubmitted(item: TenderItemFields): SubmittedItem {
  return {
    productName: item.productName,
    description: item.description ?? "",
    quantity: String(item.quantity),
    unit: item.unit,
  };
}

/** A Tender that is already saved, as the form shows it. */
export function tenderAsSubmitted(tender: TenderFields): SubmittedTender {
  return {
    clientName: tender.clientName,
    title: tender.title,
    dateReceived: tender.dateReceived,
    internalQuoteDeadline: tender.internalQuoteDeadline,
    clientSubmissionDeadline: tender.clientSubmissionDeadline,
    expectedDecisionDate: tender.expectedDecisionDate ?? "",
    ownerUserId: tender.ownerUserId,
    notes: tender.notes ?? "",
  };
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function at(formData: FormData, name: string, index: number): string {
  return String(formData.getAll(name)[index] ?? "").trim();
}
