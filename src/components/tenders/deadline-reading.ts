/**
 * How a number of days to a deadline reads: *today*, *tomorrow*, a date, or one gone by.
 *
 * A wording decision rather than arithmetic, which is why it lives here beside the
 * message keys and not in `@/lib/tenders/progress`: "tomorrow" is a word, and which day
 * counts as tomorrow is a subtraction somebody else already did. A date already gone by
 * gets its own reading rather than a negative number of days — nobody says a deadline is
 * due in minus six.
 *
 * One copy, because two screens now say this sentence off the same four
 * `tenders.row.due.<kind>.*` keys — a tender row on the worklist, and an Item's row on My
 * work (ADR-0021). A second ladder written out beside the second screen is how the two
 * come to disagree about what "tomorrow" is.
 */
export type DeadlineReading = "passed" | "today" | "tomorrow" | "on";

export function deadlineReading(days: number): DeadlineReading {
  if (days < 0) return "passed";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";

  return "on";
}
