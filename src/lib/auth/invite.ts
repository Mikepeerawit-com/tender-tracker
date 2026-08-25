import "server-only";

import { createServiceClient } from "@/lib/supabase/service-client";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

import { currentUser } from "./session";

export const inviteRefusals = ["not_admin", "already_invited", "send_failed"] as const;

export type InviteRefusal = (typeof inviteRefusals)[number];

export type InviteResult =
  | { ok: true; userId: string }
  | { ok: false; reason: InviteRefusal };

/**
 * How an invitation can end, as the Org Admin sees it: the refusals, the send that
 * worked, and the form's own empty-field case.
 *
 * Success is in the list alongside the failures on purpose. An outcome rendering as a
 * key leaves the admin unable to tell a sent invitation from a silent failure — and the
 * person waiting to be invited has no way to ask. `messages.test.ts` walks this.
 */
export const inviteStatuses = [...inviteRefusals, "sent", "incomplete"] as const;

export type InviteStatus = (typeof inviteStatuses)[number];

export const wecomUserIdRefusals = ["not_admin", "not_found", "taken"] as const;

export type WecomUserIdRefusal = (typeof wecomUserIdRefusals)[number];

/** How saving a WeCom userid can end. Walked by `messages.test.ts`. */
export const wecomUserIdStatuses = [...wecomUserIdRefusals, "saved"] as const;

export type WecomUserIdStatus = (typeof wecomUserIdStatuses)[number];

/**
 * Invite a colleague by email.
 *
 * Accounts exist only by invitation: there is no self-signup, and `enable_signup` is
 * off at the platform level rather than merely unlinked from the UI. `is_org_admin`
 * gates this and nothing else — it confers no extra visibility.
 *
 * The gate is enforced here rather than only in the page that renders the form, because
 * a server action is a public HTTP endpoint. Anyone signed in can POST to it.
 */
export async function invite(
  { email, name }: { email: string; name: string },
  store: SessionCookieStore,
): Promise<InviteResult> {
  const caller = await currentUser(store);

  if (!caller?.isOrgAdmin) {
    return { ok: false, reason: "not_admin" };
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.inviteUserByEmail(email);

  if (error !== null || !data.user) {
    // Supabase reports an already-registered address as a send failure. Tell them apart,
    // because "they already have an account" needs no action and a real send failure
    // does.
    const alreadyRegistered =
      error?.code === "email_exists" || error?.message.includes("already been registered");

    return { ok: false, reason: alreadyRegistered ? "already_invited" : "send_failed" };
  }

  const { error: profileError } = await service.from("users").insert({
    id: data.user.id,
    org_id: caller.orgId,
    name,
    email,
    // `locale` is left null deliberately: first start-up asks rather than inferring.
  });

  if (profileError) {
    // The auth account now exists with no profile, which is an account that can hold a
    // password and read nothing. Undo it, or the address is permanently un-invitable —
    // a second attempt would come back as `already_invited`.
    await service.auth.admin.deleteUser(data.user.id);

    return { ok: false, reason: "send_failed" };
  }

  return { ok: true, userId: data.user.id };
}

/**
 * Set a colleague's WeCom userid, copied by hand from the WeCom console under
 * Contacts → member → Account.
 *
 * It is not a login credential and confers nothing; it is only the handle the group
 * robot needs to @mention someone. Admin-gated because it is a field about somebody
 * else's account, and because a typo drops that one person from every reminder silently.
 */
export async function setWecomUserid(
  { userId, wecomUserid }: { userId: string; wecomUserid: string | null },
  store: SessionCookieStore,
): Promise<{ ok: true } | { ok: false; reason: WecomUserIdRefusal }> {
  const caller = await currentUser(store);

  if (!caller?.isOrgAdmin) {
    return { ok: false, reason: "not_admin" };
  }

  const { data, error } = await createServiceClient()
    .from("users")
    .update({ wecom_userid: wecomUserid })
    .eq("id", userId)
    .eq("org_id", caller.orgId)
    .select("id");

  if (error !== null) {
    return { ok: false, reason: error.code === "23505" ? "taken" : "not_found" };
  }

  return data.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}
