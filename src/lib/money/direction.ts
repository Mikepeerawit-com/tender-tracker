import type { Locale } from "@/i18n/config";

/**
 * Which way a *change* figure went, and what colour that is in the language the screen is
 * being rendered in.
 *
 * A Margin is the change figure this app has; the module is written for the kind rather
 * than the instance, because the rule is about what a signed difference means and not
 * about profit in particular. **An absolute price is not a change** — a unit price, a
 * line total, a Bid total and a Landed Cost are amounts of money rather than movements of
 * it, and nothing here is applied to one. Colour on a figure means direction, always, or
 * the reader has to know which kind of figure they are looking at before the hue helps.
 *
 * **The hue follows the rendered locale, and there is no per-reader override**
 * (ADR-0023). In Chinese financial convention red is up and green is down — the inverse
 * of the Western reading — and this app is read daily by colleagues on both sides of
 * that. A screenshot pasted into a WeCom group has to mean one thing to whoever opens it,
 * and a screenshot carries no toggle inside it, so the convention belongs to the screen
 * that was rendered rather than to the person who rendered it.
 *
 * **The hue is never the only copy of the meaning.** Every directed figure also carries a
 * glyph and an explicit sign, which are the same in both locales and survive a greyscale
 * print, sunlight, and a colour-blind reader — and, on the Tender detail, keep a gain in
 * `zh-Hans` apart from the passed deadline drawn in the same family of red beside it.
 *
 * Arithmetic and a lookup. **No markup, no styling and no formatting** — the glyph and
 * the sign are here because they are part of the *rule* rather than part of the drawing
 * of it (a triangle that pointed the other way in one locale would be a second
 * convention), while the class, the hue and the digits belong to `ChangeFigure`. That is
 * what lets the rule be pinned as a table of cases rather than by sampling a colour off a
 * screen: the token values stay free to move, and what is asserted is which case means
 * what.
 */

/** Every way a change figure can have gone. */
export const moneyDirections = ["gain", "loss", "flat"] as const;

export type MoneyDirection = (typeof moneyDirections)[number];

/**
 * Which of the two direction hues the figure is drawn in, or neither.
 *
 * **Named by hue rather than by meaning, which is the one place in this codebase that is
 * right.** Every other token says what it means — signal, alarm, flag — because the
 * meaning is fixed and the value is free. Here it is the other way round: the hue is the
 * fixed thing and *what it means is decided by the reader's language*, so a name like
 * `favourable` would be true in one locale and false in the other. The naming is the
 * decision, not an oversight.
 */
export type DirectionTone = "red" | "green" | "none";

/** A directed figure: which way it went, and the three ways the screen says so. */
export type MoneyChange = {
  direction: MoneyDirection;
  tone: DirectionTone;
  /** Drawn beside the figure and never alone. Empty for a figure that went nowhere. */
  glyph: string;
  /**
   * Put in front of the figure's magnitude, which is formatted unsigned.
   *
   * The sign is here rather than left to `Intl`'s `signDisplay` because it is one of the
   * three copies of the meaning and has to be as deliberate as the other two — and
   * because a formatter that also signed the number would sign a loss twice.
   */
  sign: string;
};

/**
 * Which hue a *gain* takes, per locale.
 *
 * Keyed by `Locale` on purpose: a third language cannot be added without someone deciding
 * which convention it reads in, and TypeScript is what asks. A loss takes the other hue,
 * always — the two conventions disagree about which way round the pair goes and about
 * nothing else.
 */
const gainTone: Record<Locale, Exclude<DirectionTone, "none">> = {
  en: "green",
  "zh-Hans": "red",
};

const glyphs: Record<MoneyDirection, string> = {
  // Solid triangles rather than arrows: they are the shape a financial figure carries in
  // both conventions, and they read at the 10.5px a totals bar gives them.
  gain: "▲",
  loss: "▼",
  flat: "",
};

const signs: Record<MoneyDirection, string> = {
  gain: "+",
  loss: "-",
  flat: "",
};

/** The hue a direction takes when it is not the one the locale gives a gain. */
const opposite: Record<Exclude<DirectionTone, "none">, DirectionTone> = {
  green: "red",
  red: "green",
};

/**
 * What a change figure of this size, read in this language, says about itself.
 *
 * Zero is `flat` and is toned in neither convention — it went nowhere, and there is
 * nothing for the two readings to disagree about. There is deliberately no
 * "near enough to zero" band around it: a band is a threshold nobody chose, sitting
 * between two figures that genuinely differ.
 */
export function directionOf(amount: number, locale: Locale): MoneyChange {
  const direction = directionFrom(amount);

  return {
    direction,
    tone: toneOf(direction, locale),
    glyph: glyphs[direction],
    sign: signs[direction],
  };
}

function directionFrom(amount: number): MoneyDirection {
  if (amount > 0) return "gain";
  if (amount < 0) return "loss";

  // Zero, and `-0` with it — which is what the subtraction hands back whenever a selling
  // price lands exactly on the landed cost, and which is not a loss.
  return "flat";
}

function toneOf(direction: MoneyDirection, locale: Locale): DirectionTone {
  if (direction === "flat") return "none";

  const gain = gainTone[locale];

  return direction === "gain" ? gain : opposite[gain];
}
