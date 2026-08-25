import { describe, expect, it } from "vitest";

import { tenderOutcome } from "./outcome";
import {
  comingUpDeadlines,
  isAwaitingDecision,
  isSourcingOverdue,
  isSubmissionMissed,
  tenderProgress,
  worklistBlock,
  worklistBlocks,
  type ClassifiedTender,
  type SourcedItem,
} from "./progress";

/**
 * The worklist's rules, as arithmetic.
 *
 * Everything here is a fixture rather than a staged Tender, because the interesting
 * cases are combinations — a Tender that is both past its submission deadline *and*
 * has an unsourced Item, an Item nobody could source sitting beside one nobody has
 * tried — and staging each one through the database would bury the rule under setup.
 * `worklist.test.ts` holds the other half: that a real read produces these shapes.
 */

/** Every date here sits around this one, so a test says what it moves, not where it is. */
const today = "2026-08-10";

function item(overrides: Partial<SourcedItem> = {}): SourcedItem {
  return { outcome: null, quoteCount: 0, noSupplierFoundCount: 0, ...overrides };
}

/**
 * A Tender in no trouble at all: never submitted, both deadlines well beyond the rolling
 * window, one Item nobody has started. It lands in "everything else", so every test
 * below reads as the one change that moves it somewhere.
 */
function tender(overrides: Partial<ClassifiedTender> = {}): ClassifiedTender {
  return {
    submittedAt: null,
    internalQuoteDeadline: "2026-08-25",
    clientSubmissionDeadline: "2026-09-01",
    items: [item()],
    ...overrides,
  };
}

describe("tenderProgress", () => {
  it("is `new` while nobody has priced anything", () => {
    expect(tenderProgress(tender({ items: [item(), item()] }))).toBe("new");
  });

  it("is `sourcing` once one Item has a Quote and another has none", () => {
    expect(tenderProgress(tender({ items: [item({ quoteCount: 1 }), item()] }))).toBe(
      "sourcing",
    );
  });

  it("is `quoted` once every Item has one", () => {
    const items = [item({ quoteCount: 1 }), item({ quoteCount: 3 })];

    expect(tenderProgress(tender({ items }))).toBe("quoted");
  });

  it("does not let an Item marked `no_bid` pin the Tender at `sourcing`", () => {
    // The rule ADR-0001 spells out. Without the exclusion, one Item we chose not to bid
    // holds the whole Tender at `sourcing` forever, and no amount of work moves it.
    const items = [item({ quoteCount: 2 }), item({ outcome: "no_bid" })];

    expect(tenderProgress(tender({ items }))).toBe("quoted");
  });

  it("does not call a Tender we declined outright `quoted`", () => {
    // Nobody rang a supplier, so nothing was quoted. `every` over an empty list is true,
    // which is the shape this asserts against: excluding `no_bid` must not turn "there
    // was nothing to price" into "everything was priced".
    const items = [item({ outcome: "no_bid" }), item({ outcome: "no_bid" })];

    expect(tenderProgress(tender({ items }))).toBe("new");
  });

  it("still counts an Item that was lost, or cancelled, as needing a Quote", () => {
    // Only `no_bid` is excused: it is the one Outcome that says we never intended to
    // price the Item. A lost Item was bid, so a Tender missing its Quote is missing data.
    const items = [item({ quoteCount: 2 }), item({ outcome: "lost" })];

    expect(tenderProgress(tender({ items }))).toBe("sourcing");
  });

  it("is `submitted` the moment the Bid went out, whatever the Quotes say", () => {
    // Top-down: `submitted_at` is a fact, and a Tender that went to the client without
    // every Item priced is a real thing that happened, not a Tender still sourcing.
    const submitted = tender({ submittedAt: "2026-08-09T04:00:00Z", items: [item()] });

    expect(tenderProgress(submitted)).toBe("submitted");
  });
});

describe("isSubmissionMissed", () => {
  const missed = tender({ clientSubmissionDeadline: "2026-08-09" });

  it("is the client deadline gone by with no Bid sent", () => {
    expect(isSubmissionMissed(missed, today)).toBe(true);
  });

  it("is not the deadline day itself", () => {
    // The Bid is due *on* the day, so the day is not yet missed.
    expect(isSubmissionMissed(tender({ clientSubmissionDeadline: today }), today)).toBe(
      false,
    );
  });

  it("is not missed once the Bid is recorded as sent", () => {
    expect(
      isSubmissionMissed({ ...missed, submittedAt: "2026-08-08T09:00:00Z" }, today),
    ).toBe(false);
  });

  it("leaves only when an Outcome is recorded", () => {
    // What keeps it on the list: a missed submission does not age out, it is closed out.
    expect(isSubmissionMissed({ ...missed, items: [item(), item()] }, today)).toBe(true);
    expect(
      isSubmissionMissed({ ...missed, items: [item({ outcome: "cancelled" }), item()] }, today),
    ).toBe(false);
  });
});

describe("isSourcingOverdue", () => {
  const overdue = tender({ internalQuoteDeadline: "2026-08-09" });

  it("is the internal deadline gone by with an Item nobody has touched", () => {
    expect(isSourcingOverdue(overdue, today)).toBe(true);
  });

  it("ignores an Item somebody has recorded No Supplier Found on", () => {
    // The whole reason the third sourcing state exists. Counting "Items with no Quote"
    // instead nags an Assignee who already answered the question.
    const answered = { ...overdue, items: [item({ noSupplierFoundCount: 1 })] };

    expect(isSourcingOverdue(answered, today)).toBe(false);
  });

  it("is over once every Item has a Quote", () => {
    expect(isSourcingOverdue({ ...overdue, items: [item({ quoteCount: 1 })] }, today)).toBe(
      false,
    );
  });

  it("still fires when one Item is answered and another is not", () => {
    const items = [item({ noSupplierFoundCount: 1 }), item()];

    expect(isSourcingOverdue({ ...overdue, items }, today)).toBe(true);
  });

  it("is not the deadline day itself", () => {
    expect(isSourcingOverdue(tender({ internalQuoteDeadline: today }), today)).toBe(false);
  });

  it("says nothing about a Tender already sent, or already decided", () => {
    expect(
      isSourcingOverdue({ ...overdue, submittedAt: "2026-08-09T09:00:00Z" }, today),
    ).toBe(false);
    expect(
      isSourcingOverdue({ ...overdue, items: [item({ outcome: "won" }), item()] }, today),
    ).toBe(false);
  });
});

describe("isAwaitingDecision", () => {
  const sent = tender({ submittedAt: "2026-08-09T09:00:00Z" });

  it("is a Bid that went out and has heard nothing back", () => {
    expect(isAwaitingDecision(sent)).toBe(true);
  });

  it("is still waiting while any one Item is undecided", () => {
    // Half an award is ordinary (ADR-0001), and half an answer is still an open chase.
    expect(isAwaitingDecision({ ...sent, items: [item({ outcome: "won" }), item()] })).toBe(
      true,
    );
  });

  it("is over once every Item has been decided", () => {
    const items = [item({ outcome: "won" }), item({ outcome: "lost" })];

    expect(isAwaitingDecision({ ...sent, items })).toBe(false);
  });

  it("is not a Tender that was never sent", () => {
    expect(isAwaitingDecision(tender())).toBe(false);
  });
});

describe("comingUpDeadlines", () => {
  it("names the client submission deadline when that is the one falling due", () => {
    const soon = tender({ clientSubmissionDeadline: "2026-08-14" });

    expect(comingUpDeadlines(soon, today)).toEqual(["client_submission"]);
  });

  it("names the internal quote deadline on its own", () => {
    // The case a Client Submission-only window misses entirely: the Tender reads "due
    // 1 Sep" and looks healthy while the deadline that actually needs work is on Tuesday.
    const soon = tender({
      internalQuoteDeadline: "2026-08-12",
      clientSubmissionDeadline: "2026-09-30",
    });

    expect(comingUpDeadlines(soon, today)).toEqual(["internal_quote"]);
  });

  it("names both when both fall inside the window", () => {
    const soon = tender({
      internalQuoteDeadline: "2026-08-12",
      clientSubmissionDeadline: "2026-08-15",
    });

    expect(comingUpDeadlines(soon, today)).toEqual(["internal_quote", "client_submission"]);
  });

  it("rolls seven days from today, inclusive at both ends", () => {
    const on = (date: string) =>
      comingUpDeadlines(tender({ clientSubmissionDeadline: date }), today);

    expect(on(today)).toEqual(["client_submission"]);
    expect(on("2026-08-17")).toEqual(["client_submission"]);
    // A calendar week would have collapsed to nothing by now; a rolling one has not.
    expect(on("2026-08-18")).toEqual([]);
    expect(on("2026-08-09")).toEqual([]);
  });
});

describe("worklistBlock", () => {
  it("puts a Tender in trouble in the first block that describes it", () => {
    // Both conditions hold at once, which is ordinary — an unsourced Item is *why* the
    // submission was missed. Top-down is what stops the row appearing twice.
    const both = tender({
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-09",
    });

    expect(isSourcingOverdue(both, today)).toBe(true);
    expect(worklistBlock(both, today)).toBe("submission_missed");
  });

  it("prefers Sourcing Overdue to a deadline merely coming up", () => {
    const overdue = tender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-08-14",
    });

    expect(worklistBlock(overdue, today)).toBe("sourcing_overdue");
  });

  it("holds a Bid that is out with the client in Awaiting Decision", () => {
    // Not "coming up", even though its client deadline is days away: the deadline was
    // met, and what is left to do is chase a person rather than a supplier.
    const sent = tender({
      submittedAt: "2026-08-09T09:00:00Z",
      clientSubmissionDeadline: "2026-08-14",
    });

    expect(worklistBlock(sent, today)).toBe("awaiting_decision");
  });

  it("leaves an ordinary Tender with time on it in everything else", () => {
    expect(worklistBlock(tender(), today)).toBe("everything_else");
  });

  it("takes a written-off Tender off the list entirely", () => {
    const noBid = tender({ items: [item({ outcome: "no_bid" })] });
    const cancelled = tender({ items: [item({ outcome: "cancelled" })] });

    expect(worklistBlock(noBid, today)).toBeNull();
    expect(worklistBlock(cancelled, today)).toBeNull();
  });

  it("takes a decided Tender off the list, however it was decided", () => {
    const sent = { submittedAt: "2026-08-09T09:00:00Z" };
    const won = tender({ ...sent, items: [item({ outcome: "won" })] });
    const split = tender({
      ...sent,
      items: [item({ outcome: "won" }), item({ outcome: "lost" })],
    });

    expect(worklistBlock(won, today)).toBeNull();
    expect(worklistBlock(split, today)).toBeNull();
  });

  it("keeps a partly-decided Tender that was never sent on the list", () => {
    // One Item pulled by the client, the rest still to bid. It is still work.
    const partly = tender({ items: [item({ outcome: "cancelled" }), item()] });

    expect(worklistBlock(partly, today)).toBe("everything_else");
  });

  it("gives every Tender exactly one block, over every combination there is", () => {
    // The acceptance criterion, proved by exhaustion rather than by example. Two things
    // are asserted at once: that the ordered read agrees with each condition computed on
    // its own — so a Tender the list calls Sourcing Overdue really is one — and that the
    // *only* way off the list is a recorded Outcome. Falling through all five blocks
    // while still being live work is how a worklist quietly loses a Tender.
    const dates = ["2026-08-05", today, "2026-08-14", "2026-09-30"];
    const outcomes = [null, "won", "lost", "no_bid", "cancelled"] as const;
    const counts = [0, 1];
    let seen = 0;
    let offTheList = 0;

    for (const internalQuoteDeadline of dates) {
      for (const clientSubmissionDeadline of dates) {
        for (const submittedAt of [null, "2026-08-09T09:00:00Z"]) {
          for (const outcome of outcomes) {
            // The second Item's Outcome varies too. Holding it at null would make every
            // Tender in the sweep still open, and the one branch worth sweeping for —
            // the way *off* the list — would never once be taken.
            for (const second of outcomes) {
              for (const quoteCount of counts) {
                const noSupplierFoundCount = quoteCount === 1 ? 0 : 1;
                const subject = {
                  internalQuoteDeadline,
                  clientSubmissionDeadline,
                  submittedAt,
                  items: [
                    item({ outcome, quoteCount, noSupplierFoundCount }),
                    item({ outcome: second }),
                  ],
                };
                const where = JSON.stringify(subject);
                const block = worklistBlock(subject, today);

                seen += 1;
                if (block === null) offTheList += 1;

                expect(block === null, where).toBe(tenderOutcome(subject.items) !== null);
                expect(block === "submission_missed", where).toBe(
                  isSubmissionMissed(subject, today),
                );
                expect(block === "awaiting_decision", where).toBe(
                  isAwaitingDecision(subject),
                );

                expect(block === "sourcing_overdue", where).toBe(
                  isSourcingOverdue(subject, today) && !isSubmissionMissed(subject, today),
                );

                if (block === "coming_up") {
                  expect(comingUpDeadlines(subject, today).length, where).toBeGreaterThan(0);
                }
              }
            }
          }
        }
      }
    }

    // A sweep is worth nothing if it never ran, and worth little if it only ever took
    // one branch. Both are asserted: the count, and that the way off the list was
    // genuinely exercised rather than sitting behind a condition no fixture could meet.
    expect(seen).toBe(dates.length ** 2 * 2 * outcomes.length ** 2 * counts.length);
    expect(offTheList).toBeGreaterThan(0);
    expect(worklistBlocks).toHaveLength(5);
  });
});
