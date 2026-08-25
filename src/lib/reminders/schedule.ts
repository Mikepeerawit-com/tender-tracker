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
 * ## Two anchor shapes, and the CHECK that keeps them apart
 *
 * Three of the four milestones are **offsets** from a date the Tender already carries, and
 * set `days_before`. `decision_chase` is an **absolute** date the Owner types, and sets
 * `remind_on` instead — clients rarely say when they will decide, so there is nothing to
 * count back from. `anchor_exactly_one` is what stops a row claiming both or neither, and
 * {@link PlannedReminder} carries both fields so a planned row states which shape it is.
 */

/**
 * The four dated things a Tender is reminded about.
 *
 * Ordered as they fire, which is also the order they read in a message: chase the Quotes,
 * chase the Bid, say the Bid never went out, chase the client's answer.
 */
export const reminderMilestones = [
  "internal_quote",
  "client_submission",
  "submission_missed",
  "decision_chase",
] as const;

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
 *
 * **`submission_missed` is the one negative offset**, and the sign is the whole of it: it
 * fires the day *after* the Client Submission Deadline, because the cron runs at 08:00
 * Bangkok and at 08:00 on the deadline itself the Bid can still go out. A `0` here would
 * announce a miss to the whole group every morning somebody was still working on it.
 *
 * `decision_chase` is absent because it has no offset at all; see {@link plannedReminders}.
 */
export const reminderOffsets: Record<OffsetMilestone, readonly number[]> = {
  internal_quote: [3, 1, 0],
  client_submission: [7, 3, 1, 0],
  submission_missed: [-1],
};

/** The milestones that count from a date the Tender already has. */
export type OffsetMilestone = Exclude<ReminderMilestone, "decision_chase">;

/**
 * The same three, in the order {@link reminderMilestones} declares them.
 *
 * Read off `reminderOffsets` rather than listed again, so it cannot fall out of step with
 * it — and filtered from `reminderMilestones` rather than from `Object.keys`, so the order
 * is the one declared rather than whichever the object literal happened to be written in.
 */
const offsetMilestones = reminderMilestones.filter(
  (milestone): milestone is OffsetMilestone => milestone in reminderOffsets,
);

/**
 * The dates a Tender's schedule is built from.
 *
 * `expectedDecisionDate` is nullable and the decision chase is off while it is null: a
 * Tender only chases a decision the Owner asked to be reminded about.
 */
export type Deadlines = {
  internalQuoteDeadline: string;
  clientSubmissionDeadline: string;
  expectedDecisionDate: string | null;
};

/**
 * The date a milestone is about — the deadline it counts from, or the Owner's own day.
 *
 * Null only for a `decision_chase` on a Tender with no expected decision date, which has
 * no rows to ask about. Callers reading a stored row have one by construction.
 */
export function dateFor(milestone: OffsetMilestone, deadlines: Deadlines): string;
export function dateFor(
  milestone: ReminderMilestone,
  deadlines: Deadlines,
): string | null;
export function dateFor(
  milestone: ReminderMilestone,
  deadlines: Deadlines,
): string | null {
  switch (milestone) {
    case "internal_quote":
      return deadlines.internalQuoteDeadline;
    case "client_submission":
    // The miss is a fact about the client deadline, so it is the date it names.
    case "submission_missed":
      return deadlines.clientSubmissionDeadline;
    case "decision_chase":
      return deadlines.expectedDecisionDate;
  }
}

/** One row's worth of schedule: what it is about, which anchor it uses, and when it is due. */
export type PlannedReminder = {
  milestone: ReminderMilestone;
  /** Set on an offset milestone, null on the decision chase. Exactly one of the two. */
  daysBefore: number | null;
  /** Set on the decision chase, null on an offset milestone. Exactly one of the two. */
  remindOn: string | null;
  /** `yyyy-mm-dd`, counted from the milestone's date. */
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
 *
 * The decision chase is the one row a Tender may not have. **Off unless the Owner sets a
 * date**, which is why it is planned conditionally rather than given a default offset:
 * there is no honest day to guess, and a chase nobody asked for on a date nobody stated
 * is the kind of nudge that teaches a group to mute the robot.
 */
export function plannedReminders(deadlines: Deadlines): PlannedReminder[] {
  const offsets = offsetMilestones.flatMap((milestone) =>
    reminderOffsets[milestone].map((daysBefore) => ({
      milestone,
      daysBefore,
      remindOn: null,
      dueDate: plusDays(dateFor(milestone, deadlines), -daysBefore),
    })),
  );

  const { expectedDecisionDate } = deadlines;

  if (expectedDecisionDate === null) return offsets;

  return [
    ...offsets,
    {
      milestone: "decision_chase",
      daysBefore: null,
      // The Owner's date is both the anchor and the day it comes due. Stored twice
      // rather than derived, because `due_date` is what the cron queries and
      // `remind_on` is what says which anchor the row used.
      remindOn: expectedDecisionDate,
      dueDate: expectedDecisionDate,
    },
  ];
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
