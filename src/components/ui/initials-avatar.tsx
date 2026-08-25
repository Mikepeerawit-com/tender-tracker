/**
 * A person, as one small coloured disc of initials.
 *
 * It exists because of what "sourced by" is for. Under ADR-0004 several Assignees work
 * the same Tender through their own suppliers, so two Quotes from the same supplier at
 * different prices are normal and correct, and the only thing telling those two rows
 * apart is whose they are. On a phone that fact has to survive being one line inside a
 * card rather than a column of its own, and a name alone in grey text is the first thing
 * the eye skips.
 *
 * **Decorative, and marked so.** The name is always rendered beside it, so the disc is
 * `aria-hidden` and carries no accessible name of its own — a screen reader that read the
 * initials as well would say every Assignee's name twice.
 *
 * The colour is derived from the name and stored nowhere. It is a way of telling two
 * people apart at a glance rather than a property of either of them, and there is no
 * per-user colour to pick, migrate, or keep unique.
 */
export function InitialsAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="inline-grid size-5 shrink-0 place-items-center rounded-full text-[0.6rem] font-semibold text-white"
      style={{ backgroundColor: `oklch(0.48 0.13 ${hue(name)})` }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * One character per name part, and never more than two.
 *
 * The first character of the first and last word, which gives "SP" for *Somchai P.* and
 * "WZ" for *Wei Zhang*. A single-word name contributes one character rather than two, so
 * that 王伟 renders as 王 — two full-width characters do not fit a 20px disc, and a name
 * clipped in half reads as a rendering fault rather than as an initial.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");

  if (words.length === 0) return "?";

  const first = firstCharacter(words[0]);
  const last = words.length === 1 ? "" : firstCharacter(words[words.length - 1]);

  return (first + last).toUpperCase();
}

/** By code point, not by `charAt` — an emoji or a surrogate pair is one character. */
function firstCharacter(word: string): string {
  return [...word][0] ?? "";
}

/** A stable hue per name. Any spread will do; what matters is that it never moves. */
function hue(name: string): number {
  let hash = 0;

  for (const character of name) {
    hash = (hash * 31 + character.codePointAt(0)!) % 360;
  }

  return hash;
}
