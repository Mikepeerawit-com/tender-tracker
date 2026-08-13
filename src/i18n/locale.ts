import "server-only";

import { cookies } from "next/headers";

import { defaultLocale, isLocale, type Locale, localeCookieName } from "@/i18n/config";

const oneYearInSeconds = 60 * 60 * 24 * 365;

/**
 * The locale this request renders in.
 *
 * Until there is a `users` row to read `locale` from, the cookie is the whole story.
 * When the user row arrives it becomes the source of truth and this falls back to it.
 */
export async function getLocale(): Promise<Locale> {
  const stored = (await cookies()).get(localeCookieName)?.value;
  return isLocale(stored) ? stored : defaultLocale;
}

export async function setLocale(locale: Locale): Promise<void> {
  (await cookies()).set(localeCookieName, locale, {
    maxAge: oneYearInSeconds,
    sameSite: "lax",
    path: "/",
  });
}
