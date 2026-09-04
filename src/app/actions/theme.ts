"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { chooseTheme } from "@/lib/auth/preferences";
import { isThemeChoice } from "@/lib/theme/config";
import { setThemeChoice } from "@/lib/theme/cookie";

export async function switchTheme(theme: string): Promise<void> {
  if (!isThemeChoice(theme)) {
    throw new Error(`Unsupported theme: ${theme}`);
  }

  await setThemeChoice(theme);

  // The cookie is what paints; `users.theme` is what remembers. The root layout resolves a
  // theme for every page including the signed-out ones, before anything has asked who is
  // looking, which is why the cookie exists at all — this control is only ever reached
  // from Preferences, behind the login, so both writes always have somebody to aim at.
  //
  // The row write's answer is deliberately not surfaced. A refused write leaves the reader
  // correctly repainted and their choice unremembered, and there is nothing they could do
  // with the news mid-transition; `switchLocale` makes the same trade for the same reason.
  await chooseTheme(theme, await cookies());

  // The class is written on `<html>` by the root layout, so the whole tree is what has to
  // come back — the same revalidation the language switch asks for.
  revalidatePath("/", "layout");
}
