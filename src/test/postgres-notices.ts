import type postgres from "postgres";

/**
 * The driver prints every `NOTICE` the server volunteers, and two of them arrive on every
 * call the exclusive suites make: `42P06 schema "withheld" already exists, skipping` and
 * `42P07 relation "migrations" already exists, skipping`, raised by the
 * `create … if not exists` that both files repair themselves with.
 *
 * They land immediately above whatever failed and read like its cause. Placing #125 —
 * a flake in `route.exclusive.test.ts` — took a detour through them first, so those two
 * are dropped. Anything else the server had a reason to say is still worth a reader's eye,
 * which is why this is a filter rather than `onnotice: () => {}`.
 *
 * Pass as `onnotice` wherever a suite opens a superuser connection.
 */
export function reportUnlessRoutine(notice: postgres.Notice): void {
  if (notice.code === "42P06" || notice.code === "42P07") return;

  console.warn(`${notice.severity} ${notice.code}: ${notice.message}`);
}
