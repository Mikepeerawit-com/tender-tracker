import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "./service-client";

/**
 * The v1 schema, asserted through the same client library the app uses. Two kinds of
 * claim live here, and the second is the reason the file exists.
 *
 * The first is ordinary: the tables are there, the generated column computes, the
 * CHECK constraints refuse what they are meant to refuse.
 *
 * The second guards four *absences* that each look like an oversight and are not — no
 * `tenders.status`, no unique index on `(tender_item_id, supplier_id)`, `outcome` on
 * the Item rather than the Tender, no `users.mobile`. Every one of them is a thing a
 * future reader will helpfully add back. A comment cannot stop that; a failing test
 * can. See buildspec_2.md, "Four schema decisions a future reader will want to undo".
 */

const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const fixture = {
  orgId: "",
  userId: "",
  supplierId: "",
  tenderId: "",
  tenderItemId: "",
};

function quote(overrides: Record<string, unknown> = {}) {
  return {
    org_id: fixture.orgId,
    tender_item_id: fixture.tenderItemId,
    supplier_id: fixture.supplierId,
    created_by_user_id: fixture.userId,
    unit_price: 12.5,
    currency: "CNY",
    quoted_unit: "piece",
    fx_rate_mid: 5,
    fx_rate_applied: 5.1,
    fx_rate_as_of: "2026-08-10",
    match_type: "exact",
    quoted_at: "2026-08-10",
    ...overrides,
  };
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await service.from(table).insert(row).select("id").single();

  if (error) throw error;

  return data.id as string;
}

beforeAll(async () => {
  fixture.orgId = await insert("orgs", { name: `Schema ${run}` });

  const { data, error } = await service.auth.admin.createUser({
    email: `schema-${run}@example.test`,
    password: "correct-horse-battery-staple",
    email_confirm: true,
  });

  if (error) throw error;

  fixture.userId = data.user.id;

  await service.from("users").insert({
    id: fixture.userId,
    org_id: fixture.orgId,
    name: "Schema fixture",
    email: `schema-${run}@example.test`,
  });

  fixture.supplierId = await insert("suppliers", {
    org_id: fixture.orgId,
    name: `Supplier ${run}`,
  });

  fixture.tenderId = await insert("tenders", {
    org_id: fixture.orgId,
    reference: `S-${run}`,
    client_name: "Bangkok General",
    title: "Examination gloves",
    date_received: "2026-08-01",
    internal_quote_deadline: "2026-08-10",
    client_submission_deadline: "2026-08-17",
    owner_user_id: fixture.userId,
  });

  fixture.tenderItemId = await insert("tender_items", {
    org_id: fixture.orgId,
    tender_id: fixture.tenderId,
    product_name: "Nitrile gloves, size M",
    quantity: 500,
    unit: "box of 50",
  });
});

afterAll(async () => {
  // `tender_items` and `quotes` cascade from the tender; the rest does not.
  await service.from("tenders").delete().eq("id", fixture.tenderId);
  await service.from("suppliers").delete().eq("id", fixture.supplierId);
  await service.from("users").delete().eq("id", fixture.userId);
  await service.auth.admin.deleteUser(fixture.userId);
  await service.from("orgs").delete().eq("id", fixture.orgId);
});

describe("the v1 schema", () => {
  const tables = [
    "orgs",
    "users",
    "suppliers",
    "tenders",
    "tender_assignees",
    "tender_items",
    "quotes",
    "quote_photos",
    "reference_images",
    "no_supplier_found",
    "fx_rates",
    "reminders",
    "notifications",
  ];

  it.each(tables)("has a %s table", async (table) => {
    const { error } = await service.from(table).select("*").limit(0);

    expect(error).toBeNull();
  });

  it("seeds exactly one org, on Bangkok time with the 2% FX buffer", async () => {
    const { data, error } = await service
      .from("orgs")
      .select("timezone, fx_buffer_pct")
      .eq("name", "Taihue");

    expect(error).toBeNull();
    expect(data).toEqual([{ timezone: "Asia/Bangkok", fx_buffer_pct: 0.02 }]);
  });
});

describe("quotes", () => {
  it("stores the THB unit price as mid-plus-buffer times the quoted price", async () => {
    const { data, error } = await service
      .from("quotes")
      .insert(quote({ unit_price: 12.5, fx_rate_applied: 5.1 }))
      .select("unit_price_thb")
      .single();

    expect(error).toBeNull();
    expect(Number(data?.unit_price_thb)).toBeCloseTo(63.75, 6);
  });

  it("refuses to be written a THB price of its own", async () => {
    const { error } = await service
      .from("quotes")
      .insert(quote({ unit_price_thb: 1 }));

    expect(error).not.toBeNull();
  });

  it("requires an Alternative to name the product actually quoted", async () => {
    const { error } = await service
      .from("quotes")
      .insert(quote({ match_type: "alternative" }));

    expect(error?.message).toContain("alternative_named");
  });

  it("accepts an Alternative that names it", async () => {
    const { error } = await service.from("quotes").insert(
      quote({
        match_type: "alternative",
        alternative_product_name: "Vinyl gloves, size M",
      }),
    );

    expect(error).toBeNull();
  });

  it("rejects a match type outside the vocabulary", async () => {
    const { error } = await service.from("quotes").insert(quote({ match_type: "close" }));

    expect(error).not.toBeNull();
  });

  it("lets two colleagues quote the same supplier for the same Item", async () => {
    // Load-bearing absence: competing calls to one supplier produce different prices,
    // and that difference is the most interesting signal in the dataset. A unique index
    // here would delete it and stop the second caller recording their work at all.
    const first = await service.from("quotes").insert(quote({ unit_price: 12.5 }));
    const second = await service.from("quotes").insert(quote({ unit_price: 11.8 }));

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });
});

describe("the Selected Quote", () => {
  // A8 chose `tender_items.selected_quote_id` over `quotes.is_selected` to make "one
  // Selected Quote per Item" structural rather than a rule the app has to keep. A plain
  // FK to `quotes(id)` only gets half of that: it stops two Quotes being selected, but
  // happily points an Item at a Quote belonging to a different Item — after which the
  // Item's price, its THB conversion and every total derived from it come from an
  // unrelated Item, with nothing anywhere able to notice.
  const other = { itemId: "", quoteId: "" };
  let ownQuoteId = "";

  beforeAll(async () => {
    ownQuoteId = await insert("quotes", quote());

    other.itemId = await insert("tender_items", {
      org_id: fixture.orgId,
      tender_id: fixture.tenderId,
      product_name: "Surgical gowns",
      quantity: 40,
      unit: "piece",
    });
    other.quoteId = await insert("quotes", quote({ tender_item_id: other.itemId }));
  });

  it("accepts a Quote on the Item doing the selecting", async () => {
    const { error } = await service
      .from("tender_items")
      .update({ selected_quote_id: ownQuoteId })
      .eq("id", fixture.tenderItemId);

    expect(error).toBeNull();
  });

  it("refuses a Quote belonging to a different Item", async () => {
    const { error } = await service
      .from("tender_items")
      .update({ selected_quote_id: other.quoteId })
      .eq("id", fixture.tenderItemId);

    expect(error).not.toBeNull();
  });

  it("clears the selection when the selected Quote is deleted", async () => {
    const quoteId = await insert("quotes", quote({ tender_item_id: other.itemId }));

    await service
      .from("tender_items")
      .update({ selected_quote_id: quoteId })
      .eq("id", other.itemId);

    // The FK is composite, so its referencing columns include `tender_items.id` — the
    // primary key. An unqualified `on delete set null` would try to null that too and
    // fail the delete outright, so the column list is load-bearing, not decoration.
    const { error } = await service.from("quotes").delete().eq("id", quoteId);

    expect(error).toBeNull();

    const { data } = await service
      .from("tender_items")
      .select("selected_quote_id")
      .eq("id", other.itemId)
      .single();

    expect(data?.selected_quote_id).toBeNull();
  });

  it("lets a Tender with Selected Quotes still be deleted", async () => {
    // `quotes` cascades from `tender_items`, which cascades from `tenders`, and
    // `tender_items` now points back into `quotes`. That cycle is where a composite FK
    // most plausibly deadlocks a cascade, so the delete is exercised rather than
    // assumed.
    const tenderId = await insert("tenders", {
      org_id: fixture.orgId,
      reference: `S-${run}-cascade`,
      client_name: "Bangkok General",
      title: "Cascade",
      date_received: "2026-08-01",
      internal_quote_deadline: "2026-08-10",
      client_submission_deadline: "2026-08-17",
      owner_user_id: fixture.userId,
    });
    const itemId = await insert("tender_items", {
      org_id: fixture.orgId,
      tender_id: tenderId,
      product_name: "Cannulas",
      quantity: 10,
      unit: "piece",
    });
    const quoteId = await insert("quotes", quote({ tender_item_id: itemId }));

    await service
      .from("tender_items")
      .update({ selected_quote_id: quoteId })
      .eq("id", itemId);

    const { error } = await service.from("tenders").delete().eq("id", tenderId);

    expect(error).toBeNull();

    const { data } = await service.from("quotes").select("id").eq("id", quoteId);

    expect(data).toEqual([]);
  });
});

describe("prices", () => {
  it("refuses a negative unit price", async () => {
    // A typo'd -125 ranks first in a comparison view that sorts by cheapest THB, and
    // wins every comparison it appears in.
    const { error } = await service.from("quotes").insert(quote({ unit_price: -125 }));

    expect(error).not.toBeNull();
  });

  it("refuses a unit price of nothing", async () => {
    const { error } = await service.from("quotes").insert(quote({ unit_price: 0 }));

    expect(error).not.toBeNull();
  });

  it("refuses a negative landed cost", async () => {
    const { error } = await service
      .from("tender_items")
      .update({ landed_cost_per_unit: -1 })
      .eq("id", fixture.tenderItemId);

    expect(error).not.toBeNull();
  });

  it("refuses a negative selling price", async () => {
    const { error } = await service
      .from("tender_items")
      .update({ selling_price_per_unit: -1 })
      .eq("id", fixture.tenderItemId);

    expect(error).not.toBeNull();
  });

  it("refuses a zero FX rate, which would route around the price floor", async () => {
    // unit_price_thb is generated from unit_price * fx_rate_applied, so a zero rate
    // produces a zero THB price on a perfectly valid quoted price.
    const { error } = await service
      .from("quotes")
      .insert(quote({ fx_rate_applied: 0 }));

    expect(error).not.toBeNull();
  });

  it("refuses a negative mid rate", async () => {
    const { error } = await service.from("quotes").insert(quote({ fx_rate_mid: -5 }));

    expect(error).not.toBeNull();
  });

  it("refuses a zero rate at the source the fetch writes to", async () => {
    const { error } = await service
      .from("fx_rates")
      .insert({ currency: "XXX", as_of: "2026-08-10", rate_to_thb: 0 });

    expect(error).not.toBeNull();
  });

  it("allows a line priced at zero, which is a real way to bid", async () => {
    const { error } = await service
      .from("tender_items")
      .update({ landed_cost_per_unit: 0, selling_price_per_unit: 0 })
      .eq("id", fixture.tenderItemId);

    expect(error).toBeNull();
  });
});

describe("tender_items", () => {
  function item(overrides: Record<string, unknown> = {}) {
    return {
      org_id: fixture.orgId,
      tender_id: fixture.tenderId,
      product_name: "Surgical masks",
      quantity: 100,
      unit: "box",
      ...overrides,
    };
  }

  it("carries the Outcome, because a client can split an award", async () => {
    // Load-bearing absence: Outcome is deliberately not on `tenders`. The Tender-level
    // outcome is derived, and its `partial` value can never be stored.
    const { error } = await service
      .from("tender_items")
      .insert(item({ outcome: "won", outcome_at: "2026-09-01T00:00:00.000Z" }));

    expect(error).toBeNull();
  });

  it("refuses an Outcome without the date it was recorded", async () => {
    const { error } = await service.from("tender_items").insert(item({ outcome: "won" }));

    expect(error?.message).toContain("outcome_dated");
  });

  it("refuses an Outcome date without an Outcome", async () => {
    const { error } = await service
      .from("tender_items")
      .insert(item({ outcome_at: "2026-09-01T00:00:00.000Z" }));

    expect(error?.message).toContain("outcome_dated");
  });

  it("refuses a quantity of nothing", async () => {
    const { error } = await service.from("tender_items").insert(item({ quantity: 0 }));

    expect(error).not.toBeNull();
  });

  it("rejects an Outcome outside the vocabulary", async () => {
    const { error } = await service
      .from("tender_items")
      .insert(item({ outcome: "partial", outcome_at: "2026-09-01T00:00:00.000Z" }));

    // `partial` is a Tender-level display state, derived from the Items. It can never
    // be stored, on either table.
    expect(error).not.toBeNull();
  });
});

describe("users", () => {
  it("accepts only the two locales the app ships", async () => {
    const { error } = await service
      .from("users")
      .update({ locale: "th" })
      .eq("id", fixture.userId);

    expect(error).not.toBeNull();
  });

  it("leaves the locale null until first start-up asks", async () => {
    const { data } = await service
      .from("users")
      .select("locale")
      .eq("id", fixture.userId)
      .single();

    expect(data?.locale).toBeNull();
  });
});

describe("reminders", () => {
  function reminder(overrides: Record<string, unknown> = {}) {
    return {
      org_id: fixture.orgId,
      tender_id: fixture.tenderId,
      milestone: "internal_quote",
      due_date: "2026-08-08",
      ...overrides,
    };
  }

  it("anchors on an offset", async () => {
    const { error } = await service.from("reminders").insert(reminder({ days_before: 3 }));

    expect(error).toBeNull();
  });

  it("anchors on an absolute date, for the decision chase", async () => {
    const { error } = await service.from("reminders").insert(
      reminder({ milestone: "decision_chase", remind_on: "2026-09-15" }),
    );

    expect(error).toBeNull();
  });

  it("refuses two anchors", async () => {
    const { error } = await service
      .from("reminders")
      .insert(reminder({ days_before: 3, remind_on: "2026-09-15" }));

    expect(error?.message).toContain("anchor_exactly_one");
  });

  it("refuses no anchor", async () => {
    const { error } = await service.from("reminders").insert(reminder());

    expect(error?.message).toContain("anchor_exactly_one");
  });

  it("rejects a milestone outside the three that exist", async () => {
    const { error } = await service
      .from("reminders")
      .insert(reminder({ milestone: "submission_missed", days_before: 0 }));

    expect(error).not.toBeNull();
  });
});

describe("uniqueness", () => {
  it("treats supplier names as the same regardless of case", async () => {
    const { error } = await service
      .from("suppliers")
      .insert({ org_id: fixture.orgId, name: `SUPPLIER ${run}`.toUpperCase() });

    expect(error).not.toBeNull();
  });

  it("will not let two Tenders in one org share a reference", async () => {
    // `tenders_org_reference_key` is still there and still the backstop, but it can no
    // longer be reached from a client: since the reference became generated, a caller
    // supplying a duplicate gets a fresh one issued instead of an error. The guarantee
    // is the same and it is now unbreakable rather than merely enforced.
    const { data, error } = await service
      .from("tenders")
      .insert({
        org_id: fixture.orgId,
        reference: `S-${run}`,
        client_name: "Bangkok General",
        title: "Duplicate reference",
        date_received: "2026-08-01",
        internal_quote_deadline: "2026-08-10",
        client_submission_deadline: "2026-08-17",
        owner_user_id: fixture.userId,
      })
      .select("id, reference")
      .single();

    expect(error).toBeNull();
    expect(data?.reference).not.toBe(`S-${run}`);

    await service.from("tenders").delete().eq("id", data?.id);
  });
});

describe("the columns that must stay absent", () => {
  it("has no status on tenders — progress is derived on read", async () => {
    const { error } = await service.from("tenders").select("status").limit(0);

    expect(error).not.toBeNull();
  });

  it("has no outcome on tenders — a client can award part of one", async () => {
    const { error } = await service.from("tenders").select("outcome").limit(0);

    expect(error).not.toBeNull();
  });

  it("has no mobile on users — mentions target the WeCom userid", async () => {
    const { error } = await service.from("users").select("mobile").limit(0);

    expect(error).not.toBeNull();
  });

  it("has no role on users — under ten trusted users, everyone sees everything", async () => {
    const { error } = await service.from("users").select("role").limit(0);

    expect(error).not.toBeNull();
  });

  it("never stores margin — it is selling price less landed cost", async () => {
    const { error } = await service.from("tender_items").select("margin").limit(0);

    expect(error).not.toBeNull();
  });
});
