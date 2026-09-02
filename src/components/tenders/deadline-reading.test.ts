import { describe, expect, it } from "vitest";

import { deadlineReading } from "./deadline-reading";

/**
 * All four readings, because all four are words somebody sees.
 *
 * This exists as its own suite for the reason the module exists at all: the ladder is
 * shared by the worklist's row and My work's, and a branch nothing exercises is a branch
 * either screen could lose without a test going red (ADR-0016). Rendering one of them
 * through a component covers `tomorrow` and leaves the other three unwatched.
 *
 * The boundaries are the whole of it — 0 and 1 are words rather than dates, and the step
 * from 1 to 2 is where "tomorrow" stops being true.
 */
describe("deadlineReading", () => {
  it("reads a day already gone by as passed, however far back", () => {
    expect(deadlineReading(-1)).toBe("passed");
    expect(deadlineReading(-128)).toBe("passed");
  });

  it("reads the day itself as today and the next as tomorrow", () => {
    expect(deadlineReading(0)).toBe("today");
    expect(deadlineReading(1)).toBe("tomorrow");
  });

  it("names a date from two days out, where no single word is true any more", () => {
    expect(deadlineReading(2)).toBe("on");
    expect(deadlineReading(49)).toBe("on");
  });
});
