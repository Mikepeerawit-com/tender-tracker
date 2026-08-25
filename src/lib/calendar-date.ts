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

/**
 * How an *instant* is shown as the day it fell on — `submitted_at`, `outcome_at`.
 *
 * Not {@link calendarDateFormat}, which reads `date` columns in UTC so a day cannot
 * shift. These columns hold moments, and which day a moment lands on is a question only
 * a timezone can answer: the org's (`orgs.timezone`), never the server's, because Vercel
 * runs UTC and would date a Bid sent at 9pm in Bangkok to the day before.
 */
export function instantDayFormat(timezone: string) {
  return { timeZone: timezone, dateStyle: "medium" } as const;
}

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

/**
 * The day `days` after a `yyyy-mm-dd` one — the arithmetic a rolling window needs.
 *
 * Counted in UTC, like everything else here, so the answer is the same day wherever it
 * is read. Adding 7 × 24 hours to a *local* midnight is a day short for one week a year
 * in every hemisphere that changes its clocks, and a rolling seven days that is
 * sometimes six is exactly the kind of quiet wrongness a deadline cannot afford.
 */
export function plusDays(value: string, days: number): string {
  const shifted = calendarDate(value);

  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted.toISOString().slice(0, 10);
}

/**
 * How many days from one `yyyy-mm-dd` day to another. Negative when `to` is behind.
 *
 * Counted in UTC for the same reason {@link plusDays} adds in UTC: 24-hour arithmetic
 * over a *local* midnight is off by one for the week either side of a clock change, and
 * a reminder that says "还剩 2 天" about tomorrow is worse than one that says nothing.
 */
export function daysBetween(from: string, to: string): number {
  const day = 24 * 60 * 60 * 1000;

  return Math.round((calendarDate(to).getTime() - calendarDate(from).getTime()) / day);
}
