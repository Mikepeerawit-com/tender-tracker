/**
 * Who is looking at this Tender, and therefore which screen they get.
 *
 * ADR-0020 introduced the first visibility tier in the app: on a Tender they are an
 * Assignee but not the Owner of, a user sees their own Quotes and no money at all. The
 * tier is Owner-versus-everybody-else on **one Tender** — never a rank in the
 * organisation, which is why nothing here asks about `is_org_admin`. An Org Admin looking
 * at somebody else's Tender is a reader like any other, exactly as `mayCorrectQuote` has
 * it, and that is the sentence this file exists to make hard to write differently twice.
 *
 * It is deliberately *not* `server-only`. The Tender detail asks it on the server, the
 * item sourcing screen asks it on the server, and the components that draw either have to
 * be mountable in a browser test — the same reason `mayCorrectQuote` lives outside
 * `@/lib/quotes/quotes`.
 *
 * **This is not what makes anything safe.** It shapes what a loader returns, so that the
 * hidden data is absent from the payload rather than present behind a flag. Org isolation
 * is RLS's job and stays entirely RLS's job.
 */

/**
 * Does this reader own this Tender?
 *
 * Two arguments and neither is a role. `ownerUserId` is nullable because the Tender may
 * not have been read at all — a bad link, or another org's id, which RLS makes the same
 * answer — and a Tender nobody can read is nobody's to own. Answering `false` there is
 * what makes the reduced screen the fail-closed default.
 */
export function ownsTender({
  ownerUserId,
  callerId,
}: {
  /** The Tender's `owner_user_id`; null when the Tender could not be read. */
  ownerUserId: string | null;
  callerId: string;
}): boolean {
  return ownerUserId !== null && ownerUserId === callerId;
}
