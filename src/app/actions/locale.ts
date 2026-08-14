"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/config";
import { setLocale } from "@/i18n/locale";
import { chooseLocale } from "@/lib/auth/preferences";

export async function switchLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  await setLocale(locale);

  // The cookie is what renders; `users.locale` is what remembers. A signed-out visitor
  // switching language on the login screen has only the cookie, and that is enough —
  // the row gets written once they are someone.
  await chooseLocale(locale, await cookies());

  revalidatePath("/", "layout");
}
