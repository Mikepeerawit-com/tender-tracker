import { describe, expect, it } from "vitest";

import { worklistGroup, type ClassifiedTender } from "@/lib/tenders/progress";
import type { ItemOutcome } from "@/lib/tenders/outcome";

import { digestLines, isOpen, nextMilestone, type DigestTender } from "./digest";

/**
 * What the Digest says, as arithmetic.
 *
 * The interesting cases are combinations rather than journeys — a Tender submitted with
 * no chase date, a client deadline that went by with nothing sent, a Tender the client
 * part-decided — and every one of them is worth stating as a fixture rather than staged
 * as a Tender. What the run actually posts, Digest included, is asserted end-to-end in
 * `@/lib/reminders/send.test.ts`, which is where the cron and the robot stub live.
 */

const today = "2026-08-10";

function aTender(shape: Partial<DigestTender> = {}): DigestTender {
  return {
    reference: "T-1042",
    client: "Bangkok General Hospital",
    title: "Surgical consumables Q3",
    submittedAt: null,
    internalQuoteDeadline: "2026-08-25",
    clientSubmissionDeadline: "2026-09-01",
    expectedDecisionDate: null,
    items: [{ outcome: null }],
    ...shape,
  };
}

describe("the milestone a Tender is heading for", () => {
  it("is the internal deadline while that is still ahead", () => {
    expect(nextMilestone(aTender(), today)).toEqual({
      milestone: "internal_quote",
      date: "2026-08-25",
    });
  });

  it("counts a deadline falling today as still ahead", () => {
    // The cron runs at 08:00 Bangkok, and at 08:00 on the day itself the work can still
    // be done. Treating today as behind us would announce a miss every morning somebody
    // was still working on it.
    expect(
      nextMilestone(aTender({ internalQuoteDeadline: today }), today),
    ).toMatchObject({ milestone: "internal_quote" });
  });

  it("moves on to the client deadline once the internal one has gone", () => {
    expect(
      nextMilestone(aTender({ internalQuoteDeadline: "2026-08-01" }), today),
    ).toEqual({ milestone: "client_submission", date: "2026-09-01" });
  });

  it("is the miss once the client deadline goes by with nothing sent", () => {
    // The loudest thing this app says, and it outranks any date still on the calendar.
    expect(
      nextMilestone(
        aTender({
          internalQuoteDeadline: "2026-08-01",
          clientSubmissionDeadline: "2026-08-05",
        }),
        today,
      ),
    ).toEqual({ milestone: "submission_missed", date: "2026-08-05" });
  });

  it("is the Owner's chase date once the Bid has gone out", () => {
    expect(
      nextMilestone(
        aTender({ submittedAt: "2026-08-08T03:00:00Z", expectedDecisionDate: "2026-09-20" }),
        today,
      ),
    ).toEqual({ milestone: "decision_chase", date: "2026-09-20" });
  });

  it("is nothing at all when the Bid is out and no chase date was set", () => {
    // Open, and dated by nothing. A guessed date would send somebody to the client on a
    // day nobody ever claimed, which is worse than the admitted blank.
    expect(nextMilestone(aTender({ submittedAt: "2026-08-08T03:00:00Z" }), today)).toBe(
      null,
    );
  });

  it("says nothing about a deadline that has gone by on a submitted Tender", () => {
    // Its client deadline was met; there is no miss to announce and no countdown left.
    expect(
      nextMilestone(
        aTender({
          submittedAt: "2026-08-08T03:00:00Z",
          internalQuoteDeadline: "2026-08-01",
          clientSubmissionDeadline: "2026-08-05",
        }),
        today,
      ),
    ).toBe(null);
  });
});

describe("which Tenders the Digest lists", () => {
  it("leaves out one whose Outcome has been recorded", () => {
    const lines = digestLines(
      [aTender(), aTender({ reference: "T-1043", items: [{ outcome: "won" }] })],
      today,
    );

    expect(lines.map((line) => line.reference)).toEqual(["T-1042"]);
  });

  it("keeps one the client has only part-decided", () => {
    // Half an award is still work: the other Item is still out with the client.
    expect(
      digestLines([aTender({ items: [{ outcome: "won" }, { outcome: null }] })], today),
    ).toHaveLength(1);
  });

  /**
   * The definition, held against the one it has to match.
   *
   * "Open" is the tender list's default filter and must not become a second, nearly
   * identical rule — a Tender on somebody's worklist that the morning Digest leaves out
   * is exactly the losing-track the Digest exists to stop.
   */
  it("is exactly the set the tender list shows", () => {
    const outcomes: (ItemOutcome | null)[] = [null, "won", "lost", "no_bid", "cancelled"];
    const shapes = outcomes.flatMap((first) =>
      outcomes.map((second) => [{ outcome: first }, { outcome: second }]),
    );

    for (const items of shapes) {
      for (const submittedAt of [null, "2026-08-08T03:00:00Z"]) {
        for (const clientSubmissionDeadline of ["2026-08-05", "2026-09-01"]) {
          const tender = aTender({ items, submittedAt, clientSubmissionDeadline });
          const classified: ClassifiedTender = {
            submittedAt,
            internalQuoteDeadline: tender.internalQuoteDeadline,
            clientSubmissionDeadline,
            items: items.map((item) => ({
              ...item,
              quoteCount: 0,
              noSupplierFoundCount: 0,
            })),
          };

          expect({ items, submittedAt, open: isOpen(items) }).toEqual({
            items,
            submittedAt,
            open: worklistGroup(classified, today) !== null,
          });
        }
      }
    }
  });
});

describe("the order the Digest reads in", () => {
  it("puts the soonest milestone first and the undated ones last", () => {
    // A Digest is read top-down and abandoned partway, so whatever is nearest has to be
    // in the half that gets read. A Tender waiting on a client is the one state nobody
    // can act on today.
    const lines = digestLines(
      [
        aTender({ reference: "T-3", submittedAt: "2026-08-08T03:00:00Z" }),
        aTender({ reference: "T-2", internalQuoteDeadline: "2026-08-20" }),
        aTender({ reference: "T-1", internalQuoteDeadline: "2026-08-12" }),
      ],
      today,
    );

    expect(lines.map((line) => line.reference)).toEqual(["T-1", "T-2", "T-3"]);
  });

  it("floats a missed submission to the top, because its date is behind us", () => {
    const lines = digestLines(
      [
        aTender({ reference: "T-2", internalQuoteDeadline: "2026-08-12" }),
        aTender({
          reference: "T-1",
          internalQuoteDeadline: "2026-08-01",
          clientSubmissionDeadline: "2026-08-05",
        }),
      ],
      today,
    );

    expect(lines.map((line) => line.reference)).toEqual(["T-1", "T-2"]);
  });

  it("orders two Tenders due the same day the same way every morning", () => {
    const lines = digestLines(
      [aTender({ reference: "T-9" }), aTender({ reference: "T-8" })],
      today,
    );

    expect(lines.map((line) => line.reference)).toEqual(["T-8", "T-9"]);
  });

  it("counts the days to the milestone, from today", () => {
    expect(digestLines([aTender({ internalQuoteDeadline: "2026-08-13" })], today)[0].next)
      .toEqual({ milestone: "internal_quote", date: "2026-08-13", daysLeft: 3 });
  });
});
