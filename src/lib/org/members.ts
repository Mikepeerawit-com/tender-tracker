import "server-only";

import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

export type Member = { id: string; name: string };

/**
 * One person's place in this org, as the People screen reads it (CONTEXT.md, Identity).
 *
 * A **Membership** rather than a person: `isOrgAdmin` and `disabledAt` are facts about
 * somebody's place *here*, and the glossary is explicit that admin of one organisation
 * says nothing about any other. {@link Member} is the same person seen by a picker, which
 * needs only enough to label an option.
 */
export type Membership = Member & {
  email: string;
  wecomUserid: string | null;
  isOrgAdmin: boolean;
  disabledAt: string | null;
};

/** A member as the Owner picker offers them: `former` is one who has since been Disabled. */
export type OwnerOption = Member & { former: boolean };

/**
 * Everyone who can still be given work: the org's members, disabled ones left out.
 *
 * Read through the session client, so RLS is what scopes it to the caller's org. A
 * disabled member keeps their rows — a Quote records who sourced it — but must not
 * appear in a picker that would make them a Tender's Owner or Assignee.
 *
 * The `id` tiebreak is the one key of the three #119 found that the database seam can
 * answer for: taken away, `members.test.ts` goes red 10 times in 10.
 */
export async function listMembers(store: SessionCookieStore): Promise<Member[]> {
  const { data } = await createSessionClient(store)
    .from("users")
    .select("id, name")
    .is("disabled_at", null)
    // Two colleagues can share a name — this is a picker, and an option that moves
    // between two openings of the same form is one a person clicks the wrong one of.
    // `id` decides that rather than the heap.
    .order("name")
    .order("id")
    .overrideTypes<Member[], { merge: false }>();

  return data ?? [];
}

/**
 * Every Membership in the org, Disabled included, as the People screen reads them.
 *
 * The one read that must *not* leave Disabled colleagues out: this is the screen an admin
 * opens to see who is here, and somebody who has been Disabled is exactly who they came
 * to check on. {@link listMembers} answers the other question — who may still be given
 * work — and the two differ only in that, in the columns, and in nothing else.
 *
 * **A function rather than the query inlined on the page**, which is what the page had
 * until #119. `PeoplePage` is an `async` Server Component and `vitest.config.mts` says
 * why that matters: no seam in this repo can call one, so a rule written there is a rule
 * nothing can check (ADR-0016). The ordering is such a rule.
 */
export async function listMemberships(
  store: SessionCookieStore,
): Promise<Membership[]> {
  const { data } = await createSessionClient(store)
    .from("users")
    .select("id, name, email, wecom_userid, is_org_admin, disabled_at")
    // The same rule as {@link listMembers}, stated the same way: names are not unique, and
    // this is the table an admin reads down looking for one person.
    //
    // **And the one key of the three that no check covers directly, which is a measured
    // result rather than an omission (#119).** Taken away and the whole suite run in
    // parallel ten times, the read handed back the asserted order anyway — **0 red in
    // 10**, against 10 in 10 for `listMembers` on the same two columns of the same table.
    // An untiebroken read is the planner's answer, not the query's (#105), and a check
    // that passes whether or not the thing it guards is present is worse than none
    // (ADR-0016), so no such check was left behind here.
    //
    // What covers it is `listMembers`' check one function above: same table, same two
    // columns, same rule, and nothing in this file can change one ordering without the
    // reader seeing the other. Moving the rule to a comparator was tried and measured
    // too — sorting in JS instead makes deleting the sort a coin toss, 5 and 6 red in 10
    // for the two reads, because an unordered read is then pure heap order. That is the
    // check #105 refuses, so this stays in SQL.
    .order("name")
    .order("id");

  // Mapped inline rather than through a named row mapper like `tenderSummary`: naming the
  // row's shape means writing `is_org_admin:` in a type, and `conventions.test.ts` allows
  // exactly one file in the repo to write that column's name followed by a colon —
  // `auth/setup.ts`, which is where an Org Admin is minted (ADR-0017). Inferring the shape
  // from the query keeps that rule a real one rather than one with an exception in it.
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    wecomUserid: row.wecom_userid,
    isOrgAdmin: row.is_org_admin,
    disabledAt: row.disabled_at,
  }));
}

/**
 * Who the Owner picker may show: everyone who can still be given work, plus — if they
 * are not already among them — whoever owns this Tender today.
 *
 * A `<select>` whose value matches no option is not empty; the browser selects the first
 * option instead. Left to `listMembers` alone, a Tender owned by a since-disabled
 * colleague therefore renders as owned by whoever sorts first by name, and pressing Save
 * makes that true — a silent hand-over, on the screen somebody opens *because* a
 * colleague left.
 *
 * The former Owner is kept last and marked rather than quietly mixed in: they are not a
 * choice on offer, they are the answer to "who has this now".
 */
export function ownerOptions(
  members: Member[],
  owner: Member | null,
): OwnerOption[] {
  const options = members.map((member) => ({ ...member, former: false }));

  if (!owner?.id || options.some((option) => option.id === owner.id)) return options;

  return [...options, { ...owner, former: true }];
}
