import { daysBetween, plusDays } from "@/lib/calendar-date";
import { tenderOutcome, type DecidedItem } from "@/lib/tenders/outcome";

/**
 * What a Tender is *doing*, which group of the worklist it belongs in, and what its row
 * says about itself.
 *
 * Nothing here is stored. There is no `status` column and there deliberately never will
 * be (ADR-0001): a hand-maintained status drifts from reality inside a month and then
 * every number derived from it lies quietly. Everything in this file is computed on
 * every read, which also makes regression automatic and correct — delete the last Quote
 * on an Item and the Tender is `sourcing` again, with no transition to police.
 *
 * **"Overdue" is three unrelated conditions**, and they are three functions here for the
 * same reason the row says three different sentences: collapsing them into one badge makes
 * the app unable to say *which one you have*. Submission Missed is fatal and the Owner's;
 * Sourcing Overdue is ours, fixable, and an Assignee's; Awaiting Decision is not a
 * failure at all — it is the state the business spends most of its time in.
 *
 * Arithmetic only, over rows something else has read, and over a `today` something else
 * has decided. No clock, no database, no timezone: `today` arrives already resolved in
 * the org's timezone (`orgs.timezone`, via `todayIn`), because Vercel runs UTC and a
 * server-local day boundary rolls seven hours early for everybody in Bangkok. Keeping
 * that out of here is what lets the interesting combinations — a Tender both past its
 * submission deadline and holding an unsourced Item, an Item nobody could source beside
 * one nobody has tried — be stated as fixtures rather than staged as Tenders.
 */

/** The rolling window "Coming up" means. Rolling, not a calendar week — see below. */
const comingUpDays = 7;

/** What the rules need of a Tender Item: how it ended, and how its sourcing stands. */
export type SourcedItem = DecidedItem & {
  quoteCount: number;
  /**
   * How many Assignees have said they could not source it. **Not the same as having no
   * Quote**: "nobody could supply this" and "nobody tried" mean opposite things, and only
   * one of them is worth chasing an Assignee about.
   */
  noSupplierFoundCount: number;
};

/** What the rules need of a Tender. A real list row satisfies it. */
export type ClassifiedTender = {
  /** The fact the Bid went out. Its *absence* is the whole of Submission Missed. */
  submittedAt: string | null;
  /** Both `yyyy-mm-dd`, compared against a `today` in the same shape. */
  internalQuoteDeadline: string;
  clientSubmissionDeadline: string;
  items: SourcedItem[];
};

export const tenderProgresses = ["new", "sourcing", "quoted", "submitted"] as const;

export type TenderProgress = (typeof tenderProgresses)[number];

/**
 * Which deadline put a Tender in "Coming up" — a row is labelled with it.
 *
 * A list rather than a bare union, as every union the app renders a key from is: the
 * wording lives in the message files, and `messages.test.ts` walks this to hold both
 * locales to it. A third deadline added to a union alone would ship unnamed.
 */
export const deadlineKinds = ["internal_quote", "client_submission"] as const;

export type DeadlineKind = (typeof deadlineKinds)[number];

/**
 * The groups of the worklist, in the order they are drawn.
 *
 * **One ordered list, not two taxonomies.** Until the 29 August 2026 amendment to
 * ADR-0007 there were five blocks, of which four named *urgency* and one —
 * `awaiting_decision` — named a *phase*; and on this screen that one was not merely
 * similar to Progress `submitted`, it was exactly that set. A reader had to learn five
 * prose-hinted headings instead of one vocabulary they already used.
 *
 * So the list groups by **Progress**, the term `CONTEXT.md` already defines, in the order
 * it already defines. Submission Missed is pinned above as the single exception: it is
 * the failure the product exists to prevent, and a dead Tender rendered as one row inside
 * "Sourcing" with a small red mark is the outcome the block was invented to stop.
 *
 * Keeping it a single ordered list is what preserves *every Tender appears in exactly one
 * place*, and what lets `messages.test.ts` walk one union rather than two.
 */
export const worklistGroups = ["submission_missed", ...tenderProgresses] as const;

export type WorklistGroup = (typeof worklistGroups)[number];

/**
 * How far along a Tender is, evaluated top-down.
 *
 * **Items marked `no_bid` are excluded from the `quoted` test**, or a single Item we
 * chose not to price pins the Tender at `sourcing` forever and no amount of work moves
 * it. Only `no_bid` is excused: a `lost` Item was bid, so a Tender missing its Quote is
 * missing data, not finished with it.
 */
export function tenderProgress(tender: ClassifiedTender): TenderProgress {
  if (tender.submittedAt !== null) return "submitted";

  const priceable = tender.items.filter((item) => item.outcome !== "no_bid");

  // `length > 0` is not belt-and-braces: `every` over nothing is true, so a Tender we
  // declined outright would read `quoted` — a claim that somebody gathered prices for
  // goods nobody ever rang a supplier about.
  if (priceable.length > 0 && priceable.every((item) => item.quoteCount > 0)) {
    return "quoted";
  }

  return tender.items.some((item) => item.quoteCount > 0) ? "sourcing" : "new";
}

/**
 * The Bid never went out and the client's deadline has passed. Fatal, and the Owner's.
 *
 * **No column implies this; it is the absence of one** — `submitted_at` being null is
 * indistinguishable from a Tender nobody has got to yet, right up until the deadline
 * goes by. That is why it has to be excluded explicitly wherever "active" is computed,
 * and why it does not age out: it leaves the list when somebody records an Outcome on
 * it, and not before.
 */
export function isSubmissionMissed(tender: ClassifiedTender, today: string): boolean {
  return (
    tender.submittedAt === null &&
    tender.clientSubmissionDeadline < today &&
    !isDecidedAtAll(tender)
  );
}

/**
 * The internal deadline has passed with an Item nobody has answered for. Ours, fixable.
 *
 * *Not Yet Sourced* is an Item with **neither a Quote nor a No Supplier Found record**.
 * Counting "Items with no Quote" instead nags an Assignee who already rang round and
 * reported back — which is the surest way to teach a team to ignore the nag.
 *
 * A second, different definition of Sourcing Overdue exists deliberately for reminder
 * targeting (per-Assignee: mention only those who have entered no Quotes at all). They
 * answer different questions and must not be merged.
 */
export function isSourcingOverdue(tender: ClassifiedTender, today: string): boolean {
  return (
    tender.submittedAt === null &&
    tender.internalQuoteDeadline < today &&
    !isDecidedAtAll(tender) &&
    tender.items.some((item) => item.quoteCount === 0 && item.noSupplierFoundCount === 0)
  );
}

/**
 * The Bid is out with the client and no answer has come back.
 *
 * **Not a failure.** It is the normal resting state of a live tender and a prompt to
 * chase a person rather than a supplier. Half an answer is still an open chase: a client
 * awarding one Item and going quiet on another is ordinary (ADR-0001), so this stays true
 * while any one Item is undecided.
 */
export function isAwaitingDecision(tender: ClassifiedTender): boolean {
  return tender.submittedAt !== null && tenderOutcome(tender.items) === null;
}

/**
 * Which of the two deadlines fall inside the rolling seven days, in the order a row
 * shows them. Empty when neither does.
 *
 * **Rolling, not a calendar week**, which collapses to near-nothing by Friday and tells
 * a team on Thursday afternoon that nothing is due. Inclusive at both ends: a deadline
 * today is due today.
 *
 * **Either deadline, not just the client's.** Under Client Submission alone a Tender
 * reads "due 1 Sep" and looks healthy while its Internal Quote Deadline is on Tuesday
 * with an Item unsourced — which is the one actionable thing on the screen.
 */
export function comingUpDeadlines(
  tender: ClassifiedTender,
  today: string,
): DeadlineKind[] {
  const horizon = plusDays(today, comingUpDays);
  const within = (deadline: string) => deadline >= today && deadline <= horizon;

  return [
    ...(within(tender.internalQuoteDeadline) ? (["internal_quote"] as const) : []),
    ...(within(tender.clientSubmissionDeadline) ? (["client_submission"] as const) : []),
  ];
}

/**
 * The one group a Tender belongs in, or null when it belongs on no list at all.
 *
 * Read top-down, and the order is load-bearing. **Submission Missed is tested first**
 * because a dead Tender is very often also mid-Sourcing — the unsourced Item is *why* the
 * Bid never went out — and grouping it by its Progress would file the one failure this
 * product exists to prevent as an ordinary row halfway down the list.
 *
 * Null is exactly the Tenders whose Outcome has been recorded: written off (`no_bid`,
 * `cancelled`) or decided (`won`, `lost`, `partial`). There is no other way off the list,
 * which is what stops a Tender in trouble quietly ageing out of it.
 *
 * Everything surviving both is grouped by {@link tenderProgress} — no third question, no
 * urgency test. **Urgency did not disappear; it moved onto the row**, as an indicator
 * lamp and a sentence naming the date and how far off it is ({@link rowStatus}). That is
 * what keeps "a Tender appears in exactly one place" true: it appears once, under its
 * Progress, and its trouble is stated *on* it rather than by which pile it landed in.
 */
export function worklistGroup(
  tender: ClassifiedTender,
  today: string,
): WorklistGroup | null {
  if (isSubmissionMissed(tender, today)) return "submission_missed";

  // A recorded Outcome is the exit, and the only one.
  if (tenderOutcome(tender.items) !== null) return null;

  return tenderProgress(tender);
}

/**
 * How many of a Tender's Items nobody has answered for.
 *
 * *Not Yet Sourced* is an Item with **neither a Quote nor a No Supplier Found record** —
 * the same definition {@link isSourcingOverdue} turns on, and for the same reason.
 * Counting "Items with no Quote" instead nags an Assignee who already rang round and
 * reported back, which is the surest way to teach a team to ignore the nag.
 */
export function notYetSourcedCount(tender: ClassifiedTender): number {
  return tender.items.filter(
    (item) => item.quoteCount === 0 && item.noSupplierFoundCount === 0,
  ).length;
}

/** How loud a row's indicator lamp is drawn. */
export type LampTone = "alarm" | "signal" | "calm";

/**
 * What one row says about itself: which sentence it carries, and how loudly.
 *
 * Urgency used to be the *heading* a Tender was filed under. Since the 29 August 2026
 * amendment to ADR-0007 the heading is Progress, and this is where urgency went — onto
 * the row, as a lamp and a sentence naming the date and how far off it is. The sentence
 * carries strictly more than the old chip did: the chip said *which* deadline, this says
 * which **and how far**.
 *
 * A discriminated union rather than a rendered string, because the wording lives in the
 * message files and the arithmetic is what is worth testing. `days` is the whole of the
 * "how far": the screen turns it into *today*, *tomorrow* or a date, which is a wording
 * decision and belongs beside the words.
 */
export type RowStatus =
  | { kind: "submission_missed"; tone: "alarm"; days: number }
  | { kind: "unsourced"; tone: "alarm"; count: number; total: number }
  | { kind: "due"; tone: LampTone; deadline: DeadlineKind; days: number }
  | { kind: "with_client"; tone: "calm" };

/**
 * The one sentence a row states, read top-down in the order the reader needs them.
 *
 * The order is the whole design. A dead Tender says it is dead before anything else; a
 * Bid already with the client has no deadline left to state, so it says where it is; an
 * Item nobody has answered for outranks a date still in the future, because it is the
 * thing somebody can act on today. Only then does the row fall back to its next date.
 *
 * **Alarm is time, and only time** (ADR-0019). Both alarm readings here are dates that
 * have gone by — a submission missed, and an Item still unsourced *after* the internal
 * deadline. Neither is a judgement about money or about a person.
 */
export function rowStatus(tender: ClassifiedTender, today: string): RowStatus {
  if (isSubmissionMissed(tender, today)) {
    return {
      kind: "submission_missed",
      tone: "alarm",
      days: daysBetween(tender.clientSubmissionDeadline, today),
    };
  }

  // Both deadlines are spent once the Bid is out, so there is no next date to name. What
  // is left is a person to chase, which is what the row says instead.
  if (tender.submittedAt !== null) return { kind: "with_client", tone: "calm" };

  if (isSourcingOverdue(tender, today)) {
    return {
      kind: "unsourced",
      tone: "alarm",
      count: notYetSourcedCount(tender),
      total: tender.items.length,
    };
  }

  const next = nextDeadline(tender, today);
  const days = daysBetween(today, next.date);

  return {
    kind: "due",
    // Inside the rolling window something is expected of the reader; beyond it the lamp
    // is drawn hollow. A date already gone by that got this far is one somebody has
    // already looked at — a part-decided Tender that was never sent — so it is stated
    // rather than shouted about.
    tone: days >= 0 && days <= comingUpDays ? "signal" : "calm",
    deadline: next.kind,
    days,
  };
}

/**
 * The soonest deadline still ahead, or — when both are spent — the client's.
 *
 * Falling back to the client's rather than to nothing is what lets the row always have a
 * date to name. Both being in the past and the Tender still on the list is the narrow
 * case of a Tender part-decided but never sent: `isSubmissionMissed` excuses it because
 * somebody has recorded an Outcome on an Item, so it lands here.
 */
function nextDeadline(
  tender: ClassifiedTender,
  today: string,
): { kind: DeadlineKind; date: string } {
  const internal = { kind: "internal_quote" as const, date: tender.internalQuoteDeadline };
  const client = {
    kind: "client_submission" as const,
    date: tender.clientSubmissionDeadline,
  };
  const ahead = [internal, client]
    .filter((deadline) => deadline.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return ahead[0] ?? client;
}

/**
 * Has anybody recorded an Outcome on any Item?
 *
 * Deliberately *any*, not the derived Tender Outcome. Both overdue conditions are about
 * whether the Tender has been dealt with at all, and one Item marked `cancelled` is
 * somebody having looked at it — which is enough to stop the app shouting about it,
 * without being enough to call the Tender decided.
 */
function isDecidedAtAll(tender: ClassifiedTender): boolean {
  return tender.items.some((item) => item.outcome !== null);
}
