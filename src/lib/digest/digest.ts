import "server-only";

import { appLinks } from "@/lib/app-links";
import { daysBetween } from "@/lib/calendar-date";
import type { ReminderMilestone } from "@/lib/reminders/schedule";
import { createServiceClient } from "@/lib/supabase/service-client";
import { tenderOutcome, type DecidedItem, type ItemOutcome } from "@/lib/tenders/outcome";
import { digestMessage, type DigestLine } from "@/lib/wecom/messages";
import type { GroupMessage } from "@/lib/wecom/robot";

/**
 * The daily Digest: every open Tender and its next Milestone, in one message.
 *
 * ## Why it exists at all, given the reminders
 *
 * **Reminders fire at thresholds, so they say nothing about a Tender that is merely
 * ongoing.** The problem this product was built for is losing track of what is in
 * flight — and a Tender three weeks from its deadline, with nobody having touched it,
 * is invisible to a threshold engine by construction. The Digest answers "what is going
 * on right now" directly, for one message a day, on the cron that is already running.
 *
 * It is the opposite kind of post from a reminder in two respects, and both are
 * deliberate: it **@s nobody** — a daily ping is how a group learns to mute the robot —
 * and it is **stateless**, with no row anywhere recording that it went out. There is
 * nothing to catch up: a Digest missed on Tuesday is answered by Wednesday's, which is
 * the whole of what it had to say and one day fresher.
 *
 * ## "Open" is the tender list's definition, not a second one
 *
 * A Tender is open while **no Outcome has been recorded on it** — which is exactly the
 * Tenders `worklistGroup` puts in one of its five groups, since the one way off that
 * list is a recorded Outcome. Stated here as {@link isOpen} rather than by calling
 * `worklistGroup`, because the groups need each Item's sourcing counts and the Digest
 * needs none of that; `digest.test.ts` holds the two definitions to each other over
 * fixtures so they cannot drift apart.
 *
 * ## Financial silence, and the language
 *
 * Both inherited from ADR-0012 and enforced where every other message is: the builder in
 * `@/lib/wecom/messages` is called by introspection in `messages.test.ts`, so the Digest
 * is covered by the price/margin/supplier rules the day it is written.
 *
 * Arithmetic over `today` — a day already resolved in the org's timezone (ADR-0010) —
 * and one query. No clock is read here.
 */

/** What the Digest needs of a Tender. A list row satisfies it. */
export type DigestTender = {
  reference: string;
  client: string;
  title: string;
  /** The fact the Bid went out: what decides which half of the lifecycle it is in. */
  submittedAt: string | null;
  internalQuoteDeadline: string;
  clientSubmissionDeadline: string;
  expectedDecisionDate: string | null;
  items: DecidedItem[];
};

/**
 * Is this Tender still open?
 *
 * The tender list's default filter, in the terms the Digest can afford to ask in. See
 * the note above: `worklistGroup` returns null for precisely these Tenders and the test
 * proves it, so a Tender on somebody's worklist is a Tender in the morning's Digest.
 */
export function isOpen(items: DecidedItem[]): boolean {
  return tenderOutcome(items) === null;
}

/**
 * The one Milestone this Tender is heading for, or null when nothing is dated ahead of
 * it.
 *
 * Read in lifecycle order, because which Milestone comes next is decided by where the
 * Tender is rather than by which date happens to sort first:
 *
 * - **The Bid has gone out** — the only thing left is the client's answer. That is the
 *   Owner's own chase date if they set one, and **null if they did not**: there is no
 *   honest day to name, and a guessed one is worse than an admitted blank.
 * - **The client's deadline has gone by with nothing sent** — the miss, which is the
 *   loudest thing this app says and outranks any date still on the calendar. Stated as
 *   the Milestone's rule (the Bid did not go out and the day has passed), which is
 *   `milestoneRules.submission_missed` in `@/lib/reminders/send.ts` and **not**
 *   `isSubmissionMissed` in `@/lib/tenders/progress.ts`. The two really do differ on one
 *   Tender — never submitted, past the deadline, with one Item decided and one still
 *   open — and the reminder engine is the one to agree with: it posts "投标已错过" about
 *   that Tender, so a Digest reading it any other way would contradict the message
 *   sitting directly above it in the same batch. The worklist's extra condition puts
 *   that row in "everything else" instead, which decides *which pile it is in* rather
 *   than whether the Bid went out. `send.test.ts` pins the agreement.
 * - **Otherwise the nearer of the two deadlines still ahead.** The internal one comes
 *   first by construction (`deadlines_out_of_order` refuses the other order), so it is
 *   next while it is still ahead and the client's deadline is next once it is not.
 *
 * Null therefore means one specific, honest thing — submitted, awaiting an answer, with
 * no date claimed — and never "we could not work it out".
 */
export function nextMilestone(
  tender: DigestTender,
  today: string,
): { milestone: ReminderMilestone; date: string } | null {
  if (tender.submittedAt !== null) {
    return tender.expectedDecisionDate === null
      ? null
      : { milestone: "decision_chase", date: tender.expectedDecisionDate };
  }

  if (tender.clientSubmissionDeadline < today) {
    return { milestone: "submission_missed", date: tender.clientSubmissionDeadline };
  }

  return tender.internalQuoteDeadline >= today
    ? { milestone: "internal_quote", date: tender.internalQuoteDeadline }
    : { milestone: "client_submission", date: tender.clientSubmissionDeadline };
}

/**
 * Every open Tender as one line, soonest first.
 *
 * **Sorted by the Milestone each one is heading for, not by the deadline the list screen
 * sorts on.** A Digest is read top-down and abandoned partway; whatever is nearest —
 * including a submission already missed, whose date is behind us and which therefore
 * sorts to the top on its own — has to be in the part that gets read. The undated ones
 * go last: they are waiting on a client, which is the one state nobody can act on today.
 *
 * The reference breaks ties, so two Tenders due the same day are in a stable order from
 * one morning to the next rather than in whatever order the rows came back in.
 */
export function digestLines(tenders: DigestTender[], today: string): DigestLine[] {
  return tenders
    .filter((tender) => isOpen(tender.items))
    .map((tender) => {
      const next = nextMilestone(tender, today);

      return {
        reference: tender.reference,
        client: tender.client,
        title: tender.title,
        next:
          next === null
            ? null
            : { ...next, daysLeft: daysBetween(today, next.date) },
      };
    })
    .sort(soonestFirst);
}

function soonestFirst(left: DigestLine, right: DigestLine): number {
  if (left.next === null || right.next === null) {
    // Undated last, and two undated ones fall through to the reference.
    if (left.next !== right.next) return left.next === null ? 1 : -1;
  } else if (left.next.date !== right.next.date) {
    return left.next.date < right.next.date ? -1 : 1;
  }

  return left.reference < right.reference ? -1 : 1;
}

type TenderRow = {
  reference: string;
  client_name: string;
  title: string;
  internal_quote_deadline: string;
  client_submission_deadline: string;
  expected_decision_date: string | null;
  submitted_at: string | null;
  items: { outcome: ItemOutcome | null }[];
};

/**
 * One org's Digest, or **null when it has nothing open**.
 *
 * Silence is the right answer to an empty list, and it is the same rule the reminder
 * path applies to a Tender with nothing to say about it: a message that names no work
 * is the group's attention spent on a line with no fact in it, posted every morning for
 * ever. A team with nothing open is not losing track of anything.
 *
 * Read through the **service** client, scoped by `org_id`. The cron has no session, so
 * RLS is not the boundary here — that filter is, and it is what stops one org's Tenders
 * being listed in another's group.
 */
export async function digestFor(
  orgId: string,
  today: string,
): Promise<GroupMessage | null> {
  const { data } = await createServiceClient()
    .from("tenders")
    .select(
      "reference, client_name, title, internal_quote_deadline, " +
        "client_submission_deadline, expected_decision_date, submitted_at, " +
        "items:tender_items(outcome)",
    )
    .eq("org_id", orgId)
    .overrideTypes<TenderRow[], { merge: false }>();

  const lines = digestLines((data ?? []).map(fromRow), today);

  // One link, to the list — the Digest is the one message that is not about a single
  // Tender, and the Tenders list is what it is a listing of. Null when the deployment was
  // never told its origin, which costs the link and never the Digest.
  const link = appLinks().tenders();

  return lines.length === 0 ? null : digestMessage({ tenders: lines, link });
}

function fromRow(row: TenderRow): DigestTender {
  return {
    reference: row.reference,
    client: row.client_name,
    title: row.title,
    submittedAt: row.submitted_at,
    internalQuoteDeadline: row.internal_quote_deadline,
    clientSubmissionDeadline: row.client_submission_deadline,
    expectedDecisionDate: row.expected_decision_date,
    items: row.items,
  };
}
