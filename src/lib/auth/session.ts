import "server-only";

import { cache } from "react";

import { isLocale, type Locale } from "@/i18n/config";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

export type SessionUser = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  locale: Locale | null;
  isOrgAdmin: boolean;
};

/**
 * `disabled` also covers an auth account with no profile row. The two are different
 * causes and the same situation — the person cannot use the app — and telling them
 * apart at a login form gives whoever is standing there nothing they can act on.
 */
export const signInRefusals = ["invalid", "disabled"] as const;

export type SignInRefusal = (typeof signInRefusals)[number];

export type SignInResult = { ok: true } | { ok: false; reason: SignInRefusal };

/**
 * Everything the login screen can say about why somebody is not in — the refusals above,
 * plus two the sign-in never returns.
 *
 * `incomplete` is the form's own: an empty field is refused before any credential is
 * checked. `link` comes from the URL rather than from an action at all — an invite link
 * that has expired or been used already lands back here with a flag on it, and that is
 * the arrival least able to guess what went wrong.
 *
 * A list rather than a bare union, as every union the app renders a key from is:
 * `messages.test.ts` walks this to hold both locales to it.
 */
export const loginErrors = [...signInRefusals, "incomplete", "link"] as const;

export type LoginError = (typeof loginErrors)[number];

const profileColumns = "id, org_id, name, email, locale, is_org_admin";

export async function signIn(
  credentials: { email: string; password: string },
  store: SessionCookieStore,
): Promise<SignInResult> {
  const supabase = createSessionClient(store);
  const { data, error } = await supabase.auth.signInWithPassword(credentials);

  if (error !== null || data.user === null) {
    return { ok: false, reason: "invalid" };
  }

  // Supabase Auth knows nothing about `disabled_at`, so the credentials check passing
  // is not the whole answer. This has to be asked with the service client: RLS hides a
  // disabled user's profile row from them, so asking as them cannot distinguish
  // "disabled" from "no such row".
  const { data: profile } = await createServiceClient()
    .from("users")
    .select("disabled_at")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.disabled_at !== null) {
    await supabase.auth.signOut();
    return { ok: false, reason: "disabled" };
  }

  return { ok: true };
}

export async function signOut(store: SessionCookieStore): Promise<void> {
  await createSessionClient(store).auth.signOut();
}

/**
 * Who is asking, or null.
 *
 * The profile is read through the session client rather than the service client on
 * purpose. RLS makes a disabled user read nothing, including their own row, so
 * disabling someone ends their live session on their very next request — they do not
 * keep working until a 30-day cookie expires. The one place that must not use this is
 * the sign-in check above, which needs to tell "disabled" apart from "wrong password".
 *
 * Read **at most once per request**, however many times it is asked for. Two round trips
 * live in here — `getUser()` against the auth server, then the profile row — and one
 * screen asks for them more than once: `(app)/layout.tsx` gates on the answer, and the
 * page beneath it needs the same answer to decide what the caller may do. That was two
 * separate pairs of round trips on every render, for one question with one answer.
 *
 * `cache()` is scoped to a single request, so this can never hand one user another's
 * session. It keys on `store` by reference, which is sound because `cookies()` is itself
 * memoised per request and hands every caller the same object.
 *
 * Outside a render — every test below — React's `cache` is a pass-through that does not
 * memoise at all, so a test that disables a member between two calls still sees the
 * second answer change. Deliberate: the dedupe must not be able to hide that.
 */
export const currentUser = cache(async function currentUser(
  store: SessionCookieStore,
): Promise<SessionUser | null> {
  const supabase = createSessionClient(store);

  // `getUser()`, never `getSession()`: the latter trusts the cookie as sent, while this
  // revalidates it with the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select(profileColumns)
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    id: profile.id,
    orgId: profile.org_id,
    name: profile.name,
    email: profile.email,
    locale: isLocale(profile.locale) ? profile.locale : null,
    isOrgAdmin: profile.is_org_admin,
  };
});
