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
    // `ordinal` has no default on purpose: an Item with no place in the list is a bug in
    // whoever inserted it, and a default would hide it by stacking every Item on 0.
    ordinal: 0,
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
    "tender_item_assignees",
    "tender_items",
    "quotes",
    "quote_photos",
    "reference_images",
    "no_supplier_found",
    "fx_rates",
    "reminders",
    "reminder_deliveries",
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

describe("tender_item_assignees", () => {
  // Asked of the database directly because the guarantees are the database's: the app's
  // upsert is *built on* this key, and the cascade fires on a path no app code walks.
  it("keys on the Item and the person, once", async () => {
    const row = {
      tender_item_id: fixture.tenderItemId,
      user_id: fixture.userId,
      org_id: fixture.orgId,
    };

    const first = await service.from("tender_item_assignees").insert(row);
    const second = await service.from("tender_item_assignees").insert(row);

    expect(first.error).toBeNull();
    expect(second.error?.message).toContain("tender_item_assignees_pkey");

    await service
      .from("tender_item_assignees")
      .delete()
      .match({ tender_item_id: fixture.tenderItemId, user_id: fixture.userId });
  });

  it("goes with its Item, the way the old table went with its Tender", async () => {
    const doomedItem = await insert("tender_items", {
      org_id: fixture.orgId,
      tender_id: fixture.tenderId,
      product_name: "Doomed widget",
      quantity: 1,
      unit: "piece",
      ordinal: 99,
    });

    await service.from("tender_item_assignees").insert({
      tender_item_id: doomedItem,
      user_id: fixture.userId,
      org_id: fixture.orgId,
    });

    await service.from("tender_items").delete().eq("id", doomedItem);

    const { data } = await service
      .from("tender_item_assignees")
      .select("user_id")
      .eq("tender_item_id", doomedItem);

    expect(data).toEqual([]);
  });

  it("left no tender_assignees table behind", async () => {
    // "Replaces" means replaces: two assignment tables would be two answers to "who is
    // on this?", and the one the code no longer reads would be the one that lies.
    const { error } = await service.from("tender_assignees").select("*").limit(0);

    expect(error).not.toBeNull();
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
      ordinal: 1,
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
      ordinal: 0,
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

describe("the Ruled Out Quote", () => {
  // ADR-0032 could not reuse the Selected Quote's shape: a pointer on `tender_items` is
  // one-per-Item by construction, and the Owner may rule out four of five offers. So the
  // mark is columns on the Quote itself, and `ruled_out_at` is what carries the boolean —
  // there is no `is_ruled_out` beside it to disagree with.
  const judgedAt = "2026-09-12T04:00:00Z";

  /** A fresh Quote, marked as the argument says, and whatever the database made of it. */
  async function markedQuote(mark: Record<string, unknown>) {
    const quoteId = await insert("quotes", quote());
    const { error } = await service.from("quotes").update(mark).eq("id", quoteId);

    return { quoteId, error };
  }

  it("records who ruled it out, when, and why", async () => {
    const { quoteId, error } = await markedQuote({
      ruled_out_by_user_id: fixture.userId,
      ruled_out_at: judgedAt,
      ruled_out_note: "Wrong voltage",
    });

    expect(error).toBeNull();

    const { data } = await service
      .from("quotes")
      .select("ruled_out_by_user_id, ruled_out_at, ruled_out_note")
      .eq("id", quoteId)
      .single();

    expect(data?.ruled_out_by_user_id).toBe(fixture.userId);
    expect(new Date(data!.ruled_out_at!).toISOString()).toBe(
      new Date(judgedAt).toISOString(),
    );
    expect(data?.ruled_out_note).toBe("Wrong voltage");
  });

  it("accepts a mark with no note", async () => {
    // The note must never be what stops the discard: the judgement is made several times
    // per Item on a screen the Owner is already scrolling.
    const { error } = await markedQuote({
      ruled_out_by_user_id: fixture.userId,
      ruled_out_at: judgedAt,
    });

    expect(error).toBeNull();
  });

  it("clears the Item's selection as the mark goes on", async () => {
    // The same division `deleteQuote` runs on, where the composite foreign key's `on delete
    // set null` is what makes "nothing dangles" true whatever the app does. A Quote both
    // Selected and Ruled Out is a sentence the sheet cannot render, so the database is what
    // stops it existing rather than two app writes that could half-land.
    const quoteId = await insert("quotes", quote());

    await service
      .from("tender_items")
      .update({ selected_quote_id: quoteId })
      .eq("id", fixture.tenderItemId);

    const { error } = await service
      .from("quotes")
      .update({ ruled_out_by_user_id: fixture.userId, ruled_out_at: judgedAt })
      .eq("id", quoteId);

    expect(error).toBeNull();

    const { data } = await service
      .from("tender_items")
      .select("selected_quote_id")
      .eq("id", fixture.tenderItemId)
      .single();

    expect(data?.selected_quote_id).toBeNull();
  });

  it("hands nothing back to the Item when the mark comes off", async () => {
    // Reopening a Quote says it is under consideration again, not that anybody chose it.
    const quoteId = await insert("quotes", quote());

    await service
      .from("tender_items")
      .update({ selected_quote_id: quoteId })
      .eq("id", fixture.tenderItemId);
    await service
      .from("quotes")
      .update({ ruled_out_by_user_id: fixture.userId, ruled_out_at: judgedAt })
      .eq("id", quoteId);

    const { error } = await service
      .from("quotes")
      .update({ ruled_out_by_user_id: null, ruled_out_at: null })
      .eq("id", quoteId);

    expect(error).toBeNull();

    const { data } = await service
      .from("tender_items")
      .select("selected_quote_id")
      .eq("id", fixture.tenderItemId)
      .single();

    expect(data?.selected_quote_id).toBeNull();
  });

  it("refuses a note with nothing ruled out", async () => {
    // A reason on a Quote that is not ruled out is the same species of stale claim as an
    // Alternative's product name on a row that no longer offers one.
    const { error } = await markedQuote({ ruled_out_note: "Wrong voltage" });

    expect(error?.message).toContain("ruled_out_together");
  });

  it("refuses a time with nobody attached to it", async () => {
    const { error } = await markedQuote({ ruled_out_at: judgedAt });

    expect(error?.message).toContain("ruled_out_together");
  });

  it("refuses somebody with no time attached to them", async () => {
    const { error } = await markedQuote({ ruled_out_by_user_id: fixture.userId });

    expect(error?.message).toContain("ruled_out_together");
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
      // Every Item has a place in its Tender's list, and the column is `not null` with
      // no default so that an insert which forgot one says so rather than guessing.
      ordinal: 2,
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

  it("has nowhere to store a Margin, on any column", async () => {
    // Load-bearing absence, and the one a future reader will most want to add back —
    // usually to make a dashboard query simpler. Margin is selling price less Landed
    // Cost; a stored copy would be a third number to keep in step with two that move,
    // and it would go stale silently, on the figure the business is judged by.
    const { data } = await service
      .from("tender_items")
      .insert(item({ landed_cost_per_unit: 620, selling_price_per_unit: 700 }))
      .select("*")
      .single();

    // Asserted before the columns are read: an insert that failed would hand back no
    // row, and a row with no columns has no `margin` in it either.
    expect(data).not.toBeNull();
    expect(Object.keys(data!).filter((column) => /margin/.test(column))).toEqual([]);
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

  it("accepts only the three themes there is a control for", async () => {
    const { error } = await service
      .from("users")
      .update({ theme: "sepia" })
      .eq("id", fixture.userId);

    expect(error).not.toBeNull();
  });

  it("follows the device until somebody says otherwise", async () => {
    // The one place `theme` parts company with `locale`, which is null until first
    // start-up asks. Nothing asks about a theme, so a row nobody has touched has to
    // already hold the answer that needs no question — otherwise every member arrives on
    // a screen with no palette decided for it.
    const { data } = await service
      .from("users")
      .select("theme")
      .eq("id", fixture.userId)
      .single();

    expect(data?.theme).toBe("system");
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

  it("counts the missed submission forward from the deadline it names", async () => {
    // The one negative offset in the schedule: `due_date` is the day *after* the client
    // deadline, because a deadline has not been missed until it has passed.
    const { error } = await service
      .from("reminders")
      .insert(reminder({ milestone: "submission_missed", days_before: -1 }));

    expect(error).toBeNull();
  });

  it("rejects a milestone outside the four that exist", async () => {
    const { error } = await service
      .from("reminders")
      .insert(reminder({ milestone: "sourcing_overdue", days_before: 0 }));

    expect(error).not.toBeNull();
  });
});

describe("reminder_deliveries", () => {
  // A reminder of this suite's own, so the delivery rows here cannot collide with the
  // ones the send suite's runs write against its orgs.
  let reminderId = "";

  beforeAll(async () => {
    reminderId = await insert("reminders", {
      org_id: fixture.orgId,
      tender_id: fixture.tenderId,
      milestone: "internal_quote",
      days_before: 3,
      due_date: "2026-08-07",
      // Settled already, so the send suite's runs — which sweep every org, this
      // fixture's included, and write email deliveries as they go (ADR-0034) — can
      // never race the inserts below for the same primary key.
      sent: true,
    });
  });

  function delivery(overrides: Record<string, unknown> = {}) {
    return {
      reminder_id: reminderId,
      channel: "email",
      org_id: fixture.orgId,
      delivered_at: "2026-08-10T01:00:00Z",
      ...overrides,
    };
  }

  // First, while the table holds nothing for this reminder — after a success the same
  // row would trip the primary key before the null could be noticed.
  it("requires the instant — the run passes it in, the database never invents one", async () => {
    const { error } = await service
      .from("reminder_deliveries")
      .insert(delivery({ delivered_at: null }));

    expect(error?.message).toContain("delivered_at");
  });

  it("records one Reminder's success on one channel", async () => {
    const { error } = await service.from("reminder_deliveries").insert(delivery());

    expect(error).toBeNull();
  });

  it("refuses a second success on the same channel — that is what stops a re-send", async () => {
    const { error } = await service.from("reminder_deliveries").insert(delivery());

    expect(error?.message).toContain("reminder_deliveries_pkey");
  });

  it("keeps the channels apart — the other transport's success is its own row", async () => {
    const { error } = await service
      .from("reminder_deliveries")
      .insert(delivery({ channel: "wecom" }));

    expect(error).toBeNull();
  });

  it("rejects a channel that is neither email nor wecom", async () => {
    const { error } = await service
      .from("reminder_deliveries")
      .insert(delivery({ channel: "line" }));

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
