import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { createQuote, type QuoteFields } from "@/lib/quotes/quotes";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { addAssignee, createTender, getTender } from "@/lib/tenders/tenders";

import { getComparisonSheet, selectQuote } from "./sheet";

/**
 * The comparison working sheet's read and its one write, against the real local Postgres.
 *
 * Two things here only exist in the database and do not survive being lifted out of it.
 * The Selected Quote is a **composite** foreign key — `(selected_quote_id, id)` against
 * `quotes(id, tender_item_id)` — so an Item pointing at another Item's Quote is refused
 * by the schema rather than by a check in the app; the test for it is worth having
 * precisely because there is no code to read. And `unit_price_thb` is a generated column,
 * so the THB figures the sheet ranks on are the database's arithmetic, not ours.
 *
 * Ranking itself is tested next door in `ranking.test.ts`, where it is arithmetic over
 * fixtures rather than an afternoon of staged Tenders.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

/**
 * Supplier names are scoped to this run. They are unique on `lower(name)` within an org
 * but not across the database, and another test file asserting globally on a supplier it
 * created would see this one's too.
 */
const suppliers = {
  ace: `Ace Medical ${run}`,
  beta: `Beta Supply ${run}`,
  gamma: `Gamma Trading ${run}`,
};

const owner = { id: "", email: `sheet-owner-${run}@example.test` };
const rival = { id: "", email: `sheet-rival-${run}@example.test` };

let orgId = "";
let tenderId = "";
let glovesId = "";
let syringesId = "";

async function signedInAs(email: string): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${email}`);

  return store;
}

async function createMember(who: { id: string; email: string }) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service
    .from("users")
    .insert({ id: who.id, org_id: orgId, name: who.email, email: who.email });

  if (profileError) throw profileError;
}

/** A Quote as somebody actually gives one, in THB so no rate has to be fetched. */
function aQuote(overrides: Partial<QuoteFields> & { tenderItemId: string }): QuoteFields {
  return {
    supplierName: suppliers.ace,
    unitPrice: 620,
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

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Sheet ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = data.id;

  await createMember(owner);
  await createMember(rival);

  const store = await signedInAs(owner.email);
  const created = await createTender(
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
        {
          productName: "Syringes, 10ml luer lock",
          description: null,
          quantity: 200,
          unit: "box of 100",
        },
      ],
    },
    store,
  );

  if (!created.ok) throw new Error(`could not create a Tender: ${created.reason}`);

  tenderId = created.tenderId;

  for (const who of [owner, rival]) {
    await addAssignee({ tenderId, userId: who.id }, store);
  }

  const tender = await getTender(tenderId, store);

  glovesId = tender!.items[0].id;
  syringesId = tender!.items[1].id;
});

afterEach(async () => {
  await service.from("tender_items").update({ selected_quote_id: null }).eq("tender_id", tenderId);
  await service.from("quotes").delete().in("tender_item_id", [glovesId, syringesId]);
  await service.from("suppliers").delete().eq("org_id", orgId);
});

afterAll(async () => {
  await service.from("tenders").delete().eq("org_id", orgId);
  await service.from("suppliers").delete().eq("org_id", orgId);

  const memberIds = [owner.id, rival.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().eq("id", orgId);
});

describe("reading the whole Tender at once", () => {
  it("puts every Item's competing Quotes under it, in the Items' own order", async () => {
    const store = await signedInAs(owner.email);

    await createQuote(aQuote({ tenderItemId: glovesId }), store);
    await createQuote(
      aQuote({ tenderItemId: glovesId, supplierName: suppliers.beta, unitPrice: 595 }),
      store,
    );
    await createQuote(
      aQuote({
        tenderItemId: syringesId,
        supplierName: suppliers.gamma,
        quotedUnit: "box of 100",
      }),
      store,
    );

    const sheet = await getComparisonSheet(tenderId, store);

    expect(sheet.items.map((item) => item.productName)).toEqual([
      "Nitrile gloves, powder-free",
      "Syringes, 10ml luer lock",
    ]);
    expect(sheet.items.map((item) => item.quotes.length)).toEqual([2, 1]);
    expect(sheet.items[0].quotes.map((quote) => quote.supplierName)).toEqual([
      suppliers.ace,
      suppliers.beta,
    ]);
  });

  it("carries the sourcing of an Item nobody has quoted as the third state", async () => {
    const store = await signedInAs(owner.email);
    const sheet = await getComparisonSheet(tenderId, store);

    // Not Yet Sourced is an absence, and stays one: no Quotes and nobody having said
    // they could not find a supplier are different facts from a row of zeroes.
    expect(sheet.items[0].sourcing).toEqual({ quoteCount: 0, noSupplierFound: [] });
  });

  it("opens with nothing selected and no pricing on it", async () => {
    const store = await signedInAs(owner.email);
    const sheet = await getComparisonSheet(tenderId, store);

    expect(sheet.items[0]).toMatchObject({
      selectedQuoteId: null,
      landedCostPerUnit: null,
      landedCostConfirmedAt: null,
      sellingPricePerUnit: null,
      quantity: 500,
      unit: "box of 50",
    });
  });
});

describe("selecting the winning Quote", () => {
  it("records it in one call, with nothing to confirm", async () => {
    const store = await signedInAs(owner.email);
    const created = await createQuote(aQuote({ tenderItemId: glovesId }), store);

    if (!created.ok) throw new Error(created.reason);

    expect(await selectQuote({ tenderItemId: glovesId, quoteId: created.quoteId }, store))
      .toEqual({ ok: true });

    const sheet = await getComparisonSheet(tenderId, store);

    expect(sheet.items[0].selectedQuoteId).toBe(created.quoteId);
  });

  it("moves the selection when a different Quote wins", async () => {
    const store = await signedInAs(owner.email);
    const first = await createQuote(aQuote({ tenderItemId: glovesId }), store);
    const second = await createQuote(
      aQuote({ tenderItemId: glovesId, supplierName: suppliers.beta, unitPrice: 595 }),
      store,
    );

    if (!first.ok || !second.ok) throw new Error("could not record both Quotes");

    await selectQuote({ tenderItemId: glovesId, quoteId: first.quoteId }, store);
    await selectQuote({ tenderItemId: glovesId, quoteId: second.quoteId }, store);

    const sheet = await getComparisonSheet(tenderId, store);

    expect(sheet.items[0].selectedQuoteId).toBe(second.quoteId);
  });

  it("takes the selection back off the Quote already carrying it", async () => {
    // The undo, and the only one there is: selecting has no confirm step to cancel out
    // of, so pressing the Selected row again is what an accidental click costs.
    const store = await signedInAs(owner.email);
    const created = await createQuote(aQuote({ tenderItemId: glovesId }), store);

    if (!created.ok) throw new Error(created.reason);

    await selectQuote({ tenderItemId: glovesId, quoteId: created.quoteId }, store);
    await selectQuote({ tenderItemId: glovesId, quoteId: created.quoteId }, store);

    const sheet = await getComparisonSheet(tenderId, store);

    expect(sheet.items[0].selectedQuoteId).toBeNull();
  });

  it("refuses a Quote that belongs to another Item, and leaves the selection alone", async () => {
    // The composite foreign key is what refuses this, not a check in the app. Without it
    // the Item's Selected price, its THB conversion and every total built on
    // `per_unit × quantity` would come from an unrelated product.
    const store = await signedInAs(owner.email);
    const gloves = await createQuote(aQuote({ tenderItemId: glovesId }), store);
    const syringes = await createQuote(
      aQuote({
        tenderItemId: syringesId,
        supplierName: suppliers.gamma,
        quotedUnit: "box of 100",
      }),
      store,
    );

    if (!gloves.ok || !syringes.ok) throw new Error("could not record both Quotes");

    await selectQuote({ tenderItemId: glovesId, quoteId: gloves.quoteId }, store);

    expect(
      await selectQuote({ tenderItemId: glovesId, quoteId: syringes.quoteId }, store),
    ).toEqual({ ok: false, reason: "not_found" });

    const sheet = await getComparisonSheet(tenderId, store);

    expect(sheet.items[0].selectedQuoteId).toBe(gloves.quoteId);
  });

  it("lets an Assignee who did not source the Quote select it", async () => {
    // Entering a Quote is the Assignee's own act, because they rang the supplier.
    // Choosing between Quotes already recorded is not: everyone sees all of it, and the
    // person making the call is not necessarily the person who found the price.
    const store = await signedInAs(owner.email);
    const created = await createQuote(aQuote({ tenderItemId: glovesId }), store);

    if (!created.ok) throw new Error(created.reason);

    const theirs = await signedInAs(rival.email);

    expect(await selectQuote({ tenderItemId: glovesId, quoteId: created.quoteId }, theirs))
      .toEqual({ ok: true });
  });

  it("refuses an Item that is not there", async () => {
    const store = await signedInAs(owner.email);

    expect(
      await selectQuote(
        { tenderItemId: crypto.randomUUID(), quoteId: crypto.randomUUID() },
        store,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});
