import type { FxBoundary } from "./rates";

/**
 * The test double for the Frankfurter boundary — test-only, imported by no shipping
 * code.
 *
 * One stub rather than one per test file, for the reason `robot-stub.ts` is one: two
 * hand-rolled fakes drift, and the one that drifts is the one still passing. It records
 * what was asked for as well as answering, because *which day* was requested is half of
 * what this boundary is: a Quote dated on a Saturday must ask for the Saturday and let
 * ECB answer with the Friday, not quietly ask for something else.
 */

export type RateStub = FxBoundary & {
  /** Every URL asked for, in order. */
  asked: string[];
};

/**
 * A Frankfurter that answers with one rate.
 *
 * `asOf` defaults to the date that was asked for; pass a different one to stand in for
 * the business-day rule, where a Saturday's request comes back dated Friday.
 */
export function respondingRates(
  rate: number,
  asOf?: string,
): RateStub {
  const asked: string[] = [];

  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    asked.push(url.toString());

    return Response.json({
      amount: 1,
      base: url.searchParams.get("base"),
      // The path is `/v1/{date}`, which is what "the day that was asked for" means here.
      date: asOf ?? url.pathname.split("/").pop(),
      rates: { THB: rate },
    });
  };

  return { asked, fetch: fetch as typeof globalThis.fetch };
}

/** A Frankfurter that cannot be reached at all — the transport itself fails. */
export function unreachableRates(message = "ECONNRESET"): FxBoundary {
  return {
    fetch: (() => Promise.reject(new Error(message))) as typeof globalThis.fetch,
  };
}

/** A Frankfurter that is up and answering with an error status. */
export function failingRates(status = 503): FxBoundary {
  return {
    fetch: (async () =>
      new Response("upstream said no", { status })) as typeof globalThis.fetch,
  };
}
