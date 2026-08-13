"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/config";
import { setLocale } from "@/i18n/locale";

export async function switchLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  await setLocale(locale);
  revalidatePath("/", "layout");
}
