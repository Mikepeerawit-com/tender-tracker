/**
 * The `yyyy-mm-dd` strings the `date` columns hold, and how to show one.
 *
 * A deadline is a day, not an instant — `2026-08-20` is the twentieth wherever it is
 * read. Both halves therefore work in UTC: the string is parsed at UTC midnight and
 * formatted back in UTC, so the two cancel and the day cannot shift. Formatting a
 * UTC-midnight date in Asia/Bangkok would still read the twentieth, but in the Americas
 * it would render the nineteenth, and every deadline in the app would be a day early.
 *
 * This is not the org timezone (`orgs.timezone`) and is not trying to be. That one
 * decides *which day it currently is* when a boundary has to be computed; this one only
 * renders a day that has already been decided.
 */
export const calendarDateFormat = { timeZone: "UTC", dateStyle: "medium" } as const;

export function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** `yyyy-mm-dd`, and a real day: `2026-02-31` parses and is not a date. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = calendarDate(value);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Which day it is, in a given timezone, at a given instant.
 *
 * Both arguments are required on purpose. The timezone is the org's (`orgs.timezone`),
 * never the server's — Vercel runs UTC, which rolls the day seven hours early for
 * everybody in Bangkok. The instant is passed in rather than read here, so that nothing
 * downstream of a request boundary calls the wall clock (ADR-0010).
 *
 * `en-CA` is not a language choice: it is the one widely-supported locale whose short
 * date format is already `yyyy-mm-dd`, which is what the `date` columns hold.
 */
export function todayIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
