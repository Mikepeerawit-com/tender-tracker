import { describe, expect, it } from "vitest";

import {
  plannedReminders,
  rearms,
  reminderMilestones,
  reminderOffsets,
} from "./schedule";

/**
 * The reminder schedule as arithmetic, over dates chosen by the test.
 *
 * `reminders.test.ts` proves the same rules survive the database. What is worth stating
 * here is the shape of the escalation and the one asymmetry in rule 3 — a deadline moved
 * back re-arms, a deadline moved forward does not — because both are the kind of rule
 * that reads as obviously right in either direction until it is written down.
 */

const deadlines = {
  internalQuoteDeadline: "2026-08-25",
  clientSubmissionDeadline: "2026-09-01",
};

describe("the schedule a Tender is created with", () => {
  it("covers both milestones and nothing else", () => {
    const milestones = new Set(plannedReminders(deadlines).map((row) => row.milestone));

    // `decision_chase` anchors on an absolute date the Owner sets and is off by default.
    expect([...milestones].sort()).toEqual([...reminderMilestones].sort());
  });

  it("escalates the client submission at 7, 3 and 1 days, plus the morning of", () => {
    expect(reminderOffsets.client_submission).toEqual([7, 3, 1, 0]);
  });

  it("ramps the internal quote deadline at 3 and 1 days, plus the morning of", () => {
    // buildspec_2 A2: proposed, not settled. Changing it is this line and the constant.
    expect(reminderOffsets.internal_quote).toEqual([3, 1, 0]);
  });

  it("counts each due date back from its own deadline", () => {
    const rows = plannedReminders(deadlines);
    const dueFor = (milestone: string, daysBefore: number) =>
      rows.find((row) => row.milestone === milestone && row.daysBefore === daysBefore)
        ?.dueDate;

    expect(dueFor("internal_quote", 3)).toBe("2026-08-22");
    expect(dueFor("internal_quote", 0)).toBe("2026-08-25");
    expect(dueFor("client_submission", 7)).toBe("2026-08-25");
    expect(dueFor("client_submission", 0)).toBe("2026-09-01");
  });

  it("crosses a month boundary without arithmetic of its own", () => {
    expect(
      plannedReminders({
        internalQuoteDeadline: "2026-03-02",
        clientSubmissionDeadline: "2026-03-05",
      }).find((row) => row.milestone === "internal_quote" && row.daysBefore === 3)
        ?.dueDate,
    ).toBe("2026-02-27");
  });

  it("plans a nudge that is already overdue rather than dropping it", () => {
    // A Tender created two days before its client deadline still gets its 7-days-before
    // row. Late beats never, and rule 4 collapses the backlog into one message.
    const rows = plannedReminders({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-12",
    });

    expect(rows.filter((row) => row.dueDate < "2026-08-10")).not.toEqual([]);
  });
});

describe("what a moved deadline does to a reminder already marked sent", () => {
  const today = "2026-08-10";

  it("re-arms one whose new due date is still to come", () => {
    // Pushing a deadline back gives the Tender more runway, and leaving the flag set is
    // how it goes quiet at exactly the point there is most time to act.
    expect(rearms("2026-08-11", today)).toBe(true);
  });

  it("leaves one whose new due date is today alone", () => {
    // The run that sent it was this morning's. Re-arming would send it twice in a day.
    expect(rearms(today, today)).toBe(false);
  });

  it("leaves one whose new due date is in the past alone", () => {
    // Pulling a deadline forward re-dates the schedule; it does not re-spam people.
    expect(rearms("2026-08-01", today)).toBe(false);
  });
});
