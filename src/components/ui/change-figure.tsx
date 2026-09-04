import { useFormatter, useLocale, useTranslations } from "next-intl";

import { defaultLocale, isLocale } from "@/i18n/config";
// From the currency list rather than from `@/lib/quotes/quotes`, which re-exports it:
// this renders inside a client component on the working sheet, and that module is
// `server-only`.
import { reportingCurrency } from "@/lib/fx/currencies";
import { directionOf, type DirectionTone } from "@/lib/money/direction";
import { cn } from "@/lib/utils";

/**
 * A figure that is a *change*, drawn so that it says which way it went three times over.
 *
 * A glyph, an explicit sign and a hue — and the hue is the only one of the three that
 * moves with the language the screen is rendered in (ADR-0023). A gain is red in
 * `zh-Hans` and green in `en`; the triangle points the same way in both, and the `+` is a
 * `+` in both. That is what makes the figure survive a greyscale print, sunlight, a
 * colour-blind reader, and — on the Tender detail in `zh-Hans` — sitting a few
 * centimetres from a passed deadline drawn in a red of its own.
 *
 * **Only a change gets one of these.** A unit price, a line total, a Bid total and a
 * Landed Cost are amounts of money rather than movements of it, and they stay plain
 * `.money` ink. Colour on a figure means direction, always, or a reader has to know which
 * kind of figure they are looking at before the hue tells them anything.
 *
 * **The magnitude is formatted unsigned and the sign is put in front of it.** Leaving the
 * sign to `Intl` would give a loss two of them, and would give a gain none at all — and
 * the `+` is one of the three copies of the meaning rather than decoration.
 *
 * There is no test of this component's own, deliberately: the rule it draws is pinned as
 * a table of cases over `@/lib/money/direction`, where it needs neither a browser nor a
 * rendered colour to assert, and how it *looks* is a matter for the contact sheet.
 */
export function ChangeFigure({
  amount,
  maximumFractionDigits,
}: {
  amount: number;
  /** The totals bar rounds to whole baht; a per-Item figure does not. */
  maximumFractionDigits?: number;
}) {
  const t = useTranslations("money.direction");
  const format = useFormatter();
  const rendered = useLocale();
  // The locale this screen was rendered in — never a preference of the reader's, which is
  // the whole of ADR-0023.
  //
  // The fallback is unreachable rather than a policy: `getLocale` only ever returns a
  // value `isLocale` has already accepted, and every test provider is given one of the
  // two. It exists because `useLocale` is typed as a plain `string`, and narrowing beats
  // asserting — but it is not an answer to "what convention does an unknown language
  // read in", and nothing should start relying on it for one.
  const locale = isLocale(rendered) ? rendered : defaultLocale;

  const change = directionOf(amount, locale);

  return (
    <span className={cn("money text-base font-medium", toneClass[change.tone])}>
      {change.glyph === "" ? null : (
        // Aria-hidden, because the word beside it says the same thing and a screen
        // reader should be told once. A shade smaller than the digits so it marks the
        // figure rather than competing with it.
        <span aria-hidden="true" className="mr-0.5 text-[0.78em] align-baseline">
          {change.glyph}
        </span>
      )}

      {/* The glyph's accessible name, and the flat case's only marking. */}
      <span className="sr-only">{t(change.direction)} </span>

      {/* One text run, so the sign and the digits cannot be separated by a line break. */}
      <span className="whitespace-nowrap">
        {change.sign}
        {format.number(Math.abs(amount), {
          style: "currency",
          currency: reportingCurrency,
          maximumFractionDigits,
        })}
      </span>
    </span>
  );
}

/**
 * Which token the tone reaches for.
 *
 * Written out rather than interpolated so that the class names are literals a build can
 * see — and so that a fourth tone has exactly one place to be drawn wrong.
 */
const toneClass: Record<DirectionTone, string> = {
  red: "text-money-red",
  green: "text-money-green",
  // A figure that went nowhere takes ordinary ink. Colouring it would be colouring the
  // absence of a direction.
  none: "",
};
