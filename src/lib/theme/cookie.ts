import "server-only";

import { cookies } from "next/headers";

import {
  defaultThemeChoice,
  isThemeChoice,
  type ThemeChoice,
  themeCookieName,
} from "@/lib/theme/config";

const oneYearInSeconds = 60 * 60 * 24 * 365;

/**
 * The theme this request paints in, and the cookie it is read from.
 *
 * Named for the mechanism rather than for the subject, which is the opposite of
 * `i18n/locale.ts` next door and deliberate: this is *the cookie half* of the theme, and
 * `theme/theme.ts` would have been a filename that said nothing its own docblock did not
 * have to say over again. The meaning is in `config.ts`, which the browser can import.
 *
 * The cookie is what renders and `users.theme` is what remembers — the shape
 * `getLocale()` already has. The root layout calls this before anything knows who is
 * looking, which is what lets a signed-out login screen and a cold load inside the WeCom
 * webview arrive already painted (ADR-0024).
 *
 * A cookie that is missing or holds something this app does not ship falls back to
 * following the device, which is the answer that is right for a reader nobody has asked.
 */
export async function getThemeChoice(): Promise<ThemeChoice> {
  const stored = (await cookies()).get(themeCookieName)?.value;
  return isThemeChoice(stored) ? stored : defaultThemeChoice;
}

export async function setThemeChoice(choice: ThemeChoice): Promise<void> {
  (await cookies()).set(themeCookieName, choice, {
    maxAge: oneYearInSeconds,
    sameSite: "lax",
    path: "/",
  });
}
