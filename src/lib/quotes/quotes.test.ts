import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { failingRates, respondingRates, unreachableRates } from "@/lib/fx/rate-stub";
import type { FxBoundary } from "@/lib/fx/rates";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { tenderProgress } from "@/lib/tenders/progress";
import { addAssignee, createTender, getTender } from "@/lib/tenders/tenders";

import {
  clearNoSupplierFound,
  countItemSourcing,
  createQuote,
  deleteQuote,
  listItemSourcing,
  listQuotes,
  recordNoSupplierFound,
  updateQuote,
  type QuoteCorrection,
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
/** An Assignee on the same Tender who sourced none of it — the one an edit must refuse. */
const colleague = { id: "", email: `quote-colleague-${run}@example.test` };
/** An Org Admin, and an Assignee, and neither the Quote's Assignee nor the Owner. */
const admin = { id: "", email: `quote-admin-${run}@example.test` };
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

async function createMember(
  org: string,
  who: { id: string; email: string },
  { isOrgAdmin = false }: { isOrgAdmin?: boolean } = {},
) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service
    .from("users")
    .insert({
      id: who.id,
      org_id: org,
      name: who.email,
      email: who.email,
      is_org_admin: isOrgAdmin,
    });

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

/** The same Quote, written and handed back by id — what a correction needs to aim at. */
async function aWrittenQuote(
  store: SessionCookieStore,
  overrides: Partial<QuoteFields> = {},
  boundary: FxBoundary = {},
): Promise<string> {
  const result = await createQuote(aQuote(overrides), store, boundary);

  if (!result.ok) throw new Error(`could not create a Quote: ${result.reason}`);

  return result.quoteId;
}

/**
 * A correction as the edit form posts one: every correctable field, with no currency
 * among them. Defaults match `aQuote`, so an override is the only thing that changed.
 */
function aCorrection(
  overrides: Partial<Omit<QuoteCorrection, "quoteId">> = {},
): Omit<QuoteCorrection, "quoteId"> {
  return {
    supplierName: "Ace Medical",
    unitPrice: 125.5,
    quotedUnit: "box of 50",
    leadTimeDays: 14,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-18",
    ...overrides,
  };
}

/**
 * The stored row, read past the app's own shaping.
 *
 * `listQuotes` does not carry `created_at` or `updated_at`, and the four rate fields are
 * the ones an edit must leave alone byte for byte — so these assertions read the row
 * rather than the type a screen gets.
 */
async function storedQuote(quoteId: string) {
  const { data, error } = await service
    .from("quotes")
    // One string literal rather than a concatenation: `supabase-js` infers the row type
    // by parsing this at the type level, and a `+` between two halves leaves it with
    // nothing to parse.
    .select(
      "unit_price, currency, quoted_unit, lead_time_days, detail_notes, quoted_at, fx_rate_mid, fx_rate_applied, fx_rate_as_of, fx_rate_is_stale, created_at, updated_at",
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (error) throw error;

  return data;
}

/** The four fields ADR-0018 says move together or not at all. */
function frozenRateOf(row: NonNullable<Awaited<ReturnType<typeof storedQuote>>>) {
  return {
    mid: row.fx_rate_mid,
    applied: row.fx_rate_applied,
    asOf: row.fx_rate_as_of,
    isStale: row.fx_rate_is_stale,
  };
}

beforeAll(async () => {
  orgId = await createOrg(`Quotes ${run}`);
  otherOrgId = await createOrg(`Quotes other ${run}`);

  await createMember(orgId, assignee);
  await createMember(orgId, rival);
  await createMember(orgId, colleague);
  await createMember(orgId, admin, { isOrgAdmin: true });
  await createMember(orgId, bystander);
  await createMember(otherOrgId, outsider);

  // `assignee` owns this Tender as well as being on it, which is what makes the Owner
  // override testable: `rival` sources a Quote the Owner did not.
  ({ tenderId, itemId } = await aTender(assignee, [assignee, rival, colleague, admin]));
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

  const memberIds = [
    assignee.id,
    rival.id,
    colleague.id,
    admin.id,
    bystander.id,
    outsider.id,
  ].filter(Boolean);

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

/**
 * Correcting a Quote, and taking one back.
 *
 * A Quote was written once and could never be touched again (#55). That mattered more
 * than a typo usually does: a wrong Quote is not inert — it feeds the comparison working
 * sheet, it can be an Item's Selected Quote, and a wrong price that happens to be the
 * lowest is the one most likely to be picked.
 *
 * The sharp part is the rate, and ADR-0018 is the contract: correcting a price keeps the
 * frozen rate, correcting `quoted_at` re-freezes it against the new date. Both halves are
 * held to here, because a row carrying the rate for a day it no longer claims is one
 * nothing downstream is written to notice.
 */
describe("correcting a Quote", () => {
  it("writes down what the supplier actually said", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    const result = await updateQuote(
      {
        quoteId,
        ...aCorrection({
          supplierName: "Ace Medical Supplies",
          unitPrice: 118.25,
          quotedUnit: "box of 100",
          leadTimeDays: 21,
          detailNotes: "He misread his own sheet; 118.25 is the real one.",
        }),
      },
      store,
    );

    expect(result.ok).toBe(true);

    const [quote] = await listQuotes(itemId, store);

    expect(quote).toMatchObject({
      supplierName: "Ace Medical Supplies",
      unitPrice: 118.25,
      quotedUnit: "box of 100",
      leadTimeDays: 21,
      detailNotes: "He misread his own sheet; 118.25 is the real one.",
      // Never reassigned by an edit. It is who rang the supplier, and with the same
      // supplier legitimately quoted twice it is the only thing telling two rows apart.
      sourcedByUserId: assignee.id,
    });
  });

  it("recomputes the THB figure from the corrected price", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(
      store,
      { currency: "CNY", unitPrice: 100 },
      rates(5, "2026-08-18"),
    );

    expect((await updateQuote({ quoteId, ...aCorrection({ unitPrice: 200 }) }, store)).ok)
      .toBe(true);

    const [quote] = await listQuotes(itemId, store);

    // Generated by the database from `unit_price * fx_rate_applied`, never by hand.
    expect(quote.unitPriceThb).toBeCloseTo(200 * quote.fxRateApplied, 6);
  });

  it("can turn an exact match into an Alternative, which then carries its own name", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    const result = await updateQuote(
      {
        quoteId,
        ...aCorrection({
          matchType: "alternative",
          alternativeProductName: "Vinyl gloves, powder-free",
        }),
      },
      store,
    );

    expect(result.ok).toBe(true);
    expect((await listQuotes(itemId, store))[0]).toMatchObject({
      matchType: "alternative",
      alternativeProductName: "Vinyl gloves, powder-free",
    });
  });

  it("drops the substitute's name when a correction makes it an exact match again", async () => {
    // Otherwise the row keeps a product name for a Quote that no longer offers one, and
    // the comparison view's QUOTED PRODUCT column names a substitute nobody offered.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store, {
      matchType: "alternative",
      alternativeProductName: "Vinyl gloves, powder-free",
    });

    expect((await updateQuote({ quoteId, ...aCorrection() }, store)).ok).toBe(true);
    expect((await listQuotes(itemId, store))[0]).toMatchObject({
      matchType: "exact",
      alternativeProductName: null,
    });
  });

  it("moves `updated_at`, which until now meant `created_at`", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);
    const before = (await storedQuote(quoteId))!;

    // The column shipped with a default and no trigger. Nothing wrote a Quote after the
    // insert, so it was inert rather than lying — and it would start lying here.
    expect(before.updated_at).toBe(before.created_at);

    expect((await updateQuote({ quoteId, ...aCorrection({ unitPrice: 130 }) }, store)).ok)
      .toBe(true);

    const after = (await storedQuote(quoteId))!;

    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(after.created_at).getTime(),
    );
  });
});

describe("the frozen rate under a correction", () => {
  it("is left exactly as it was when the date does not move", async () => {
    // ADR-0018: a correction to a digit is not a claim about a currency. Re-fetching
    // could only introduce a difference — a later ECB revision, or a stale rate where the
    // original was live.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(
      store,
      { currency: "CNY", unitPrice: 100 },
      rates(4.9138, "2026-08-18"),
    );

    const before = frozenRateOf((await storedQuote(quoteId))!);

    // Answering, and with a different rate on purpose: had the edit re-frozen, the mid
    // would now be 9.99 and the stub would have been asked. Both staying put is proof no
    // freeze was attempted rather than proof one happened to agree.
    const stub = respondingRates(9.99);
    const result = await updateQuote(
      { quoteId, ...aCorrection({ unitPrice: 175, supplierName: "Ace Medical" }) },
      store,
      stub,
    );

    expect(result.ok).toBe(true);
    expect(frozenRateOf((await storedQuote(quoteId))!)).toEqual(before);
    expect(stub.asked).toEqual([]);
  });

  it("is re-frozen against the new date when `quoted_at` moves", async () => {
    // The sharp case. `fx_rate_as_of` has never meant "the day somebody typed this in" —
    // it means the rate for the day the Quote claims. A date edit that left the rate
    // alone would produce a row the create path could not produce.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(
      store,
      { currency: "CNY", unitPrice: 100, quotedAt: "2026-08-18" },
      rates(4.9138, "2026-08-18"),
    );

    const result = await updateQuote(
      { quoteId, ...aCorrection({ unitPrice: 100, quotedAt: "2026-08-19" }) },
      store,
      rates(5.25, "2026-08-19"),
    );

    expect(result.ok).toBe(true);

    const after = (await storedQuote(quoteId))!;

    expect(after.quoted_at).toBe("2026-08-19");
    expect(Number(after.fx_rate_mid)).toBeCloseTo(5.25, 8);
    expect(after.fx_rate_as_of).toBe("2026-08-19");
    expect(after.fx_rate_is_stale).toBe(false);
    // All four move together, the applied rate included — it is the mid with the org's
    // buffer on it, and a mid rewritten under an old applied is the buffer applied to
    // nothing.
    expect(Number(after.fx_rate_applied)).toBeCloseTo(5.25 * 1.02, 8);
  });

  it("records a re-freeze that fell back to a last-known rate as stale, rather than refusing", async () => {
    // An Assignee fixing a date must no more be stopped by a service in Frankfurt than
    // one entering a price was.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(
      store,
      { currency: "CNY", quotedAt: "2026-08-18" },
      rates(4.9138, "2026-08-18"),
    );

    const result = await updateQuote(
      { quoteId, ...aCorrection({ quotedAt: "2026-08-19" }) },
      store,
      unreachableRates(),
    );

    expect(result.ok).toBe(true);

    const after = (await storedQuote(quoteId))!;

    expect(after.quoted_at).toBe("2026-08-19");
    expect(after.fx_rate_is_stale).toBe(true);
    // The day the rate really came from, not the day it was asked for.
    expect(after.fx_rate_as_of).toBe("2026-08-18");
  });

  it("refuses a date it can find no rate for at all, and leaves the row untouched", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(
      store,
      { currency: "CNY", unitPrice: 100 },
      rates(4.9138, "2026-08-18"),
    );

    const before = (await storedQuote(quoteId))!;

    // No cached rate to fall back on, and nothing answering: the one case the create
    // path refuses, for the reason it refuses it — `fx_rate_mid` is `not null` and every
    // total is built on it.
    await service.from("fx_rates").delete().eq("currency", "CNY");

    const result = await updateQuote(
      { quoteId, ...aCorrection({ unitPrice: 999, quotedAt: "2026-08-19" }) },
      store,
      unreachableRates(),
    );

    expect(result).toEqual({ ok: false, reason: "no_rate" });

    // Every field, not just the rate. A refused edit is not a partial one: the price
    // moved in the same submit and must not have landed on its own.
    expect(await storedQuote(quoteId)).toEqual(before);
  });

  it("does not convert a THB Quote whose date was corrected, or go near a rate service", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store, { currency: "THB", unitPrice: 125.5 });
    const stub = respondingRates(4.9138);

    const result = await updateQuote(
      { quoteId, ...aCorrection({ quotedAt: "2026-08-19" }) },
      store,
      stub,
    );

    expect(result.ok).toBe(true);

    const after = (await storedQuote(quoteId))!;

    expect(Number(after.fx_rate_mid)).toBe(1);
    expect(Number(after.fx_rate_applied)).toBe(1);
    expect(after.fx_rate_as_of).toBe("2026-08-19");
    expect(after.fx_rate_is_stale).toBe(false);
    expect(stub.asked).toEqual([]);
  });

  it("keeps the currency the Quote was given in, which no correction may change", async () => {
    // Changing the currency changes what the stored price *means*, which is a different
    // Quote rather than a correction to this one. There is deliberately no field for it.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(
      store,
      { currency: "CNY", unitPrice: 100 },
      rates(4.9138, "2026-08-18"),
    );

    const result = await updateQuote(
      // @ts-expect-error currency is not a correctable field, and this is the assertion.
      { quoteId, ...aCorrection({ currency: "EUR" }) },
      store,
      rates(38, "2026-08-18", "EUR"),
    );

    expect(result.ok).toBe(true);
    expect((await storedQuote(quoteId))!.currency).toBe("CNY");
  });
});

describe("who may correct a Quote", () => {
  it("lets the Assignee who sourced it", async () => {
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    expect((await updateQuote({ quoteId, ...aCorrection({ unitPrice: 99 }) }, theirs)).ok)
      .toBe(true);
  });

  it("refuses another Assignee on the same Tender, and says which problem it is", async () => {
    // Sourced-by is load-bearing: there is no unique index on (Item, supplier) because
    // two Assignees ringing the same supplier is expected and informative, and
    // `created_by_user_id` is the only field telling two otherwise identical rows apart.
    // If any Assignee could edit any Quote, the comparison view's duplicate banner would
    // stop reporting what it claims.
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    const result = await updateQuote(
      { quoteId, ...aCorrection({ unitPrice: 1 }) },
      await signedInAs(colleague.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_sourced_by_you" });
    expect((await listQuotes(itemId, theirs))[0].unitPrice).toBe(125.5);
  });

  it("lets the Tender's Owner correct a Quote they did not source", async () => {
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    const result = await updateQuote(
      { quoteId, ...aCorrection({ unitPrice: 99 }) },
      // `assignee` owns this Tender; `rival` rang the supplier.
      await signedInAs(assignee.email),
    );

    expect(result.ok).toBe(true);
    expect((await listQuotes(itemId, theirs))[0]).toMatchObject({
      unitPrice: 99,
      // Corrected by the Owner, still sourced by the person who made the call.
      sourcedByUserId: rival.id,
    });
  });

  it("refuses an Org Admin who is neither the sourcer nor the Owner", async () => {
    // An Org Admin has no extra visibility and no say over Tenders they do not own.
    // Being on this Tender as an Assignee does not change that.
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    expect(
      await updateQuote(
        { quoteId, ...aCorrection({ unitPrice: 1 }) },
        await signedInAs(admin.email),
      ),
    ).toEqual({ ok: false, reason: "not_sourced_by_you" });
  });

  it("gives another org's Quote the same answer as a deleted one", async () => {
    const quoteId = await aWrittenQuote(await signedInAs(assignee.email));

    expect(
      await updateQuote(
        { quoteId, ...aCorrection() },
        await signedInAs(outsider.email),
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a signed-out caller", async () => {
    const quoteId = await aWrittenQuote(await signedInAs(assignee.email));

    expect(await updateQuote({ quoteId, ...aCorrection() }, memoryCookieStore())).toEqual(
      { ok: false, reason: "forbidden" },
    );
  });
});

describe("what a correction will not accept", () => {
  it("refuses exactly what entry refuses", async () => {
    // The same validation, not a second copy of it that can drift: a form that accepts
    // on edit what it refused on entry is one that launders a bad Quote through the
    // correction path.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    const refusals: [Partial<Omit<QuoteCorrection, "quoteId">>, string][] = [
      [{ unitPrice: 0 }, "invalid_price"],
      [{ supplierName: "  " }, "incomplete"],
      [{ quotedUnit: "" }, "incomplete"],
      [{ quotedAt: "2026-02-31" }, "invalid_date"],
      [{ leadTimeDays: 2.5 }, "invalid_lead_time"],
      [{ matchType: "alternative", alternativeProductName: null }, "alternative_unnamed"],
    ];

    for (const [override, reason] of refusals) {
      expect(await updateQuote({ quoteId, ...aCorrection(override) }, store)).toEqual({
        ok: false,
        reason,
      });
    }

    // Untouched by every one of them.
    expect((await listQuotes(itemId, store))[0].unitPrice).toBe(125.5);
  });
});

describe("taking a Quote back", () => {
  it("is done by the Assignee who sourced it", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    expect(await deleteQuote({ quoteId }, store)).toEqual({ ok: true });
    expect(await listQuotes(itemId, store)).toEqual([]);
  });

  it("refuses another Assignee on the same Tender", async () => {
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    expect(
      await deleteQuote({ quoteId }, await signedInAs(colleague.email)),
    ).toEqual({ ok: false, reason: "not_sourced_by_you" });
    expect(await listQuotes(itemId, theirs)).toHaveLength(1);
  });

  it("is done by the Tender's Owner on a Quote they did not source", async () => {
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    expect(await deleteQuote({ quoteId }, await signedInAs(assignee.email))).toEqual({
      ok: true,
    });
    expect(await listQuotes(itemId, theirs)).toEqual([]);
  });

  it("refuses an Org Admin who is neither the sourcer nor the Owner", async () => {
    const theirs = await signedInAs(rival.email);
    const quoteId = await aWrittenQuote(theirs);

    expect(await deleteQuote({ quoteId }, await signedInAs(admin.email))).toEqual({
      ok: false,
      reason: "not_sourced_by_you",
    });
  });

  it("refuses a signed-out caller", async () => {
    const quoteId = await aWrittenQuote(await signedInAs(assignee.email));

    expect(await deleteQuote({ quoteId }, memoryCookieStore())).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("gives another org's Quote the same answer as a deleted one", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    expect(await deleteQuote({ quoteId }, await signedInAs(outsider.email))).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await listQuotes(itemId, store)).toHaveLength(1);
  });

  it("will not quietly drop an Item's Selected Quote", async () => {
    // The foreign key is composite and clears the selection safely on its own, so nothing
    // dangles. What is missing is not integrity — it is that the Item would lose the one
    // decision anybody made about it with nothing said to anyone.
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    await service
      .from("tender_items")
      .update({ selected_quote_id: quoteId })
      .eq("id", itemId);

    expect(await deleteQuote({ quoteId }, store)).toEqual({
      ok: false,
      reason: "clears_selection",
    });
    expect(await listQuotes(itemId, store)).toHaveLength(1);
  });

  it("goes ahead once the Selected Quote's deletion is confirmed, clearing the selection", async () => {
    const store = await signedInAs(assignee.email);
    const quoteId = await aWrittenQuote(store);

    await service
      .from("tender_items")
      .update({ selected_quote_id: quoteId })
      .eq("id", itemId);

    expect(await deleteQuote({ quoteId, clearingSelection: true }, store)).toEqual({
      ok: true,
    });
    expect(await listQuotes(itemId, store)).toEqual([]);

    const { data } = await service
      .from("tender_items")
      .select("selected_quote_id")
      .eq("id", itemId)
      .single();

    expect(data?.selected_quote_id).toBeNull();
  });

  it("asks for no confirmation when the Quote is not the Selected one", async () => {
    const store = await signedInAs(assignee.email);
    const selected = await aWrittenQuote(store, { supplierName: "Ace Medical" });
    const other = await aWrittenQuote(store, { supplierName: "Beta Surgical" });

    await service
      .from("tender_items")
      .update({ selected_quote_id: selected })
      .eq("id", itemId);

    expect(await deleteQuote({ quoteId: other }, store)).toEqual({ ok: true });

    const { data } = await service
      .from("tender_items")
      .select("selected_quote_id")
      .eq("id", itemId)
      .single();

    // The surviving selection is still the one that was made.
    expect(data?.selected_quote_id).toBe(selected);
  });

  it("takes the Item's last Quote back to Not Yet Sourced, which regresses the Tender", async () => {
    // The derivation already handles this and nothing new is needed for it — but a Tender
    // that went on reading `quoted` with an Item nobody has a price for is exactly the
    // failure a delete path can introduce, so it is pinned end to end rather than at the
    // count that feeds it.
    //
    // Two Items, because that is what makes the regression `sourcing` rather than `new`:
    // one Item still has a price, so the Tender is being worked rather than untouched.
    const store = await signedInAs(assignee.email);
    const built = await createTender(
      {
        clientName: "Bangkok General Hospital",
        title: `Two-item regression ${run}`,
        dateReceived: "2026-08-01",
        internalQuoteDeadline: "2026-08-20",
        clientSubmissionDeadline: "2026-08-28",
        expectedDecisionDate: null,
        ownerUserId: assignee.id,
        notes: null,
        items: [
          {
            productName: "Nitrile gloves, powder-free",
            description: null,
            quantity: 500,
            unit: "box of 50",
          },
          {
            productName: "Surgical masks, type IIR",
            description: null,
            quantity: 200,
            unit: "box of 50",
          },
        ],
      },
      store,
    );

    if (!built.ok) throw new Error(`could not create a Tender: ${built.reason}`);

    const added = await addAssignee(
      { tenderId: built.tenderId, userId: assignee.id },
      store,
    );

    if (!added.ok) throw new Error(`could not assign: ${added.reason}`);

    const items = (await getTender(built.tenderId, store))!.items.map((item) => item.id);

    /** The Tender as `tenderProgress` needs it, built from what the database now says. */
    const progressNow = async () => {
      const counts = await countItemSourcing(items, store);

      return tenderProgress({
        submittedAt: null,
        internalQuoteDeadline: "2026-08-20",
        clientSubmissionDeadline: "2026-08-28",
        items: items.map((id) => ({
          outcome: null,
          quoteCount: counts.get(id)?.quoteCount ?? 0,
          noSupplierFoundCount: counts.get(id)?.noSupplierFoundCount ?? 0,
        })),
      });
    };

    await aWrittenQuote(store, { tenderItemId: items[0] });

    const doomed = await aWrittenQuote(store, { tenderItemId: items[1] });

    // Every Item has a price, so the Bid could be built today.
    expect(await progressNow()).toBe("quoted");

    expect(await deleteQuote({ quoteId: doomed }, store)).toEqual({ ok: true });

    // Absent, not zeroed: Not Yet Sourced is an absence, and `tenderProgress` reads a
    // missing entry as an Item with no Quote.
    expect((await countItemSourcing(items, store)).get(items[1])).toBeUndefined();
    expect(await progressNow()).toBe("sourcing");
  });
});
