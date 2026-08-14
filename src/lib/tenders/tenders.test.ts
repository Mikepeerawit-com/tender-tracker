import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

import {
  addAssignee,
  addTenderItem,
  createTender,
  getTender,
  listTenders,
  removeAssignee,
  removeTenderItem,
  updateTender,
  updateTenderItem,
} from "./tenders";

const password = "correct-horse-battery-staple";

// A literal, not `new Date()`: the clock is resolved at the request boundary and passed
// down (ADR-0010), and nothing here turns on when the disabling happened.
const disabledAt = "2026-08-01T00:00:00Z";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const owner = { id: "", email: `owner-${run}@example.test` };
const mate = { id: "", email: `mate-${run}@example.test` };
const outsider = { id: "", email: `outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

/** Every Tender any test made, torn down however the test ended. */
const created: string[] = [];

function tenderInput(overrides: Partial<Parameters<typeof createTender>[0]> = {}) {
  return {
    clientName: "Bangkok General Hospital",
    title: "Surgical consumables Q3",
    dateReceived: "2026-08-01",
    internalQuoteDeadline: "2026-08-20",
    clientSubmissionDeadline: "2026-08-28",
    expectedDecisionDate: null,
    ownerUserId: owner.id,
    notes: null,
    items: [{ productName: "Nitrile gloves", description: null, quantity: 500, unit: "box of 50" }],
    ...overrides,
  };
}

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

/** Creates a Tender as the Owner and registers it for teardown. */
async function aTender(overrides = {}): Promise<string> {
  const result = await createTender(tenderInput(overrides), await signedInAs(owner.email));

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  created.push(result.tenderId);

  return result.tenderId;
}

beforeAll(async () => {
  orgId = await createOrg(`Tenders ${run}`);
  otherOrgId = await createOrg(`Tenders other ${run}`);

  await createMember(orgId, owner);
  await createMember(orgId, mate);
  await createMember(otherOrgId, outsider);
});

afterEach(async () => {
  if (created.length === 0) return;

  await service.from("tenders").delete().in("id", created);
  created.length = 0;
});

afterAll(async () => {
  const ids = [owner.id, mate.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", ids);

  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }

  // The reference counters go with the orgs — the FK cascades.
  await service.from("orgs").delete().in("id", [orgId, otherOrgId]);
});

describe("createTender", () => {
  it("records the client, the three dates and the Items in one go", async () => {
    const tenderId = await aTender({
      expectedDecisionDate: "2026-09-15",
      notes: "Repeat client; they always ask for a sample.",
      items: [
        { productName: "Nitrile gloves", description: "Powder-free", quantity: 500, unit: "box of 50" },
        { productName: "Surgical masks", description: null, quantity: 20000, unit: "piece" },
      ],
    });

    const tender = await getTender(tenderId, await signedInAs(owner.email));

    expect(tender).toMatchObject({
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-20",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: "2026-09-15",
      notes: "Repeat client; they always ask for a sample.",
      ownerUserId: owner.id,
    });

    expect(tender?.items.map((item) => item.productName)).toEqual([
      "Nitrile gloves",
      "Surgical masks",
    ]);
  });

  it("hands out a reference from the org's sequence", async () => {
    const first = await createTender(tenderInput(), await signedInAs(owner.email));

    if (!first.ok) throw new Error(first.reason);
    created.push(first.tenderId);

    const second = await createTender(tenderInput(), await signedInAs(owner.email));

    if (!second.ok) throw new Error(second.reason);
    created.push(second.tenderId);

    expect(first.reference).toMatch(/^T-\d+$/);
    expect(Number(second.reference.slice(2))).toBe(Number(first.reference.slice(2)) + 1);
  });

  it("refuses a Tender with no Items, because a Tender always asks for something", async () => {
    const result = await createTender(
      tenderInput({ items: [] }),
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "no_items" });
  });

  it("refuses an Item with no quantity", async () => {
    const result = await createTender(
      tenderInput({
        items: [{ productName: "Gloves", description: null, quantity: 0, unit: "box" }],
      }),
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("refuses an Internal Quote Deadline that falls after the Client Submission Deadline", async () => {
    // The internal one exists so the team can pick what to Bid. Behind the submission
    // deadline it chases nobody, and the Tender looks healthy while it is already lost.
    const result = await createTender(
      tenderInput({
        internalQuoteDeadline: "2026-08-29",
        clientSubmissionDeadline: "2026-08-28",
      }),
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "deadlines_out_of_order" });
  });

  it("refuses a blank client name or title", async () => {
    const store = await signedInAs(owner.email);

    await expect(createTender(tenderInput({ clientName: "  " }), store)).resolves.toEqual({
      ok: false,
      reason: "incomplete",
    });
    await expect(createTender(tenderInput({ title: "" }), store)).resolves.toEqual({
      ok: false,
      reason: "incomplete",
    });
  });

  it("refuses a Disabled Owner", async () => {
    await service
      .from("users")
      .update({ disabled_at: disabledAt })
      .eq("id", mate.id);

    const result = await createTender(
      tenderInput({ ownerUserId: mate.id }),
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });

    await service.from("users").update({ disabled_at: null }).eq("id", mate.id);
  });

  it("refuses an Owner from another org", async () => {
    const result = await createTender(
      tenderInput({ ownerUserId: outsider.id }),
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a caller with no session", async () => {
    const result = await createTender(tenderInput(), memoryCookieStore());

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("creates nothing when it refuses", async () => {
    const before = await listTenders(await signedInAs(owner.email));

    await createTender(tenderInput({ items: [] }), await signedInAs(owner.email));

    const after = await listTenders(await signedInAs(owner.email));

    expect(after).toHaveLength(before.length);
  });
});

describe("updateTender", () => {
  it("edits the Tender after creation", async () => {
    const tenderId = await aTender();

    const result = await updateTender(
      {
        tenderId,
        clientName: "Chiang Mai Ram Hospital",
        title: "Surgical consumables Q4",
        dateReceived: "2026-08-02",
        internalQuoteDeadline: "2026-08-21",
        clientSubmissionDeadline: "2026-08-29",
        expectedDecisionDate: null,
        ownerUserId: mate.id,
        notes: "Handed over.",
      },
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: true });

    const tender = await getTender(tenderId, await signedInAs(owner.email));

    expect(tender).toMatchObject({
      clientName: "Chiang Mai Ram Hospital",
      title: "Surgical consumables Q4",
      ownerUserId: mate.id,
      notes: "Handed over.",
    });
  });

  it("refuses a Tender in another org", async () => {
    const tenderId = await aTender();

    const result = await updateTender(
      {
        tenderId,
        clientName: "Reached in",
        title: "Reached in",
        dateReceived: "2026-08-01",
        internalQuoteDeadline: "2026-08-20",
        clientSubmissionDeadline: "2026-08-28",
        expectedDecisionDate: null,
        ownerUserId: outsider.id,
        notes: null,
      },
      await signedInAs(outsider.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("Tender Items", () => {
  it("adds another Item to an existing Tender", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(mate.email);

    const result = await addTenderItem(
      {
        tenderId,
        productName: "Surgical masks",
        description: null,
        quantity: 20000,
        unit: "piece",
      },
      store,
    );

    expect(result.ok).toBe(true);

    const tender = await getTender(tenderId, store);

    expect(tender?.items).toHaveLength(2);
  });

  it("edits an Item", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(owner.email);
    const [item] = (await getTender(tenderId, store))?.items ?? [];

    const result = await updateTenderItem(
      {
        itemId: item.id,
        productName: "Nitrile gloves, large",
        description: "Powder-free",
        quantity: 750,
        unit: "box of 100",
      },
      store,
    );

    expect(result).toEqual({ ok: true });

    const [edited] = (await getTender(tenderId, store))?.items ?? [];

    expect(edited).toMatchObject({
      productName: "Nitrile gloves, large",
      description: "Powder-free",
      quantity: 750,
      unit: "box of 100",
    });
  });

  it("refuses a quantity of zero on an edit as well as on creation", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(owner.email);
    const [item] = (await getTender(tenderId, store))?.items ?? [];

    const result = await updateTenderItem(
      { itemId: item.id, productName: "Gloves", description: null, quantity: -1, unit: "box" },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("refuses a caller with no session, like every other write here", async () => {
    const tenderId = await aTender();
    const [item] = (await getTender(tenderId, await signedInAs(owner.email)))?.items ?? [];

    expect(await removeTenderItem(item.id, memoryCookieStore())).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("removes an Item, but never the last one", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(owner.email);

    await addTenderItem(
      { tenderId, productName: "Masks", description: null, quantity: 10, unit: "piece" },
      store,
    );

    const items = (await getTender(tenderId, store))?.items ?? [];

    expect(await removeTenderItem(items[1].id, store)).toEqual({ ok: true });
    expect(await removeTenderItem(items[0].id, store)).toEqual({
      ok: false,
      reason: "last_item",
    });

    expect((await getTender(tenderId, store))?.items).toHaveLength(1);
  });
});

describe("Assignees", () => {
  it("lets the Owner add and remove someone", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(owner.email);

    expect(await addAssignee({ tenderId, userId: mate.id }, store)).toEqual({ ok: true });
    expect((await getTender(tenderId, store))?.assignees.map((a) => a.id)).toEqual([
      mate.id,
    ]);

    expect(await removeAssignee({ tenderId, userId: mate.id }, store)).toEqual({
      ok: true,
    });
    expect((await getTender(tenderId, store))?.assignees).toEqual([]);
  });

  it("lets anyone add themselves without waiting to be asked", async () => {
    // Self-assignment is the step that enrols you in the Tender's reminders, and it is
    // deliberately not gated: ADR-0004.
    const tenderId = await aTender();
    const store = await signedInAs(mate.email);

    expect(await addAssignee({ tenderId, userId: mate.id }, store)).toEqual({ ok: true });
  });

  it("refuses a non-Owner adding somebody else", async () => {
    const tenderId = await aTender();

    const result = await addAssignee(
      { tenderId, userId: owner.id },
      await signedInAs(mate.email),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("refuses a non-Owner removing somebody else", async () => {
    const tenderId = await aTender();

    await addAssignee({ tenderId, userId: owner.id }, await signedInAs(owner.email));

    const result = await removeAssignee(
      { tenderId, userId: owner.id },
      await signedInAs(mate.email),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("lets an Assignee take themselves back off", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(mate.email);

    await addAssignee({ tenderId, userId: mate.id }, store);

    expect(await removeAssignee({ tenderId, userId: mate.id }, store)).toEqual({
      ok: true,
    });
  });

  it("is idempotent, so a second add is not an error", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(mate.email);

    await addAssignee({ tenderId, userId: mate.id }, store);

    expect(await addAssignee({ tenderId, userId: mate.id }, store)).toEqual({ ok: true });
    expect((await getTender(tenderId, store))?.assignees).toHaveLength(1);
  });

  it("refuses to assign a Disabled colleague, whose id the picker never offered", async () => {
    // The picker leaves them out, and the picker is not the gate: the action is a public
    // endpoint and the disabled member's row is still visible to the rest of the org.
    const tenderId = await aTender();

    await service
      .from("users")
      .update({ disabled_at: disabledAt })
      .eq("id", mate.id);

    const result = await addAssignee(
      { tenderId, userId: mate.id },
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });

    await service.from("users").update({ disabled_at: null }).eq("id", mate.id);
  });

  it("still lets the Owner take a Disabled colleague off", async () => {
    // The mirror has to keep working. Someone leaving is exactly when their Tenders get
    // tidied up, and by then their account is already disabled.
    const tenderId = await aTender();
    const store = await signedInAs(owner.email);

    await addAssignee({ tenderId, userId: mate.id }, store);

    await service
      .from("users")
      .update({ disabled_at: disabledAt })
      .eq("id", mate.id);

    expect(await removeAssignee({ tenderId, userId: mate.id }, store)).toEqual({
      ok: true,
    });

    await service.from("users").update({ disabled_at: null }).eq("id", mate.id);
  });

  it("refuses to assign someone from another org", async () => {
    const tenderId = await aTender();

    const result = await addAssignee(
      { tenderId, userId: outsider.id },
      await signedInAs(owner.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

/**
 * These ask the database directly, with the service client, because the point is that
 * the guarantee does not depend on the application remembering it. `createTender` never
 * sends a reference — that is exactly why a test that goes through it proves nothing.
 */
describe("the reference is the database's to issue", () => {
  it("overwrites a reference the caller supplied", async () => {
    const { data, error } = await service
      .from("tenders")
      .insert({
        org_id: orgId,
        reference: "T-9999",
        client_name: "Direct",
        title: "Direct",
        date_received: "2026-08-01",
        internal_quote_deadline: "2026-08-20",
        client_submission_deadline: "2026-08-28",
        owner_user_id: owner.id,
      })
      .select("id, reference")
      .single();

    if (error) throw error;

    created.push(data.id);

    expect(data.reference).toMatch(/^T-\d+$/);
    expect(data.reference).not.toBe("T-9999");
  });

  it("pins the reference against an update, and touches updated_at", async () => {
    const tenderId = await aTender();

    const { data: before } = await service
      .from("tenders")
      .select("reference, updated_at")
      .eq("id", tenderId)
      .single();

    const { data: after, error } = await service
      .from("tenders")
      .update({ reference: "T-9999", title: "Renamed" })
      .eq("id", tenderId)
      .select("reference, title, updated_at")
      .single();

    if (error) throw error;

    expect(after.reference).toBe(before?.reference);
    expect(after.title).toBe("Renamed");
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before!.updated_at).getTime(),
    );
  });
});

describe("listTenders and getTender", () => {
  it("lists the org's Tenders with what a list row needs", async () => {
    const tenderId = await aTender();

    const rows = await listTenders(await signedInAs(mate.email));
    const row = rows.find((candidate) => candidate.id === tenderId);

    expect(row).toMatchObject({
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      clientSubmissionDeadline: "2026-08-28",
      ownerName: owner.email,
      itemCount: 1,
    });
    expect(row?.reference).toMatch(/^T-\d+$/);
  });

  it("shows another org nothing", async () => {
    const tenderId = await aTender();
    const store = await signedInAs(outsider.email);

    expect((await listTenders(store)).map((row) => row.id)).not.toContain(tenderId);
    expect(await getTender(tenderId, store)).toBeNull();
  });

  it("shows a signed-out caller nothing", async () => {
    const tenderId = await aTender();

    expect(await listTenders(memoryCookieStore())).toEqual([]);
    expect(await getTender(tenderId, memoryCookieStore())).toBeNull();
  });
});
