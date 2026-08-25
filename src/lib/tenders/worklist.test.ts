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
import { worklistBlocks, type WorklistBlock } from "./progress";
import { listWorklist } from "./worklist";

/**
 * The worklist, read the way the screen reads it: through the session client, against
 * the real local Postgres.
 *
 * `progress.test.ts` holds the rules as arithmetic. What is left here is the half that
 * does not survive being lifted out of the database — that a Quote *row*, a No Supplier
 * Found *row* and an Outcome *column* are what the blocks are actually derived from, and
 * that deleting the row takes the derivation back with it. Derive-on-read is the whole
 * design (ADR-0001), so the thing worth asserting is that the read really does derive.
 *
 * Every date here is placed around one fixed `today`, which is passed in rather than
 * read: the clock belongs to the request boundary (ADR-0010), and a suite that asked the
 * wall clock what day it was would rot on a particular Tuesday.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

/** The day every Tender below is placed around. Never `new Date()`. */
const today = "2026-08-10";

const service = createServiceClient();

const owner = { id: "", email: `worklist-owner-${run}@example.test` };
const outsider = { id: "", email: `worklist-outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

async function signedInAs(email: string): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${email}`);

  return store;
}

async function createOrg(name: string): Promise<string> {
  const { data, error } = await service.from("orgs").insert({ name }).select("id").single();

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

type TenderShape = Partial<TenderFields> & { items?: TenderItemFields[] };

const anItem = (productName = "Nitrile gloves"): TenderItemFields => ({
  productName,
  description: null,
  quantity: 500,
  unit: "box of 50",
});

/**
 * A Tender, with the Owner enrolled as an Assignee so that Quotes can be entered on it.
 * Returns its Items in order, because everything interesting here is done to one of them.
 */
async function aTender(
  shape: TenderShape = {},
): Promise<{ id: string; itemIds: string[] }> {
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
      items: [anItem()],
      ...shape,
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  const assigned = await addAssignee({ tenderId: result.tenderId, userId: owner.id }, store);

  if (!assigned.ok) throw new Error(`could not enrol the Owner: ${assigned.reason}`);

  const tender = await getTender(result.tenderId, store);

  return { id: result.tenderId, itemIds: tender!.items.map((item) => item.id) };
}

/** One supplier's price on an Item, through the real write path with a stubbed rate. */
async function aQuote(tenderItemId: string, supplierName = "Ace Medical"): Promise<string> {
  const result = await createQuote(
    {
      tenderItemId,
      supplierName,
      unitPrice: 125.5,
      currency: "THB",
      quotedUnit: "box of 50",
      leadTimeDays: 14,
      matchType: "exact",
      alternativeProductName: null,
      detailNotes: null,
      quotedAt: "2026-08-05",
    },
    await signedInAs(owner.email),
    respondingRates(1),
  );

  if (!result.ok) throw new Error(`could not enter a Quote: ${result.reason}`);

  return result.quoteId;
}

/** The worklist's blocks as the Owner sees them. */
async function worklist() {
  return (await listWorklist(today, await signedInAs(owner.email))).sections;
}

/** Which block a Tender landed in, or null when the list does not carry it at all. */
async function blockOf(tenderId: string): Promise<WorklistBlock | null> {
  const sections = await worklist();
  const found = sections
    .filter((section) => section.tenders.some((tender) => tender.id === tenderId))
    .map((section) => section.block);

  // Not a convenience: appearing twice is the failure the block order exists to prevent,
  // and a helper that returned the first match would hide it from every test below.
  expect(found.length).toBeLessThanOrEqual(1);

  return found[0] ?? null;
}

beforeAll(async () => {
  orgId = await createOrg(`Worklist ${run}`);
  otherOrgId = await createOrg(`Worklist other ${run}`);

  await createMember(orgId, owner);
  await createMember(otherOrgId, outsider);
});

afterEach(async () => {
  await service.from("tenders").delete().in("org_id", [orgId, otherOrgId]);
  await service.from("suppliers").delete().in("org_id", [orgId, otherOrgId]);
});

afterAll(async () => {
  const memberIds = [owner.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId]);
});

describe("listWorklist", () => {
  it("returns the five blocks in the order they are read", async () => {
    expect((await worklist()).map((section) => section.block)).toEqual([...worklistBlocks]);
  });

  it("puts every Tender in exactly one block, and sorts each by the client's deadline", async () => {
    const missed = await aTender({
      internalQuoteDeadline: "2026-08-01",
      clientSubmissionDeadline: "2026-08-05",
    });
    const overdue = await aTender({ internalQuoteDeadline: "2026-08-05" });
    const soon = await aTender({
      internalQuoteDeadline: "2026-08-13",
      clientSubmissionDeadline: "2026-08-14",
    });
    const quiet = await aTender();
    const alsoQuiet = await aTender({ clientSubmissionDeadline: "2026-08-30" });

    const sent = await aTender();
    await recordSubmission(
      { tenderId: sent.id, submittedAt: new Date("2026-08-08T09:00:00Z") },
      await signedInAs(owner.email),
    );

    const sections = await worklist();
    const placed = sections.flatMap((section) => section.tenders.map((row) => row.id));

    expect(new Set(placed).size).toBe(placed.length);
    expect(sections.map((section) => section.tenders.map((row) => row.id))).toEqual([
      [missed.id],
      [overdue.id],
      [soon.id],
      [sent.id],
      // Soonest client submission deadline first, within the block as across the list.
      [alsoQuiet.id, quiet.id],
    ]);
  });

  it("labels a Coming up row with which deadline put it there", async () => {
    const internal = await aTender({
      internalQuoteDeadline: "2026-08-12",
      clientSubmissionDeadline: "2026-09-30",
    });
    const both = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-13",
    });

    const comingUp = (await worklist()).find((section) => section.block === "coming_up");
    const labels = new Map(
      comingUp!.tenders.map((row) => [row.id, row.dueDeadlines] as const),
    );

    // The case a client-deadline-only window misses: the Tender reads "due 30 Sep" and
    // looks healthy while the deadline that needs work is on Wednesday.
    expect(labels.get(internal.id)).toEqual(["internal_quote"]);
    expect(labels.get(both.id)).toEqual(["internal_quote", "client_submission"]);
  });

  it("leaves a Coming up row unlabelled everywhere else", async () => {
    const quiet = await aTender();
    const sections = await worklist();
    const elsewhere = sections
      .filter((section) => section.block !== "coming_up")
      .flatMap((section) => section.tenders);

    expect(elsewhere.map((row) => row.id)).toContain(quiet.id);
    expect(elsewhere.every((row) => row.dueDeadlines.length === 0)).toBe(true);
  });

  it("derives Progress from the Quote rows, and takes it back when they go", async () => {
    // The regression ADR-0001 promises: nothing transitions, so nothing has to be
    // untransitioned. Deleting the row is the whole of it.
    const { id, itemIds } = await aTender({ items: [anItem(), anItem("Surgical masks")] });

    expect((await blockRow(id)).progress).toBe("new");

    const first = await aQuote(itemIds[0]);

    expect((await blockRow(id)).progress).toBe("sourcing");

    await aQuote(itemIds[1]);

    expect((await blockRow(id)).progress).toBe("quoted");

    await service.from("quotes").delete().eq("id", first);

    expect((await blockRow(id)).progress).toBe("sourcing");
  });

  it("does not let an Item marked no_bid hold Progress at sourcing", async () => {
    const { id, itemIds } = await aTender({ items: [anItem(), anItem("Surgical masks")] });
    const store = await signedInAs(owner.email);

    await aQuote(itemIds[0]);
    await setItemOutcome(
      { itemId: itemIds[1], outcome: "no_bid", decidedAt: new Date("2026-08-09T09:00:00Z") },
      store,
    );

    expect((await blockRow(id)).progress).toBe("quoted");
  });

  it("reads Progress as submitted the moment the Bid is recorded as sent", async () => {
    const { id } = await aTender();

    await recordSubmission(
      { tenderId: id, submittedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    expect((await blockRow(id)).progress).toBe("submitted");
  });

  it("stops calling an Item overdue once somebody records No Supplier Found on it", async () => {
    const { id, itemIds } = await aTender({ internalQuoteDeadline: "2026-08-05" });

    expect(await blockOf(id)).toBe("sourcing_overdue");

    const recorded = await recordNoSupplierFound(
      { tenderItemId: itemIds[0], note: "Nobody stocks this size." },
      await signedInAs(owner.email),
    );

    expect(recorded.ok).toBe(true);
    // The point of the third sourcing state: the Assignee answered, so the nag stops —
    // where counting "Items with no Quote" would have gone on nagging them.
    expect(await blockOf(id)).toBe("everything_else");
  });

  it("keeps a Submission Missed Tender out of the default active list", async () => {
    // No column implies Submission Missed — it is the *absence* of `submitted_at` — so
    // "everything else" has to exclude it explicitly or the fatal case hides in the pile.
    const { id, itemIds } = await aTender({
      internalQuoteDeadline: "2026-08-01",
      clientSubmissionDeadline: "2026-08-05",
    });

    expect(await blockOf(id)).toBe("submission_missed");

    await setItemOutcome(
      { itemId: itemIds[0], outcome: "lost", decidedAt: new Date("2026-08-11T09:00:00Z") },
      await signedInAs(owner.email),
    );

    // It leaves when an Outcome is recorded, and not before.
    expect(await blockOf(id)).toBeNull();
  });

  it("takes a written-off Tender off the list", async () => {
    const { id, itemIds } = await aTender();

    await setItemOutcome(
      { itemId: itemIds[0], outcome: "no_bid", decidedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    expect(await blockOf(id)).toBeNull();
  });

  it("carries what a row shows: the reference, the Owner's name and the Item count", async () => {
    const { id } = await aTender({ items: [anItem(), anItem("Surgical masks")] });
    const row = await blockRow(id);

    expect(row).toMatchObject({
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      ownerName: owner.email,
      itemCount: 2,
    });
    expect(row.reference).toMatch(/^T-\d+$/);
  });

  it("counts the Tenders it left off the list, so an empty one can say which empty it is", async () => {
    // "Nothing recorded yet" and "everything is finished" are the same empty list and
    // must not read as the same sentence.
    const { id, itemIds } = await aTender();

    await setItemOutcome(
      { itemId: itemIds[0], outcome: "won", decidedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    const list = await listWorklist(today, await signedInAs(owner.email));

    expect(await blockOf(id)).toBeNull();
    expect(list.sections.flatMap((section) => section.tenders)).toEqual([]);
    expect(list.total).toBe(1);
  });

  it("shows another org nothing, and a stranger nothing at all", async () => {
    await aTender();

    const theirs = await listWorklist(today, await signedInAs(outsider.email));
    const nobodys = await listWorklist(today, memoryCookieStore());

    expect(theirs.sections.flatMap((section) => section.tenders)).toEqual([]);
    expect(theirs.total).toBe(0);
    expect(nobodys.sections.flatMap((section) => section.tenders)).toEqual([]);
  });
});

/** The one row a test is about, wherever the list put it. */
async function blockRow(tenderId: string) {
  const sections = await worklist();
  const row = sections
    .flatMap((section) => section.tenders)
    .find((tender) => tender.id === tenderId);

  if (!row) throw new Error("the worklist does not carry that Tender");

  return row;
}
