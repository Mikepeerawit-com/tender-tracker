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
import { worklistGroups, type WorklistGroup } from "./progress";
import { listWorklist } from "./worklist";

/**
 * The worklist, read the way the screen reads it: through the session client, against
 * the real local Postgres.
 *
 * `progress.test.ts` holds the rules as arithmetic. What is left here is the half that
 * does not survive being lifted out of the database — that a Quote *row*, a No Supplier
 * Found *row* and an Outcome *column* are what the groups are actually derived from, and
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

/** The worklist's groups as the Owner sees them. */
async function worklist() {
  return (await listWorklist(today, await signedInAs(owner.email))).sections;
}

/** Which group a Tender landed in, or null when the list does not carry it at all. */
async function groupOf(tenderId: string): Promise<WorklistGroup | null> {
  const sections = await worklist();
  const found = sections
    .filter((section) => section.tenders.some((tender) => tender.id === tenderId))
    .map((section) => section.group);

  // Not a convenience: appearing twice is the failure the group order exists to prevent,
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
  it("returns all five groups in order, empty ones included", async () => {
    // Empty ones too: the order is this function's decision, and a screen that had to
    // reassemble it from whatever came back could get it wrong. Drawing or skipping an
    // empty group is the screen's business, not the assembly's.
    const sections = await worklist();

    expect(sections.map((section) => section.group)).toEqual([...worklistGroups]);
    expect(sections.every((section) => section.tenders.length === 0)).toBe(true);
  });

  it("puts every Tender in exactly one group, and sorts each by the client's deadline", async () => {
    // Six Tenders at once. Built one after another this was the slowest test in the
    // repo — 5039 ms in a full parallel run, *past* vitest's 5000 ms and reported green
    // only because the clock and the assertion were racing (#105). Every group below is
    // decided by dates and Quote rows, never by the order the six arrived in, so the
    // waiting is all this gives up.
    const [missed, overdue, quiet, alsoQuiet, priced, sent] = await Promise.all([
      aTender({
        internalQuoteDeadline: "2026-08-01",
        clientSubmissionDeadline: "2026-08-05",
      }),
      // Overdue on sourcing, but that is a fact about the *row* now. It groups by
      // Progress like everything else, and its Progress is `new`.
      aTender({ internalQuoteDeadline: "2026-08-05" }),
      aTender({ clientSubmissionDeadline: "2026-09-05" }),
      aTender({ clientSubmissionDeadline: "2026-08-30" }),
      aTender({ items: [anItem(), anItem("Surgical masks")] }),
      aTender(),
    ]);

    // These two are what make `priced` and `sent` the groups they are named for, so they
    // wait for the Tenders rather than joining them.
    await aQuote(priced.itemIds[0]);
    await recordSubmission(
      { tenderId: sent.id, submittedAt: new Date("2026-08-08T09:00:00Z") },
      await signedInAs(owner.email),
    );

    const sections = await worklist();
    const placed = sections.flatMap((section) => section.tenders.map((row) => row.id));

    expect(new Set(placed).size).toBe(placed.length);
    expect(sections.map((section) => section.tenders.map((row) => row.id))).toEqual([
      [missed.id],
      // Soonest client submission deadline first, within a group as across the list. The
      // order is inherited from `listTenders`, never decided here. Three different client
      // deadlines on purpose: what a tie does is the next test's question, and this one
      // would answer it by luck.
      [alsoQuiet.id, overdue.id, quiet.id],
      [priced.id],
      [],
      [sent.id],
    ]);
  });

  it("breaks a tie on the client's deadline with the internal one", async () => {
    // Two Tenders due to the client on the same day, which the date the list sorts on
    // cannot order. Created in the *opposite* order to the one asserted, so that insert
    // order — what an untiebroken read of a fresh heap hands back — is the wrong answer
    // rather than accidentally the right one. Take the tiebreaker back out of
    // `listTenders` and this was watched go red, every run — which is the point of
    // asserting a tie rather than inheriting one (ADR-0016). The `id` key behind this
    // one is the next test's question.
    const later = await aTender({
      internalQuoteDeadline: "2026-08-26",
      clientSubmissionDeadline: "2026-09-10",
    });
    const sooner = await aTender({
      internalQuoteDeadline: "2026-08-20",
      clientSubmissionDeadline: "2026-09-10",
    });

    const grouped = (await worklist()).filter((section) => section.tenders.length > 0);

    // Both are `new`, so they share a group and what is read below is the order *within*
    // a list — not the order of the groups around it, which would answer by accident.
    expect(grouped).toHaveLength(1);
    expect(grouped[0].tenders.map((row) => row.id)).toEqual([sooner.id, later.id]);
  });

  it("falls back to `id` when both deadlines match, so a list of twins holds still", async () => {
    // Five Tenders alike in both dates, where neither key can say anything and `id` is
    // all that is left. Five rather than two because a uuid is random: with two, insert
    // order agrees with `id` order half the time and pulling the key out would be a coin
    // toss rather than a red — the very fault this issue is about, rebuilt inside its own
    // check. With five the heap has one arrangement in 120 that would let it pass, and
    // pulling the key out was watched go red (ADR-0016).
    //
    // Built all at once: five sequential `aTender` calls are five sign-ins and five
    // writes end to end, which measured 4577 ms of vitest's 5000 ms in a full parallel
    // run — a test one slow round trip from failing on the clock rather than on the
    // ordering it is about (#105). Nothing here wants a known insert order, unlike the
    // tie test above: what is asserted is ascending `id`, which the ids answer for
    // themselves however they arrived.
    const twins = await Promise.all(
      Array.from({ length: 5 }, () =>
        aTender({
          internalQuoteDeadline: "2026-08-22",
          clientSubmissionDeadline: "2026-09-12",
        }),
      ),
    );

    const grouped = (await worklist()).filter((section) => section.tenders.length > 0);

    expect(grouped).toHaveLength(1);
    // Postgres orders `uuid` bytewise, which for the lowercase hex it hands back is the
    // same order a plain string sort gives — so this is the spec's ascending `id`, not a
    // second copy of the query's reasoning.
    expect(grouped[0].tenders.map((row) => row.id)).toEqual(
      twins.map((twin) => twin.id).sort(),
    );
  });

  it("labels every row with whichever deadlines are inside the rolling window", async () => {
    const internal = await aTender({
      internalQuoteDeadline: "2026-08-12",
      clientSubmissionDeadline: "2026-09-30",
    });
    const both = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-13",
    });

    const labels = new Map(
      (await worklist())
        .flatMap((section) => section.tenders)
        .map((row) => [row.id, row.dueDeadlines] as const),
    );

    // The case a client-deadline-only window misses: the Tender reads "due 30 Sep" and
    // looks healthy while the deadline that needs work is on Wednesday.
    expect(labels.get(internal.id)).toEqual(["internal_quote"]);
    expect(labels.get(both.id)).toEqual(["internal_quote", "client_submission"]);
  });

  it("gives a row with nothing inside the window an empty label and a calm lamp", async () => {
    // `dueDeadlines` is populated for every row now, where it used to be filled for one
    // block only. Empty here means *nothing is due within seven days*, which is a fact
    // about this Tender — not a fact about which pile it landed in.
    const quiet = await aTender();
    const row = await groupRow(quiet.id);

    expect(row.dueDeadlines).toEqual([]);
    expect(row.status).toEqual({
      kind: "due",
      tone: "calm",
      deadline: "internal_quote",
      days: 15,
    });
  });

  it("states each row's own urgency, wherever the group put it", async () => {
    // The whole point of moving urgency off the heading: two Tenders in the same group
    // say different things, because the trouble is a property of the Tender rather than
    // of the pile. Both of these are Progress `new`.
    const overdue = await aTender({
      internalQuoteDeadline: "2026-08-05",
      items: [anItem(), anItem("Surgical masks")],
    });
    const calm = await aTender();

    expect(await groupOf(overdue.id)).toBe("new");
    expect(await groupOf(calm.id)).toBe("new");

    expect((await groupRow(overdue.id)).status).toEqual({
      kind: "unsourced",
      tone: "alarm",
      count: 2,
      total: 2,
    });
    expect((await groupRow(overdue.id)).notYetSourced).toBe(2);
    expect((await groupRow(calm.id)).status.tone).toBe("calm");
    expect((await groupRow(calm.id)).notYetSourced).toBe(1);
  });

  it("derives Progress from the Quote rows, and takes it back when they go", async () => {
    // The regression ADR-0001 promises: nothing transitions, so nothing has to be
    // untransitioned. Deleting the row is the whole of it.
    const { id, itemIds } = await aTender({ items: [anItem(), anItem("Surgical masks")] });

    expect((await groupRow(id)).progress).toBe("new");

    const first = await aQuote(itemIds[0]);

    expect((await groupRow(id)).progress).toBe("sourcing");

    await aQuote(itemIds[1]);

    expect((await groupRow(id)).progress).toBe("quoted");

    await service.from("quotes").delete().eq("id", first);

    expect((await groupRow(id)).progress).toBe("sourcing");
  });

  it("does not let an Item marked no_bid hold Progress at sourcing", async () => {
    const { id, itemIds } = await aTender({ items: [anItem(), anItem("Surgical masks")] });
    const store = await signedInAs(owner.email);

    await aQuote(itemIds[0]);
    await setItemOutcome(
      { itemId: itemIds[1], outcome: "no_bid", decidedAt: new Date("2026-08-09T09:00:00Z") },
      store,
    );

    expect((await groupRow(id)).progress).toBe("quoted");
  });

  it("reads Progress as submitted the moment the Bid is recorded as sent", async () => {
    const { id } = await aTender();

    await recordSubmission(
      { tenderId: id, submittedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    expect((await groupRow(id)).progress).toBe("submitted");
  });

  it("stops calling an Item overdue once somebody records No Supplier Found on it", async () => {
    const { id, itemIds } = await aTender({ internalQuoteDeadline: "2026-08-05" });

    expect((await groupRow(id)).status).toMatchObject({ kind: "unsourced", count: 1 });

    const recorded = await recordNoSupplierFound(
      { tenderItemId: itemIds[0], note: "Nobody stocks this size." },
      await signedInAs(owner.email),
    );

    expect(recorded.ok).toBe(true);
    // The point of the third sourcing state: the Assignee answered, so the nag stops —
    // where counting "Items with no Quote" would have gone on nagging them.
    expect((await groupRow(id)).status).not.toMatchObject({ kind: "unsourced" });
    expect((await groupRow(id)).notYetSourced).toBe(0);
  });

  it("keeps a Submission Missed Tender out of the default active list", async () => {
    // No column implies Submission Missed — it is the *absence* of `submitted_at` — so
    // "everything else" has to exclude it explicitly or the fatal case hides in the pile.
    const { id, itemIds } = await aTender({
      internalQuoteDeadline: "2026-08-01",
      clientSubmissionDeadline: "2026-08-05",
    });

    expect(await groupOf(id)).toBe("submission_missed");

    await setItemOutcome(
      { itemId: itemIds[0], outcome: "lost", decidedAt: new Date("2026-08-11T09:00:00Z") },
      await signedInAs(owner.email),
    );

    // It leaves when an Outcome is recorded, and not before.
    expect(await groupOf(id)).toBeNull();
  });

  it("takes a written-off Tender off the list", async () => {
    const { id, itemIds } = await aTender();

    await setItemOutcome(
      { itemId: itemIds[0], outcome: "no_bid", decidedAt: new Date("2026-08-09T09:00:00Z") },
      await signedInAs(owner.email),
    );

    expect(await groupOf(id)).toBeNull();
  });

  it("carries what a row shows: the reference, the Owner's name and the Item count", async () => {
    const { id } = await aTender({ items: [anItem(), anItem("Surgical masks")] });
    const row = await groupRow(id);

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

    expect(await groupOf(id)).toBeNull();
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
async function groupRow(tenderId: string) {
  const sections = await worklist();
  const row = sections
    .flatMap((section) => section.tenders)
    .find((tender) => tender.id === tenderId);

  if (!row) throw new Error("the worklist does not carry that Tender");

  return row;
}
