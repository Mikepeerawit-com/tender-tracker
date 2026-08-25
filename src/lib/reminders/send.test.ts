import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { respondingLatestRates, respondingRates, unreachableRates } from "@/lib/fx/rate-stub";
import { createQuote, recordNoSupplierFound } from "@/lib/quotes/quotes";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import {
  addAssignee,
  createTender,
  recordSubmission,
  setItemOutcome,
  updateTender,
} from "@/lib/tenders/tenders";
import { recordingRobot, type RobotStub } from "@/lib/wecom/robot-stub";
import { paceMs } from "@/lib/wecom/robot";

import { runDailyCron } from "@/lib/cron/daily";

import { sendDueReminders } from "./send";

/**
 * The nightly send, run against the real database the way the cron runs it.
 *
 * ADR-0005's five rules are all about **persisted state across runs** — "the cron is
 * missed for two days and then runs", "a deadline moves after a nudge was marked sent",
 * "WeCom refuses one message out of ten" — so none of them can be stated without a
 * database and a stub standing at the webhook. That is the seam this file uses, and the
 * assertions are about the one thing the run has externally: **the messages that would be
 * posted**.
 *
 * **Everything that runs the cron lives in this one file, deliberately.** `sendDueReminders`
 * sweeps *every* org, the way it does in production, so two test files calling it in
 * parallel would each consume the other\'s pending rows and post the other\'s messages into
 * their own stub. A new caller (#35\'s Digest) belongs here rather than in a file of its
 * own.
 *
 * Every Tender here is placed around one fixed day. The instant is 01:00 in Bangkok on
 * that day, which is when the cron actually fires — and, deliberately, the *previous*
 * calendar day in UTC. A run that read the server's clock would be a day behind on every
 * assertion below.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

/** The day every deadline below is placed around, in the org's timezone. */
const today = "2026-08-10";

/** 01:00 on that day in Bangkok — and 2026-08-09 in UTC, where Vercel runs. */
const runInstant = new Date("2026-08-09T18:00:00Z");

/** The same wall clock two hours earlier, which is still the day before in Bangkok. */
const nightBefore = new Date("2026-08-09T16:00:00Z");

const service = createServiceClient();

/** Unique to this run, so a message of ours is tellable from a neighbouring suite's. */
const client = `Bangkok General ${run}`;

const webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${run}`;

/** A day nothing else in the suite writes, so these rate rows are this file\'s alone. */
const ratesAsOf = "2015-03-18";
const perEur = { THB: 40, USD: 1.25 };

const owner = { id: "", email: `send-owner-${run}@example.test`, wecom: `owner-${run}` };
const nok = { id: "", email: `send-nok-${run}@example.test`, wecom: `nok-${run}` };
const anong = { id: "", email: `send-anong-${run}@example.test`, wecom: `anong-${run}` };

let orgId = "";

async function signedInAs(who: { email: string }): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email: who.email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${who.email}`);

  return store;
}

async function createMember(who: { id: string; email: string; wecom: string }) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service.from("users").insert({
    id: who.id,
    org_id: orgId,
    name: who.email,
    email: who.email,
    wecom_userid: who.wecom,
  });

  if (profileError) throw profileError;
}

type TenderShape = {
  internalQuoteDeadline?: string;
  clientSubmissionDeadline?: string;
  expectedDecisionDate?: string | null;
  items?: string[];
  assignees?: { id: string }[];
};

/** The Tender's own fields, as both the create and the edit below need them. */
function fieldsFor(shape: TenderShape) {
  return {
    clientName: client,
    title: "Surgical consumables",
    dateReceived: "2026-08-01",
    internalQuoteDeadline: shape.internalQuoteDeadline ?? "2026-08-25",
    clientSubmissionDeadline: shape.clientSubmissionDeadline ?? "2026-09-01",
    expectedDecisionDate: shape.expectedDecisionDate ?? null,
    ownerUserId: owner.id,
    notes: null,
  };
}

/** A Tender with its reminders already scheduled, and its Items back in order. */
async function aTender(shape: TenderShape = {}): Promise<{
  id: string;
  itemIds: string[];
}> {
  const store = await signedInAs(owner);
  const result = await createTender(
    {
      ...fieldsFor(shape),
      items: (shape.items ?? ["Nitrile gloves"]).map((productName) => ({
        productName,
        description: null,
        quantity: 500,
        unit: "box",
      })),
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  for (const assignee of shape.assignees ?? []) {
    const added = await addAssignee(
      { tenderId: result.tenderId, userId: assignee.id },
      store,
    );

    if (!added.ok) throw new Error(`could not assign: ${added.reason}`);
  }

  const { data } = await service
    .from("tender_items")
    .select("id")
    .eq("tender_id", result.tenderId)
    .order("ordinal");

  return { id: result.tenderId, itemIds: (data ?? []).map((item) => item.id) };
}

async function quoteOn(itemId: string, who: { email: string }): Promise<void> {
  const result = await createQuote(
    {
      tenderItemId: itemId,
      supplierName: `Ace Medical ${run}`,
      unitPrice: 120,
      currency: "THB",
      quotedUnit: "box",
      leadTimeDays: null,
      matchType: "exact",
      alternativeProductName: null,
      detailNotes: null,
      quotedAt: "2026-08-05",
    },
    await signedInAs(who),
    respondingRates(1),
  );

  if (!result.ok) throw new Error(`could not quote: ${result.reason}`);
}

/** Move a Tender's dates, the way the edit screen does — reschedule included. */
async function reschedule(
  tenderId: string,
  shape: TenderShape,
  at: Date,
): Promise<void> {
  const result = await updateTender(
    { tenderId, ...fieldsFor(shape) },
    at,
    await signedInAs(owner),
  );

  if (!result.ok) throw new Error(`could not edit the Tender: ${result.reason}`);
}

/** Only what this suite posted — other suites' orgs share the run. */
function mine(robot: RobotStub) {
  return robot.sent.filter((message) => message.payload.text.content.includes(client));
}

function contentFor(robot: RobotStub, reference: string): string {
  return (
    mine(robot).find((message) => message.payload.text.content.includes(reference))
      ?.payload.text.content ?? ""
  );
}

async function referenceOf(tenderId: string): Promise<string> {
  const { data } = await service
    .from("tenders")
    .select("reference")
    .eq("id", tenderId)
    .single();

  return data!.reference;
}

async function remindersOn(tenderId: string) {
  const { data } = await service
    .from("reminders")
    .select("milestone, days_before, due_date, sent")
    .eq("tender_id", tenderId);

  return data ?? [];
}

async function notificationsOn(tenderId: string) {
  const { data } = await service
    .from("notifications")
    .select("user_id, type, tender_item_id, body")
    .eq("tender_id", tenderId);

  return data ?? [];
}

beforeAll(async () => {
  const { data: org, error } = await service
    .from("orgs")
    .insert({ name: `Send ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = org.id;

  await createMember(owner);
  await createMember(nok);
  await createMember(anong);

  const { error: robotError } = await service
    .from("group_robots")
    .insert({ org_id: orgId, webhook_url: webhook, updated_by: owner.id });

  if (robotError) throw robotError;
});

afterAll(async () => {
  await service.from("fx_rates").delete().eq("as_of", ratesAsOf);
  await service.from("group_robots").delete().eq("org_id", orgId);
  await service.from("notifications").delete().eq("org_id", orgId);
  await service.from("tenders").delete().eq("org_id", orgId);
  await service.from("suppliers").delete().eq("org_id", orgId);
  await service.from("users").delete().eq("org_id", orgId);

  for (const who of [owner, nok, anong]) await service.auth.admin.deleteUser(who.id);

  await service.from("orgs").delete().eq("id", orgId);
});

describe("rule 1: catch up, never skip", () => {
  it("still sends a nudge whose day went by while the cron was down", async () => {
    // The real scenario, run as three runs: one that happens, two that are missed, and
    // one that catches up. `due_date = today` would have dropped the 8th permanently,
    // with nothing anywhere recording that it had ever been owed.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-20",
    });
    const reference = await referenceOf(tender.id);

    // The 7th: the cron runs, and nothing is due yet.
    const before = recordingRobot();

    await sendDueReminders(new Date("2026-08-06T18:00:00Z"), before);

    expect(contentFor(before, reference)).toBe("");

    // The 8th and the 9th: the cron does not run at all. The 3-days-before nudge comes
    // due on the 8th and nobody is there to send it.
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, reference)).toContain("2026-08-11");

    const internal = (await remindersOn(tender.id)).filter(
      (row) => row.milestone === "internal_quote",
    );

    // The two already owed are settled; the morning-of one is still ahead.
    expect(internal.filter((row) => row.sent).map((row) => row.days_before).sort()).toEqual(
      [1, 3],
    );
  });

  it("computes the day in the org's timezone, not the server's", async () => {
    // 2026-08-09 18:00Z is already the tenth in Bangkok. A run reading UTC would call it
    // the ninth and leave every reminder due on the tenth for tomorrow — every deadline
    // in the app going quiet for seven hours a day, every day.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-13",
      clientSubmissionDeadline: "2026-08-20",
    });
    const reference = await referenceOf(tender.id);

    const early = recordingRobot();

    await sendDueReminders(nightBefore, early);

    expect(contentFor(early, reference)).toBe("");

    const onTheDay = recordingRobot();

    await sendDueReminders(runInstant, onTheDay);

    expect(contentFor(onTheDay, reference)).toContain("2026-08-13");
  });

  it("says a deadline is today rather than counting zero days to it", async () => {
    const tender = await aTender({
      internalQuoteDeadline: today,
      clientSubmissionDeadline: "2026-08-20",
    });
    const reference = await referenceOf(tender.id);
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, reference)).toContain("就是今天");
  });
});

describe("rule 2: a caught-up nudge for a milestone that has passed", () => {
  it("is suppressed rather than posted late", async () => {
    // "3 days to go" about a deadline that went by yesterday tells nobody anything. The
    // worklist's Submission Missed block says the true thing, much more loudly.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-09-01",
    });
    const reference = await referenceOf(tender.id);
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, reference)).toBe("");
  });

  it("settles the row so it is not reconsidered every night forever", async () => {
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-09-01",
    });

    await sendDueReminders(runInstant, recordingRobot());

    const internal = (await remindersOn(tender.id)).filter(
      (row) => row.milestone === "internal_quote" && row.due_date <= today,
    );

    expect(internal.every((row) => row.sent)).toBe(true);
  });

  it("says nothing at all about a Tender whose Bid has gone out", async () => {
    // Its client deadline was met and its internal one is spent — the same reading the
    // worklist takes when it refuses to call a submitted Tender "coming up".
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-12",
    });
    const reference = await referenceOf(tender.id);

    await recordSubmission(
      { tenderId: tender.id, submittedAt: runInstant },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, reference)).toBe("");
  });
});

describe("rule 4: one message per Tender per run", () => {
  it("collapses a three-day backlog across both milestones into one message", async () => {
    // The figure that matters: ten Tenders after a three-day outage is ~10 messages
    // batched this way and up to ~60 if the send path loops the pending rows, against a
    // webhook capped at 20 a minute.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-13",
    });
    const reference = await referenceOf(tender.id);
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(
      mine(robot).filter((message) => message.payload.text.content.includes(reference)),
    ).toHaveLength(1);

    const content = contentFor(robot, reference);

    expect(content).toContain("内部报价截止");
    expect(content).toContain("客户投标截止");
  });

  it("turns ten Tenders with a backlog into ten messages, paced apart", async () => {
    // The measured case from ticket 14: ten open Tenders after a three-day outage. Four
    // rows are owed on each — two offsets on each milestone — so a run that looped the
    // pending rows would post forty against a webhook capped at twenty a minute.
    const tenders = [];

    for (let index = 0; index < 10; index += 1) {
      tenders.push(
        await aTender({
          internalQuoteDeadline: "2026-08-11",
          clientSubmissionDeadline: "2026-08-13",
        }),
      );
    }

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    for (const tender of tenders) {
      expect(contentFor(robot, await referenceOf(tender.id))).not.toBe("");
    }

    expect(mine(robot)).toHaveLength(10);
    // ~3s apart is ≈17/min, which keeps a catch-up burst inside the cap by construction.
    expect(robot.waited.every((ms) => ms === paceMs)).toBe(true);
    expect(robot.waited).toHaveLength(robot.sent.length - 1);
  });
});

describe("rule 5: a non-zero errcode is not a send", () => {
  it("leaves the row unsent so the next run retries it", async () => {
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-20",
    });
    const reference = await referenceOf(tender.id);

    // WeCom's throttle response is unmeasured, so every non-zero result is retryable.
    await sendDueReminders(runInstant, recordingRobot({ errcode: 45009, errmsg: "busy" }));

    expect((await remindersOn(tender.id)).every((row) => row.sent === false)).toBe(true);

    const retry = recordingRobot();

    await sendDueReminders(runInstant, retry);

    expect(contentFor(retry, reference)).toContain("2026-08-11");
    expect(
      (await remindersOn(tender.id)).filter((row) => row.due_date <= today).every(
        (row) => row.sent,
      ),
    ).toBe(true);
  });

  it("writes no in-app notification for a message that was refused", async () => {
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-20",
      assignees: [nok],
    });

    await sendDueReminders(runInstant, recordingRobot(500));

    expect(await notificationsOn(tender.id)).toEqual([]);
  });
});

describe("who a reminder @s", () => {
  it("mentions only Assignees who have entered no Quotes at all", async () => {
    // A reminder that pings the person who already rang round teaches the whole group to
    // mute the robot inside a month.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-09-01",
      items: ["Nitrile gloves", "Surgical masks"],
      assignees: [nok, anong],
    });
    const reference = await referenceOf(tender.id);

    await quoteOn(tender.itemIds[0], nok);

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const message = mine(robot).find((sent) =>
      sent.payload.text.content.includes(reference),
    );

    expect(message?.payload.text.mentioned_list).toEqual([anong.wecom]);
  });

  it("leaves an Assignee alone once they have quoted anything on the Tender", async () => {
    // The filter is "no Quotes at all", per Assignee and per Tender. It is deliberately
    // not the worklist's Item-level Sourcing Overdue rule — which would nag Nok here,
    // because the gloves are still unpriced. That one decides which block a Tender sits
    // in; this one decides who is @-ed. They answer different questions.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-13",
      items: ["Nitrile gloves", "Surgical masks"],
      assignees: [nok],
    });
    const reference = await referenceOf(tender.id);

    await quoteOn(tender.itemIds[1], nok);

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const message = mine(robot).find((sent) =>
      sent.payload.text.content.includes(reference),
    );

    expect(message?.payload.text.content).toContain("客户投标截止");
    expect(message?.payload.text.content).not.toContain("内部报价截止");
    expect(message?.payload.text.mentioned_list).toEqual([owner.wecom]);
  });

  it("leaves alone an Assignee who has recorded No Supplier Found on every Item", async () => {
    // Recording No Supplier Found silences the sourcing nag for the person who recorded
    // it (CONTEXT.md). Counting Quotes alone would ping the one person on the Tender who
    // answered every question they were asked — which is the surest way to teach a team
    // to ignore the robot.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-13",
      items: ["Nitrile gloves", "Surgical masks"],
      assignees: [nok],
    });
    const reference = await referenceOf(tender.id);

    for (const itemId of tender.itemIds) {
      await recordNoSupplierFound({ tenderItemId: itemId, note: null }, await signedInAs(nok));
    }

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const message = mine(robot).find((sent) =>
      sent.payload.text.content.includes(reference),
    );

    expect(message?.payload.text.content).not.toContain("内部报价截止");
    expect(message?.payload.text.mentioned_list).toEqual([owner.wecom]);
  });

  it("still nags an Assignee who has answered for only some of the Items", async () => {
    // Half an answer is not an answer. One Item reported on and one untouched is somebody
    // part-way through the job, not somebody finished with it.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-09-01",
      items: ["Nitrile gloves", "Surgical masks"],
      assignees: [nok],
    });
    const reference = await referenceOf(tender.id);

    await recordNoSupplierFound(
      { tenderItemId: tender.itemIds[0], note: null },
      await signedInAs(nok),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(
      mine(robot).find((sent) => sent.payload.text.content.includes(reference))?.payload
        .text.mentioned_list,
    ).toEqual([nok.wecom]);
  });

  it("says nothing about the internal deadline once every Assignee has answered", async () => {
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-09-01",
      assignees: [nok],
    });
    const reference = await referenceOf(tender.id);

    await quoteOn(tender.itemIds[0], nok);

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, reference)).toBe("");
  });

  it("mentions the Owner for the client submission deadline", async () => {
    // The Owner is accountable for the Bid going out on time, whoever sourced it.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-08-13",
      assignees: [nok],
    });
    const reference = await referenceOf(tender.id);
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const message = mine(robot).find((sent) =>
      sent.payload.text.content.includes(reference),
    );

    expect(message?.payload.text.content).toContain("客户投标截止");
    expect(message?.payload.text.mentioned_list).toEqual([owner.wecom]);
  });
});

describe("the in-app notifications the bell will read", () => {
  it("writes one per Item for the internal quote deadline", async () => {
    // The WeCom message collapses to one per Tender; the deep links must not collapse
    // with it, or the bell can only ever point at the Tender.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-09-01",
      items: ["Nitrile gloves", "Surgical masks"],
      assignees: [nok],
    });

    await sendDueReminders(runInstant, recordingRobot());

    const rows = (await notificationsOn(tender.id)).filter(
      (row) => row.type === "reminder:internal_quote",
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.user_id === nok.id)).toBe(true);
    expect(new Set(rows.map((row) => row.tender_item_id))).toEqual(
      new Set(tender.itemIds),
    );
    // The deadline, not a sentence. A notification has exactly one reader, so the wording
    // belongs in the message catalogue and is rendered from this when the bell is built.
    expect(rows.every((row) => row.body === "2026-08-11")).toBe(true);
  });

  it("skips an Item the Assignee has already recorded No Supplier Found on", async () => {
    // They are still @-ed about the Tender; they are not sent back to a job they finished.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-09-01",
      items: ["Nitrile gloves", "Surgical masks"],
      assignees: [nok],
    });

    await recordNoSupplierFound(
      { tenderItemId: tender.itemIds[0], note: null },
      await signedInAs(nok),
    );

    await sendDueReminders(runInstant, recordingRobot());

    const rows = (await notificationsOn(tender.id)).filter(
      (row) => row.type === "reminder:internal_quote",
    );

    expect(rows.map((row) => row.tender_item_id)).toEqual([tender.itemIds[1]]);
  });

  it("writes one Tender-level row for the client submission deadline", async () => {
    // There is no Item a submission deadline could point at, and a row per Item would be
    // the same sentence five times over.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-08-13",
      items: ["Nitrile gloves", "Surgical masks"],
    });

    await sendDueReminders(runInstant, recordingRobot());

    expect(
      (await notificationsOn(tender.id)).filter(
        (row) => row.type === "reminder:client_submission",
      ),
    ).toEqual([
      {
        user_id: owner.id,
        type: "reminder:client_submission",
        tender_item_id: null,
        body: "2026-08-13",
      },
    ]);
  });
});

describe("the missed submission", () => {
  // The failure this whole product exists to prevent. Everything here is about it being
  // said once, loudly, on the morning it happens — and not on any other morning.
  const missed = { internalQuoteDeadline: "2026-08-09", clientSubmissionDeadline: "2026-08-09" };

  it("posts when the client deadline goes by with nothing submitted", async () => {
    const tender = await aTender(missed);
    const reference = await referenceOf(tender.id);
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const message = mine(robot).find((sent) =>
      sent.payload.text.content.includes(reference),
    );

    expect(message?.payload.text.content).toContain("错过");
    expect(message?.payload.text.content).toContain("2026-08-09");
    // The Owner is accountable for the Bid going out, whoever sourced it.
    expect(message?.payload.text.mentioned_list).toEqual([owner.wecom]);
  });

  it("says it once rather than every morning afterwards", async () => {
    // `sent` is the dedupe, which is the whole reason this is a reminder row and not a
    // sweep over Tenders. A group told daily that it missed something last Tuesday
    // learns to scroll past the one message that mattered.
    const tender = await aTender(missed);
    const reference = await referenceOf(tender.id);

    await sendDueReminders(runInstant, recordingRobot());

    const again = recordingRobot();

    await sendDueReminders(new Date("2026-08-10T18:00:00Z"), again);

    expect(contentFor(again, reference)).toBe("");
  });

  it("is the only thing said about a Tender whose deadlines have all gone", async () => {
    // Rule 2 is inverted for this one milestone and unchanged for the others: a
    // countdown to a date that went by is noise, and the miss is the news.
    const tender = await aTender(missed);
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const content = contentFor(robot, await referenceOf(tender.id));

    expect(content).toContain("错过");
    expect(content).not.toContain("客户投标截止:");
    expect(content).not.toContain("内部报价截止");
  });

  it("says nothing about a Tender whose Bid went out in time", async () => {
    const tender = await aTender(missed);

    await recordSubmission(
      { tenderId: tender.id, submittedAt: new Date("2026-08-08T04:00:00Z") },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, await referenceOf(tender.id))).toBe("");
  });

  it("says nothing once somebody has recorded an Outcome", async () => {
    // A Tender written off is off the worklist entirely, and shouting about a deadline
    // on it is shouting about finished work.
    const tender = await aTender(missed);

    await setItemOutcome(
      { itemId: tender.itemIds[0], outcome: "cancelled", decidedAt: runInstant },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, await referenceOf(tender.id))).toBe("");
  });

  it("posts again when the client extends and the new deadline is missed too", async () => {
    // Rule 3 applied to the loudest message there is. A client who grants an extension
    // resets the whole schedule, and a Tender missed twice was missed twice.
    const tender = await aTender(missed);
    const reference = await referenceOf(tender.id);

    await sendDueReminders(runInstant, recordingRobot());
    await reschedule(
      tender.id,
      { internalQuoteDeadline: "2026-08-14", clientSubmissionDeadline: "2026-08-16" },
      runInstant,
    );

    // 2026-08-17 in Bangkok: the day after the extension, missed again.
    const after = recordingRobot();

    await sendDueReminders(new Date("2026-08-16T18:00:00Z"), after);

    expect(contentFor(after, reference)).toContain("错过");
    expect(contentFor(after, reference)).toContain("2026-08-16");
  });
});

describe("the decision chase", () => {
  it("is off entirely until the Owner names a date", async () => {
    // Not a row that never fires — no row at all. Clients rarely state a decision date,
    // so there is nothing honest to default it to.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-08",
    });

    await recordSubmission(
      { tenderId: tender.id, submittedAt: new Date("2026-08-07T04:00:00Z") },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(await remindersOn(tender.id)).not.toContainEqual(
      expect.objectContaining({ milestone: "decision_chase" }),
    );
    expect(contentFor(robot, await referenceOf(tender.id))).toBe("");
  });

  it("reminds the Owner to chase on the day they set", async () => {
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-08",
      expectedDecisionDate: today,
    });
    const reference = await referenceOf(tender.id);

    await recordSubmission(
      { tenderId: tender.id, submittedAt: new Date("2026-08-07T04:00:00Z") },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const message = mine(robot).find((sent) =>
      sent.payload.text.content.includes(reference),
    );

    expect(message?.payload.text.content).toContain("决标");
    expect(message?.payload.text.content).toContain(today);
    expect(message?.payload.text.mentioned_list).toEqual([owner.wecom]);
  });

  it("chases nothing on a Tender whose Bid never went out", async () => {
    // There is no decision coming on something nobody submitted, and the group has
    // already been told the louder thing about it.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-08-09",
      expectedDecisionDate: today,
    });
    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    const content = contentFor(robot, await referenceOf(tender.id));

    expect(content).toContain("错过");
    expect(content).not.toContain("决标");
  });

  it("waits rather than giving up when the submission was never recorded", async () => {
    // The hole this closes: "nobody recorded the submission" is a commoner reason for a
    // null `submitted_at` than "the Bid never went out", and settling the row would mean
    // the chase never fired again once somebody fixed the record. It holds instead.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-08",
      expectedDecisionDate: today,
    });
    const reference = await referenceOf(tender.id);

    await sendDueReminders(runInstant, recordingRobot());

    // Neither posted nor closed — it is owed again tomorrow, unchanged.
    expect(
      (await remindersOn(tender.id)).filter(
        (row) => row.milestone === "decision_chase",
      ),
    ).toEqual([
      expect.objectContaining({ milestone: "decision_chase", sent: false }),
    ]);

    await recordSubmission(
      { tenderId: tender.id, submittedAt: new Date("2026-08-07T04:00:00Z") },
      await signedInAs(owner),
    );

    const after = recordingRobot();

    await sendDueReminders(new Date("2026-08-10T18:00:00Z"), after);

    expect(contentFor(after, reference)).toContain("决标");
  });

  it("stops chasing once the Outcome is in", async () => {
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-08",
      expectedDecisionDate: today,
    });

    await recordSubmission(
      { tenderId: tender.id, submittedAt: new Date("2026-08-07T04:00:00Z") },
      await signedInAs(owner),
    );
    await setItemOutcome(
      { itemId: tender.itemIds[0], outcome: "lost", decidedAt: runInstant },
      await signedInAs(owner),
      recordingRobot(),
    );

    const robot = recordingRobot();

    await sendDueReminders(runInstant, robot);

    expect(contentFor(robot, await referenceOf(tender.id))).toBe("");
  });
});

describe("the daily run as a whole", () => {
  it("fetches rates before it posts anything", async () => {
    // A Quote entered during the day falls back on `fx_rates` when Frankfurter cannot be
    // reached, so the fetch has to have happened before the day starts — not after the
    // reminders, which are the half that wakes people up.
    await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-20",
    });

    const order: string[] = [];
    const rates = respondingLatestRates(perEur, ratesAsOf);
    const robot = recordingRobot();
    const recordOrder =
      (name: string, inner: typeof globalThis.fetch) =>
      ((...args: Parameters<typeof globalThis.fetch>) => {
        order.push(name);

        return inner(...args);
      }) as typeof globalThis.fetch;

    const report = await runDailyCron(runInstant, {
      rates: { fetch: recordOrder("rates", rates.fetch!) },
      robot: { ...robot, fetch: recordOrder("robot", robot.fetch!) },
    });

    expect(order[0]).toBe("rates");
    expect(order).toContain("robot");
    expect(report.rates).toMatchObject({ asOf: ratesAsOf });
    expect(report.ranAt).toBe(runInstant.toISOString());
  });

  it("still sends the reminders when Frankfurter cannot be reached", async () => {
    // Stale rates cost a fallback that is a day older. Reminders that did not go out cost
    // the thing this product exists to prevent, and a run that aborted on the rate fetch
    // would trade the cheap failure for the expensive one.
    const tender = await aTender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-20",
    });
    const robot = recordingRobot();

    const report = await runDailyCron(runInstant, {
      rates: unreachableRates(),
      robot,
    });

    expect(report.rates).toBeNull();
    expect(contentFor(robot, await referenceOf(tender.id))).not.toBe("");
  });
});
