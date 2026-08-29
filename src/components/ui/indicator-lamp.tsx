import type { LampTone } from "@/lib/tenders/progress";

/**
 * The one device this design is remembered by: same shape, same meaning, on every screen.
 *
 * A ringed circle, filled when lit and **drawn hollow rather than omitted when calm**.
 * That is the whole reason it exists as a component: if a calm row simply had no lamp,
 * every row would change width as its urgency changed and the eye would be pulled by
 * rows resizing rather than by what they say. A calm row and an urgent row are the same
 * shape; only the fill differs.
 *
 * **Colour is never the only copy of the meaning** (ADR-0019). This is `aria-hidden` and
 * always sits beside a sentence that says the same thing in words — "Quotes due
 * tomorrow", "Deadline passed 6 days ago". A reader in sunlight, in greyscale, or who is
 * colour-blind loses nothing but the emphasis, and a screen reader is told once rather
 * than twice.
 *
 * The hue is reached through the tokens rather than written as a value, so the three
 * meanings stay the three meanings the token file names.
 */
export function IndicatorLamp({
  tone,
  size = 14,
}: {
  tone: LampTone;
  /** Pixels. The row draws it at 14 and a band heading at 15 — see the canvas. */
  size?: number;
}) {
  const hue =
    tone === "alarm"
      ? "var(--alarm)"
      : tone === "signal"
        ? "var(--signal)"
        : "var(--ink-faint)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="5.6" stroke={hue} strokeWidth="1.5" />
      {tone === "calm" ? null : <circle cx="8" cy="8" r="2.6" fill={hue} />}
    </svg>
  );
}
