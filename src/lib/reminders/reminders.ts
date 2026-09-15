import "server-only";

import { createServiceClient } from "@/lib/supabase/service-client";
import type { createSessionClient } from "@/lib/supabase/session-client";

import {
  plannedReminders,
  rearms,
  reminderMilestones,
  type Deadlines,
  type PlannedReminder,
  type ReminderMilestone,
} from "./schedule";

/**
 * A Tender's reminder rows: written when it is created, re-dated whenever a deadline
 * moves.
 *
 * Both writes go through the caller's **session** client, because both happen inside a
 * write the user is already making and RLS is what keeps one org out of another's rows.
 * The cron reads these back with the service role instead — it has no session at all.
 *
 * ## Why a failure here fails the write it is part of
 *
 * A Tender whose reminders were never written looks exactly like a Tender whose
 * reminders have not come due yet, and it keeps looking like one right up to the morning
 * nobody was told the Bid was due. There is no screen that shows the schedule and no
 * background job that repairs it, so a silently half-written Tender would be discovered
 * by the failure it was built to prevent. Both functions therefore report failure, and
 * their callers treat it the way they treat a Tender that could not be given its Items.
 */

/** What both writes need to know about the Tender they are scheduling. */
export type ReminderTarget = { tenderId: string; orgId: string; deadlines: Deadlines };

type Supabase = ReturnType<typeof createSessionClient>;

/** An existing row, as the reconcile below needs to see it. */
type ExistingReminder = {
  id: string;
  milestone: ReminderMilestone;
  /**
   * The anchor, and the only half of it the reconcile matches on.
   *
   * `remind_on` is deliberately not read back. It is the decision chase's *date*, and the
   * whole point of that row is that the date moves — matching on it would orphan the row
   * every time the Owner changed it. So a planned row is paired to a stored one by
   * milestone and offset, and `remind_on` is then written from the plan.
   */
  days_before: number | null;
  due_date: string;
  sent: boolean;
};

/**
 * Give a newly created Tender its whole escalation at once.
 *
 * Every offset is written, including ones whose `due_date` already fell in the past —
 * a Tender entered two days before its client deadline is exactly the Tender most worth
 * shouting about, and rule 1's `<=` query is what turns those rows into a message on the
 * next run rather than into nothing at all.
 */
export async function scheduleReminders(
  { tenderId, orgId, deadlines }: ReminderTarget,
  supabase: Supabase,
): Promise<boolean> {
  const { error } = await supabase
    .from("reminders")
    .insert(plannedReminders(deadlines).map((row) => reminderRow(row, tenderId, orgId)));

  return error === null;
}

/**
 * Bring a Tender's schedule back in line with its deadlines. (ADR-0005, rule 3.)
 *
 * A reconcile rather than a patch: it re-dates the rows that exist, writes any the Tender
 * is missing, and drops any it should not have. Stating it as "the schedule is now this"
 * rather than "apply these changes" is what makes it idempotent — a caller that retries
 * after a failed save gets the same answer — and it quietly repairs a Tender whose
 * creation half-succeeded.
 *
 * `today` is a `yyyy-mm-dd` day **already resolved in the org's timezone** and handed down
 * from the request boundary (ADR-0010). It decides one thing and one thing only: whether
 * a row that had been marked sent is un-sent by the move ({@link rearms}).
 */
export async function rescheduleReminders(
  { tenderId, orgId, deadlines }: ReminderTarget,
  today: string,
  supabase: Supabase,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("reminders")
    .select("id, milestone, days_before, due_date, sent")
    .eq("tender_id", tenderId)
    .in("milestone", [...reminderMilestones])
    .overrideTypes<ExistingReminder[], { merge: false }>();

  if (error !== null) return false;

  const existing = data ?? [];
  const matched = new Set<string>();
  const inserts: PlannedReminder[] = [];
  const updates: { id: string; planned: PlannedReminder; unsend: boolean }[] = [];

  for (const planned of plannedReminders(deadlines)) {
    // First match only. A duplicate pair cannot arise through the app, and if one ever
    // did, leaving it unmatched is what sweeps it up in the delete below.
    const row = existing.find(
      (candidate) =>
        !matched.has(candidate.id) &&
        candidate.milestone === planned.milestone &&
        // The offset, never the date — see the note on `ExistingReminder.days_before`.
        candidate.days_before === planned.daysBefore,
    );

    if (!row) {
      inserts.push(planned);
      continue;
    }

    matched.add(row.id);

    // A row whose date has not moved has nothing to say. Skipping it is not an
    // optimisation: `sent` is only ever set on a row already due, so re-deciding
    // `rearms` for an unchanged date could only ever agree with itself.
    if (row.due_date === planned.dueDate) continue;

    updates.push({
      id: row.id,
      planned,
      unsend: row.sent && rearms(planned.dueDate, today),
    });
  }

  const orphans = existing.filter((row) => !matched.has(row.id)).map((row) => row.id);
  // A re-dated row is a new promise, and both channels owe it again: the messages that
  // went out named the old date. Cleared through the **service** client — deliveries
  // are the cron's bookkeeping, and `reminder_deliveries` deliberately grants a session
  // nothing but reading its own org's rows. Orphaned rows need nothing here: their
  // deliveries go with them, `on delete cascade`.
  //
  // **Cleared first, alone, and fatally.** There is no transaction spanning the two
  // clients, so the order decides which way a half-done move fails. Deliveries gone but
  // dates not yet moved re-sends the old date — a duplicate nudge, the safe direction.
  // Dates moved with stale deliveries left behind would let the next run settle the
  // re-armed rows without sending anything, on a write that reported success — and a
  // user's retry could not repair it, because a date that already matches is skipped.
  // So a failed clear fails the whole edit, and the user's retry really does retry it.
  const redated = updates.map(({ id }) => id);

  if (redated.length > 0) {
    const { error: deliveriesError } = await createServiceClient()
      .from("reminder_deliveries")
      .delete()
      .in("reminder_id", redated);

    if (deliveriesError !== null) return false;
  }

  const results = await Promise.all([
    inserts.length === 0
      ? ok()
      : supabase
          .from("reminders")
          .insert(inserts.map((row) => reminderRow(row, tenderId, orgId))),
    orphans.length === 0
      ? ok()
      : supabase.from("reminders").delete().in("id", orphans),
    ...updates.map(({ id, planned, unsend }) =>
      supabase
        .from("reminders")
        .update({
          due_date: planned.dueDate,
          // The anchor moves with the date on the decision chase, whose `remind_on` *is*
          // the day it fires. Written on every update rather than only that one, because
          // an offset row's `remind_on` is null and re-writing null is a no-op.
          remind_on: planned.remindOn,
          // Left alone unless the move really un-sends it: writing `sent: false` on a
          // row that is staying sent would clear `sent_at` with it and lose the only
          // record of when anybody was told.
          ...(unsend ? { sent: false, sent_at: null } : {}),
        })
        .eq("id", id),
    ),
  ]);

  return results.every((result) => result.error === null);
}

/**
 * The anchor, spelled out both ways round.
 *
 * `plannedReminders` has already set exactly one of the two — an offset row's `remindOn`
 * is null and the decision chase's `daysBefore` is — so both are written verbatim and the
 * `anchor_exactly_one` CHECK is satisfied by construction rather than by a branch here.
 */
function reminderRow(row: PlannedReminder, tenderId: string, orgId: string) {
  return {
    org_id: orgId,
    tender_id: tenderId,
    milestone: row.milestone,
    days_before: row.daysBefore,
    remind_on: row.remindOn,
    due_date: row.dueDate,
  };
}

/** The shape the branches above share, so `results.every` can read them all the same. */
function ok(): Promise<{ error: null }> {
  return Promise.resolve({ error: null });
}
