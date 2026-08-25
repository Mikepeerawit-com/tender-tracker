import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { createTender, updateTender, type TenderFields } from "@/lib/tenders/tenders";

/**
 * A Tender's reminder rows, as the database really holds them.
 *
 * `schedule.test.ts` states the arithmetic. What cannot be lifted out of Postgres is the
 * half this file is for: that creating a Tender writes the rows at all, and that ADR-0005
 * rule 3 — a moved deadline re-dates the schedule and un-sends only the nudges that have
 * not happened yet — is a property of *stored state across two writes*, which is exactly
 * the shape `buildspec_1`'s design got wrong.
 *
 * Every date is placed around one fixed `today`, passed in as an instant rather than read
 * from the clock (ADR-0010). The org's timezone is Asia/Bangkok, so 02:00Z is the
 * morning of the same day there — which is when the cron runs.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

/** 09:00 in Bangkok on 2026-08-10. Every "today" below is that day. */
const runInstant = new Date("2026-08-10T02:00:00Z");

const service = createServiceClient();

const owner = { id: "", email: `reminders-owner-${run}@example.test` };

let orgId = "";

type StoredReminder = {
  milestone: string;
  days_before: number | null;
  remind_on: string | null;
  due_date: string;
  sent: boolean;
  sent_at: string | null;
};

async function signedInAsOwner(): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email: owner.email, password }, store);

  if (!result.ok) throw new Error("could not sign in");

  return store;
}

const fields: TenderFields = {
  clientName: "Bangkok General Hospital",
  title: "Surgical consumables Q3",
  dateReceived: "2026-08-01",
  internalQuoteDeadline: "2026-08-25",
  clientSubmissionDeadline: "2026-09-01",
  expectedDecisionDate: null,
  ownerUserId: "",
  notes: null,
};

async function aTender(overrides: Partial<TenderFields> = {}): Promise<string> {
  const result = await createTender(
    {
      ...fields,
      ownerUserId: owner.id,
      ...overrides,
      items: [
        { productName: "Nitrile gloves", description: null, quantity: 500, unit: "box" },
      ],
    },
    await signedInAsOwner(),
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  return result.tenderId;
}

async function editTender(
  tenderId: string,
  overrides: Partial<TenderFields>,
): Promise<void> {
  const result = await updateTender(
    { tenderId, ...fields, ownerUserId: owner.id, ...overrides },
    runInstant,
    await signedInAsOwner(),
  );

  if (!result.ok) throw new Error(`could not edit the Tender: ${result.reason}`);
}

async function remindersOn(tenderId: string): Promise<StoredReminder[]> {
  const { data } = await service
    .from("reminders")
    .select("milestone, days_before, remind_on, due_date, sent, sent_at")
    .eq("tender_id", tenderId)
    .order("milestone")
    .order("days_before");

  return (data ?? []) as StoredReminder[];
}

/** What a past cron run would have left behind. */
async function markSent(tenderId: string): Promise<void> {
  const { error } = await service
    .from("reminders")
    .update({ sent: true, sent_at: runInstant.toISOString() })
    .eq("tender_id", tenderId);

  if (error) throw error;
}

beforeAll(async () => {
  const { data: org, error: orgError } = await service
    .from("orgs")
    .insert({ name: `Reminders ${run}` })
    .select("id")
    .single();

  if (orgError) throw orgError;

  orgId = org.id;

  const { data, error } = await service.auth.admin.createUser({
    email: owner.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  owner.id = data.user.id;

  const { error: profileError } = await service
    .from("users")
    .insert({ id: owner.id, org_id: orgId, name: "Owner", email: owner.email });

  if (profileError) throw profileError;
});

afterAll(async () => {
  await service.from("tenders").delete().eq("org_id", orgId);
  await service.from("users").delete().eq("org_id", orgId);
  await service.auth.admin.deleteUser(owner.id);
  await service.from("orgs").delete().eq("id", orgId);
});

describe("creating a Tender", () => {
  it("writes the whole escalation, counted back from each deadline", async () => {
    const tenderId = await aTender();

    expect(
      (await remindersOn(tenderId)).map(({ milestone, days_before, due_date }) => ({
        milestone,
        days_before,
        due_date,
      })),
    ).toEqual([
      { milestone: "client_submission", days_before: 0, due_date: "2026-09-01" },
      { milestone: "client_submission", days_before: 1, due_date: "2026-08-31" },
      { milestone: "client_submission", days_before: 3, due_date: "2026-08-29" },
      { milestone: "client_submission", days_before: 7, due_date: "2026-08-25" },
      { milestone: "internal_quote", days_before: 0, due_date: "2026-08-25" },
      { milestone: "internal_quote", days_before: 1, due_date: "2026-08-24" },
      { milestone: "internal_quote", days_before: 3, due_date: "2026-08-22" },
      // The one negative offset: the day *after* the client deadline, because a deadline
      // has not been missed until it has passed.
      { milestone: "submission_missed", days_before: -1, due_date: "2026-09-02" },
    ]);
  });

  it("writes no decision chase until the Owner names a date", async () => {
    // Off by default, and off is the absence of a row rather than a row that never
    // fires: there is no honest day to guess at, because clients rarely state one.
    expect(
      (await remindersOn(await aTender())).filter(
        (row) => row.milestone === "decision_chase",
      ),
    ).toEqual([]);
  });

  it("anchors the decision chase on the Owner's own date", async () => {
    const rows = await remindersOn(
      await aTender({ expectedDecisionDate: "2026-09-20" }),
    );

    expect(
      rows
        .filter((row) => row.milestone === "decision_chase")
        .map(({ days_before, remind_on, due_date }) => ({
          days_before,
          remind_on,
          due_date,
        })),
    ).toEqual([
      // `days_before` null and `remind_on` set is the other half of `anchor_exactly_one`.
      // A row carrying both would have been refused by the database outright.
      { days_before: null, remind_on: "2026-09-20", due_date: "2026-09-20" },
    ]);
  });

  it("anchors every row on an offset, never on an absolute date", async () => {
    // `anchor_exactly_one` is what tells these rows from the decision chase's, whose
    // date the Owner sets outright. A row with both would not have been stored at all.
    const rows = await remindersOn(await aTender());

    expect(rows.every((row) => row.remind_on === null)).toBe(true);
    expect(rows.every((row) => row.days_before !== null)).toBe(true);
  });

  it("leaves every row unsent, however near the deadline is", async () => {
    // A Tender entered two days before its client deadline still gets its 7-days-before
    // row, dated in the past. Rule 1's `<=` query is what turns it into a message.
    const tenderId = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-12",
    });
    const rows = await remindersOn(tenderId);

    expect(rows.every((row) => row.sent === false)).toBe(true);
    expect(rows.filter((row) => row.due_date < "2026-08-10")).not.toEqual([]);
  });
});

describe("moving a deadline", () => {
  it("re-arms reminders already marked sent when it moves back", async () => {
    // The failure this rule exists for: a Tender given a fortnight more runway going
    // silent for the whole of it, because every nudge was still marked done.
    const tenderId = await aTender();

    await markSent(tenderId);
    await editTender(tenderId, { clientSubmissionDeadline: "2026-09-15" });

    const submission = (await remindersOn(tenderId)).filter(
      (row) => row.milestone === "client_submission",
    );

    expect(submission.map((row) => row.due_date)).toEqual([
      "2026-09-15",
      "2026-09-14",
      "2026-09-12",
      "2026-09-08",
    ]);
    expect(submission.every((row) => row.sent === false)).toBe(true);
    expect(submission.every((row) => row.sent_at === null)).toBe(true);
  });

  it("re-dates without re-sending when it moves forward", async () => {
    // Pulling a deadline in must not re-spam people with nudges they have already read.
    const tenderId = await aTender();

    await markSent(tenderId);
    await editTender(tenderId, {
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-08",
    });

    const rows = await remindersOn(tenderId);

    expect(rows.map((row) => row.due_date).sort()).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-04",
      "2026-08-05",
      "2026-08-05",
      "2026-08-07",
      "2026-08-08",
      // The missed-submission row, one day past the new client deadline.
      "2026-08-09",
    ]);
    expect(rows.every((row) => row.sent === true)).toBe(true);
    expect(rows.every((row) => row.sent_at !== null)).toBe(true);
  });

  it("re-arms whatever is still to come, whichever way the deadline moved", async () => {
    // The flag turns on the *date*, not the direction. A deadline pulled in from
    // September to next week still has its 7-days-before nudge ahead of it, and that one
    // has genuinely not happened — while the ones now behind today keep their flag.
    const tenderId = await aTender();

    await markSent(tenderId);
    await editTender(tenderId, {
      internalQuoteDeadline: "2026-08-12",
      clientSubmissionDeadline: "2026-08-14",
    });

    const submission = (await remindersOn(tenderId)).filter(
      (row) => row.milestone === "client_submission",
    );
    const byDueDate = new Map(submission.map((row) => [row.due_date, row.sent]));

    expect(byDueDate.get("2026-08-07")).toBe(true);
    expect(byDueDate.get("2026-08-11")).toBe(false);
    expect(byDueDate.get("2026-08-13")).toBe(false);
    expect(byDueDate.get("2026-08-14")).toBe(false);
  });

  it("leaves the other milestone's reminders alone", async () => {
    const tenderId = await aTender();

    await markSent(tenderId);
    await editTender(tenderId, { clientSubmissionDeadline: "2026-09-15" });

    const internal = (await remindersOn(tenderId)).filter(
      (row) => row.milestone === "internal_quote",
    );

    expect(internal.map((row) => row.due_date)).toEqual([
      "2026-08-25",
      "2026-08-24",
      "2026-08-22",
    ]);
    expect(internal.every((row) => row.sent === true)).toBe(true);
  });

  it("adds no rows when the deadlines have not changed", async () => {
    // The reschedule states "the schedule is now this" rather than applying a diff, so
    // an edit that touched only the notes has to leave exactly eight rows behind.
    const tenderId = await aTender();

    await editTender(tenderId, { notes: "Client rang about the gloves." });

    expect(await remindersOn(tenderId)).toHaveLength(8);
  });

  it("drops the decision chase when the Owner clears the date", async () => {
    // Turning the chase off is deleting the row, not leaving one dated in the past — a
    // stale row would come due on the next run and post a chase nobody asked for.
    const tenderId = await aTender({ expectedDecisionDate: "2026-09-20" });

    expect(await remindersOn(tenderId)).toHaveLength(9);

    await editTender(tenderId, { expectedDecisionDate: null });

    expect(
      (await remindersOn(tenderId)).filter((row) => row.milestone === "decision_chase"),
    ).toEqual([]);
  });

  it("re-dates the decision chase in place rather than replacing it", async () => {
    // Matched on the milestone and the offset, never on the date. Pairing on the date
    // would orphan the row every time the Owner moved it — deleting the one that had
    // been sent and inserting a fresh unsent one, which is rule 3 inverted.
    const tenderId = await aTender({ expectedDecisionDate: "2026-08-05" });

    await markSent(tenderId);
    await editTender(tenderId, { expectedDecisionDate: "2026-09-20" });

    expect(
      (await remindersOn(tenderId))
        .filter((row) => row.milestone === "decision_chase")
        .map(({ remind_on, due_date, sent }) => ({ remind_on, due_date, sent })),
    ).toEqual([
      // Re-armed, because a chase dated next month has not happened yet.
      { remind_on: "2026-09-20", due_date: "2026-09-20", sent: false },
    ]);
  });

  it("repairs a Tender that has lost a reminder row", async () => {
    // Self-healing falls out of stating the schedule rather than patching it, and it is
    // the only thing standing between a half-written Tender and permanent silence.
    const tenderId = await aTender();

    await service
      .from("reminders")
      .delete()
      .eq("tender_id", tenderId)
      .eq("milestone", "client_submission")
      .eq("days_before", 0);

    expect(await remindersOn(tenderId)).toHaveLength(7);

    await editTender(tenderId, {});

    expect(await remindersOn(tenderId)).toHaveLength(8);
  });
});
