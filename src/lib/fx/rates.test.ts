import { afterAll, describe, expect, it } from "vitest";

import { reportingCurrency } from "@/lib/fx/currencies";
import { failingRates, respondingLatestRates, unreachableRates } from "@/lib/fx/rate-stub";
import { fetchDailyRates } from "@/lib/fx/rates";
import { createServiceClient } from "@/lib/supabase/service-client";

/**
 * The daily rate fetch — the first thing the cron does, and the one part of the night's
 * work that is allowed to come to nothing.
 *
 * Every Quote freezes its own rate at entry, so nothing on any screen depends on this
 * table being fresh. What it is for is the fallback: a Quote entered while Frankfurter is
 * down converts at the last rate this org ever stored, and this is what makes sure there
 * is one.
 */

const service = createServiceClient();

/** A day nothing else in the suite writes, so these rows are this file's alone. */
const asOf = "2015-03-17";

/** Per euro, as ECB publishes. Only the ratio against THB matters. */
const perEur = { THB: 40, USD: 1.25, CNY: 8, JPY: 160 };

afterAll(async () => {
  await service.from("fx_rates").delete().eq("as_of", asOf);
});

async function storedRate(currency: string): Promise<number | null> {
  const { data } = await service
    .from("fx_rates")
    .select("rate_to_thb")
    .eq("currency", currency)
    .eq("as_of", asOf)
    .maybeSingle();

  return data ? Number(data.rate_to_thb) : null;
}

describe("the daily rate fetch", () => {
  it("stores every convertible currency against THB from one request", async () => {
    const boundary = respondingLatestRates(perEur, asOf);

    const result = await fetchDailyRates(boundary);

    expect(boundary.asked).toHaveLength(1);
    // USD, CNY and JPY from the table, plus the euro it is expressed in. THB is in the
    // ECB list but is never converted, so it is not among the rows.
    expect(result).toEqual({ asOf, stored: 4 });
  });

  it("divides the euro table back into what a Baht costs", async () => {
    await fetchDailyRates(respondingLatestRates(perEur, asOf));

    // 40 THB per euro against 1.25 USD per euro is 32 THB to the dollar.
    await expect(storedRate("USD")).resolves.toBe(32);
    await expect(storedRate("CNY")).resolves.toBe(5);
    // The euro does not appear in its own table, and is the table's own base rate.
    await expect(storedRate("EUR")).resolves.toBe(40);
  });

  it("stores no rate for the reporting currency itself", async () => {
    await fetchDailyRates(respondingLatestRates(perEur, asOf));

    await expect(storedRate(reportingCurrency)).resolves.toBeNull();
  });

  it("skips a currency the response did not carry rather than storing nothing", async () => {
    // ECB adds and drops currencies about once a decade. One missing symbol must not
    // take the other twenty-eight down with it.
    await fetchDailyRates(respondingLatestRates(perEur, asOf));

    await expect(storedRate("JPY")).resolves.toBe(0.25);
    await expect(storedRate("ISK")).resolves.toBeNull();
  });

  it("dates the rows the day ECB published, not the day it was asked", async () => {
    // A Sunday run is keeping Friday's rates, and `fx_rate_as_of` on a Quote is what
    // later tells a reader the figure is not today's.
    const result = await fetchDailyRates(respondingLatestRates(perEur, asOf));

    expect(result?.asOf).toBe(asOf);
  });

  it("reports nothing rather than throwing when Frankfurter is unreachable", async () => {
    await expect(fetchDailyRates(unreachableRates())).resolves.toBeNull();
  });

  it("reports nothing rather than throwing when Frankfurter answers with an error", async () => {
    await expect(fetchDailyRates(failingRates())).resolves.toBeNull();
  });

  it("reports nothing when the response carries no THB at all", async () => {
    // Without it there is nothing to convert *to*, and inventing a base would store a
    // whole day of rates that are quietly wrong.
    await expect(
      fetchDailyRates(respondingLatestRates({ USD: 1.25 }, asOf)),
    ).resolves.toBeNull();
  });
});
