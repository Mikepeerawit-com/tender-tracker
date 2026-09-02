/**
 * The arrow at the end of a row that opens something.
 *
 * `aria-hidden`, because the row is already a link and its text already says where it
 * goes — the chevron is the affordance, not a second copy of the destination.
 *
 * One copy, drawn by both of the app's two list rows: a Tender on the worklist and an
 * Item on My work (ADR-0021). Sixteen lines of `<path>` retyped beside the second list
 * is how the two come to point in different directions.
 */
export function RowChevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-border mt-3 shrink-0"
    >
      <path
        d="M9 5l7 7-7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
