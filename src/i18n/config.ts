/**
 * The two locales the app ships. Both are complete at launch — a switcher over
 * half-translated strings sends the first person who flips it to raw keys.
 */
export const locales = ["en", "zh-Hans"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/**
 * Where the chosen locale is remembered until there is a `users` row to hold it.
 * The locale is deliberately not in the URL: reminder deep links posted into WeCom
 * should not have to encode one, and the user row is the source of truth.
 */
export const localeCookieName = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}
