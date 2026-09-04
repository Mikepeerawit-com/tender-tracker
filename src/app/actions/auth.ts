"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { setLocale } from "@/i18n/locale";
import { setPassword, type SetPasswordError } from "@/lib/auth/password";
import { currentUser, signIn, signOut, type LoginError } from "@/lib/auth/session";
import { chooseLocale } from "@/lib/auth/preferences";
import { setThemeChoice } from "@/lib/theme/cookie";

/**
 * The request boundary. `cookies()` is resolved here and handed down, so everything
 * below is reachable from a test without a Next request context — the same shape as
 * the injected run instant in ADR-0010.
 */

/**
 * `email` comes back on a refusal because React resets the form on every submit,
 * restoring each input from its `defaultValue` — so a refusal that carries only a reason
 * makes the user retype their address to try again. The password deliberately does not:
 * it is the field they got wrong, and a secret is not something to echo through a server
 * response and back into the page.
 */
export type SignInState = {
  error?: Exclude<LoginError, "link">;
  email?: string;
};

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const typed = typeof email === "string" ? email : "";

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "incomplete", email: typed };
  }

  const store = await cookies();
  const result = await signIn({ email, password }, store);

  if (!result.ok) {
    return { error: result.reason, email: typed };
  }

  // Carry the stored choices into the cookies the renderer reads, so the very next page is
  // already in the right language and the right theme rather than one navigation behind.
  // This is what "on any device they sign in on" means in practice: the row is the memory,
  // and signing in is when it reaches a browser that has never seen this member.
  const user = await currentUser(store);

  if (user?.locale) await setLocale(user.locale);
  if (user) await setThemeChoice(user.theme);

  redirect(user?.locale ? "/" : "/choose-language");
}

export async function signOutAction(): Promise<void> {
  await signOut(await cookies());
  redirect("/login");
}

export type SetPasswordState = { error?: SetPasswordError };

export async function setPasswordAction(
  _previous: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (password.length < 8) return { error: "too_short" };
  if (password !== confirmation) return { error: "mismatch" };

  const store = await cookies();
  const result = await setPassword(password, store);

  if (!result.ok) return { error: "no_session" };

  const user = await currentUser(store);

  redirect(user?.locale ? "/" : "/choose-language");
}

export async function chooseLanguageAction(formData: FormData): Promise<void> {
  const locale = formData.get("locale");

  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${String(locale)}`);
  }

  const store = await cookies();

  await chooseLocale(locale, store);
  await setLocale(locale);

  redirect("/");
}
