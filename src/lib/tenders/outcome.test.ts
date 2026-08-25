import { describe, expect, it } from "vitest";

import { itemOutcomes, tenderOutcome, winRate, type ItemOutcome } from "./outcome";

/**
 * The three ordered rules, and the one value that exists only on the way out.
 *
 * Arithmetic over Outcomes somebody else has read, so every case here is a fixture
 * rather than a staged Tender — which is what makes it cheap to write the awkward ones
 * down: the `no_bid` sitting beside two wins, the Tender the client pulled entirely, and
 * the mixed award that is the whole reason Outcome is per Item.
 */

/** Items as the rules see them: nothing but their Outcomes, in order. */
function items(...outcomes: (ItemOutcome | null)[]) {
  return outcomes.map((outcome) => ({ outcome }));
}

describe("the Tender-level Outcome", () => {
  it("has none while any Item is undecided", () => {
    // Rule 1, and it runs first: a Tender half-decided is open, not partially won.
    expect(tenderOutcome(items("won", null))).toBeNull();
    expect(tenderOutcome(items(null))).toBeNull();
  });

  it("stays open on an undecided Item even when the rest are written off", () => {
    // Rule 1 beats rule 2. Reversing them would report a Tender as `no_bid` while an
    // Item on it is still out with the client.
    expect(tenderOutcome(items("no_bid", null))).toBeNull();
    expect(tenderOutcome(items("cancelled", null))).toBeNull();
  });

  it("is no_bid when nothing was bid and any Item says so", () => {
    expect(tenderOutcome(items("no_bid"))).toBe("no_bid");
    expect(tenderOutcome(items("no_bid", "cancelled"))).toBe("no_bid");
  });

  it("is cancelled when the client pulled every Item", () => {
    expect(tenderOutcome(items("cancelled"))).toBe("cancelled");
    expect(tenderOutcome(items("cancelled", "cancelled"))).toBe("cancelled");
  });

  it("is won when every Item that went to the client won", () => {
    expect(tenderOutcome(items("won"))).toBe("won");
    // Rule 3 considers only `won` and `lost`. An Item we chose not to bid is not a
    // defeat, and one the client pulled is not ours to have lost.
    expect(tenderOutcome(items("won", "no_bid"))).toBe("won");
    expect(tenderOutcome(items("won", "cancelled", "won"))).toBe("won");
  });

  it("is lost when every Item that went to the client lost", () => {
    expect(tenderOutcome(items("lost"))).toBe("lost");
    expect(tenderOutcome(items("lost", "no_bid"))).toBe("lost");
  });

  it("is partial when the client split the award", () => {
    // The case the whole per-Item model exists for: half to us, half to a competitor.
    expect(tenderOutcome(items("won", "lost"))).toBe("partial");
    expect(tenderOutcome(items("lost", "won", "no_bid"))).toBe("partial");
  });

  it("has none for a Tender with no Items at all", () => {
    // Unreachable through the app — a Tender always has an Item — and answered anyway,
    // because rule 2 over an empty list would otherwise report `cancelled` on nothing.
    expect(tenderOutcome([])).toBeNull();
  });

  it("is never storable, because `partial` is not an Item Outcome", () => {
    // The guard behind the display state. `partial` is derived here and nowhere else,
    // and the vocabulary a write may use is this list — which does not contain it.
    expect([...itemOutcomes]).toEqual(["won", "lost", "no_bid", "cancelled"]);
    expect([...itemOutcomes]).not.toContain("partial");
  });
});

describe("the win rate", () => {
  it("is won over won plus lost", () => {
    expect(winRate(items("won", "won", "won", "lost"))).toEqual({
      won: 3,
      lost: 1,
      rate: 0.75,
    });
  });

  it("leaves no_bid and cancelled out of the denominator", () => {
    // A Tender we chose not to bid is not a loss, and one the client pulled is not a
    // verdict on us. Counting either would report a team that never lost as failing.
    expect(winRate(items("won", "no_bid", "cancelled"))).toEqual({
      won: 1,
      lost: 0,
      rate: 1,
    });
  });

  it("ignores Items still undecided", () => {
    expect(winRate(items("won", "lost", null))).toEqual({ won: 1, lost: 1, rate: 0.5 });
  });

  it("has no rate at all when nothing has been decided either way", () => {
    // Null, never zero: a zero rate reads as "we lose everything", which is the opposite
    // of what an empty denominator means.
    expect(winRate(items("no_bid", null))).toEqual({ won: 0, lost: 0, rate: null });
    expect(winRate([])).toEqual({ won: 0, lost: 0, rate: null });
  });
});
