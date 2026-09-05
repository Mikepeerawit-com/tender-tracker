import { describe, expect, it } from "vitest";

import {
  activeView,
  everything,
  isFiltering,
  landingFilter,
  matchesFilter,
  parseWorklistFilter,
  toggleProgress,
  withFilter,
  worklistFilterQuery,
  worklistViews,
  type WorklistFilter,
} from "@/lib/tenders/worklist-filter";

/**
 * The reduce bar's rules, tested as arithmetic.
 *
 * The filter is a pure predicate over a row precisely so that it can be tested here
 * rather than through a screen — the same split `@/lib/tenders/progress` already makes,
 * and for the same reason: a rule that can only be exercised by rendering something is a
 * rule whose edge cases nobody writes down.
 */

const row = {
  reference: "TR-2026-0142",
  clientName: "Bangkok Metropolitan Administration",
  title: "Medical consumables, Q3 2026",
  ownerUserId: "user-somchai",
  assigneeUserIds: ["user-nok"],
  progress: "sourcing" as const,
  notYetSourced: 0,
};

/**
 * One axis at a time, built out from **Everything** rather than from the landing state,
 * so that a test about Progress is not also silently a test about Mine.
 */
const filter = (over: Partial<WorklistFilter> = {}): WorklistFilter => ({
  ...everything,
  ...over,
});

describe("mine", () => {
  it("keeps a Tender the reader owns", () => {
    expect(matchesFilter(row, filter({ mine: true }), "user-somchai")).toBe(true);
  });

  it("keeps a Tender the reader is sourcing but does not own", () => {
    expect(matchesFilter(row, filter({ mine: true }), "user-nok")).toBe(true);
  });

  it("drops a Tender the reader is neither Owner nor Assignee on", () => {
    expect(matchesFilter(row, filter({ mine: true }), "user-pim")).toBe(false);
  });

  /**
   * The fail-closed direction, and the same answer `ownsTender` gives to the same
   * question. A reader we cannot identify seeing *everybody's* work would be the one
   * reading of Mine that is never right.
   */
  it("matches nothing rather than everything when the reader is unknown", () => {
    expect(matchesFilter(row, filter({ mine: true }), null)).toBe(false);
  });

  it("does not consult the reader at all when it is off", () => {
    expect(matchesFilter(row, filter({ mine: false }), null)).toBe(true);
  });
});

describe("text", () => {
  it("finds a reference", () => {
    expect(matchesFilter(row, filter({ text: "0142" }), null)).toBe(true);
  });

  it("finds a client regardless of case", () => {
    expect(matchesFilter(row, filter({ text: "BANGKOK" }), null)).toBe(true);
  });

  it("finds a title", () => {
    expect(matchesFilter(row, filter({ text: "consumables" }), null)).toBe(true);
  });

  it("drops a row nothing in it matches", () => {
    expect(matchesFilter(row, filter({ text: "syringe" }), null)).toBe(false);
  });

  /**
   * Half this app's readers type Han, which has no spaces in it. A word-boundary test
   * would find nothing at all in `zh-Hans` — this is why the match is a substring.
   */
  it("finds a Han substring with no spaces around it", () => {
    const han = { ...row, clientName: "曼谷市政管理局", title: "医疗耗材" };

    expect(matchesFilter(han, filter({ text: "医疗" }), null)).toBe(true);
    expect(matchesFilter(han, filter({ text: "市政" }), null)).toBe(true);
  });

  it("ignores surrounding whitespace, which a phone keyboard adds freely", () => {
    expect(matchesFilter(row, filter({ text: "  0142  " }), null)).toBe(true);
  });
});

describe("progress and sourcing", () => {
  it("treats an empty Progress list as every Progress, never as none", () => {
    expect(matchesFilter(row, filter({ progress: [] }), null)).toBe(true);
  });

  it("keeps a row whose Progress is one of several asked for", () => {
    expect(matchesFilter(row, filter({ progress: ["new", "sourcing"] }), null)).toBe(true);
  });

  it("drops a row whose Progress was not asked for", () => {
    expect(matchesFilter(row, filter({ progress: ["submitted"] }), null)).toBe(false);
  });

  it("drops a fully answered Tender under Not Yet Sourced", () => {
    expect(matchesFilter(row, filter({ notYetSourced: true }), null)).toBe(false);
  });

  it("keeps a Tender with an Item nobody has answered for", () => {
    const open = { ...row, notYetSourced: 2 };

    expect(matchesFilter(open, filter({ notYetSourced: true }), null)).toBe(true);
  });

  it("narrows on every axis at once rather than on the last one set", () => {
    const both = filter({ mine: true, progress: ["sourcing"], text: "0142" });

    expect(matchesFilter(row, both, "user-nok")).toBe(true);
    // Same filter, and only the Progress test now fails.
    expect(matchesFilter({ ...row, progress: "quoted" }, both, "user-nok")).toBe(false);
  });

  /**
   * The one field that widens is not read here at all. Putting a suppressed row back is
   * a rule about one pinned group, and this predicate is blind to which group a row is
   * in — `listWorklist` is where that lives.
   */
  it("is unmoved by revealMissed, which is not its business", () => {
    const hidden = filter({ mine: true, revealMissed: true });

    expect(matchesFilter(row, hidden, "user-pim")).toBe(false);
  });
});

describe("reading a filter out of a URL", () => {
  /**
   * The asymmetry that makes Mine the landing state: no params means Mine, and
   * Everything has to say so. ADR-0025 — with fifty live Tenders, a screen whose first
   * answer to *what do I do next* is everybody's work has answered a different question.
   */
  it("reads Mine, not Everything, from no params at all", () => {
    expect(parseWorklistFilter({})).toEqual(landingFilter);
  });

  it("reads Everything only when the URL asks for it", () => {
    expect(parseWorklistFilter({ mine: "0" })).toEqual(everything);
  });

  it("reads every key", () => {
    expect(
      parseWorklistFilter({
        mine: "0",
        q: "gloves",
        progress: "new,quoted",
        not_yet_sourced: "1",
        missed: "1",
      }),
    ).toEqual({
      mine: false,
      text: "gloves",
      progress: ["new", "quoted"],
      notYetSourced: true,
      revealMissed: true,
    });
  });

  it("reads a repeated key as well as a comma-joined one", () => {
    expect(parseWorklistFilter({ progress: ["new", "quoted"] }).progress).toEqual([
      "new",
      "quoted",
    ]);
  });

  /**
   * These arrive from a link somebody may have hand-edited or a chat client may have
   * truncated. A reader who opens one should get a list, not a stack trace — and for
   * Mine the safe fallback is the default, so anything that is not the literal `0` reads
   * as on.
   */
  it("falls back to the default on a value it cannot read", () => {
    const parsed = parseWorklistFilter({ mine: "nobody", progress: "airborne" });

    expect(parsed.mine).toBe(true);
    expect(parsed.progress).toEqual([]);
  });

  it("drops a duplicated Progress so nothing is tested twice", () => {
    expect(parseWorklistFilter({ progress: "new,new,quoted" }).progress).toEqual([
      "new",
      "quoted",
    ]);
  });

  it("caps the text at a length a URL can carry", () => {
    expect(parseWorklistFilter({ q: "x".repeat(500) }).text).toHaveLength(100);
  });

  /**
   * Trimmed before the cap, not after. A phone keyboard adds a leading space freely, and
   * a cap applied first would spend it on whitespace and cut the reader's last character
   * off instead.
   */
  it("does not spend the cap on whitespace a keyboard added", () => {
    expect(parseWorklistFilter({ q: `   ${"x".repeat(100)}` }).text).toHaveLength(100);
  });

  /** Cut on code points, so the hundredth character cannot be half a surrogate pair. */
  it("does not cut a character in half at the cap", () => {
    const text = parseWorklistFilter({ q: "🧤".repeat(200) }).text;

    expect([...text]).toHaveLength(100);
    expect(text).not.toContain("\uFFFD");
  });
});

describe("writing a filter back into a URL", () => {
  it("writes nothing at all for the list a reader lands on", () => {
    expect(worklistFilterQuery(landingFilter)).toBe("");
  });

  /** The one key written for being *off*, because the default it leaves is Mine. */
  it("writes Everything as a step away from Mine", () => {
    expect(worklistFilterQuery(everything)).toBe("?mine=0");
  });

  /**
   * The same filter must always produce the same string, or two readers comparing links
   * end up comparing the spelling instead of the filter.
   */
  it("writes Progress in the canonical order rather than the clicked order", () => {
    const clicked = filter({ mine: true, progress: ["submitted", "new"] });

    expect(worklistFilterQuery(clicked)).toBe("?progress=new%2Csubmitted");
  });

  it("round-trips a filter through a query string unchanged", () => {
    const original = filter({ text: "gloves", notYetSourced: true, revealMissed: true });
    const query = worklistFilterQuery(original);
    const params = Object.fromEntries(new URLSearchParams(query.slice(1)));

    expect(parseWorklistFilter(params)).toEqual(original);
  });
});

describe("views", () => {
  it("lights the View whose filter the reader is looking at", () => {
    expect(activeView(landingFilter)).toBe("mine");
    expect(activeView(everything)).toBe("everything");
  });

  /**
   * The screen says what is true of the list, never which route the reader took to it —
   * so a filter assembled control by control lights the View it happens to equal.
   */
  it("lights a View reached through the individual controls", () => {
    expect(activeView(toggleProgress(everything, "submitted"))).toBe("submitted");
    expect(activeView(withFilter(everything, { notYetSourced: true }))).toBe(
      "notYetSourced",
    );
  });

  it("lights nothing for a filter no View expresses", () => {
    expect(activeView(filter({ mine: true, text: "gloves" }))).toBe(null);
  });

  /**
   * Revealing the hidden missed submissions widens one pinned group; it does not change
   * which View is being read, and a Mine chip that went dark for it would be saying the
   * reader had left Mine.
   */
  it("keeps the View lit when the missed submissions are revealed", () => {
    expect(activeView(withFilter(landingFilter, { revealMissed: true }))).toBe("mine");
  });

  /**
   * Two Views cannot both be true of one list, so only Mine carries `mine` — the other
   * three are org-wide. A Not Yet Sourced View that kept Mine on would light two chips
   * and leave the reader unable to tell which one they were reading.
   */
  it("has no two Views that are the same filter", () => {
    const queries = worklistViews.map((view) => worklistFilterQuery(view.filter));

    expect(new Set(queries).size).toBe(worklistViews.length);
  });

  it("every View round-trips through a URL", () => {
    for (const view of worklistViews) {
      const query = worklistFilterQuery(view.filter);
      const params = Object.fromEntries(new URLSearchParams(query.slice(1)));

      expect(parseWorklistFilter(params)).toEqual(view.filter);
    }
  });
});

describe("isFiltering", () => {
  /**
   * Measured against Everything, so the list a reader *lands* on counts as filtered.
   * That is the cost ADR-0025 names for defaulting to Mine: an already-narrowed list
   * that did not say so would be the one case where the count matters most.
   */
  it("is false only for Everything, and true for the landing state", () => {
    expect(isFiltering(everything)).toBe(false);
    expect(isFiltering(landingFilter)).toBe(true);
  });

  it("is true for each narrowing on its own", () => {
    expect(isFiltering(filter({ mine: true }))).toBe(true);
    expect(isFiltering(filter({ text: "gloves" }))).toBe(true);
    expect(isFiltering(filter({ progress: ["new"] }))).toBe(true);
    expect(isFiltering(filter({ notYetSourced: true }))).toBe(true);
  });

  /** It widens rather than narrows, so it is not a reason to draw the count and Clear. */
  it("is false for revealMissed on its own", () => {
    expect(isFiltering(filter({ revealMissed: true }))).toBe(false);
  });

  /** Whitespace is not a filter, and a phone keyboard produces it by accident. */
  it("is false for text that is only whitespace", () => {
    expect(isFiltering(filter({ text: "   " }))).toBe(false);
  });
});

describe("toggleProgress", () => {
  it("adds one that was not there and removes one that was", () => {
    const on = toggleProgress(everything, "new");

    expect(on.progress).toEqual(["new"]);
    expect(toggleProgress(on, "new").progress).toEqual([]);
  });

  it("leaves every other part of the filter alone", () => {
    const original = filter({ mine: true, text: "gloves" });
    const toggled = toggleProgress(original, "new");

    expect(toggled.mine).toBe(true);
    expect(toggled.text).toBe("gloves");
  });
});
