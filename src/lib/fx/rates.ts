import "server-only";

import { isConvertibleCurrency, reportingCurrency } from "@/lib/fx/currencies";
import { createServiceClient } from "@/lib/supabase/service-client";
import type { createSessionClient } from "@/lib/supabase/session-client";

/**
 * The rate a Quote freezes at entry.
 *
 * A Quote stores `fx_rate_mid`, `fx_rate_applied` and `fx_rate_as_of` and never asks
 * again. History stays auditable, dashboard totals do not drift, and no screen depends
 * on a rate service being up at render time — the ranking a person saw is reproducible
 * from the stored row a year later.
 *
 * Rates come from Frankfurter: MIT, no key, no quota, free for commercial use, and
 * self-hostable if it disappears. What it serves is **ECB reference rates — mid-market,
 * business days only** — so a Quote entered on a Saturday freezes Friday's rate, and the
 * response says so in its own `date` rather than this file assuming anything.
 *
 * ## Nothing here may stop a Quote being recorded
 *
 * An Assignee is off the phone with a supplier holding a price. Whether a rate service
 * in Frankfurt answered in the next two seconds is not their problem, so every failure
 * path here ends in a usable rate marked `isStale` rather than in a refusal. The one
 * exception is a currency with no rate at all, ever — see {@link freezeRate}.
 */

/**
 * The outbound boundary, injected so tests can stand at it — one of exactly two stubbed
 * in this project (see the note in vitest.config.mts). Not a global `fetch` stub: this
 * runs inside a server action that also talks to Postgres over HTTP, and taking `fetch`
 * out globally would take `supabase-js` with it.
 */
export type FxBoundary = { fetch?: typeof globalThis.fetch };

/** What a Quote freezes. Both rates, so the buffer stays visible and is applied once. */
export type FrozenRate = {
  /** ECB mid-market, as published. */
  mid: number;
  /** `mid * (1 + fx_buffer_pct)` — what the Quote is actually converted at. */
  applied: number;
  /** The ECB reference date the rate belongs to, which is rarely today. */
  asOf: string;
  /** True when Frankfurter could not be reached and a previously stored rate was used. */
  isStale: boolean;
};

const frankfurter = "https://api.frankfurter.dev/v1";

/**
 * How long to wait for a rate before giving up and using the last known one.
 *
 * "Never block quote entry" is a promise about wall-clock time as much as about
 * outcomes: a fetch with no deadline does not fail, it hangs, and a form that hangs on a
 * phone inside the WeCom webview is indistinguishable from an app that has crashed.
 */
const timeoutMs = 4_000;

/** `numeric(18,8)`, and the precision both rates are rounded to before they are stored. */
const rateScale = 1e8;

/**
 * Freeze a rate for one Quote, or report that there is none.
 *
 * Returns null only when the currency is one ECB does not publish, or when Frankfurter
 * could not be reached *and* this org has never stored a rate for that currency. The
 * second is the honest floor: `fx_rate_mid` is `not null` and every total in the app is
 * built on it, so the alternative to refusing is a stored price nothing can convert —
 * which A11 rejected for the first case and which is no better for the second. It cannot
 * happen for a currency that has been quoted once before.
 *
 * THB never touches the network. Both rates are 1 and `asOf` is the quoted date itself:
 * a THB Quote is not converted, so there is no rate to be stale about.
 */
export async function freezeRate(
  { currency, on, bufferPct }: { currency: string; on: string; bufferPct: number },
  supabase: ReturnType<typeof createSessionClient>,
  boundary: FxBoundary = {},
): Promise<FrozenRate | null> {
  if (currency === reportingCurrency) {
    return { mid: 1, applied: 1, asOf: on, isStale: false };
  }

  if (!isConvertibleCurrency(currency)) return null;

  const fetched = await fetchRate(currency, on, boundary);

  if (fetched !== null) {
    // Best effort, and deliberately not awaited for its outcome beyond errors being
    // ignored: the Quote is what the user asked for, and a rate that failed to cache is
    // one more fetch next time rather than a failure to report. The daily cron (#33)
    // fills this table properly; writing here as well is what gives the fallback below
    // something to find before that cron exists.
    await remember(fetched);

    return withBuffer(fetched.rate, fetched.asOf, bufferPct, false);
  }

  const known = await lastKnown(currency, supabase);

  return known === null ? null : withBuffer(known.rate, known.asOf, bufferPct, true);
}

/** One rate as ECB published it. */
type PublishedRate = { currency: string; rate: number; asOf: string };

/**
 * Ask Frankfurter for the rate on a given day.
 *
 * The date goes in the path and the answer carries its own `date` back, because the two
 * are routinely different: ECB publishes on business days, so asking for a Saturday
 * returns Friday. Whatever comes back is what the Quote freezes and what the comparison
 * view will later show on hover — never the date that was asked for.
 *
 * Every failure is null. There is nothing a caller could do differently for a timeout
 * than for a 500 or for a body in a shape this does not recognise, and all three mean
 * the same thing to the person holding the price.
 */
async function fetchRate(
  currency: string,
  on: string,
  boundary: FxBoundary,
): Promise<PublishedRate | null> {
  const get = boundary.fetch ?? globalThis.fetch;
  const url = `${frankfurter}/${on}?base=${currency}&symbols=${reportingCurrency}`;

  try {
    const response = await get(url, { signal: AbortSignal.timeout(timeoutMs) });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      date?: unknown;
      rates?: Record<string, unknown>;
    };
    const rate = body.rates?.[reportingCurrency];
    const asOf = body.date;

    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
    if (typeof asOf !== "string") return null;

    return { currency, rate, asOf };
  } catch {
    return null;
  }
}

/**
 * Keep what was fetched, so the next Quote has something to fall back to.
 *
 * Written with the service client because `fx_rates` is reference data with no owner and
 * its policy is read-only: the browser's anon key must never hold an edit on the rate
 * every future Quote freezes at. `ignoreDuplicates` because the same day's rate is
 * fetched by every Quote entered that day and re-writing it would be a needless
 * round trip, not a correction — ECB does not revise a published reference rate.
 */
async function remember({ currency, rate, asOf }: PublishedRate): Promise<void> {
  await createServiceClient()
    .from("fx_rates")
    .upsert(
      { currency, as_of: asOf, rate_to_thb: rate },
      { onConflict: "currency,as_of", ignoreDuplicates: true },
    );
}

/**
 * The most recent rate this app has ever stored for a currency.
 *
 * Read through the caller's own session, because `fx_rates` is readable by any member of
 * any org and by nobody else — the same answer the browser would get. Deliberately *not*
 * bounded to on-or-before the quoted date: the fallback exists because a service is
 * unreachable, and the nearest rate there is beats no Quote at all. `fx_rate_as_of`
 * records which day it really came from, and `fx_rate_is_stale` says out loud that it is
 * not the day that was asked for.
 */
async function lastKnown(
  currency: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<{ rate: number; asOf: string } | null> {
  const { data } = await supabase
    .from("fx_rates")
    .select("as_of, rate_to_thb")
    .eq("currency", currency)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // `numeric` crosses the wire as a JSON number in a type wider than this column holds.
  return { rate: Number(data.rate_to_thb), asOf: data.as_of };
}

/**
 * Apply the org's buffer, once.
 *
 * ECB mid-market is not what a bank charges, so the stored conversion errs toward
 * *overstating* cost: a Bid built on an understated cost is a Bid that wins and loses
 * money. Both rates are kept precisely so the buffer stays visible in the row and cannot
 * be applied a second time by anything downstream.
 *
 * Both are rounded to the column's own scale here rather than left to Postgres, so what
 * a test asserts and what a comparison view later re-derives are the same number.
 */
function withBuffer(
  mid: number,
  asOf: string,
  bufferPct: number,
  isStale: boolean,
): FrozenRate {
  return {
    mid: round(mid),
    applied: round(mid * (1 + bufferPct)),
    asOf,
    isStale,
  };
}

function round(rate: number): number {
  return Math.round(rate * rateScale) / rateScale;
}
