"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { setLocale } from "@/i18n/locale";
import { setPassword } from "@/lib/auth/password";
import { currentUser, signIn, signOut } from "@/lib/auth/session";
import { chooseLocale } from "@/lib/auth/preferences";

/**
 * The request boundary. `cookies()` is resolved here and handed down, so everything
 * below is reachable from a test without a Next request context — the same shape as
 * the injected run instant in ADR-0010.
 */

export type SignInState = { error?: "invalid" | "disabled" | "incomplete" };

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "incomplete" };
  }

  const store = await cookies();
  const result = await signIn({ email, password }, store);

  if (!result.ok) {
    return { error: result.reason };
  }

  // Carry the stored choice into the cookie the renderer reads, so the very next page
  // is already in the right language rather than one navigation behind.
  const user = await currentUser(store);

  if (user?.locale) await setLocale(user.locale);

  redirect(user?.locale ? "/" : "/choose-language");
}

export async function signOutAction(): Promise<void> {
  await signOut(await cookies());
  redirect("/login");
}

export type SetPasswordState = { error?: "too_short" | "mismatch" | "no_session" };

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
