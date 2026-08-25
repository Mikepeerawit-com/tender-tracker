import "server-only";

import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

/**
 * Every way the set-password form can refuse, as a list rather than a bare union.
 *
 * Refused at the one moment the account does not fully exist yet: whoever is reading has
 * no signed-in app to retreat into and no password to get back in with, so a reason that
 * renders as its own key strands them. `messages.test.ts` walks this.
 */
export const setPasswordErrors = ["too_short", "mismatch", "no_session"] as const;

export type SetPasswordError = (typeof setPasswordErrors)[number];

/**
 * Set the signed-in user's password.
 *
 * This is how an invite completes: the invitee arrives at /auth/confirm holding a
 * one-use token, that becomes a session, and this turns the session into an account
 * they can sign back into.
 *
 * There is deliberately no password-reset flow. Under ten users the Org Admin resets a
 * password from the Supabase dashboard, which keeps the app's email surface at exactly
 * one template — and one template is the difference between an SMTP misconfiguration
 * being obvious and it being a class of bug.
 */
export async function setPassword(
  password: string,
  store: SessionCookieStore,
): Promise<{ ok: boolean }> {
  const { error } = await createSessionClient(store).auth.updateUser({ password });

  return { ok: error === null };
}
