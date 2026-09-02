import { describe, expect, it } from "vitest";

import { tenderOutcome } from "./outcome";
import {
  comingUpDeadlines,
  isAwaitingDecision,
  isSourcingOverdue,
  isSubmissionMissed,
  notYetSourcedCount,
  rowStatus,
  sourcingDeadlineStatus,
  tenderProgress,
  worklistGroup,
  worklistGroups,
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
 * window, one Item nobody has started. It reads as Progress `new` with a calm row, so
 * every test below reads as the one change that moves it somewhere.
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

describe("worklistGroup", () => {
  it("pins a dead Tender above its Progress, however far along it looked", () => {
    // Both conditions hold at once, which is ordinary — an unsourced Item is *why* the
    // submission was missed. Submission Missed is tested first so that the one failure
    // this product exists to prevent is never filed as an ordinary row under `sourcing`.
    const both = tender({
      internalQuoteDeadline: "2026-08-05",
      clientSubmissionDeadline: "2026-08-09",
      items: [item({ quoteCount: 1 }), item()],
    });

    expect(isSourcingOverdue(both, today)).toBe(true);
    expect(tenderProgress(both)).toBe("sourcing");
    expect(worklistGroup(both, today)).toBe("submission_missed");
  });

  it("groups a Tender whose sourcing is overdue by its Progress, not its trouble", () => {
    // The trouble did not vanish; it moved onto the row. `rowStatus` is what says it now.
    const overdue = tender({
      internalQuoteDeadline: "2026-08-09",
      clientSubmissionDeadline: "2026-08-14",
      items: [item({ quoteCount: 1 }), item()],
    });

    expect(worklistGroup(overdue, today)).toBe("sourcing");
    expect(rowStatus(overdue, today).tone).toBe("alarm");
  });

  it("groups each Progress under its own heading", () => {
    const sent = tender({
      submittedAt: "2026-08-09T09:00:00Z",
      clientSubmissionDeadline: "2026-08-14",
    });

    expect(worklistGroup(tender(), today)).toBe("new");
    expect(worklistGroup(tender({ items: [item({ quoteCount: 1 }), item()] }), today)).toBe(
      "sourcing",
    );
    expect(worklistGroup(tender({ items: [item({ quoteCount: 1 })] }), today)).toBe(
      "quoted",
    );
    expect(worklistGroup(sent, today)).toBe("submitted");
  });

  it("draws Awaiting Decision and Progress `submitted` as the same set", () => {
    // The whole reason `awaiting_decision` stopped being a heading: on this screen it was
    // not merely similar to Progress `submitted`, it was exactly that set. A Tender with
    // an Outcome has already left the list, so nothing submitted is ever *not* awaiting.
    const sent = tender({ submittedAt: "2026-08-09T09:00:00Z" });

    expect(isAwaitingDecision(sent)).toBe(true);
    expect(worklistGroup(sent, today)).toBe("submitted");
  });

  it("takes a written-off Tender off the list entirely", () => {
    const noBid = tender({ items: [item({ outcome: "no_bid" })] });
    const cancelled = tender({ items: [item({ outcome: "cancelled" })] });

    expect(worklistGroup(noBid, today)).toBeNull();
    expect(worklistGroup(cancelled, today)).toBeNull();
  });

  it("takes a decided Tender off the list, however it was decided", () => {
    const sent = { submittedAt: "2026-08-09T09:00:00Z" };
    const won = tender({ ...sent, items: [item({ outcome: "won" })] });
    const split = tender({
      ...sent,
      items: [item({ outcome: "won" }), item({ outcome: "lost" })],
    });

    expect(worklistGroup(won, today)).toBeNull();
    expect(worklistGroup(split, today)).toBeNull();
  });

  it("keeps a partly-decided Tender that was never sent on the list", () => {
    // One Item pulled by the client, the rest still to bid. It is still work.
    const partly = tender({ items: [item({ outcome: "cancelled" }), item()] });

    expect(worklistGroup(partly, today)).toBe("new");
  });

  it("gives every Tender exactly one group, over every combination there is", () => {
    // The acceptance criterion, proved by exhaustion rather than by example. Three things
    // are asserted at once: that the *only* way off the list is a recorded Outcome, that
    // Submission Missed wins over Progress wherever both apply, and that everything
    // surviving both is grouped by exactly `tenderProgress` and nothing else. Falling
    // through every group while still being live work is how a worklist loses a Tender.
    const dates = ["2026-08-05", today, "2026-08-14", "2026-09-30"];
    const outcomes = [null, "won", "lost", "no_bid", "cancelled"] as const;
    const counts = [0, 1];
    let seen = 0;
    let offTheList = 0;
    let pinned = 0;

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
                const group = worklistGroup(subject, today);

                seen += 1;
                if (group === null) offTheList += 1;
                if (group === "submission_missed") pinned += 1;

                expect(group === null, where).toBe(tenderOutcome(subject.items) !== null);
                expect(group === "submission_missed", where).toBe(
                  isSubmissionMissed(subject, today),
                );

                // Everything still on the list and not pinned is its Progress, exactly.
                if (group !== null && group !== "submission_missed") {
                  expect(group, where).toBe(tenderProgress(subject));
                }
              }
            }
          }
        }
      }
    }

    // A sweep is worth nothing if it never ran, and worth little if it only ever took
    // one branch. All three are asserted: the count, that the way off the list was
    // genuinely exercised, and that the pinned group was reached at all rather than
    // sitting behind a condition no fixture could meet.
    expect(seen).toBe(dates.length ** 2 * 2 * outcomes.length ** 2 * counts.length);
    expect(offTheList).toBeGreaterThan(0);
    expect(pinned).toBeGreaterThan(0);
    expect(worklistGroups).toHaveLength(5);
  });
});

describe("notYetSourcedCount", () => {
  it("counts only Items with neither a Quote nor a No Supplier Found", () => {
    // The third state is the whole point. An Assignee who rang round and reported back
    // has answered; counting them as a gap is how a team learns to ignore the nag.
    const mixed = tender({
      items: [
        item(),
        item(),
        item({ quoteCount: 2 }),
        item({ noSupplierFoundCount: 1 }),
      ],
    });

    expect(notYetSourcedCount(mixed)).toBe(2);
  });

  it("is zero once every Item has been answered for, either way", () => {
    const answered = tender({
      items: [item({ quoteCount: 1 }), item({ noSupplierFoundCount: 1 })],
    });

    expect(notYetSourcedCount(answered)).toBe(0);
  });
});

describe("rowStatus", () => {
  it("says how long ago a missed submission was due", () => {
    const dead = tender({ clientSubmissionDeadline: "2026-08-04" });

    expect(rowStatus(dead, today)).toEqual({
      kind: "submission_missed",
      tone: "alarm",
      days: 6,
    });
  });

  it("counts the unanswered Items once the internal deadline has passed", () => {
    const overdue = tender({
      internalQuoteDeadline: "2026-08-09",
      items: [item({ quoteCount: 1 }), item(), item(), item({ noSupplierFoundCount: 1 })],
    });

    expect(rowStatus(overdue, today)).toEqual({
      kind: "unsourced",
      tone: "alarm",
      count: 2,
      total: 4,
    });
  });

  it("says a Bid is with the client rather than naming a spent deadline", () => {
    // Both dates are behind it and neither means anything any more. What is left is a
    // person to chase, so the row says where the Bid is instead of counting down to
    // something that has already happened.
    const sent = tender({
      submittedAt: "2026-08-09T09:00:00Z",
      internalQuoteDeadline: "2026-08-01",
      clientSubmissionDeadline: "2026-08-09",
    });

    expect(rowStatus(sent, today)).toEqual({ kind: "awaiting_decision", tone: "calm" });
  });

  it("counts down to the soonest deadline still ahead", () => {
    const soon = tender({
      internalQuoteDeadline: "2026-08-11",
      clientSubmissionDeadline: "2026-08-14",
    });

    expect(rowStatus(soon, today)).toEqual({
      kind: "due",
      tone: "signal",
      deadline: "internal_quote",
      days: 1,
    });
  });

  it("moves to the client's deadline once the internal one is behind it", () => {
    // Nothing is unsourced, so this is not overdue — the internal date simply passed with
    // the work done, and the next thing that matters is getting the Bid out.
    const sourced = tender({
      internalQuoteDeadline: "2026-08-08",
      clientSubmissionDeadline: "2026-08-12",
      items: [item({ quoteCount: 1 })],
    });

    expect(rowStatus(sourced, today)).toEqual({
      kind: "due",
      tone: "signal",
      deadline: "client_submission",
      days: 2,
    });
  });

  it("counts a deadline falling today as due today, not as passed", () => {
    const now = tender({ internalQuoteDeadline: today });

    expect(rowStatus(now, today)).toMatchObject({ deadline: "internal_quote", days: 0 });
  });

  it("draws the lamp hollow once the next date is beyond the rolling window", () => {
    // Seven days is inside and eight is outside, which is the boundary `comingUpDays`
    // sets. The lamp is still drawn — hollow, not omitted — so the row keeps its shape.
    const inside = tender({ internalQuoteDeadline: "2026-08-17" });
    const outside = tender({ internalQuoteDeadline: "2026-08-18" });

    expect(rowStatus(inside, today).tone).toBe("signal");
    expect(rowStatus(outside, today).tone).toBe("calm");
  });

  it("states a spent deadline rather than shouting about one somebody has seen", () => {
    // Both dates behind it, never submitted, and off Submission Missed only because an
    // Item carries an Outcome. Somebody has looked at this; it is stated, not alarmed.
    const partly = tender({
      internalQuoteDeadline: "2026-08-01",
      clientSubmissionDeadline: "2026-08-04",
      items: [item({ outcome: "cancelled" }), item()],
    });

    expect(worklistGroup(partly, today)).toBe("new");
    expect(rowStatus(partly, today)).toEqual({
      kind: "due",
      tone: "calm",
      deadline: "client_submission",
      days: -6,
    });
  });

  it("gives every Tender on the list exactly one sentence to say", () => {
    // The row is never blank. A sweep rather than examples, because the fallback that
    // makes this true — the client's deadline when both are spent — is reached by a
    // combination no single fixture reads as obviously.
    const dates = ["2026-08-01", "2026-08-05", today, "2026-08-14", "2026-09-30"];
    const kinds = new Set<string>();

    for (const internalQuoteDeadline of dates) {
      for (const clientSubmissionDeadline of dates) {
        for (const submittedAt of [null, "2026-08-09T09:00:00Z"]) {
          for (const quoteCount of [0, 1]) {
            for (const outcome of [null, "cancelled"] as const) {
              const subject = {
                internalQuoteDeadline,
                clientSubmissionDeadline,
                submittedAt,
                items: [item({ quoteCount }), item({ outcome })],
              };

              if (worklistGroup(subject, today) === null) continue;

              const status = rowStatus(subject, today);

              kinds.add(status.kind);
              expect(status.tone, JSON.stringify(subject)).toMatch(
                /^(alarm|signal|calm)$/,
              );
            }
          }
        }
      }
    }

    // Every reading is genuinely reachable from a real combination, not just declared.
    expect([...kinds].sort()).toEqual([
      "awaiting_decision",
      "due",
      "submission_missed",
      "unsourced",
    ]);
  });
});

describe("sourcingDeadlineStatus", () => {
  // The day everything below is placed around, as everywhere else in this file.
  const today = "2026-08-10";

  it("counts the days to the Assignee's own deadline, forwards and backwards", () => {
    expect(sourcingDeadlineStatus("2026-08-12", today).days).toBe(2);
    expect(sourcingDeadlineStatus("2026-08-10", today).days).toBe(0);
    expect(sourcingDeadlineStatus("2026-08-07", today).days).toBe(-3);
  });

  it("holds the rolling window at seven days, inclusive, and goes quiet beyond it", () => {
    // The boundary a fixture-based test cannot reach twice: the seventh day is still
    // inside the window and the eighth is not, and the difference is one lamp.
    expect(sourcingDeadlineStatus("2026-08-17", today).tone).toBe("signal");
    expect(sourcingDeadlineStatus("2026-08-18", today).tone).toBe("calm");
  });

  it("calls a day already gone by an alarm, because the Item is this reader's and late", () => {
    // Where `rowStatus` reads a spent date as calm, it is talking about a Tender
    // somebody has dealt with. Every row of My work is an Item its reader has not.
    expect(sourcingDeadlineStatus("2026-08-09", today)).toEqual({ tone: "alarm", days: -1 });
    expect(sourcingDeadlineStatus("2026-08-10", today).tone).toBe("signal");
  });
});
