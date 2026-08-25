import { plusDays } from "@/lib/calendar-date";
import { tenderOutcome, type DecidedItem } from "@/lib/tenders/outcome";

/**
 * What a Tender is *doing*, and which block of the worklist it belongs in.
 *
 * Nothing here is stored. There is no `status` column and there deliberately never will
 * be (ADR-0001): a hand-maintained status drifts from reality inside a month and then
 * every number derived from it lies quietly. Everything in this file is computed on
 * every read, which also makes regression automatic and correct — delete the last Quote
 * on an Item and the Tender is `sourcing` again, with no transition to police.
 *
 * **"Overdue" is three unrelated conditions**, and they are three functions here for the
 * same reason they are three blocks on the screen: collapsing them into one badge makes
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
 * The five blocks, in the order they are read. The order is not decoration: it is what
 * makes every Tender land in exactly one, and the list a worklist rather than a report.
 */
export const worklistBlocks = [
  "submission_missed",
  "sourcing_overdue",
  "coming_up",
  "awaiting_decision",
  "everything_else",
] as const;

export type WorklistBlock = (typeof worklistBlocks)[number];

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
 * The one block a Tender belongs in, or null when it belongs on no list at all.
 *
 * Read top-down, and the order is load-bearing: a missed submission is very often *also*
 * a sourcing failure — the unsourced Item is why the Bid never went out — and without an
 * order the same row would appear in two blocks and the list would stop being a worklist.
 *
 * Null is exactly the Tenders whose Outcome has been recorded: written off (`no_bid`,
 * `cancelled`) or decided (`won`, `lost`, `partial`). There is no other way off the list,
 * which is what stops a Tender in trouble quietly ageing out of it.
 *
 * Two exclusions in here are worth naming, because both look like omissions:
 *
 * - **A submitted Tender is never "Coming up".** Its client deadline was met and its
 *   internal one is spent; what is left is a person to chase, which is Awaiting Decision.
 * - **A Tender part-decided but never sent falls to "everything else"**, not off the
 *   list. One Item pulled by the client with the rest still to bid is still work.
 */
export function worklistBlock(
  tender: ClassifiedTender,
  today: string,
): WorklistBlock | null {
  if (isSubmissionMissed(tender, today)) return "submission_missed";
  if (isSourcingOverdue(tender, today)) return "sourcing_overdue";

  // Every block below this line is about a Tender still open, so a recorded Outcome is
  // the exit — checked once here rather than repeated into three conditions.
  if (tenderOutcome(tender.items) !== null) return null;

  if (isAwaitingDecision(tender)) return "awaiting_decision";

  return comingUpDeadlines(tender, today).length > 0 ? "coming_up" : "everything_else";
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
