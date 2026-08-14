import "server-only";

import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

export type Member = { id: string; name: string };

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
