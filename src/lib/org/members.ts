import "server-only";

import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

export type Member = { id: string; name: string };

/** A member as the Owner picker offers them: `former` is one who has since been Disabled. */
export type OwnerOption = Member & { former: boolean };

/**
 * Everyone who can still be given work: the org's members, disabled ones left out.
 *
 * Read through the session client, so RLS is what scopes it to the caller's org. A
 * disabled member keeps their rows — a Quote records who sourced it — but must not
 * appear in a picker that would make them a Tender's Owner or Assignee.
 */
export async function listMembers(store: SessionCookieStore): Promise<Member[]> {
  const { data } = await createSessionClient(store)
    .from("users")
    .select("id, name")
    .is("disabled_at", null)
    .order("name")
    .overrideTypes<Member[], { merge: false }>();

  return data ?? [];
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
