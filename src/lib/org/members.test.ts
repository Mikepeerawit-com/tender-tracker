import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

import { listMembers, listMemberships, ownerOptions, type Member } from "./members";

/**
 * The Owner picker is a `<select>` over the org's active members, and a `<select>` whose
 * value matches none of its options does not stay empty — the browser shows the first
 * option instead. So a Tender owned by a since-disabled colleague renders as owned by
 * whoever sorts first by name, and saving the form makes that true.
 *
 * `listMembers` is right to leave disabled people out; the fix is that the Owner this
 * Tender already has is not a pick, it is a fact the form has to be able to show.
 */

/**
 * **And the two reads themselves, against the real local Postgres** (#119).
 *
 * `src/lib/org/` had no database seam at all until this file grew one, which is how both
 * reads shipped with an `.order("id")` tiebreak that nothing could take away — the shape
 * ADR-0016 refuses, arrived at by omission. The order is not decoration: the Owner picker
 * is a `<select>`, and an option that moves between two openings of the same form is one
 * a person clicks the wrong one of.
 *
 * The pair below share a name, and their profile rows are written **in descending `id`
 * order**, so an untiebroken read hands back the opposite of what the assertion wants.
 * That is the whole lever — #105 found that a check whose fixtures happen to be inserted
 * in the order it asserts is green with the key and without it.
 *
 * It works for one of the two reads. Only `listMembers` is held to the order here; what
 * the same experiment said about `listMemberships`, and why that read is left with no
 * ordering check at all, is written where that read is tested below.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

/** Two colleagues who share a name — the tie both reads have to settle the same way. */
const twins = [
  { id: "", email: `member-twin-a-${run}@example.test` },
  { id: "", email: `member-twin-b-${run}@example.test` },
];

/** Somebody who has been Disabled: gone from one read, still on the other. */
const departed = { id: "", email: `member-departed-${run}@example.test` };

/** The name the twins share. Sorts after `departed`'s, so the order asserted is earned. */
const sharedName = "Somsak Chaiwong";

let orgId = "";

/** Ascending `id`, which is the order both reads state they produce. */
function twinIdsInOrder(): string[] {
  return twins.map((twin) => twin.id).sort();
}

async function signedInAs(email: string): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${email}`);

  return store;
}

/** An auth user, with no profile row yet — that is written separately, in a chosen order. */
async function createLogin(who: { id: string; email: string }): Promise<void> {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;
}

async function writeProfile(
  who: { id: string; email: string },
  fields: { name: string; disabledAt?: string; isOrgAdmin?: boolean },
): Promise<void> {
  const { error } = await service.from("users").insert({
    id: who.id,
    org_id: orgId,
    name: fields.name,
    email: who.email,
    is_org_admin: fields.isOrgAdmin ?? false,
    disabled_at: fields.disabledAt ?? null,
  });

  if (error) throw error;
}

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Members ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = data.id;

  await Promise.all([...twins, departed].map(createLogin));

  await writeProfile(departed, {
    name: "Anong Pitsuwan",
    disabledAt: "2026-08-01T00:00:00Z",
  });

  // Descending `id`, so heap order is the wrong answer and the key is the only thing that
  // can produce the right one. One after another, because the order they land in is the
  // whole point — `Promise.all` here would hand the fixtures back to the coin toss.
  for (const id of twinIdsInOrder().reverse()) {
    await writeProfile(twins.find((twin) => twin.id === id)!, {
      name: sharedName,
      // Somebody has to be one — an org always has at least one Org Admin (ADR-0017) —
      // and it is the twin sorting first, so the People screen's mapping of the flag is
      // read off a row the ordering test is already looking at.
      isOrgAdmin: id === twinIdsInOrder()[0],
    });
  }
});

afterAll(async () => {
  const ids = [...twins, departed].map((who) => who.id).filter(Boolean);

  await service.from("users").delete().in("id", ids);

  for (const id of ids) await service.auth.admin.deleteUser(id);

  await service.from("orgs").delete().eq("id", orgId);
});

describe("listMembers", () => {
  it("settles two colleagues who share a name by id, not by the heap", async () => {
    // Verified the way ADR-0016 asks and #105 insists on: with `.order("id")` taken out of
    // `listMembers`, this file run whole under the parallel suite went red **10 times in
    // 10** — never filtered to this test alone, which is the condition that manufactures a
    // red rather than finding one. The sort's input is the heap, and the fixture above put
    // the twins there in descending `id`, so the key is the only thing that can produce
    // the order asserted below.
    //
    // `listMemberships` gets no such check and this one stands in for it: same table, same
    // two columns, same rule. See the comment on that read for the measurement that
    // decided it.
    const store = await signedInAs(twins[0].email);

    const listed = (await listMembers(store))
      .filter((member) => member.name === sharedName)
      .map((member) => member.id);

    expect(listed).toEqual(twinIdsInOrder());
  });

  it("leaves out a colleague who has been Disabled", async () => {
    // The line between the two reads, and the reason `listMemberships` could not simply
    // call this one: a picker that offered somebody who has left would make them a
    // Tender's Owner.
    const store = await signedInAs(twins[0].email);

    expect((await listMembers(store)).map((member) => member.id)).not.toContain(
      departed.id,
    );
  });
});

describe("listMemberships", () => {
  // **No ordering check here, deliberately.** The read states the same `name`-then-`id`
  // rule as `listMembers` and cannot be held to it: with the `id` key removed and the
  // whole suite run in parallel ten times, this read produced the asserted order every
  // time — 0 red in 10 (#119). A check that passes whether or not the key is present
  // reports on the planner, not on the ordering, and ADR-0016 would rather have the
  // silence. `listMembers` above carries the rule for both.

  it("lists a colleague who has been Disabled, because that is who the screen is for", async () => {
    const store = await signedInAs(twins[0].email);

    expect(
      (await listMemberships(store)).find(
        (membership) => membership.id === departed.id,
      ),
    ).toMatchObject({ name: "Anong Pitsuwan", disabledAt: expect.any(String) });
  });

  it("hands the screen every column it draws", async () => {
    // The People screen renders all six, and the page is an `async` Server Component that
    // nothing can render — so a column silently arriving as `undefined` would show up as a
    // missing badge on a screen no test opens.
    const store = await signedInAs(twins[0].email);
    const [first] = twinIdsInOrder();

    expect(
      (await listMemberships(store)).find((membership) => membership.id === first),
    ).toEqual({
      id: first,
      name: sharedName,
      email: twins.find((twin) => twin.id === first)!.email,
      wecomUserid: null,
      isOrgAdmin: true,
      disabledAt: null,
    });
  });
});

const members: Member[] = [
  { id: "anong", name: "Anong" },
  { id: "malee", name: "Malee" },
];

describe("ownerOptions", () => {
  it("offers the active members when the Owner is one of them", () => {
    expect(ownerOptions(members, { id: "malee", name: "Malee" })).toEqual([
      { id: "anong", name: "Anong", former: false },
      { id: "malee", name: "Malee", former: false },
    ]);
  });

  it("keeps an Owner who is no longer an active member", () => {
    const options = ownerOptions(members, { id: "somchai", name: "Somchai" });

    expect(options).toContainEqual({ id: "somchai", name: "Somchai", former: true });
  });

  it("marks that Owner as former, so the form can say so", () => {
    // Indistinguishable from an active colleague is how a Tender quietly stays with
    // somebody who has left.
    const options = ownerOptions(members, { id: "somchai", name: "Somchai" });

    expect(options.filter((option) => option.former).map((option) => option.id)).toEqual([
      "somchai",
    ]);
  });

  it("offers only the active members when there is no Owner yet", () => {
    // The record screen: nothing is owned, so there is nothing to preserve.
    expect(ownerOptions(members, null)).toEqual([
      { id: "anong", name: "Anong", former: false },
      { id: "malee", name: "Malee", former: false },
    ]);
  });

  it("ignores an Owner with no id", () => {
    expect(ownerOptions(members, { id: "", name: "" })).toHaveLength(members.length);
  });
});
