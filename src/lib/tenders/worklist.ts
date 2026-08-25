import "server-only";

import {
  comingUpDeadlines,
  tenderProgress,
  worklistBlock,
  worklistBlocks,
  type DeadlineKind,
  type SourcedItem,
  type TenderProgress,
  type WorklistBlock,
} from "@/lib/tenders/progress";
import { countItemSourcing } from "@/lib/quotes/quotes";
import { listTenders, type TenderSummary } from "@/lib/tenders/tenders";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

/**
 * The tender list, assembled as a worklist.
 *
 * This is the app's home and the answer to "what do I do next" at 9am, which is why it
 * is grouped by **what is wrong with each Tender** rather than by how the business is
 * doing, and why **every Tender appears in exactly one block**. A row that shows up in
 * two places is a report; a row that shows up in one is a job.
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

/** One row of the list: what it shows, and what the block put on it. */
export type WorklistRow = TenderSummary & {
  itemCount: number;
  progress: TenderProgress;
  /**
   * Which deadline put this row in "Coming up", in the order a row shows them. Empty in
   * every other block — a Tender in trouble is not also "due Tuesday", and the row says
   * one thing.
   */
  dueDeadlines: DeadlineKind[];
};

export type WorklistSection = { block: WorklistBlock; tenders: WorklistRow[] };

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
 * The whole list, block by block, in the order the blocks are read.
 *
 * All five sections are always returned, empty ones included: the order is the product
 * decision, and a caller that had to reassemble it from whatever came back could get it
 * wrong. Drawing or skipping an empty block is the screen's business.
 *
 * Tenders whose Outcome has been recorded — written off (`no_bid`, `cancelled`) or
 * decided (`won`, `lost`, `partial`) — are in none of the five and so are absent here.
 * That is the only way off the list.
 */
export async function listWorklist(
  today: string,
  store: SessionCookieStore,
): Promise<Worklist> {
  // Already soonest Client Submission Deadline first, which is the order every block
  // inherits: the blocks decide *which* pile a Tender is in, never where in the pile.
  const tenders = await listTenders(store);
  const itemIds = tenders.flatMap((tender) => tender.items.map((item) => item.id));
  // Two more queries for the whole list rather than two per Tender. An Item absent from
  // the map is Not Yet Sourced, which is the state Sourcing Overdue turns on.
  const sourcing = await countItemSourcing(itemIds, store);
  const sections = new Map<WorklistBlock, WorklistRow[]>(
    worklistBlocks.map((block) => [block, []]),
  );

  for (const { items: listItems, ...summary } of tenders) {
    const items: SourcedItem[] = listItems.map((item) => ({
      outcome: item.outcome,
      ...(sourcing.get(item.id) ?? notYetSourced),
    }));
    const classified = { ...summary, items };
    const block = worklistBlock(classified, today);

    // The Tenders in no block are exactly the ones whose Outcome has been recorded. They
    // are off the list, not hidden in it: the work on them is done.
    if (block === null) continue;

    sections.get(block)!.push({
      ...summary,
      itemCount: items.length,
      progress: tenderProgress(classified),
      dueDeadlines: block === "coming_up" ? comingUpDeadlines(classified, today) : [],
    });
  }

  return {
    sections: worklistBlocks.map((block) => ({ block, tenders: sections.get(block)! })),
    total: tenders.length,
  };
}

/** An Item nobody has answered for yet — neither a Quote nor a No Supplier Found. */
const notYetSourced = { quoteCount: 0, noSupplierFoundCount: 0 };
