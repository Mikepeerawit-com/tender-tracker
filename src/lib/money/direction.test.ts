import { describe, expect, it } from "vitest";

import { locales, type Locale } from "@/i18n/config";
import {
  directionOf,
  moneyDirections,
  type DirectionTone,
  type MoneyDirection,
} from "@/lib/money/direction";

/**
 * Which way a figure went, and what colour that is in the language the screen is being
 * read in.
 *
 * **The rule is pinned as a table of cases, and nothing here samples a rendered colour.**
 * A test that read a computed hue off the DOM would be testing the token file — which
 * ADR-0023 deliberately leaves free to move — and would say nothing about the only thing
 * that must not move: which case maps to which direction, in which locale. The table
 * below is that rule, written out.
 *
 * It runs in the `server` project because the module is arithmetic and a lookup: no
 * browser, no database, and no component in between it and the claim.
 */

/** Amount, locale — direction, tone. The whole rule, one row per case. */
const cases: {
  amount: number;
  locale: Locale;
  direction: MoneyDirection;
  tone: DirectionTone;
}[] = [
  // A gain is red where a gain has always been red, and green where it has always been
  // green. This is the inversion the whole module exists for.
  { amount: 80, locale: "en", direction: "gain", tone: "green" },
  { amount: 80, locale: "zh-Hans", direction: "gain", tone: "red" },
  { amount: -80, locale: "en", direction: "loss", tone: "red" },
  { amount: -80, locale: "zh-Hans", direction: "loss", tone: "green" },

  // Zero went nowhere, so it is toned in neither convention and there is nothing for the
  // two locales to disagree about.
  { amount: 0, locale: "en", direction: "flat", tone: "none" },
  { amount: 0, locale: "zh-Hans", direction: "flat", tone: "none" },
  // Selling at exactly the landed cost is how this arrives in practice, and JavaScript
  // hands it back as -0 whenever the subtraction lands that way round.
  { amount: -0, locale: "en", direction: "flat", tone: "none" },
  { amount: -0, locale: "zh-Hans", direction: "flat", tone: "none" },

  // A hundredth of a baht is still a gain. There is no "near enough to zero" band: a
  // band would be a threshold nobody chose, sitting between two figures that differ.
  { amount: 0.01, locale: "en", direction: "gain", tone: "green" },
  { amount: -0.01, locale: "zh-Hans", direction: "loss", tone: "green" },
];

describe.each(cases)(
  "$amount in $locale",
  ({ amount, locale, direction, tone }) => {
    it(`is a ${direction}, toned ${tone}`, () => {
      expect(directionOf(amount, locale)).toMatchObject({ direction, tone });
    });
  },
);

describe("the copies of the meaning that survive greyscale", () => {
  it("gives a gain and a loss a glyph and a sign of their own, in every locale", () => {
    // Colour never carries the only copy of a meaning (ADR-0019), and here it carries
    // the *inverted* copy: a reader who cannot see the hue, or who is reading a
    // screenshot in the other convention, has the glyph and the sign instead.
    for (const locale of locales) {
      const gain = directionOf(80, locale);
      const loss = directionOf(-80, locale);

      expect(gain.glyph).not.toBe("");
      expect(loss.glyph).not.toBe("");
      expect(gain.glyph).not.toBe(loss.glyph);

      expect(gain.sign).toBe("+");
      expect(loss.sign).toBe("-");
    }
  });

  it("draws the same glyph and sign for a gain whichever language it is read in", () => {
    // The hue inverts and nothing else does. A glyph that pointed the other way in
    // `zh-Hans` would leave a screenshot saying two things at once.
    expect(directionOf(80, "en").glyph).toBe(directionOf(80, "zh-Hans").glyph);
    expect(directionOf(80, "en").sign).toBe(directionOf(80, "zh-Hans").sign);
  });

  it("marks a figure that went nowhere with neither", () => {
    for (const locale of locales) {
      expect(directionOf(0, locale)).toMatchObject({ glyph: "", sign: "" });
    }
  });
});

describe("the magnitude is formatted separately", () => {
  it("leaves the sign out of the figure, so a loss is never signed twice", () => {
    // The component formats `Math.abs(amount)` and puts this sign in front of it. If the
    // sign came from the formatter as well, a loss would read `-฿-80`.
    const loss = directionOf(-80, "en");

    expect(loss.sign).toBe("-");
    expect(loss.direction).toBe("loss");
  });
});

describe("the direction catalogue", () => {
  it("holds every direction a figure can be, and nothing else", () => {
    // Walked rather than listed, so a fourth direction cannot ship without the wording
    // that names it out loud — `messages.test.ts` reads this same list.
    expect([...moneyDirections].sort()).toEqual(["flat", "gain", "loss"]);
  });

  it("gives every locale the app ships an answer", () => {
    // The mapping is keyed by `Locale`, so a third locale is a type error rather than a
    // figure that silently comes back untoned. This is the runtime half of that.
    for (const locale of locales) {
      expect(directionOf(80, locale).tone).not.toBe("none");
    }
  });
});
