import { describe, expect, it } from "vitest";

import { itemAsSubmitted, refused, submittedItems, submittedTender } from "./tender-form";

/**
 * What a refused form gives back to the person who filled it in.
 *
 * React resets an uncontrolled form on *every* function-action submit — the refused
 * ones too — restoring each input from its `defaultValue`. So the values a refused
 * submission hands back are not a nicety: they are the only thing standing between a
 * mistyped quantity and a row the user has to type again from memory.
 *
 * They are raw strings on purpose. `Number("")` is 0, and an Item whose quantity the
 * user left blank must come back blank rather than pre-filled with a zero they never
 * typed and now have to notice and clear.
 */

function itemForm(fields: Record<string, string>): FormData {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }

  return formData;
}

describe("what a refused Item form hands back", () => {
  it("keeps a blank quantity blank, rather than the 0 it parses to", () => {
    const formData = itemForm({
      itemProductName: "Surgical masks",
      itemDescription: "",
      itemQuantity: "",
      itemUnit: "piece",
    });

    expect(submittedItems(formData)).toEqual([
      { productName: "Surgical masks", description: "", quantity: "", unit: "piece" },
    ]);
  });
});

describe("what a refused Tender form hands back", () => {
  it("keeps the fields the user filled in, and the ones they left empty", () => {
    // A refused create on /tenders/new takes the whole screen down with it: the client,
    // the title, three dates and the notes, alongside every Item row.
    const formData = itemForm({
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-29",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: "",
      ownerUserId: "a0000000-0000-4000-8000-000000000000",
      notes: "Ring Anong about the gowns.",
    });

    expect(submittedTender(formData)).toEqual({
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-29",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: "",
      ownerUserId: "a0000000-0000-4000-8000-000000000000",
      notes: "Ring Anong about the gowns.",
    });
  });
});

describe("an Item that is already saved, shown in a form", () => {
  it("shows an absent description as an empty field", () => {
    // `description` is `string | null` in the domain and a text input in the form, and
    // the gap between them is how a field comes to read "null".
    expect(
      itemAsSubmitted({
        productName: "Nitrile gloves",
        description: null,
        quantity: 500,
        unit: "box of 50",
      }),
    ).toEqual({
      productName: "Nitrile gloves",
      description: "",
      quantity: "500",
      unit: "box of 50",
    });
  });
});

describe("refused", () => {
  it("carries the reason and what was typed", () => {
    const submitted = {
      items: [{ productName: "Masks", description: "", quantity: "", unit: "piece" }],
    };

    expect(refused("invalid_quantity", submitted)).toEqual({
      error: "invalid_quantity",
      submitted,
    });
  });
});
