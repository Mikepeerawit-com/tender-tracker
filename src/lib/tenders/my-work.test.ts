import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { respondingRates } from "@/lib/fx/rate-stub";
import { createQuote, recordNoSupplierFound } from "@/lib/quotes/quotes";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

import {
  addAssignee,
  createTender,
  getTender,
  recordSubmission,
  setItemOutcome,
  type TenderFields,
  type TenderItemFields,
} from "./tenders";
import { listMyWork } from "./my-work";

/**
 * My work, read the way the screen reads it: through the session client, against the
 * real local Postgres.
 *
 * The peer of `worklist.test.ts`, because `listMyWork` is the peer of `listWorklist` —
 * the app's two nav destinations, built and tested the same way (ADR-0021). What that
 * suite proves about groups this one proves about *whose*: every question here is about
 * one Assignee's own answers, and none of it survives being lifted out of the database,
 * since "the caller has quoted this" is a row with their id on it and nothing else.
 *
 * Every date is placed around one fixed `today`, which is passed in rather than read: the
 * clock belongs to the request boundary (ADR-0010).
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

/** The day every Tender below is placed around. Never `new Date()`. */
const today = "2026-08-10";

const service = createServiceClient();

const owner = { id: "", email: `my-work-owner-${run}@example.test` };
/** The caller every assertion is about — an Assignee, and not the Owner. */
const nok = { id: "", email: `my-work-nok-${run}@example.test` };
/** A second Assignee, who competes rather than divides (ADR-0004). */
const somchai = { id: "", email: `my-work-somchai-${run}@example.test` };
const outsider = { id: "", email: `my-work-outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

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

type TenderShape = Partial<TenderFields> & {
  items?: TenderItemFields[];
  /** Who is enrolled to source it. The Owner is not one unless named here. */
  assignees?: { id: string }[];
};

const anItem = (productName = "Nitrile gloves"): TenderItemFields => ({
  productName,
  description: null,
  quantity: 500,
  unit: "box of 50",
});

/**
 * A Tender the Owner recorded, with whoever was named enrolled to source it.
 *
 * Assignees are a parameter rather than a fixture, because who is on a Tender is the one
 * thing every test here varies: the list is defined by it.
 */
async function aTender(
  shape: TenderShape = {},
): Promise<{ id: string; itemIds: string[] }> {
  const { assignees = [nok], items, ...fields } = shape;
  const store = await signedInAs(owner.email);
  const result = await createTender(
    {
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-25",
      clientSubmissionDeadline: "2026-09-01",
      expectedDecisionDate: null,
      ownerUserId: owner.id,
      notes: null,
      items: items ?? [anItem()],
      ...fields,
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  for (const who of assignees) {
    const assigned = await addAssignee(
      { tenderId: result.tenderId, userId: who.id },
      store,
    );

    if (!assigned.ok) throw new Error(`could not enrol an Assignee: ${assigned.reason}`);
  }

  const tender = await getTender(result.tenderId, store);

  return { id: result.tenderId, itemIds: tender!.items.map((item) => item.id) };
}

/** One supplier's price on an Item, entered by whoever is named. */
async function aQuote(tenderItemId: string, by: { email: string }): Promise<string> {
  const result = await createQuote(
    {
      tenderItemId,
      supplierName: "Ace Medical",
      unitPrice: 125.5,
      currency: "THB",
      quotedUnit: "box of 50",
      leadTimeDays: 14,
      matchType: "exact",
      alternativeProductName: null,
      detailNotes: null,
      quotedAt: "2026-08-05",
    },
    await signedInAs(by.email),
    respondingRates(1),
  );

  if (!result.ok) throw new Error(`could not enter a Quote: ${result.reason}`);

  return result.quoteId;
}

/** The list as one person sees it. */
async function myWork(who: { email: string } = nok) {
  return listMyWork(today, await signedInAs(who.email));
}

/** The Items on the list, by id — which is what every question here is really asking. */
async function myItemIds(who: { email: string } = nok): Promise<string[]> {
  return (await myWork(who)).map((row) => row.itemId);
}

beforeAll(async () => {
  orgId = await createOrg(`My work ${run}`);
  otherOrgId = await createOrg(`My work other ${run}`);

  await createMember(orgId, owner);
  await createMember(orgId, nok);
  await createMember(orgId, somchai);
  await createMember(otherOrgId, outsider);
});

afterEach(async () => {
  await service.from("tenders").delete().in("org_id", [orgId, otherOrgId]);
  await service.from("suppliers").delete().in("org_id", [orgId, otherOrgId]);
});

afterAll(async () => {
  const memberIds = [owner.id, nok.id, somchai.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId]);
});

describe("listMyWork", () => {
  it("carries what a row shows: the Item, its client, its reference and its deadline", async () => {
    const { id, itemIds } = await aTender({
      internalQuoteDeadline: "2026-08-12",
      items: [anItem("Nitrile gloves")],
    });

    const [row] = await myWork();

    expect(row).toMatchObject({
      itemId: itemIds[0],
      tenderId: id,
      productName: "Nitrile gloves",
      clientName: "Bangkok General Hospital",
      internalQuoteDeadline: "2026-08-12",
      // Two days off, which is inside the rolling window and so worth a signal rather
      // than an alarm: something is expected of the reader, and nothing is late yet.
      status: { tone: "signal", days: 2 },
    });
    expect(row.reference).toMatch(/^T-\d+$/);
  });

  it("takes a row away when the caller enters a Quote, and leaves the others", async () => {
    const { itemIds } = await aTender({
      items: [anItem("Nitrile gloves"), anItem("Surgical masks")],
    });

    expect(await myItemIds()).toEqual(itemIds);

    await aQuote(itemIds[0], nok);

    // The list shrinks as the work is done, which is the whole of what makes it
    // finishable rather than another thing to scan.
    expect(await myItemIds()).toEqual([itemIds[1]]);
  });

  it("takes a row away when the caller records No Supplier Found", async () => {
    const { itemIds } = await aTender();

    const recorded = await recordNoSupplierFound(
      { tenderItemId: itemIds[0], note: "Nobody stocks this size." },
      await signedInAs(nok.email),
    );

    expect(recorded.ok).toBe(true);
    // Both are answers and only silence is not: giving up honestly clears the row
    // exactly as a price does, or the list would punish the person who reported back.
    expect(await myItemIds()).toEqual([]);
  });

  it("keeps an Item another Assignee has quoted, because they compete rather than divide", async () => {
    const { itemIds } = await aTender({ assignees: [nok, somchai] });

    await aQuote(itemIds[0], somchai);

    // ADR-0004. A colleague's price is not this reader's answer, and a list that
    // dropped the row would be dividing the work the app exists to have duplicated.
    expect(await myItemIds()).toEqual(itemIds);
    expect(await myItemIds(somchai)).toEqual([]);
  });

  it("shows nobody the Items of a Tender they are not an Assignee on", async () => {
    await aTender({ assignees: [somchai] });

    // Readable — it is their org's Tender — and still not their work.
    expect(await myItemIds()).toEqual([]);
    expect(await myItemIds(somchai)).toHaveLength(1);
  });

  it("orders rows by soonest Internal Quote Deadline, whichever Tender they are on", async () => {
    const later = await aTender({ internalQuoteDeadline: "2026-08-20" });
    const sooner = await aTender({ internalQuoteDeadline: "2026-08-11" });
    const between = await aTender({
      internalQuoteDeadline: "2026-08-14",
      // Two Items on one Tender stay in the order they were typed in, and stay together.
      items: [anItem("Nitrile gloves"), anItem("Surgical masks")],
    });

    expect(await myItemIds()).toEqual([
      ...sooner.itemIds,
      ...between.itemIds,
      ...later.itemIds,
    ]);
  });

  it("says a deadline already gone by is an alarm, and a distant one is calm", async () => {
    const overdue = await aTender({ internalQuoteDeadline: "2026-08-07" });
    const distant = await aTender({
      internalQuoteDeadline: "2026-09-30",
      clientSubmissionDeadline: "2026-10-15",
    });

    const status = new Map(
      (await myWork()).map((row) => [row.tenderId, row.status] as const),
    );

    // Sourcing Overdue, and this reader's own: alarm is time, and only time (ADR-0019).
    expect(status.get(overdue.id)).toEqual({ tone: "alarm", days: -3 });
    expect(status.get(distant.id)).toEqual({ tone: "calm", days: 51 });
  });

  it("drops an Item once its Outcome is recorded", async () => {
    const { itemIds } = await aTender({
      items: [anItem("Nitrile gloves"), anItem("Surgical masks")],
    });

    await setItemOutcome(
      { itemId: itemIds[0], outcome: "cancelled", decidedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    // Nothing the reader could do would clear that row: the client pulled the Item, and
    // a finishable list must not hold work nobody is asking for.
    expect(await myItemIds()).toEqual([itemIds[1]]);
  });

  it("drops an Item once the Bid has gone out", async () => {
    const { id, itemIds } = await aTender();

    await recordSubmission(
      { tenderId: id, submittedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    expect(itemIds).toHaveLength(1);
    expect(await myItemIds()).toEqual([]);
  });

  it("gives an Assignee with nothing outstanding an empty list, and a stranger nothing at all", async () => {
    const { itemIds } = await aTender();

    await aQuote(itemIds[0], nok);

    expect(await myWork()).toEqual([]);
    expect(await myItemIds(outsider)).toEqual([]);
    expect(await listMyWork(today, memoryCookieStore())).toEqual([]);
  });
});
