/**
 * How a Tender ended, derived from how its Items ended.
 *
 * Outcome is stored per **Tender Item** and nowhere else (ADR-0001), because a client
 * awarding half a Tender to us and half to a competitor is ordinary and has to be
 * recordable truthfully. What a Tender as a whole came to is therefore a reading of its
 * Items, computed here on every read.
 *
 * **`partial` exists only as a display state and can never be stored.** It is produced by
 * {@link tenderOutcome} and by nothing else; the vocabulary a write may use is
 * {@link itemOutcomes}, which does not contain it. A `tenders.outcome` column to hold it
 * would need a fifth value the Items cannot express, and would then drift from them.
 *
 * Arithmetic only — no reads, no writes, no clock. The interesting cases are a Tender
 * still half out with the client and an award the client split, and both are worth
 * stating as fixtures rather than staged as Tenders.
 */

/** What may be stored on a Tender Item. Four values, and `partial` is not one of them. */
export const itemOutcomes = ["won", "lost", "no_bid", "cancelled"] as const;

export type ItemOutcome = (typeof itemOutcomes)[number];

/**
 * Everything a Tender may read as, including the one value no row may hold.
 *
 * `partial` is why this is a list rather than `ItemOutcome | "partial"`: no Item can hold
 * it, so a guard built from `itemOutcomes` alone would pass while the mixed result — the
 * most confusing thing the bar under the Items ever says — rendered as its key.
 * `messages.test.ts` walks this.
 */
export const tenderOutcomes = [...itemOutcomes, "partial"] as const;

export type TenderOutcome = (typeof tenderOutcomes)[number];

/** What the rules need of a Tender Item: its Outcome, or null while it is undecided. */
export type DecidedItem = { outcome: ItemOutcome | null };

export function isItemOutcome(value: string): value is ItemOutcome {
  return (itemOutcomes as readonly string[]).includes(value);
}

/**
 * What a Tender came to, or null while it is still open.
 *
 * Three rules, in this order, and the order is the whole of it:
 *
 * 1. **Any Item undecided → the Tender has no Outcome.** It is still open. Running this
 *    first is what stops a Tender with one Item still out with the client reading as
 *    written off because the other two were.
 * 2. **Otherwise consider only `won` and `lost`.** With none of either, nothing was ever
 *    bid: `no_bid` if we chose not to, else `cancelled` — the client pulled it. `no_bid`
 *    leads because it is the fact about *us*, and the one worth counting.
 * 3. **Otherwise: all won → `won`, all lost → `lost`, a mix → `partial`.** Items marked
 *    `no_bid` or `cancelled` sit out of this vote entirely. An Item we chose not to bid
 *    is not a defeat, and one the client pulled is not ours to have lost — counting
 *    either would turn a clean sweep into a partial award.
 */
export function tenderOutcome(items: DecidedItem[]): TenderOutcome | null {
  // A Tender always has at least one Item, so this is unreachable through the app. It is
  // answered anyway: rule 2 over an empty list would report `cancelled` on nothing.
  if (items.length === 0) return null;

  if (items.some((item) => item.outcome === null)) return null;

  const won = items.filter((item) => item.outcome === "won").length;
  const lost = items.filter((item) => item.outcome === "lost").length;

  if (won + lost === 0) {
    return items.some((item) => item.outcome === "no_bid") ? "no_bid" : "cancelled";
  }

  if (lost === 0) return "won";
  if (won === 0) return "lost";

  return "partial";
}

/** Items won, items lost, and the rate between them — or no rate at all. */
export type WinRate = {
  won: number;
  lost: number;
  /** `won / (won + lost)`, or null when nothing has been decided either way. */
  rate: number | null;
};

/**
 * The win rate, at the Item grain.
 *
 * `won / (won + lost)`. **`no_bid` and `cancelled` are excluded from the denominator**,
 * and so are Items still undecided: a Tender we chose not to bid is not a loss, and one
 * the client pulled is not a verdict on us. Counting either reports a team that has never
 * lost as failing, and does it on the figure the business judges itself by.
 *
 * The rate is null rather than zero when nothing has been decided. Zero reads as "we lose
 * everything", which is the opposite of what an empty denominator means.
 *
 * Items, not Tenders — the two are different numbers and the money lives at the Item
 * grain (ADR-0001). A caller wanting the Tender grain counts derived Tender Outcomes
 * itself, and has to decide there what a `partial` is worth.
 */
export function winRate(items: DecidedItem[]): WinRate {
  const won = items.filter((item) => item.outcome === "won").length;
  const lost = items.filter((item) => item.outcome === "lost").length;

  return { won, lost, rate: won + lost === 0 ? null : won / (won + lost) };
}
