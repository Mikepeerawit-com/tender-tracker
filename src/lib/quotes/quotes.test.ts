import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { failingRates, respondingRates, unreachableRates } from "@/lib/fx/rate-stub";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { addAssignee, createTender, getTender } from "@/lib/tenders/tenders";

import {
  clearNoSupplierFound,
  createQuote,
  listItemSourcing,
  listQuotes,
  recordNoSupplierFound,
  type QuoteFields,
} from "./quotes";

/**
 * Quotes, through the session client and against the real local Postgres.
 *
 * The shape being held to is the ticket's: an Assignee off the phone with a supplier
 * records the price **in the currency and the unit the supplier gave**, the rate is
 * frozen into the row as it is written, and nothing about a rate service being down can
 * stop any of that happening.
 *
 * Only the Frankfurter boundary is stubbed — one of the two outbound boundaries this
 * project mocks. Everything else is real, because what is risky here lives in the
 * database: the generated `unit_price_thb`, the `alternative_named` constraint, the
 * absence of a unique index on (item, supplier), and the case-insensitive supplier key.
 * None of that survives being lifted out.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const assignee = { id: "", email: `quote-assignee-${run}@example.test` };
const rival = { id: "", email: `quote-rival-${run}@example.test` };
const bystander = { id: "", email: `quote-bystander-${run}@example.test` };
const outsider = { id: "", email: `quote-outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

let tenderId = "";
let itemId = "";
let otherItemId = "";

/** Every currency any test caused a rate to be stored for. `fx_rates` has no org. */
const currenciesTouched = new Set<string>();

async function signedInAs(email: string): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${email}`);

  return store;
}

async function createOrg(name: string): Promise<string> {
  const { data, error } = await service
    .from("orgs")
    .insert({ name })
    .select("id")
    .single();

  if (error) throw error;

  return data.id;
}

async function createMember(org: string, who: { id: string; email: string }) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service
    .from("users")
    .insert({ id: who.id, org_id: org, name: who.email, email: who.email });

  if (profileError) throw profileError;
}

/** A Tender with one Item, with `assignees` enrolled on it. */
async function aTender(
  owner: { id: string; email: string },
  assignees: { id: string; email: string }[] = [],
): Promise<{ tenderId: string; itemId: string }> {
  const store = await signedInAs(owner.email);
  const result = await createTender(
    {
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-20",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: null,
      ownerUserId: owner.id,
      notes: null,
      items: [
        {
          productName: "Nitrile gloves, powder-free",
          description: null,
          quantity: 500,
          unit: "box of 50",
        },
      ],
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  // Creating a Tender does not enrol anybody, the Owner included: Assignees add
  // themselves (ADR-0004), and only an Assignee may enter a Quote.
  for (const who of assignees) {
    const added = await addAssignee(
      { tenderId: result.tenderId, userId: who.id },
      store,
    );

    if (!added.ok) throw new Error(`could not assign ${who.email}: ${added.reason}`);
  }

  const tender = await getTender(result.tenderId, store);

  return { tenderId: result.tenderId, itemId: tender!.items[0].id };
}

/** A Quote as somebody actually gives one, with the awkward fields already filled in. */
function aQuote(overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    tenderItemId: itemId,
    supplierName: "Ace Medical",
    unitPrice: 125.5,
    currency: "THB",
    quotedUnit: "box of 50",
    leadTimeDays: 14,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-18",
    ...overrides,
  };
}

/** A stubbed Frankfurter, remembering which currency it will have cached. */
function rates(rate: number, asOf?: string, currency = "CNY") {
  currenciesTouched.add(currency);

  return respondingRates(rate, asOf);
}

beforeAll(async () => {
  orgId = await createOrg(`Quotes ${run}`);
  otherOrgId = await createOrg(`Quotes other ${run}`);

  await createMember(orgId, assignee);
  await createMember(orgId, rival);
  await createMember(orgId, bystander);
  await createMember(otherOrgId, outsider);

  ({ tenderId, itemId } = await aTender(assignee, [assignee, rival]));
  ({ itemId: otherItemId } = await aTender(outsider, [outsider]));
});

afterEach(async () => {
  // The fixture Item outlives every test, so its Quotes have to not.
  await service.from("quotes").delete().eq("tender_item_id", itemId);
  await service.from("no_supplier_found").delete().eq("tender_item_id", itemId);
  await service.from("suppliers").delete().eq("org_id", orgId);

  if (currenciesTouched.size > 0) {
    await service.from("fx_rates").delete().in("currency", [...currenciesTouched]);
    currenciesTouched.clear();
  }
});

afterAll(async () => {
  await service.from("tenders").delete().in("org_id", [orgId, otherOrgId]);
  await service.from("suppliers").delete().in("org_id", [orgId, otherOrgId]);

  const memberIds = [assignee.id, rival.id, bystander.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId]);
});

describe("entering a Quote", () => {
  it("records everything the supplier said, and who heard it", async () => {
    const store = await signedInAs(assignee.email);

    const result = await createQuote(
      aQuote({
        detailNotes: "Ships from Shenzhen; minimum two boxes.",
        leadTimeDays: 21,
      }),
      store,
    );

    expect(result.ok).toBe(true);

    const [quote] = await listQuotes(itemId, store);

    expect(quote).toMatchObject({
      supplierName: "Ace Medical",
      unitPrice: 125.5,
      currency: "THB",
      quotedUnit: "box of 50",
      leadTimeDays: 21,
      matchType: "exact",
      detailNotes: "Ships from Shenzhen; minimum two boxes.",
      quotedAt: "2026-08-18",
      sourcedByUserId: assignee.id,
      sourcedByName: assignee.email,
    });
  });

  it("keeps both prices when two Assignees ring the same supplier", async () => {
    // The divergence is the most interesting signal in the dataset: it reveals that the
    // negotiating position varies by who calls. There is no unique index behind this and
    // there must be no check in front of it either.
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(rival.email);

    expect((await createQuote(aQuote({ unitPrice: 125 }), mine)).ok).toBe(true);
    expect((await createQuote(aQuote({ unitPrice: 118 }), theirs)).ok).toBe(true);

    const quotes = await listQuotes(itemId, mine);

    expect(quotes).toHaveLength(2);
    expect(quotes.map((quote) => quote.supplierName)).toEqual([
      "Ace Medical",
      "Ace Medical",
    ]);
    expect(quotes.map((quote) => quote.unitPrice)).toEqual([125, 118]);
    expect(quotes.map((quote) => quote.sourcedByUserId)).toEqual([
      assignee.id,
      rival.id,
    ]);
  });

  it("reuses a supplier of the same name whatever its capitals", async () => {
    const store = await signedInAs(assignee.email);

    await createQuote(aQuote({ supplierName: "Ace Medical" }), store);
    await createQuote(aQuote({ supplierName: "  ACE  " }), store);
    await createQuote(aQuote({ supplierName: "ace medical" }), store);

    const { data } = await service
      .from("suppliers")
      .select("id, name")
      .eq("org_id", orgId);

    // "Ace Medical" and "ace medical" are one company; "ACE" is a different name and so
    // is a second supplier. One supplier must not split across rows, and two genuinely
    // different names must not collapse into one.
    expect((data ?? []).map((row) => row.name).sort()).toEqual(["ACE", "Ace Medical"]);
  });

  it("keeps one org's suppliers out of another's", async () => {
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(outsider.email);

    await createQuote(aQuote({ supplierName: "Ace Medical" }), mine);
    await createQuote(
      aQuote({ tenderItemId: otherItemId, supplierName: "Ace Medical" }),
      theirs,
    );

    const { data } = await service
      .from("suppliers")
      .select("org_id")
      .ilike("name", "Ace Medical");

    expect((data ?? []).map((row) => row.org_id).sort()).toEqual(
      [orgId, otherOrgId].sort(),
    );
  });
});

describe("an Alternative", () => {
  it("carries the substitute's own name", async () => {
    const store = await signedInAs(assignee.email);

    const result = await createQuote(
      aQuote({
        matchType: "alternative",
        alternativeProductName: "Vinyl gloves, powder-free",
      }),
      store,
    );

    expect(result.ok).toBe(true);

    const [quote] = await listQuotes(itemId, store);

    expect(quote.matchType).toBe("alternative");
    expect(quote.alternativeProductName).toBe("Vinyl gloves, powder-free");
  });

  it("is refused without one, rather than buried in the notes", async () => {
    const store = await signedInAs(assignee.email);

    const result = await createQuote(
      aQuote({ matchType: "alternative", alternativeProductName: "   " }),
      store,
    );

    expect(result).toEqual({ ok: false, reason: "alternative_unnamed" });
  });

  it("does not let an exact match smuggle one in", async () => {
    const store = await signedInAs(assignee.email);

    await createQuote(
      aQuote({ matchType: "exact", alternativeProductName: "Something else" }),
      store,
    );

    const [quote] = await listQuotes(itemId, store);

    // A row claiming to be exact and naming a substitute would tint amber in one view
    // and rank as like-for-like in another.
    expect(quote.alternativeProductName).toBeNull();
  });
});

describe("the frozen rate", () => {
  it("stores mid, applied and as-of, with the org's buffer applied once", async () => {
    const store = await signedInAs(assignee.email);
    const boundary = rates(4.9138);

    const result = await createQuote(
      aQuote({ currency: "CNY", unitPrice: 100 }),
      store,
      boundary,
    );

    expect(result.ok).toBe(true);

    const [quote] = await listQuotes(itemId, store);

    expect(quote.fxRateMid).toBeCloseTo(4.9138, 8);
    // 2% over ECB mid-market, erring toward overstating cost.
    expect(quote.fxRateApplied).toBeCloseTo(4.9138 * 1.02, 8);
    expect(quote.fxRateAsOf).toBe("2026-08-18");
    expect(quote.fxRateIsStale).toBe(false);
    // Generated by the database from `unit_price * fx_rate_applied`, never by hand.
    expect(quote.unitPriceThb).toBeCloseTo(100 * 4.9138 * 1.02, 4);
  });

  it("reads the buffer from the org, so changing it needs no deploy", async () => {
    const store = await signedInAs(assignee.email);

    await service.from("orgs").update({ fx_buffer_pct: 0.035 }).eq("id", orgId);

    try {
      await createQuote(
        aQuote({ currency: "CNY", unitPrice: 100 }),
        store,
        rates(5),
      );

      const [quote] = await listQuotes(itemId, store);

      expect(quote.fxRateMid).toBeCloseTo(5, 8);
      expect(quote.fxRateApplied).toBeCloseTo(5 * 1.035, 8);
    } finally {
      await service.from("orgs").update({ fx_buffer_pct: 0.02 }).eq("id", orgId);
    }
  });

  it("asks for the day the Quote was given, and stores the day ECB answered with", async () => {
    // ECB publishes on business days only, so a Quote given on a Saturday freezes
    // Friday's rate — and says Friday, not Saturday.
    const store = await signedInAs(assignee.email);
    const boundary = rates(4.9138, "2026-08-14");

    await createQuote(
      aQuote({ currency: "CNY", quotedAt: "2026-08-15" }),
      store,
      boundary,
    );

    expect(boundary.asked).toHaveLength(1);
    expect(boundary.asked[0]).toContain("/2026-08-15");
    expect(boundary.asked[0]).toContain("base=CNY");

    const [quote] = await listQuotes(itemId, store);

    expect(quote.fxRateAsOf).toBe("2026-08-14");
  });

  it("does not convert a THB Quote, or go anywhere near a rate service", async () => {
    const store = await signedInAs(assignee.email);
    const boundary = respondingRates(999);

    await createQuote(aQuote({ currency: "THB", unitPrice: 125.5 }), store, boundary);

    const [quote] = await listQuotes(itemId, store);

    expect(boundary.asked).toEqual([]);
    expect(quote.fxRateMid).toBe(1);
    expect(quote.fxRateApplied).toBe(1);
    expect(quote.fxRateAsOf).toBe("2026-08-18");
    expect(quote.unitPriceThb).toBeCloseTo(125.5, 4);
  });

  it("falls back to the last known rate, marks it stale, and does not block entry", async () => {
    // The acceptance criterion this whole boundary exists for. An Assignee holding a
    // price does not care whether a service in Frankfurt answered.
    const store = await signedInAs(assignee.email);

    // Monday's Quote fetches and caches a rate.
    await createQuote(
      aQuote({ currency: "CNY", quotedAt: "2026-08-17" }),
      store,
      rates(4.9138, "2026-08-17"),
    );

    // Tuesday's cannot reach anything at all.
    const result = await createQuote(
      aQuote({ currency: "CNY", quotedAt: "2026-08-18", unitPrice: 200 }),
      store,
      unreachableRates(),
    );

    expect(result.ok).toBe(true);

    const stale = (await listQuotes(itemId, store)).find(
      (quote) => quote.unitPrice === 200,
    )!;

    expect(stale.fxRateIsStale).toBe(true);
    expect(stale.fxRateMid).toBeCloseTo(4.9138, 8);
    // The day the rate really came from, not the day it was asked for.
    expect(stale.fxRateAsOf).toBe("2026-08-17");
  });

  it("falls back the same way when the service answers with an error", async () => {
    const store = await signedInAs(assignee.email);

    await createQuote(
      aQuote({ currency: "CNY", quotedAt: "2026-08-17" }),
      store,
      rates(4.9138, "2026-08-17"),
    );

    const result = await createQuote(
      aQuote({ currency: "CNY", unitPrice: 200 }),
      store,
      failingRates(503),
    );

    expect(result.ok).toBe(true);
    expect(
      (await listQuotes(itemId, store)).find((quote) => quote.unitPrice === 200)!
        .fxRateIsStale,
    ).toBe(true);
  });

  it("refuses only when there is no rate at all, ever", async () => {
    // The honest floor: `fx_rate_mid` is not null and every total in the app is built on
    // it, so the alternative to refusing is a stored price nothing can convert. It cannot
    // happen for a currency that has been quoted once before.
    const store = await signedInAs(assignee.email);

    await service.from("fx_rates").delete().eq("currency", "ISK");

    const result = await createQuote(
      aQuote({ currency: "ISK" }),
      store,
      unreachableRates(),
    );

    expect(result).toEqual({ ok: false, reason: "no_rate" });
    expect(await listQuotes(itemId, store)).toEqual([]);
  });

  it("keeps what it fetched, so the next Quote has something to fall back to", async () => {
    // The daily cron (#33) fills `fx_rates` properly. Writing here as well is what gives
    // the fallback something to find before that cron exists — and it is the only reason
    // the stale path above can work on the second Quote of the day.
    const store = await signedInAs(assignee.email);

    await createQuote(
      aQuote({ currency: "CNY", quotedAt: "2026-08-17" }),
      store,
      rates(4.9138, "2026-08-17"),
    );

    const { data } = await service
      .from("fx_rates")
      .select("rate_to_thb")
      .eq("currency", "CNY")
      .eq("as_of", "2026-08-17")
      .maybeSingle();

    expect(Number(data?.rate_to_thb)).toBeCloseTo(4.9138, 8);
  });

  it("treats a body it does not recognise as a failure, rather than as a rate", async () => {
    // Fails closed. A response shape that changed under us must not be read as a number
    // by accident — the frozen rate is what every total on the Tender is built from.
    const store = await signedInAs(assignee.email);

    currenciesTouched.add("CNY");
    await service.from("fx_rates").delete().eq("currency", "CNY");

    const nonsense = {
      fetch: (async () =>
        Response.json({ amount: 1, base: "CNY", rates: {} })) as typeof globalThis.fetch,
    };

    expect(
      await createQuote(aQuote({ currency: "CNY" }), store, nonsense),
    ).toEqual({ ok: false, reason: "no_rate" });
  });

  it("refuses a currency ECB does not publish, before asking anybody", async () => {
    const store = await signedInAs(assignee.email);
    const boundary = respondingRates(1);

    const result = await createQuote(aQuote({ currency: "VND" }), store, boundary);

    expect(result).toEqual({ ok: false, reason: "unsupported_currency" });
    expect(boundary.asked).toEqual([]);
  });
});

describe("who may enter a Quote", () => {
  it("refuses somebody who is not an Assignee, and says which problem it is", async () => {
    const store = await signedInAs(bystander.email);

    const result = await createQuote(aQuote(), store);

    // Not `forbidden`: nothing is wrong with them, and the sentence they read has to be
    // the one that tells them to put themselves on the Tender.
    expect(result).toEqual({ ok: false, reason: "not_assignee" });
  });

  it("gives another org's Item the same answer as a deleted one", async () => {
    const store = await signedInAs(assignee.email);

    const result = await createQuote(aQuote({ tenderItemId: otherItemId }), store);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a signed-out caller", async () => {
    const result = await createQuote(aQuote(), memoryCookieStore());

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("what a Quote will not accept", () => {
  it("refuses a price of zero rather than recording a freebie", async () => {
    const store = await signedInAs(assignee.email);

    // A Quote *is* a price. The absence of one is recorded as No Supplier Found.
    expect(await createQuote(aQuote({ unitPrice: 0 }), store)).toEqual({
      ok: false,
      reason: "invalid_price",
    });
    expect(await createQuote(aQuote({ unitPrice: -125 }), store)).toEqual({
      ok: false,
      reason: "invalid_price",
    });
  });

  it("refuses a supplier or a unit that was left blank", async () => {
    const store = await signedInAs(assignee.email);

    expect(await createQuote(aQuote({ supplierName: "  " }), store)).toEqual({
      ok: false,
      reason: "incomplete",
    });
    expect(await createQuote(aQuote({ quotedUnit: "" }), store)).toEqual({
      ok: false,
      reason: "incomplete",
    });
  });

  it("refuses a quoted date that is not a real day", async () => {
    const store = await signedInAs(assignee.email);

    expect(await createQuote(aQuote({ quotedAt: "2026-02-31" }), store)).toEqual({
      ok: false,
      reason: "invalid_date",
    });
  });

  it("refuses a lead time that is not a whole number of days", async () => {
    const store = await signedInAs(assignee.email);

    expect(await createQuote(aQuote({ leadTimeDays: 2.5 }), store)).toEqual({
      ok: false,
      reason: "invalid_lead_time",
    });
    expect(await createQuote(aQuote({ leadTimeDays: -1 }), store)).toEqual({
      ok: false,
      reason: "invalid_lead_time",
    });
  });

  it("takes a lead time nobody stated", async () => {
    const store = await signedInAs(assignee.email);

    expect((await createQuote(aQuote({ leadTimeDays: null }), store)).ok).toBe(true);
    expect((await listQuotes(itemId, store))[0].leadTimeDays).toBeNull();
  });
});

describe("No Supplier Found", () => {
  it("is one Assignee's record, with an optional note", async () => {
    const store = await signedInAs(assignee.email);

    const result = await recordNoSupplierFound(
      { tenderItemId: itemId, note: "Discontinued; nobody stocks it." },
      store,
    );

    expect(result.ok).toBe(true);

    const sourcing = (await listItemSourcing(tenderId, store)).get(itemId);

    expect(sourcing?.noSupplierFound).toEqual([
      expect.objectContaining({
        userId: assignee.id,
        name: assignee.email,
        note: "Discontinued; nobody stocks it.",
      }),
    ]);
  });

  it("takes a second press as the same record, not a conflict", async () => {
    const store = await signedInAs(assignee.email);

    await recordNoSupplierFound({ tenderItemId: itemId, note: null }, store);
    const again = await recordNoSupplierFound(
      { tenderItemId: itemId, note: "Minimum order is ten times what we need." },
      store,
    );

    expect(again.ok).toBe(true);

    const sourcing = (await listItemSourcing(tenderId, store)).get(itemId);

    expect(sourcing?.noSupplierFound).toHaveLength(1);
    expect(sourcing?.noSupplierFound[0].note).toBe(
      "Minimum order is ten times what we need.",
    );
  });

  it("says nothing about what a colleague has tried", async () => {
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(rival.email);

    await recordNoSupplierFound({ tenderItemId: itemId, note: null }, mine);
    await createQuote(aQuote({ unitPrice: 118 }), theirs);

    const sourcing = (await listItemSourcing(tenderId, mine)).get(itemId);

    // Assignees compete rather than divide: one of them giving up and another holding a
    // price is a normal state, and both are shown.
    expect(sourcing?.quoteCount).toBe(1);
    expect(sourcing?.noSupplierFound.map((row) => row.userId)).toEqual([assignee.id]);
  });

  it("is cleared by the Assignee who left it", async () => {
    const store = await signedInAs(assignee.email);

    await recordNoSupplierFound({ tenderItemId: itemId, note: null }, store);

    expect((await clearNoSupplierFound(itemId, store)).ok).toBe(true);
    expect((await listItemSourcing(tenderId, store)).get(itemId)).toBeUndefined();
  });

  it("is cleared by that Assignee going on to enter a Quote", async () => {
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(rival.email);

    await recordNoSupplierFound({ tenderItemId: itemId, note: null }, mine);
    await recordNoSupplierFound({ tenderItemId: itemId, note: null }, theirs);

    await createQuote(aQuote(), mine);

    const sourcing = (await listItemSourcing(tenderId, mine)).get(itemId);

    // Theirs stands: it is a statement about their suppliers, and nobody else's Quote
    // makes it untrue.
    expect(sourcing?.noSupplierFound.map((row) => row.userId)).toEqual([rival.id]);
  });

  it("cannot be recorded by somebody who is not an Assignee", async () => {
    const store = await signedInAs(bystander.email);

    expect(await recordNoSupplierFound({ tenderItemId: itemId, note: null }, store))
      .toEqual({ ok: false, reason: "not_assignee" });
  });
});

describe("what a Tender knows about its own sourcing", () => {
  it("leaves an untouched Item out, because Not Yet Sourced is an absence", async () => {
    const store = await signedInAs(assignee.email);

    // The third state, and the only one that is overdue. An Item nobody has touched means
    // different work from one somebody has already given up on.
    expect((await listItemSourcing(tenderId, store)).get(itemId)).toBeUndefined();
  });

  it("counts the Quotes on an Item", async () => {
    const store = await signedInAs(assignee.email);

    await createQuote(aQuote({ supplierName: "Ace Medical" }), store);
    await createQuote(aQuote({ supplierName: "Siam Surgical" }), store);

    expect((await listItemSourcing(tenderId, store)).get(itemId)?.quoteCount).toBe(2);
  });

  it("tells another org nothing", async () => {
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(outsider.email);

    await createQuote(aQuote(), mine);

    expect((await listItemSourcing(tenderId, theirs)).size).toBe(0);
    expect(await listQuotes(itemId, theirs)).toEqual([]);
  });
});
