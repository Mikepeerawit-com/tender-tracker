import "server-only";

import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

/**
 * The org's two settings that are not deployment config.
 *
 * Both are columns rather than constants for the same reason: they are answers the
 * business owns and will change without anybody shipping code.
 *
 * `timezone` is where every date boundary computes. Never server-local — Vercel runs UTC,
 * which rolls the day seven hours early for everyone in Bangkok, so a deadline would go
 * red the previous afternoon. Org-level rather than per-user, because a deadline belongs
 * to the Tender and not to whoever is looking at it.
 *
 * `fxBufferPct` is the conservative margin over ECB mid-market that every Quote's applied
 * rate carries. 2% is a placeholder (buildspec_2.md A3) standing in for the real spread
 * Taihue's bank charges, and it is a column precisely so the real figure can replace it
 * without a deploy.
 */
export type OrgSettings = { timezone: string; fxBufferPct: number };

/**
 * The documented defaults, used when the row cannot be read.
 *
 * That cannot happen for a caller RLS let this far, and it is written down anyway
 * because the failure is silent in both directions: a zero buffer understates every cost
 * on every Tender, which is the direction that loses money, and a UTC fallback moves
 * every deadline by a day.
 */
const fallback: OrgSettings = { timezone: "Asia/Bangkok", fxBufferPct: 0.02 };

export async function getOrgSettings(
  store: SessionCookieStore,
): Promise<OrgSettings> {
  // No `.eq()` on the id: RLS scopes `orgs` to the caller's own org, so this is the one
  // row there is to read, and asking for it by an id the caller supplied would be asking
  // a question RLS has already answered.
  const { data } = await createSessionClient(store)
    .from("orgs")
    .select("timezone, fx_buffer_pct")
    .limit(1)
    .maybeSingle();

  if (!data) return fallback;

  return {
    timezone: data.timezone,
    // `numeric` crosses the wire as a JSON number in a type wider than this column holds.
    fxBufferPct: Number(data.fx_buffer_pct),
  };
}
