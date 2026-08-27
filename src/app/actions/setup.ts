"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/session";
import { setUpOrgAdmin, type SetupError } from "@/lib/auth/setup";

/**
 * The request boundary for the one-time setup screen, in the same shape as
 * `signInAction`: `cookies()` is resolved here and everything below it is reachable from
 * a test without a Next request context.
 */

/**
 * `email` and `name` come back on a refusal because React resets the form on every
 * submit. Neither password does, and neither does the secret — echoing a secret through
 * a server response and back into the page is exactly what `signInAction` refuses to do
 * with a password, for the same reason.
 */
export type SetupState = {
  error?: SetupError;
  email?: string;
  name?: string;
};

export async function setUpAction(
  _previous: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const secret = String(formData.get("secret") ?? "");
  const typed = { email, name };

  if (!name || !email || !password || !confirmation || !secret) {
    return { error: "incomplete", ...typed };
  }

  // The app's own floor, which is higher than the platform's `minimum_password_length`
  // of 6. This is the account that can invite every other one, so it is the last place to
  // accept the weaker of two numbers.
  if (password.length < 8) return { error: "too_short", ...typed };
  if (password !== confirmation) return { error: "mismatch", ...typed };

  const result = await setUpOrgAdmin({ email, name, password, secret });

  if (!result.ok) return { error: result.reason, ...typed };

  // They typed the password into this form a moment ago, so making them type it again on
  // the login screen tests nothing. `locale` is null by construction — first start-up
  // asks — so this lands on the language choice, exactly as an accepted Invite does.
  const session = await signIn({ email, password }, await cookies());

  // The account exists either way — the one-shot guard has already been spent, and there
  // is no second attempt to offer. So a sign-in that somehow fails sends them to the login
  // screen, which is a place they can act, rather than to `/choose-language`, which is not
  // public and would bounce them there anyway with nothing said about why.
  if (!session.ok) redirect("/login");

  redirect("/choose-language");
}
