import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import type { SheetItem } from "@/lib/comparison/sheet";

import { ItemPricing } from "./item-pricing";

/**
 * The half of the pricing row that only exists once it is interactive: the Margin
 * recomputing in the browser as digits are typed, and the field writing itself back on
 * the way out.
 *
 * The two server actions are the seam's edge and are stubbed. Everything the arithmetic
 * itself claims is asserted next door in `@/lib/comparison/pricing`, over fixtures.
 */

type PricingAction = (previous: unknown, formData: FormData) => Promise<object>;

const saved = {
  landedCost: vi.fn<PricingAction>(async () => ({})),
  sellingPrice: vi.fn<PricingAction>(async () => ({})),
};

vi.mock("@/app/actions/comparison", () => ({
  setLandedCostAction: (previous: unknown, formData: FormData) =>
    saved.landedCost(previous, formData),
  setSellingPriceAction: (previous: unknown, formData: FormData) =>
    saved.sellingPrice(previous, formData),
}));

function anItem(overrides: Partial<SheetItem> = {}): SheetItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    productName: "Nitrile gloves, powder-free",
    description: null,
    quantity: 500,
    unit: "box of 50",
    selectedQuoteId: null,
    landedCostPerUnit: 620,
    landedCostConfirmedAt: "2026-08-22T09:00:00.000Z",
    sellingPricePerUnit: null,
    quotes: [],
    sourcing: { quoteCount: 0, noSupplierFound: [] },
    ...overrides,
  };
}

function renderRow(item: SheetItem) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ItemPricing tenderId="a-tender" item={item} />
    </NextIntlClientProvider>,
  );
}

const landedCostField = () => screen.getByLabelText(/cost to us \/ unit for/i);
const sellingField = () => screen.getByLabelText(/selling \/ unit for/i);

describe("pricing inline in the Item's row", () => {
  // The stubs are shared, so what one test saved must not read as another test's write.
  beforeEach(() => {
    saved.landedCost.mockClear();
    saved.sellingPrice.mockClear();
  });

  it("computes the margin as the selling price is typed", async () => {
    // The whole reason this is a client component: somebody finds the price to bid by
    // moving the selling price until the margin looks right.
    const user = userEvent.setup();

    renderRow(anItem());
    await user.type(sellingField(), "700");

    expect(screen.getByText("THB 80.00")).toBeDefined();
    // On the line, and so through the Item's quantity — never a per-unit figure summed.
    expect(screen.getByText("THB 40,000.00")).toBeDefined();
  });

  it("shows a margin from an unconfirmed landed cost as provisional, not as a number", async () => {
    const user = userEvent.setup();

    renderRow(anItem({ landedCostConfirmedAt: null }));
    await user.type(sellingField(), "700");

    // Per unit and on the line alike: nothing has been added for shipping, duty or
    // handling, so both figures understate the cost.
    expect(screen.getAllByText("Provisional")).toHaveLength(2);
    expect(screen.queryByText("THB 80.00")).toBeNull();
  });

  it("turns provisional into a number the moment the cost is hand-edited", async () => {
    // Writing a landed cost is what confirms it (ADR-0014), so the margin becomes a
    // number as the digits land rather than a round trip later.
    const user = userEvent.setup();

    renderRow(anItem({ landedCostConfirmedAt: null, sellingPricePerUnit: 700 }));

    expect(screen.getAllByText("Provisional")).toHaveLength(2);

    await user.clear(landedCostField());
    await user.type(landedCostField(), "640");

    expect(screen.getByText("THB 60.00")).toBeDefined();
    expect(screen.queryByText("Provisional")).toBeNull();
  });

  it("shows no margin at all until both figures are there", () => {
    renderRow(anItem({ landedCostPerUnit: null }));

    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("follows a landed cost the server has re-prefilled", async () => {
    // Selecting a different Quote re-prefills the cost. The field has to show the new
    // one — and has to leave a selling price somebody is still typing where it is.
    const user = userEvent.setup();
    const { rerender } = renderRow(anItem({ landedCostConfirmedAt: null }));

    await user.type(sellingField(), "700");

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPricing
          tenderId="a-tender"
          item={anItem({ landedCostPerUnit: 595, landedCostConfirmedAt: null })}
        />
      </NextIntlClientProvider>,
    );

    expect(landedCostField()).toHaveProperty("value", "595");
    expect(sellingField()).toHaveProperty("value", "700");
  });

  it("saves a figure on the way out of the field", async () => {
    const user = userEvent.setup();

    renderRow(anItem());
    await user.type(sellingField(), "700");
    await user.tab();

    expect(saved.sellingPrice).toHaveBeenCalled();
  });

  it("confirms an untouched pre-fill when somebody presses Enter on it", async () => {
    // The zero-freight case, and the one this has to get right: when the supplier's
    // price really is the landed cost, the person leaves the digits alone and presses
    // Enter. Nothing else in the row would ever turn that margin into a number.
    const user = userEvent.setup();

    renderRow(anItem({ landedCostConfirmedAt: null }));
    await user.click(landedCostField());
    await user.keyboard("{Enter}");

    expect(saved.landedCost).toHaveBeenCalled();
  });

  it("says what the landed cost field is for without taking a line of the row", async () => {
    // The caption above the field has room for its name and nothing else, so the
    // explanation rides on the field the way the quote table's frozen rate does — on
    // hover, and in the accessible name.
    renderRow(anItem());

    expect(landedCostField()).toHaveProperty(
      "title",
      "Add shipping, duty and handling. Saving confirms the cost.",
    );
  });

  it("writes nothing back for a field somebody only read", async () => {
    // Tabbing across a row of prices to read them must not write four rows back
    // unchanged — and on the landed cost, an unchanged write would confirm a cost
    // nobody has looked at.
    const user = userEvent.setup();

    renderRow(anItem());
    await user.click(landedCostField());
    await user.tab();

    expect(saved.landedCost).not.toHaveBeenCalled();
  });
});
