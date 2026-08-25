import "server-only";

import { fetchDailyRates, type DailyRateFetch, type FxBoundary } from "@/lib/fx/rates";
import type { RobotBoundary } from "@/lib/wecom/robot";

import { sendDueReminders, type ReminderRunReport } from "@/lib/reminders/send";

/**
 * The one scheduled job in v1, and everything it does — which is why it sits here rather
 * than under `@/lib/reminders`: it fetches rates as well as sending them, and #35's Digest
 * joins it.
 *
 * A function rather than the body of the route handler, because the two things it does are
 * the two outbound boundaries this project stubs (see the note in `vitest.config.mts`) and
 * a route handler has nowhere to take them as arguments. The route resolves the instant,
 * checks it is really Vercel Cron calling, and hands off to here.
 */

/** Both stubbed boundaries the run stands at, injected together. */
export type CronBoundary = { rates?: FxBoundary; robot?: RobotBoundary };

export type DailyCronReport = {
  ranAt: string;
  /** Null when Frankfurter could not be reached — the rates are simply a day older. */
  rates: DailyRateFetch | null;
  reminders: ReminderRunReport;
};

/**
 * **Rates first, reminders second, and a rate failure never stops the reminders.**
 *
 * Every Quote freezes its own rate at entry and no screen re-reads `fx_rates`, so stale
 * rates cost a fallback that is a day older. Reminders that did not go out cost the thing
 * the product exists to prevent. Ordering these the other way round, or letting the first
 * throw, trades the cheap failure for the expensive one.
 */
export async function runDailyCron(
  at: Date,
  boundary: CronBoundary = {},
): Promise<DailyCronReport> {
  const rates = await fetchDailyRates(boundary.rates);
  const reminders = await sendDueReminders(at, boundary.robot);

  return { ranAt: at.toISOString(), rates, reminders };
}
