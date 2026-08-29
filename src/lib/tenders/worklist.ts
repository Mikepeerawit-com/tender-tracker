import "server-only";

import {
  comingUpDeadlines,
  notYetSourcedCount,
  rowStatus,
  tenderProgress,
  worklistGroup,
  worklistGroups,
  type DeadlineKind,
  type RowStatus,
  type SourcedItem,
  type TenderProgress,
  type WorklistGroup,
} from "@/lib/tenders/progress";
import { countItemSourcing } from "@/lib/quotes/quotes";
import { listTenders, type TenderSummary } from "@/lib/tenders/tenders";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

/**
 * The tender list, assembled as a worklist.
 *
 * This is the app's home and the answer to "what do I do next" at 9am. It is grouped by
 * **Progress** — the vocabulary `CONTEXT.md` already defines — with Submission Missed
 * pinned above as the single exception, and **every Tender appears in exactly one group**.
 * A row that shows up in two places is a report; a row that shows up in one is a job.
 *
 * Urgency is not the grouping and has not been since the 29 August 2026 amendment to
 * ADR-0007. It is stated *on each row* instead, which is what {@link WorklistRow.status}
 * carries.
 *
 * Nothing here is stored. `@/lib/tenders/progress` holds the rules as arithmetic and is
 * tested as arithmetic; this file is the read they run over — three queries however many
 * Tenders there are, because sourcing state is per Item and a per-Tender read would be a
 * round trip each to draw one screen. The sourcing half of that read belongs to
 * `@/lib/quotes/quotes`, which is where the third sourcing state is defined.
 *
 * `today` is a `yyyy-mm-dd` day **already resolved in the org's timezone** and passed in
 * from the request boundary (ADR-0010). It is not resolved here and must not be: Vercel
 * runs UTC, so a boundary computed server-local rolls the day seven hours early for
 * everybody in Bangkok, and every deadline on this screen would go red the previous
 * afternoon.
 */

/** One row of the list: what it shows, and what it now says about itself. */
export type WorklistRow = TenderSummary & {
  itemCount: number;
  progress: TenderProgress;
  /**
   * Which of the two deadlines fall inside the rolling seven days, in the order a row
   * shows them.
   *
   * **Populated for every row**, where it used to be filled only for the one block called
   * "Coming up". Every row states its own next date now rather than inheriting one from
   * the pile it landed in, so there is no longer a group this is meaningless for.
   *
   * Nothing draws it today: {@link status} carries the sentence the row actually says,
   * and that sentence replaced the chips this used to fill. It stays because it is the
   * row's own answer to *what falls inside the window*, which is a different question
   * from *what does the row say* — and because a caller that wanted the first would
   * otherwise have to re-derive it from two dates and a `today` it does not hold.
   */
  dueDeadlines: DeadlineKind[];
  /** The one sentence the row states, and how loudly. See {@link rowStatus}. */
  status: RowStatus;
  /**
   * How many Items nobody has answered for — neither a Quote nor a No Supplier Found.
   *
   * Carried on every row rather than only the overdue ones, so that the count the
   * sentence quotes and the count the row holds cannot drift apart.
   */
  notYetSourced: number;
};

export type WorklistSection = { group: WorklistGroup; tenders: WorklistRow[] };

export type Worklist = {
  /** All five, always, empty ones included — see {@link listWorklist}. */
  sections: WorklistSection[];
  /**
   * Every Tender the org has, the ones off the list included.
   *
   * Carried because an empty worklist has two meanings that must not be shown the same
   * sentence: a team who has recorded nothing yet, and a team who has finished
   * everything. Counted here rather than re-queried, since the rows are already in hand.
   */
  total: number;
};

/**
 * The whole list, group by group, in the order the groups are drawn.
 *
 * All five sections are always returned, empty ones included: the order is the product
 * decision, and a caller that had to reassemble it from whatever came back could get it
 * wrong. Drawing or skipping an empty group is the screen's business.
 *
 * Tenders whose Outcome has been recorded — written off (`no_bid`, `cancelled`) or
 * decided (`won`, `lost`, `partial`) — are in none of the five and so are absent here.
 * That is the only way off the list.
 */
export async function listWorklist(
  today: string,
  store: SessionCookieStore,
): Promise<Worklist> {
  // Already soonest Client Submission Deadline first, which is the order every group
  // inherits: grouping decides *which* pile a Tender is in, never where in the pile.
  const tenders = await listTenders(store);
  const itemIds = tenders.flatMap((tender) => tender.items.map((item) => item.id));
  // Two more queries for the whole list rather than two per Tender. An Item absent from
  // the map is Not Yet Sourced, which is the state Sourcing Overdue turns on.
  const sourcing = await countItemSourcing(itemIds, store);
  const sections = new Map<WorklistGroup, WorklistRow[]>(
    worklistGroups.map((group) => [group, []]),
  );

  for (const { items: listItems, ...summary } of tenders) {
    const items: SourcedItem[] = listItems.map((item) => ({
      outcome: item.outcome,
      ...(sourcing.get(item.id) ?? notYetSourced),
    }));
    const classified = { ...summary, items };
    const group = worklistGroup(classified, today);

    // The Tenders in no group are exactly the ones whose Outcome has been recorded. They
    // are off the list, not hidden in it: the work on them is done.
    if (group === null) continue;

    sections.get(group)!.push({
      ...summary,
      itemCount: items.length,
      progress: tenderProgress(classified),
      dueDeadlines: comingUpDeadlines(classified, today),
      status: rowStatus(classified, today),
      notYetSourced: notYetSourcedCount(classified),
    });
  }

  return {
    sections: worklistGroups.map((group) => ({ group, tenders: sections.get(group)! })),
    total: tenders.length,
  };
}

/** An Item nobody has answered for yet — neither a Quote nor a No Supplier Found. */
const notYetSourced = { quoteCount: 0, noSupplierFoundCount: 0 };
