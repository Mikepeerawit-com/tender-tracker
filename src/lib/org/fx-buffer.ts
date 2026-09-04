import "server-only";

import { currentUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service-client";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

/**
 * The org's FX Buffer: the margin every Quote's applied rate carries over ECB
 * mid-market, and the one place a person can change it.
 *
 * `orgs.fx_buffer_pct` is a column — `numeric(5,4)`, default `0.0200` — precisely so the
 * real spread Taihue's bank charges can replace the placeholder without a deploy
 * (buildspec_2 A3). Until this file it had no screen, so acting on that figure meant SQL
 * against production.
 *
 * **What it changes, and what it must not.** A Quote freezes `fx_rate_mid`,
 * `fx_rate_applied` and `fx_rate_as_of` at entry and never asks again, so changing this
 * setting changes what the *next* Quote freezes. Nothing here reaches into `quotes`, and
 * nothing ever should: a write that walked existing rows to re-price them would break the
 * Frozen Rate's promise in CONTEXT.md, that a ranking somebody saw stays reproducible
 * from the row a year later.
 *
 * **There is exactly one way an already-frozen pair moves, and it is not this file.**
 * ADR-0018: correcting the day a Quote *claims* re-runs the freeze against the new date,
 * and it re-runs it with the buffer as it stands now. That is the setting working rather
 * than leaking — the re-frozen row has to be one the create path could produce, and
 * reconstructing the retired buffer from `applied / mid - 1` would produce a row it could
 * not, off two values already rounded to the rate column's eight places. What the screen
 * promises is written to match: a Quote already recorded keeps its rate unless somebody
 * corrects the day it claims.
 *
 * **The direction of a wrong value is not symmetric.** The buffer errs toward
 * *overstating* cost on purpose — ECB mid-market is not what a bank charges — so a value
 * that is too high makes a Bid cautious, and one that is too low quietly makes every Bid
 * look cheaper than it is and wins tenders that lose money. Every refusal below is
 * written with that asymmetry in mind: nothing here may end in a stored null, a negative,
 * or a zero somebody did not mean to type.
 */

/**
 * The percentage a person may enter, at the two ends.
 *
 * The column would hold up to 999.99%, which is not a bound on anything: it is the
 * width of `numeric(5,4)`. A bank's spread on THB↔CNY and THB↔USD is low single digits,
 * so ten percent is far above any figure the business will ever set and far below the
 * misplaced decimal point this exists to catch — a 2 meant as 2% and typed as 200.
 *
 * Zero is allowed and is a real answer (an org that converts at mid-market), but it is
 * the direction that loses money, so it has to be typed rather than arrived at by a
 * blank box or an unparseable one.
 */
const maxPercent = 10;

/**
 * How many decimal places a percentage may carry.
 *
 * `numeric(5,4)` keeps four places of the *fraction*, which is two of the percentage.
 * Postgres would take 0.125% and store 0.0013 without complaint — a different setting
 * from the one somebody typed, reported back to them as saved.
 */
const percentDecimals = 2;

export const fxBufferRefusals = [
  "not_admin",
  "not_a_percentage",
  "out_of_range",
  "too_precise",
  "save_failed",
] as const;

export type FxBufferRefusal = (typeof fxBufferRefusals)[number];

/**
 * How setting the buffer can end, as a list rather than a bare union, so that
 * `messages.test.ts` can walk it: a refusal with no wording is a form that appears to do
 * nothing on the one screen where the number it refused re-prices every future Quote.
 */
export const fxBufferStatuses = [...fxBufferRefusals, "saved"] as const;

export type FxBufferStatus = (typeof fxBufferStatuses)[number];

export type ParsedBuffer =
  | { ok: true; fraction: number }
  | { ok: false; reason: FxBufferRefusal };

/**
 * Read what a person typed as a percentage, and hand back the fraction the column and
 * `fx_rate_applied` expect.
 *
 * **A function rather than a `Number()` in the server action**, because the conversion
 * between the two units is the failure this ticket is about: a 2 that lands as 200%
 * triples every foreign price on every Tender entered afterwards, and it does so
 * silently, on rows nobody re-reads.
 *
 * The arithmetic goes through the percentage's own scale rather than a divide by 100:
 * `1.1 / 100` is `0.011000000000000001` in binary floating point, and while
 * `numeric(5,4)` would round that back, a test asserting `0.011` on the way in should
 * not have to know that. `Math.round(percent * 100) / 10000` lands on the number the
 * column will hold.
 *
 * NFKC is applied before anything else: a Chinese IME in full-width mode produces ２５％,
 * which is indistinguishable on screen from what the reader meant and parses as nothing.
 */
export function parseBufferPercent(entered: string): ParsedBuffer {
  // The percent sign is stripped rather than refused. The label and the box already show
  // one, so typing it back is the reader agreeing with the screen, not a mistake.
  const cleaned = entered.normalize("NFKC").trim().replace(/%$/, "").trim();
  const digits = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))$/.exec(cleaned);

  if (digits === null) return { ok: false, reason: "not_a_percentage" };

  const percent = Number(cleaned);

  if (!Number.isFinite(percent)) return { ok: false, reason: "not_a_percentage" };
  if (percent < 0 || percent > maxPercent) return { ok: false, reason: "out_of_range" };

  // Read off the text rather than computed from the number, so that trailing zeros are
  // the nothing they are: refusing "2.500" would be refusing two and a half percent.
  const decimals = (digits[1] ?? digits[2] ?? "").replace(/0+$/, "");

  if (decimals.length > percentDecimals) return { ok: false, reason: "too_precise" };

  return { ok: true, fraction: Math.round(percent * 100) / 10_000 };
}

/**
 * The stored fraction as the percentage the screen shows and the box is filled from.
 *
 * The inverse of {@link parseBufferPercent}, and rounded at the column's scale for the
 * same reason it is: `0.02 * 100` is `2.0000000000000004`, and a box that opens showing
 * that is one nobody dares press Save on.
 */
export function asPercent(fraction: number): number {
  return Math.round(fraction * 10_000) / 100;
}

export type SetFxBufferResult = { ok: true } | { ok: false; reason: FxBufferRefusal };

/**
 * Set the org's FX Buffer from a percentage a person typed.
 *
 * Org Admin-gated, and gated *here* rather than in the page, because a server action is a
 * public HTTP endpoint that any signed-in member can POST to. `setGroupRobot` gives the
 * same argument for the same reason; this column is the quieter of the two, since a wrong
 * buffer breaks nothing visibly and simply re-prices everything entered afterwards.
 *
 * Written with the service client because `orgs` is settings rather than business data
 * and `insert, update, delete` is revoked from `authenticated` outright — the browser's
 * anon key must never be one PostgREST call from this column
 * (`20260814010000_membership_is_not_business_data.sql`, proven in `rls.test.ts`). The
 * row is scoped to the caller's own org by hand, as every service-client write here is.
 */
export async function setFxBuffer(
  { entered }: { entered: string },
  store: SessionCookieStore,
): Promise<SetFxBufferResult> {
  const caller = await currentUser(store);

  if (!caller?.isOrgAdmin) return { ok: false, reason: "not_admin" };

  const parsed = parseBufferPercent(entered);

  if (!parsed.ok) return parsed;

  const { error } = await createServiceClient()
    .from("orgs")
    .update({ fx_buffer_pct: parsed.fraction })
    .eq("id", caller.orgId);

  // A write that failed is not a percentage that was wrong. Reporting it as one sends the
  // admin back to re-check a figure that was fine, and leaves the old buffer in place
  // while they do.
  return error === null ? { ok: true } : { ok: false, reason: "save_failed" };
}
