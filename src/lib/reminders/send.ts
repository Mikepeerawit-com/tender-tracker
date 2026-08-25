import "server-only";

import { daysBetween, todayIn } from "@/lib/calendar-date";
import { digestFor } from "@/lib/digest/digest";
import { tenderOutcome, type ItemOutcome } from "@/lib/tenders/outcome";
import { createServiceClient } from "@/lib/supabase/service-client";
import { webhookFor } from "@/lib/wecom/group-robot";
import { reminderMessage, type DueMilestone } from "@/lib/wecom/messages";
import { sendGroupMessages, type GroupMessage, type RobotBoundary } from "@/lib/wecom/robot";

import {
  dateFor,
  reminderMilestones,
  type Deadlines,
  type ReminderMilestone,
} from "./schedule";

/**
 * The send half of the daily cron: everything owed, collapsed into as few messages as it
 * can honestly be, posted, and only then marked done.
 *
 * **The Digest rides in the same batch**, last, and it is why this file is named for the
 * run rather than for the reminders it is mostly about. It lives under `reminders/`
 * because the reminder engine below is the bulk of it and the Digest is one appended
 * message — but the batch is the org's whole morning, because pacing is per batch and a
 * second call would post outside the budget the reminders were just paced to respect
 * (ADR-0012). What the Digest *says* is `@/lib/digest/digest.ts`; what it costs the cap
 * is here.
 *
 * Everything reads through the **service** client. The cron has no session and runs for
 * every org unattended, so RLS is not the boundary here — the `org_id` filter on every
 * query is, and the run is scoped to one org at a time so that a Tender's message can
 * never be posted into another org's group.
 *
 * ## The five rules, and where each one lives
 *
 * 1. **Catch up, never skip** — {@link dueReminders} asks `due_date <= today`. A run
 *    missed for two days sends on the third rather than losing those days for good.
 * 2. **Suppress a nudge that has stopped being worth posting** — {@link suppressed}, which
 *    asks the Milestone rather than applying one rule to all four (ADR-0015). "7 days to
 *    go" about a deadline that went by yesterday is noise; the missed submission, which
 *    comes due *because* that deadline went by, is the opposite.
 * 3. **Recompute on a moved deadline** — not here. It belongs to the write that moves the
 *    deadline (`./reminders.ts`), because a schedule repaired only once a day is a
 *    schedule that is wrong for up to a day.
 * 4. **One message per Tender per run** — {@link tenderMessage} takes every surviving row
 *    for a Tender, across missed days *and* across every milestone. Ten Tenders after a
 *    three-day outage is ~10 messages; a run that looped the rows instead would post ~60
 *    against a cap of 20 a minute.
 * 5. **Never mark `sent` on a non-zero errcode** — {@link settle}. Every failure from
 *    the robot is retryable by construction, so the row is left alone and rule 1 recovers
 *    it on the next run for free.
 *
 * The run instant is a parameter (ADR-0010). Which day it is, is then a question only the
 * org's timezone can answer: Vercel runs UTC, and a server-local boundary would fire the
 * whole night's reminders seven hours early for everybody in Bangkok.
 */

/** What one run did, in the terms the rules are stated in. */
export type DailyPostReport = {
  /** Orgs with something to post — a reminder owed, a Digest, or both. */
  orgs: number;
  /**
   * Messages handed to the robot, Digests included.
   *
   * Everything in one org's run is one paced batch, so this is the figure the
   * 20-per-minute cap is about as well as the one rule 4 is about.
   */
  messages: number;
  /** Digests the robot accepted — at most one per org, and none for an org with nothing open. */
  digests: number;
  /** Rows this run finished with: posted, or suppressed as no longer worth posting. */
  closed: number;
  /** Rows deliberately left for the next run because the send did not succeed. */
  retrying: number;
  /** Orgs passed over because nobody has set up a Group Robot yet. */
  unconfigured: number;
};

type OrgRow = { id: string; timezone: string };

type ReminderRow = {
  id: string;
  tender_id: string;
  milestone: ReminderMilestone;
};

type TenderRow = {
  id: string;
  reference: string;
  client_name: string;
  title: string;
  internal_quote_deadline: string;
  client_submission_deadline: string;
  expected_decision_date: string | null;
  submitted_at: string | null;
  owner_user_id: string;
  items: { id: string; outcome: ItemOutcome | null }[];
};

/** One Tender's whole share of this run: what to post, and which rows it settles. */
type TenderBatch = {
  message: GroupMessage;
  /** Rows that are only finished once the message is accepted (rule 5). */
  liveIds: string[];
  notifications: NotificationRow[];
};

type NotificationRow = {
  org_id: string;
  user_id: string;
  type: string;
  tender_id: string;
  tender_item_id: string | null;
  body: string;
};

/**
 * Post everything every org owes this morning, as at `at`.
 *
 * Orgs are handled one at a time rather than in one flat batch, because pacing is per
 * batch (ADR-0012) and a batch that mixed two orgs' messages would be posting to two
 * different webhooks from one paced loop.
 */
export async function sendDailyPosts(
  at: Date,
  boundary: RobotBoundary = {},
): Promise<DailyPostReport> {
  const service = createServiceClient();
  const { data: orgs } = await service
    .from("orgs")
    .select("id, timezone")
    .overrideTypes<OrgRow[], { merge: false }>();

  const report: DailyPostReport = {
    orgs: 0,
    messages: 0,
    digests: 0,
    closed: 0,
    retrying: 0,
    unconfigured: 0,
  };

  for (const org of orgs ?? []) {
    const orgReport = await sendOrgPosts(org, todayIn(org.timezone, at), at, boundary);

    if (orgReport === null) continue;

    report.orgs += 1;
    report.messages += orgReport.messages;
    report.digests += orgReport.digests;
    report.closed += orgReport.closed;
    report.retrying += orgReport.retrying;
    report.unconfigured += orgReport.unconfigured;
  }

  return report;
}

type OrgReport = Omit<DailyPostReport, "orgs">;

/** One org's run, or null when it had nothing to say at all. */
async function sendOrgPosts(
  org: OrgRow,
  today: string,
  at: Date,
  boundary: RobotBoundary,
): Promise<OrgReport | null> {
  const due = await dueReminders(org.id, today);
  // Owed whether or not a reminder is. "What is going on right now" is asked every
  // morning, including — especially — the quiet ones no threshold happens to fall on.
  const digest = await digestFor(org.id, today);

  if (due.length === 0 && digest === null) return null;

  // Every row this run has finished with, reported the same way whether the run finished
  // with it because the message went out or because there was no longer one to send.
  // Anything `closeOut` could not write is counted as retrying rather than as closed —
  // it really will come back tomorrow, and a report that said otherwise would be the one
  // place in this file that lies about what happened.
  const report: OrgReport = {
    messages: 0,
    digests: 0,
    closed: 0,
    retrying: 0,
    unconfigured: 0,
  };
  const { batches, settled } = await reminderBatches(org.id, due, today);

  await settle(settled, at, report);

  // **One paced batch per org, the Digest last.** Not a second call, and this is the
  // acceptance criterion rather than tidiness: pacing keeps no state across calls
  // (ADR-0012), so a Digest posted separately would arrive with none of the ~3s
  // separation the reminders were just paced to respect — on precisely the morning a
  // catch-up run has spent the whole minute's budget on them.
  //
  // Last, because the reminders are the messages somebody has to act on and the Digest
  // is the context around them.
  const messages = [
    ...batches.map((batch) => batch.message),
    ...(digest === null ? [] : [digest]),
  ];

  if (messages.length === 0) return report;

  // Resolved after the work above, so an org with a full queue and no robot is reported
  // as unconfigured rather than as a failed send — only one of those is worth retrying,
  // and the fix for the other is one screen away.
  const webhook = await webhookFor(org.id);
  const owedRows = (owed: TenderBatch[]) =>
    owed.reduce((total, batch) => total + batch.liveIds.length, 0);

  if (webhook === null) {
    report.retrying += owedRows(batches);
    report.unconfigured = 1;

    return report;
  }

  const outcomes = await sendGroupMessages(webhook, messages, boundary);

  // Rule 5: only what WeCom accepted is finished. Everything else is left exactly as it
  // was, and rule 1's `<=` query picks it up again tomorrow. The reminders come first in
  // the batch, so an outcome and a batch share an index.
  const accepted = batches.filter((_batch, index) => outcomes[index]?.ok);

  await writeNotifications(accepted.flatMap((batch) => batch.notifications));
  await settle(accepted.flatMap((batch) => batch.liveIds), at, report);

  report.messages = messages.length;
  // The Digest is the one message with no row to leave unsent. There is nothing to
  // catch up: it is about today, and tomorrow's is the whole of what it had to say, one
  // day fresher — so a refusal is counted and nothing is retried.
  report.digests = digest !== null && outcomes[batches.length]?.ok === true ? 1 : 0;
  report.retrying += owedRows(batches.filter((batch) => !accepted.includes(batch)));

  return report;
}

/**
 * Every owed row for this org, collapsed into one message per Tender — and the rows this
 * run has finished with without posting anything.
 *
 * Separated from the send so that the Digest can share the batch: an org can owe no
 * reminders at all and still have a Digest to post, and the reads below (`.in()` over an
 * empty list is rejected outright by PostgREST) have nothing to ask on that morning.
 */
async function reminderBatches(
  orgId: string,
  due: ReminderRow[],
  today: string,
): Promise<{ batches: TenderBatch[]; settled: string[] }> {
  if (due.length === 0) return { batches: [], settled: [] };

  const tenderIds = [...new Set(due.map((row) => row.tender_id))];
  const tenders = await tendersById(tenderIds);
  const sourcing = await loadSourcing(tenders);
  const userids = await wecomUserids(tenders, sourcing);

  const settled: string[] = [];
  const batches: TenderBatch[] = [];

  for (const tenderId of tenderIds) {
    const tender = tenders.get(tenderId);
    const rows = due.filter((row) => row.tender_id === tenderId);

    // A Tender that vanished between the two queries settles its rows rather than
    // keeping them: there is nothing left to remind anybody about.
    if (!tender) {
      settled.push(...rows.map((row) => row.id));
      continue;
    }

    const verdicts = rows.map((row) => ({ row, verdict: verdictOn(row, tender, today) }));
    const live = verdicts.filter(({ verdict }) => verdict === "post").map(({ row }) => row);

    // Only the finished ones. A row held back is deliberately neither posted nor closed:
    // it comes back tomorrow, unchanged, and rule 1's `<=` query is what makes that free.
    settled.push(
      ...verdicts
        .filter(({ verdict }) => verdict === "settle")
        .map(({ row }) => row.id),
    );

    if (live.length === 0) continue;

    const batch = tenderMessage(orgId, tender, live, today, sourcing, userids);

    // Every milestone the rows were owed for turned out to have nothing to say — the
    // only case being an internal deadline whose Assignees have all answered. There is
    // no message, so the rows settle here rather than being reconsidered every night.
    if (batch === null) {
      settled.push(...live.map((row) => row.id));
      continue;
    }

    batches.push(batch);
  }

  return { batches, settled };
}

/**
 * Everything still owed, however far back. (Rule 1.)
 *
 * `<=`, never `=`. Exact date equality is the whole of `buildspec_1`'s silent-failure
 * design: one missed run and that day's reminders are gone for good, with nothing
 * anywhere recording that they were ever due. Late beats never.
 */
async function dueReminders(orgId: string, today: string): Promise<ReminderRow[]> {
  const { data } = await createServiceClient()
    .from("reminders")
    .select("id, tender_id, milestone")
    .eq("org_id", orgId)
    .eq("sent", false)
    .lte("due_date", today)
    .in("milestone", [...reminderMilestones])
    // Oldest first, so a backlog reads in the order it accumulated.
    .order("due_date")
    .overrideTypes<ReminderRow[], { merge: false }>();

  return data ?? [];
}

/**
 * What this run should do with one owed row. (Rule 2, and its neighbours.)
 *
 * Three answers, not two, and the third is the one worth explaining:
 *
 * - **`post`** — say it.
 * - **`settle`** — there is nothing left to say and there never will be, so mark the row
 *   done rather than reconsidering it every night for ever.
 * - **`hold`** — there is nothing to say *today*, and there might be tomorrow. Neither
 *   posted nor closed; rule 1's `<=` query brings it straight back.
 *
 * **`hold` exists for exactly one case, and it closes a silent-failure hole.** A decision
 * chase on a Tender with no `submitted_at` has nothing to chase — but "nobody recorded the
 * submission" is a far commoner reason for that than "the Bid never went out", and
 * settling the row would mean the chase never fires again even once somebody fixes the
 * record. So it waits. What ends the wait either way is an Outcome, which is also what
 * takes a Submission Missed Tender off the worklist — the same rule, read the same way.
 *
 * **One condition is shared and the rest are the milestone's own.** Every milestone stops
 * mattering once somebody has decided every Item; that one settles. What silences a
 * milestone otherwise depends on which is asking, and two of the four invert each other:
 *
 * - The two countdowns are dead once their date has gone by (rule 2 proper) or once the
 *   Bid has gone out.
 * - **`submission_missed` exists because the date went by**, so the rule 2 test is exactly
 *   backwards for it. It is silenced by the Bid going out and by nothing else.
 * - **`decision_chase` is silenced by the Bid *not* having gone out** — and that is the
 *   silence that is held rather than settled.
 */
type Verdict = "post" | "settle" | "hold";

function verdictOn(row: ReminderRow, tender: TenderRow, today: string): Verdict {
  // Read once here rather than inside four rules, so "decided" cannot come to mean
  // slightly different things in different branches. A decided Tender is finished work,
  // and finished work is the one silence nothing can reopen.
  if (tenderOutcome(tender.items) !== null) return "settle";

  return milestoneRules[row.milestone].verdict(tender, today);
}

/**
 * One Tender's whole share of this run, as one message. (Rule 4.)
 *
 * The rows collapse twice over: several offsets for the same milestone become one line —
 * a three-day backlog owes the 3-day, 1-day and morning-of nudges at once and they all
 * mean "the 25th" — and both milestones share the one message and the one @-list.
 *
 * Who each milestone is addressed to lives in {@link milestoneRules}, and the sharp case
 * is the internal quote deadline: **only Assignees who have not answered at all**, because
 * a reminder that pings the person who already rang round teaches the whole group to mute
 * the robot inside a month.
 */
function tenderMessage(
  orgId: string,
  tender: TenderRow,
  live: ReminderRow[],
  today: string,
  sourcing: Sourcing,
  userids: Map<string, string>,
): TenderBatch | null {
  const owed = reminderMilestones.filter((milestone) =>
    live.some((row) => row.milestone === milestone),
  );

  const milestones: DueMilestone[] = [];
  const mentions: string[] = [];
  const notifications: NotificationRow[] = [];

  for (const milestone of owed) {
    const date = dateFor(milestone, deadlines(tender));

    // Only reachable for a decision chase whose date was cleared between the reschedule
    // that should have deleted the row and this run. There is nothing to say about a day
    // nobody is claiming any more, so the row settles rather than posting a blank date.
    if (date === null) continue;

    const { addressable, owing } = milestoneRules[milestone].audience(tender, sourcing);
    const recipients = owing;

    // Everybody this line could have been addressed to has answered, so it would tell
    // the group nothing. A Tender with nobody to address at all is the opposite case and
    // still posts, unmentioned: nobody working it is the news.
    if (recipients.length === 0 && addressable.length > 0) continue;

    milestones.push({
      milestone,
      date,
      // Negative on `submission_missed`, whose whole point is a date already behind us —
      // and which is the one milestone whose line does not read this.
      daysLeft: daysBetween(today, date),
    });

    mentions.push(
      ...recipients
        .map((userId) => userids.get(userId) ?? "")
        .filter((userid) => userid !== ""),
    );

    notifications.push(
      ...notificationsFor(orgId, tender, milestone, date, recipients, sourcing),
    );
  }

  // A message that names a Tender and then says nothing about it is worse than silence:
  // it is the group's attention spent on a line with no fact in it.
  if (milestones.length === 0) return null;

  return {
    message: reminderMessage({
      reference: tender.reference,
      client: tender.client_name,
      title: tender.title,
      milestones,
      // Deduped: an Owner who is also the only Assignee owing a Quote would otherwise be
      // @-ed twice in one message for two different reasons.
      mentions: [...new Set(mentions)],
    }),
    liveIds: live.map((row) => row.id),
    notifications,
  };
}

/**
 * The in-app rows the bell will one day be a read model over. (Rule 4's other half.)
 *
 * **Per Item where the milestone is per Item** ({@link milestoneRules}'s `deepLink`), which
 * is what stops the collapse to one WeCom message from collapsing the deep links with it:
 * the internal quote deadline is about Items somebody still has to price, so there is a
 * row per Item they have not answered for. The client submission deadline is about the
 * Tender — there is no Item it could point at, and a row per Item would be the same
 * sentence repeated five times.
 *
 * Recipients here are **not** filtered by `wecom_userid`. The bell is inside the app and
 * reaches a colleague whose WeCom identifier nobody has copied across yet; conflating the
 * two would quietly make the in-app half depend on the outbound one.
 *
 * `body` holds the milestone's date and nothing else, on purpose. Unlike a group message — which
 * has no reader whose locale could pick between two versions (ADR-0012) — a notification
 * has exactly one reader, so the sentence belongs in `src/messages/` and is rendered from
 * `type` and this date when the bell is built.
 */
function notificationsFor(
  orgId: string,
  tender: TenderRow,
  milestone: ReminderMilestone,
  date: string,
  recipients: string[],
  sourcing: Sourcing,
): NotificationRow[] {
  const row = (userId: string, itemId: string | null): NotificationRow => ({
    org_id: orgId,
    user_id: userId,
    type: `reminder:${milestone}`,
    tender_id: tender.id,
    tender_item_id: itemId,
    body: date,
  });

  if (milestoneRules[milestone].deepLink === "tender") {
    return recipients.map((userId) => row(userId, null));
  }

  return recipients.flatMap((userId) =>
    tender.items
      // An Item this Assignee has already said they could not source is answered. They
      // are still @-ed about the Tender; they are not sent back to a job they finished.
      .filter((item) => !sourcing.noSupplierFound.get(item.id)?.has(userId))
      .map((item) => row(userId, item.id)),
  );
}

/**
 * Everything that differs between one milestone and the next, in one place.
 *
 * One entry per milestone rather than a `milestone === "internal_quote"` test at each of
 * the places that ask. CONTEXT.md states the audience as a property of the Milestone —
 * "which Milestone a Reminder is for decides who it @s" — and the same turns out to be
 * true of when it goes quiet, so both live here and a fifth milestone is a fifth entry
 * rather than three more branches spread across the file.
 */
const milestoneRules: Record<
  ReminderMilestone,
  {
    audience: (tender: TenderRow, sourcing: Sourcing) => Audience;
    /** What an in-app notification for this milestone deep-links to. */
    deepLink: "tender" | "item";
    /** What to do with an owed row for this milestone. See {@link verdictOn}. */
    verdict: (tender: TenderRow, today: string) => Verdict;
  }
> = {
  internal_quote: {
    audience: (tender, sourcing) => {
      const assignees = sourcing.assignees.get(tender.id) ?? [];

      return {
        addressable: assignees,
        owing: assignees.filter((userId) => stillOwes(userId, tender, sourcing)),
      };
    },
    deepLink: "item",
    verdict: (tender, today) =>
      tender.internal_quote_deadline < today || tender.submitted_at !== null
        ? "settle"
        : "post",
  },
  client_submission: {
    // The Owner is accountable for the Bid going out on time, whoever sourced it, and
    // there is no state in which that stops being true while the deadline is ahead.
    audience: ownerOnly,
    deepLink: "tender",
    verdict: (tender, today) =>
      tender.client_submission_deadline < today || tender.submitted_at !== null
        ? "settle"
        : "post",
  },
  submission_missed: {
    // The Owner, and only the Owner. The Assignees' work is done or moot by now, and the
    // one thing this post needs is the person accountable for the client relationship
    // reading it the morning it happened rather than the week after.
    audience: ownerOnly,
    deepLink: "tender",
    // No date test at all: this row's `due_date` is already the day after the deadline,
    // so it comes due precisely when the deadline has passed. Adding rule 2's test here
    // would silence the message on the only day it could ever be sent.
    verdict: (tender) => (tender.submitted_at === null ? "post" : "settle"),
  },
  decision_chase: {
    // The Owner's own reminder, set by the Owner, about the client relationship the Owner
    // holds. Nobody else asked for it.
    audience: ownerOnly,
    deepLink: "tender",
    // Held, never settled — the whole reason {@link Verdict} has three values.
    verdict: (tender) => (tender.submitted_at === null ? "hold" : "post"),
  },
};

function ownerOnly(tender: TenderRow): Audience {
  return { addressable: [tender.owner_user_id], owing: [tender.owner_user_id] };
}

/**
 * Who a milestone *could* address, and who still owes it something.
 *
 * The two are separate because an empty `owing` means opposite things depending on the
 * other: everybody having answered is a reason to say nothing, and there being nobody to
 * answer is the news itself.
 */
type Audience = { addressable: string[]; owing: string[] };

/**
 * Has this Assignee still not answered for this Tender?
 *
 * Two conditions, and the second is not optional. **No Supplier Found silences the
 * sourcing nag for the person who recorded it** (CONTEXT.md): an Assignee who rang round
 * every Item and reported back that none could be sourced has done the work, and pinging
 * them is exactly what the "no Quotes at all" filter exists to avoid. Counting Quotes
 * alone would nag the one person on the Tender who answered every question they were
 * asked.
 *
 * This is still not the worklist's Sourcing Overdue rule. That one asks whether *anybody*
 * has answered for an Item and decides which block the Tender sits in; this one asks
 * whether *this person* has answered for any of them and decides who is @-ed.
 */
function stillOwes(userId: string, tender: TenderRow, sourcing: Sourcing): boolean {
  if (sourcing.quotedBy.get(tender.id)?.has(userId)) return false;

  return tender.items.some((item) => !sourcing.noSupplierFound.get(item.id)?.has(userId));
}

function deadlines(tender: TenderRow): Deadlines {
  return {
    internalQuoteDeadline: tender.internal_quote_deadline,
    clientSubmissionDeadline: tender.client_submission_deadline,
    expectedDecisionDate: tender.expected_decision_date,
  };
}

/**
 * Mark rows finished, and account for them either way.
 *
 * Both endings come through here: a message WeCom accepted, and a milestone that stopped
 * being worth posting. Both are settled rather than pending, and a moved deadline re-arms
 * either of them through `rescheduleReminders` if it turns out there is more to say.
 *
 * **A write that fails here is the one place a message can be posted twice.** There is no
 * transaction spanning the webhook and Postgres, so a row that was posted and then could
 * not be marked comes back tomorrow and is posted again. That is the safe direction to
 * fail in — this whole file exists because a reminder that silently does *not* fire is
 * the worst defect available, and a duplicate nudge is a nuisance rather than a missed
 * deadline — but it is a real outcome, so it is counted as `retrying` rather than
 * quietly dropped from both totals.
 */
async function settle(ids: string[], at: Date, report: OrgReport): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await createServiceClient()
    .from("reminders")
    .update({ sent: true, sent_at: at.toISOString() })
    .in("id", ids);

  if (error === null) {
    report.closed += ids.length;
  } else {
    report.retrying += ids.length;
  }
}

async function writeNotifications(rows: NotificationRow[]): Promise<void> {
  if (rows.length === 0) return;

  // Best effort, and deliberately not fatal: the bell is not built, and losing a row
  // here must not cost the group the message that was already posted.
  await createServiceClient().from("notifications").insert(rows);
}

async function tendersById(ids: string[]): Promise<Map<string, TenderRow>> {
  const { data } = await createServiceClient()
    .from("tenders")
    .select(
      "id, reference, client_name, title, internal_quote_deadline, " +
        "client_submission_deadline, expected_decision_date, submitted_at, " +
        "owner_user_id, items:tender_items(id, outcome)",
    )
    .in("id", ids)
    .overrideTypes<TenderRow[], { merge: false }>();

  return new Map((data ?? []).map((tender) => [tender.id, tender]));
}

/** Who is on each Tender, who has already quoted on it, and who has answered each Item. */
type Sourcing = {
  assignees: Map<string, string[]>;
  quotedBy: Map<string, Set<string>>;
  noSupplierFound: Map<string, Set<string>>;
};

/**
 * The whole run's sourcing picture in three queries, not three per Tender.
 *
 * `quotes` carries no `tender_id` — a Quote is a price for one *Item* — so the Tender-level
 * question "has this Assignee quoted here at all" is answered by reading the Quotes on
 * every Item of every Tender in the run and folding them back up.
 */
async function loadSourcing(tenders: Map<string, TenderRow>): Promise<Sourcing> {
  const service = createServiceClient();
  const tenderOf = new Map<string, string>();

  for (const tender of tenders.values()) {
    for (const item of tender.items) tenderOf.set(item.id, tender.id);
  }

  const itemIds = [...tenderOf.keys()];
  const tenderIds = [...tenders.keys()];

  // `.in()` on an empty list is a query with no answer worth asking for, and PostgREST
  // rejects it outright rather than returning nothing.
  const overItems = <T>(query: () => PromiseLike<{ data: T[] | null }>) =>
    itemIds.length === 0 ? Promise.resolve({ data: [] as T[] }) : query();

  const [assigneeRows, quoteRows, refusalRows] = await Promise.all([
    service
      .from("tender_assignees")
      .select("tender_id, user_id")
      .in("tender_id", tenderIds),
    overItems<{ tender_item_id: string; created_by_user_id: string }>(() =>
      service
        .from("quotes")
        .select("tender_item_id, created_by_user_id")
        .in("tender_item_id", itemIds),
    ),
    overItems<{ tender_item_id: string; user_id: string }>(() =>
      service
        .from("no_supplier_found")
        .select("tender_item_id, user_id")
        .in("tender_item_id", itemIds),
    ),
  ]);

  const assignees = new Map<string, string[]>();
  const quotedBy = new Map<string, Set<string>>();
  const noSupplierFound = new Map<string, Set<string>>();

  for (const row of assigneeRows.data ?? []) {
    assignees.set(row.tender_id, [
      ...(assignees.get(row.tender_id) ?? []),
      row.user_id,
    ]);
  }

  for (const row of quoteRows.data ?? []) {
    const tenderId = tenderOf.get(row.tender_item_id);

    if (tenderId === undefined) continue;

    quotedBy.set(
      tenderId,
      (quotedBy.get(tenderId) ?? new Set()).add(row.created_by_user_id),
    );
  }

  for (const row of refusalRows.data ?? []) {
    noSupplierFound.set(
      row.tender_item_id,
      (noSupplierFound.get(row.tender_item_id) ?? new Set()).add(row.user_id),
    );
  }

  return { assignees, quotedBy, noSupplierFound };
}

/**
 * Everybody this run might @, by their WeCom userid.
 *
 * Blanks are dropped rather than sent. `mentioned_list: [""]` is accepted with
 * `errcode 0` and notifies nobody, so an unfilled identifier would be indistinguishable
 * from a working one from this side of the webhook (ADR-0005).
 */
async function wecomUserids(
  tenders: Map<string, TenderRow>,
  sourcing: Sourcing,
): Promise<Map<string, string>> {
  const ids = new Set<string>();

  for (const tender of tenders.values()) ids.add(tender.owner_user_id);
  for (const assignees of sourcing.assignees.values()) {
    for (const userId of assignees) ids.add(userId);
  }

  if (ids.size === 0) return new Map();

  const { data } = await createServiceClient()
    .from("users")
    // A Disabled colleague reads nothing and can act on none of it, so @-ing them puts a
    // name in the group chat that answers to nobody.
    .select("id, wecom_userid")
    .in("id", [...ids])
    .is("disabled_at", null);

  return new Map(
    (data ?? [])
      .filter((user) => (user.wecom_userid ?? "").trim() !== "")
      .map((user) => [user.id, user.wecom_userid!.trim()]),
  );
}
