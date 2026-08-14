import { describe, expect, it } from "vitest";

import { calendarDate, calendarDateFormat, isCalendarDate } from "./calendar-date";

describe("isCalendarDate", () => {
  it("accepts a real day", () => {
    expect(isCalendarDate("2026-08-20")).toBe(true);
  });

  it("rejects a day that does not exist", () => {
    // `new Date("2026-02-31")` parses happily and lands on 3 March. A deadline that
    // silently moves eleven days is worse than one that is refused.
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
  });

  it("rejects anything that is not yyyy-mm-dd", () => {
    expect(isCalendarDate("20/08/2026")).toBe(false);
    expect(isCalendarDate("2026-8-20")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("calendarDate", () => {
  // `dateStyle` is locale-shaped, so the day is read back in a fixed layout instead.
  // Only the timezone is under test; the rest of `calendarDateFormat` is presentation.
  const isoDay = (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(calendarDate("2026-08-20"));

  it("renders the day it was given", () => {
    expect(isoDay(calendarDateFormat.timeZone)).toBe("2026-08-20");
  });

  it("is one day early the moment the UTC pin is dropped", () => {
    // The counterexample the pin exists for, asserted so that removing `timeZone: "UTC"`
    // fails here rather than in a reader's evening six weeks from now. A deadline shown
    // a day early is the failure this app exists to prevent, wearing a disguise.
    expect(isoDay("America/Los_Angeles")).toBe("2026-08-19");
  });
});
