import { plusDays } from "@/lib/calendar-date";

/**
 * When a Tender's reminders fall due, as arithmetic.
 *
 * Nothing here reads a clock, a database or a timezone. `due_date` is the one piece of
 * derived state this schema stores (see the column comment on `reminders.due_date`), and
 * it is stored precisely so the cron can ask `due_date <= today` rather than
 * `due_date = today` — an exact match drops a day's reminders permanently the first time
 * a run is missed, which for a product whose purpose is "we occasionally miss our
 * submission" is the worst defect available (ADR-0005, rule 1).
 *
 * The two rules that are easy to get subtly wrong both live here as functions rather than
 * as comments:
 *
 * - {@link plannedReminders} — which rows a Tender gets, and when each falls due.
 * - {@link rearms} — whether moving a deadline un-sends a reminder (rule 3).
 *
 * `decision_chase` is deliberately absent. It anchors on an absolute `remind_on` the
 * Owner sets rather than on an offset, it is off by default, and it belongs to the
 * decision chase (#34). The `anchor_exactly_one` CHECK is what keeps the two shapes from
 * being confused: every row here sets `days_before` and leaves `remind_on` null.
 */

/** The two milestones a Tender is reminded about from the moment it is created. */
export const reminderMilestones = ["internal_quote", "client_submission"] as const;

export type ReminderMilestone = (typeof reminderMilestones)[number];

/**
 * How many days before each deadline the group is nudged. `0` is the morning of.
 *
 * **The `client_submission` escalation (7/3/1 + morning-of) is settled; the
 * `internal_quote` ramp (3/1 + morning-of) is assumption A2 of buildspec_2 and is not.**
 * The internal deadline is nearer-term and lower-stakes, so a shorter ramp is proposed.
 * It is a constant here rather than a column because changing it is a one-line commit and
 * a column would be a setting nobody would ever open — but it is one line, and it is the
 * line to change when the Owner confirms.
 *
 * Descending, because that is the order they fire in and the order a reader checks them
 * against the escalation they were told about.
 */
export const reminderOffsets: Record<ReminderMilestone, readonly number[]> = {
  internal_quote: [3, 1, 0],
  client_submission: [7, 3, 1, 0],
};

/** Which deadline a milestone is counted back from. */
export type Deadlines = {
  internalQuoteDeadline: string;
  clientSubmissionDeadline: string;
};

export function deadlineFor(milestone: ReminderMilestone, deadlines: Deadlines): string {
  return milestone === "internal_quote"
    ? deadlines.internalQuoteDeadline
    : deadlines.clientSubmissionDeadline;
}

/** One row's worth of schedule: what it is about, and the day it comes due. */
export type PlannedReminder = {
  milestone: ReminderMilestone;
  daysBefore: number;
  /** `yyyy-mm-dd`, counted back from the milestone's deadline. */
  dueDate: string;
};

/**
 * Every reminder a Tender is created with, and every one it is re-created with when a
 * deadline moves.
 *
 * Rows whose `due_date` has already gone by are planned all the same — a Tender created
 * two days before its client deadline still gets its 7-days-before row, dated in the
 * past, and the `<=` query fires it on the next run. That is not a bug being tolerated:
 * rule 1 is "late beats never", and rule 4's batching collapses the whole backlog for one
 * Tender into a single message anyway.
 */
export function plannedReminders(deadlines: Deadlines): PlannedReminder[] {
  return reminderMilestones.flatMap((milestone) =>
    reminderOffsets[milestone].map((daysBefore) => ({
      milestone,
      daysBefore,
      dueDate: plusDays(deadlineFor(milestone, deadlines), -daysBefore),
    })),
  );
}

/**
 * Does a row whose `due_date` just moved to `dueDate` count as un-sent? (Rule 3.)
 *
 * **A reminder that has not happened yet has not been sent, whatever the flag said before
 * the date moved.** Push a client deadline back a fortnight and every nudge for it is
 * suddenly in the future again; leaving them marked done is how a Tender goes quiet
 * exactly when it has the most runway left.
 *
 * The converse is why this is a comparison and not an unconditional clear. Rows that
 * recompute to a date **on or before today keep their flag**, so pulling a deadline
 * *forward* re-dates the schedule without re-sending anything anybody has already read.
 */
export function rearms(dueDate: string, today: string): boolean {
  return dueDate > today;
}
