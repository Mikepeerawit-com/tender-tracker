import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstantHeader } from "@/lib/run-instant";
import { migrationsOnDisk } from "@/lib/schema/migrations-on-disk.mts";
import { reportUnlessRoutine } from "@/test/postgres-notices";

import { GET } from "./route";

/**
 * The probe's own failure modes, exercised against the real local Postgres.
 *
 * #40 is a ticket about a check that could not fail: `/api/health` reported
 * `{"status":"ok"}` through eight missing migrations and through a month of
 * `permission denied for table orgs`. So the tests that matter here are the ones that
 * make it fail — and they earn their keep only by breaking the database for real. A
 * mocked `42501` proves the route can format one, not that Postgres would ever hand it
 * one; that distinction is the entire bug.
 *
 * Each destructive test therefore takes something away over a superuser connection and
 * puts it back in `finally`. Two consequences follow, and both are handled here rather
 * than left to luck.
 *
 * **It breaks the database for everybody.** `revoke select on tenders` is not scoped to
 * this worker, and the RLS suites read that table as `authenticated` at the same time.
 * Hence `.exclusive.test.ts`: vitest.config.mts gives that suffix its own project, in a
 * later group, so nothing else is running when this file is.
 *
 * **`finally` does not run when a worker is killed.** So nothing is ever destroyed — the
 * withheld migration row is *moved* to `withheld.migrations` in one transaction, and
 * `health_probe()` is *renamed* rather than dropped. `restoreWithheld` below puts back
 * whatever a previous crashed run left behind, before this one starts.
 */

const fixedInstant = "2026-03-01T09:00:00.000Z";

const expected = migrationsOnDisk();
const newest = expected[expected.length - 1];

type HealthBody = {
  status: string;
  database?: string;
  schema: {
    expected: string;
    applied: string | null;
    behind: number | null;
    error?: string;
  };
  tables?: { probed: string; readable: boolean; error?: string };
  appOrigin?: { configured: boolean; origin?: string; error?: string };
  checkedAt: string;
};

/** A usable `APP_ORIGIN`, so the healthy answer below really is the healthy answer. */
const configuredOrigin = "https://tenders.example.test";

function healthRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/health", { headers });
}

async function health(headers: Record<string, string> = {}): Promise<{
  status: number;
  body: HealthBody;
}> {
  const response = await GET(healthRequest(headers));

  return { status: response.status, body: (await response.json()) as HealthBody };
}

/**
 * A connection past PostgREST, so a test can take away what the app depends on.
 *
 * `postgres` rather than `pg` for one reason: the server project resolves packages under
 * the `react-server` condition, and `pg` is CommonJS reaching `pg-pool` through a
 * `require` that then hands back an ES module namespace, which its own
 * `class Pool extends …` cannot extend. This one is ESM throughout.
 */
async function withSuperuser<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1, onnotice: reportUnlessRoutine });

  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Put back anything a killed worker left withheld — the migration rows first, then the
 * probe function. Safe to run when there is nothing to restore, which is the usual case.
 *
 * Returns only once PostgREST is answering with `health_probe()` again, whether or not
 * this call is the one that put it back: the caller's next line, and every test after it,
 * asks the database through PostgREST, and a stale cache there is indistinguishable from
 * a database no migration ever reached.
 */
async function restoreWithheld(sql: postgres.Sql): Promise<void> {
  await sql`create schema if not exists withheld`;
  await sql`
    create table if not exists withheld.migrations
      (like supabase_migrations.schema_migrations including all)
  `;

  await sql.begin(async (tx) => {
    await tx`
      insert into supabase_migrations.schema_migrations
      select * from withheld.migrations
      on conflict (version) do nothing
    `;
    await tx`delete from withheld.migrations`;
  });

  const [hidden] = await sql`
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'health_probe_withheld'
  `;

  if (hidden) {
    await sql`alter function public.health_probe_withheld() rename to health_probe`;
  }

  // The rename is not the restore: PostgREST answers RPCs out of a cached schema, so the
  // probe is back when PostgREST answers with it and not before. Waited for on every
  // call, not only the one that renamed — a previous run killed mid-test, or a cache that
  // has drifted for its own reasons, is the same stale cache and the same wait.
  await reloadPostgrestSchema(sql);
  await untilProbeIs(true);
}

/**
 * Run `work` against a database that never received `version` — the row is moved out of
 * the migration history and put back afterwards. The schema itself is left alone: what
 * is under test is whether the probe notices the *history* disagreeing with the build,
 * which is the shape a forgotten `db push` leaves behind.
 *
 * Moved rather than deleted, in one transaction, so that a worker killed mid-test leaves
 * the row recoverable instead of leaving this database permanently unable to
 * `supabase db push` — the next push would try to re-apply DDL that is already there.
 */
async function withMigrationWithheld<T>(version: string, work: () => Promise<T>): Promise<T> {
  return withSuperuser(async (sql) => {
    await restoreWithheld(sql);

    const moved = await sql.begin(async (tx) => {
      const rows = await tx`
        insert into withheld.migrations
        select * from supabase_migrations.schema_migrations where version = ${version}
        returning version
      `;

      await tx`delete from supabase_migrations.schema_migrations where version = ${version}`;

      return rows.length;
    });

    if (moved !== 1) {
      throw new Error(`Cannot withhold ${version}: this database does not hold it.`);
    }

    try {
      return await work();
    } finally {
      await restoreWithheld(sql);
    }
  });
}

/**
 * PostgREST answers RPCs out of a cached schema, so a function it has already seen stays
 * callable after it is renamed away, and one it has not seen stays missing after it comes
 * back. Ask for the reload and wait for it to bite, rather than sleeping a guessed
 * interval.
 *
 * Supabase installs a `pgrst_ddl_watch` event trigger that sends this same notification
 * on any DDL, so the rename has usually asked already. The ask is cheap and the trigger
 * is not this suite's to rely on; the *waiting* is the part that carries the weight.
 */
async function reloadPostgrestSchema(sql: postgres.Sql): Promise<void> {
  await sql.notify("pgrst", "reload schema");
}

/** How the probe reads, or that this answer does not say. */
type ProbeReading = "present" | "absent" | "unknown";

/**
 * What one health response says about `health_probe()` — and, crucially, when it says
 * nothing.
 *
 * `applied: null` is the answer of a database with no probe *and* the answer of a
 * database nobody could reach, which is the whole of #125: reading the second as
 * "the probe is there" let a single restart end a wait for a function nobody had seen
 * come back, and the next test in this file went red naming a probe it never touched.
 * An answer that could not reach the database is evidence about the network, not about
 * the schema, so it is neither reading.
 */
async function readProbe(): Promise<ProbeReading> {
  const { body } = await health();

  if (body.database !== "reachable") return "unknown";

  return body.schema.applied === null ? "absent" : "present";
}

/**
 * Poll until the probe is observably where it is wanted. `unknown` is not an answer in
 * either direction — it keeps the loop going, which is what both the arrival and the
 * departure of a hiccup deserve.
 *
 * The whole budget has to fit inside vitest's 5s hook timeout, because `restoreWithheld`
 * waits here from `beforeAll`: a PostgREST that is down would otherwise be reported as
 * "hook timed out", which names nothing. It fails at 3s with the reading it kept getting
 * instead — `unknown` throughout is a database nobody could reach, not a missing probe,
 * and the two send a reader to different places.
 */
async function untilProbeIs(present: boolean, attempts = 60): Promise<void> {
  const wanted: ProbeReading = present ? "present" : "absent";
  let reading: ProbeReading = "unknown";

  for (let attempt = 0; attempt < attempts; attempt++) {
    reading = await readProbe();

    if (reading === wanted) return;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    reading === "unknown"
      ? "Waited for health_probe() to be " +
        `${wanted} and never reached the database at all — is PostgREST up?`
      : `PostgREST never answered with health_probe() ${wanted}.`,
  );
}

/**
 * How `withProbeHidden` puts the probe back: `restoreWithheld`, except in the one test
 * that defeats it to show what catches a restore that did not happen.
 */
type Restore = (sql: postgres.Sql) => Promise<void>;

/**
 * Run `work` against a database whose `health_probe()` is not there at all — a database
 * no migration has ever reached, which is the fault #40 was actually found in. Renamed
 * rather than dropped: the body is what carries the probe, and a test that had to
 * recreate it would be asserting against its own copy.
 */
async function withProbeHidden<T>(
  work: () => Promise<T>,
  restore: Restore = restoreWithheld,
): Promise<T> {
  return withSuperuser(async (sql) => {
    await restoreWithheld(sql);
    await sql`alter function public.health_probe() rename to health_probe_withheld`;
    await reloadPostgrestSchema(sql);

    let failed: unknown;

    try {
      await untilProbeIs(false);
      return await work();
    } catch (error) {
      failed = error;
      throw error;
    } finally {
      await handBackAProbeThatAnswers(sql, restore, failed);
    }
  });
}

/**
 * However the block above ended, the next test must not be the one to discover that the
 * probe is still renamed away. `restore` does the putting back and waits for PostgREST;
 * the second read is what makes that wait a claim this file checks rather than trusts,
 * for any `restore` that returns without having seen anything — which is what #125 was.
 *
 * Both halves fail into one message, and it names `withProbeHidden`: a hand-back that
 * cannot be completed is read three tests later as "the probe is missing", pointing at a
 * migration that ran fine. That misdirection is the cost this whole ticket was about.
 *
 * It throws from a `finally`, so it can displace a failure from the block it wrapped —
 * deliberately, because a database handed on without its probe is the larger fault and
 * the one nothing downstream can diagnose. The displaced message is carried along rather
 * than dropped.
 */
async function handBackAProbeThatAnswers(
  sql: postgres.Sql,
  restore: Restore,
  failed: unknown,
): Promise<void> {
  try {
    await restore(sql);
    await untilProbeIs(true, 10);
  } catch (cause) {
    const displaced = failed instanceof Error ? ` It displaced: ${failed.message}` : "";

    throw new Error(
      "withProbeHidden cannot hand on a database PostgREST answers health_probe() with." +
        displaced,
      { cause },
    );
  }
}

/** Run `work` against a database whose tables `authenticated` may no longer read. */
async function withReadRevoked<T>(table: string, work: () => Promise<T>): Promise<T> {
  return withSuperuser(async (sql) => {
    await sql`revoke select on ${sql(`public.${table}`)} from authenticated`;

    try {
      return await work();
    } finally {
      await sql`grant select on ${sql(`public.${table}`)} to authenticated`;
    }
  });
}

describe("GET /api/health", () => {
  beforeAll(() => withSuperuser(restoreWithheld));

  beforeEach(() => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "true");
    // Set for every test, because an unset one is now a fault in its own right and every
    // assertion of `ok` below would otherwise be asserting the wrong thing. The tests
    // that care about it unset it themselves.
    vi.stubEnv("APP_ORIGIN", configuredOrigin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the database as reachable when Postgres answers", async () => {
    const { status, body } = await health();

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", database: "reachable" });
  });

  it("names both schema versions on the healthy answer, not only the failing one", async () => {
    const { body } = await health();

    expect(body.schema).toEqual({ expected: newest, applied: newest, behind: 0 });
  });

  it("reports the table it really read, on the healthy answer", async () => {
    const { body } = await health();

    expect(body.tables).toEqual({ probed: "tenders", readable: true });
  });

  it("reports the run instant it was handed rather than the wall clock", async () => {
    const { body } = await health({ [runInstantHeader]: fixedInstant });

    expect(body.checkedAt).toBe(fixedInstant);
  });

  it("ignores an injected run instant unless overrides are enabled", async () => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "");

    const { body } = await health({ [runInstantHeader]: fixedInstant });

    expect(body.checkedAt).not.toBe(fixedInstant);
    expect(Date.parse(body.checkedAt)).toBeGreaterThan(Date.parse("2026-08-01T00:00:00.000Z"));
  });

  it("rejects an unparseable run instant instead of guessing one", async () => {
    const { status } = await health({ [runInstantHeader]: "the day before" });

    expect(status).toBe(400);
  });

  it("calls a misconfigured deployment misconfigured, not unreachable", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { status, body } = await health({ [runInstantHeader]: fixedInstant });

    expect(status).toBe(500);
    expect(body.status).toBe("misconfigured");
  });

  it("degrades rather than throwing when Postgres cannot be reached", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");

    const { status, body } = await health({ [runInstantHeader]: fixedInstant });

    expect(status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      database: "unreachable",
      checkedAt: fixedInstant,
    });
  });

  it("still names what it expected when it could not ask the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");

    const { body } = await health();

    expect(body.schema).toEqual({ expected: newest, applied: null, behind: null });
  });

  it("names what it expected even with no credentials to ask with", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { body } = await health();

    expect(body.schema).toEqual({ expected: newest, applied: null, behind: null });
  });

  it("refuses to call itself ok when the build lost its expected versions", async () => {
    vi.stubEnv("EXPECTED_SCHEMA_MIGRATIONS", "");

    const { status, body } = await health();

    expect(status).toBe(500);
    expect(body.status).toBe("misconfigured");
  });

  describe("against a database no migration ever reached", () => {
    it("does not call it unreachable — the fault is the schema, not Postgres", async () => {
      const { status, body } = await withProbeHidden(() => health());

      expect(status).toBe(503);
      expect(body.status).toBe("degraded");
      // The whole subtlety of #40: `health_probe()` ships in a migration, so a database
      // that never received one cannot answer. Reading that as "Postgres is down" sends
      // the reader to a database that is fine.
      expect(body.database).toBe("reachable");
    });

    it("names nothing applied rather than a version it cannot know", async () => {
      const { body } = await withProbeHidden(() => health());

      expect(body.schema).toMatchObject({ expected: newest, applied: null, behind: null });
    });

    it("says why it could not ask", async () => {
      const { body } = await withProbeHidden(() => health());

      expect(body.schema.error).toMatch(/health_probe/);
    });
  });

  /**
   * The scaffolding above, checked the way ADR-0016 asks a check to be checked: by
   * breaking what it watches. #125 was a restore that was believed rather than seen — a
   * single `database: "unreachable"` answer ended the wait for a probe nobody had
   * observed come back, and the next test in the file paid for it, red on a
   * `health_probe` it never touched.
   */
  describe("the seam that hides the probe", () => {
    it("keeps waiting when the health answer could not reach the database", async () => {
      // The probe is there and PostgREST knows it; this answer still says nothing about
      // it, because a database that cannot be reached reads exactly like one with no
      // probe. Anything that ends the wait here confirms the restore on a hiccup.
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");

      await expect(untilProbeIs(true, 3)).rejects.toThrow(/health_probe/);
    });

    it("goes red naming the probe rather than handing on a database still missing it", async () => {
      // Defeat the restore — a `finally` that returns without the probe being back,
      // which is all an early-returning wait amounts to — and every test after this one
      // would be asking a database whose `health_probe` is renamed away. Instead the seam
      // that hid it is the one that fails, and it says so.
      try {
        await expect(withProbeHidden(async () => undefined, async () => {})).rejects.toThrow(
          /health_probe/,
        );
      } finally {
        // In a `finally` for the reason the rest of the file is: this test is the one
        // place that deliberately leaves the probe hidden, and an assertion above that
        // fails — the message reworded, the check removed — must not also be the thing
        // that hands the next test a database without it.
        await withSuperuser((sql) => restoreWithheld(sql));
      }

      const { body } = await health();

      expect(body.schema).toMatchObject({ applied: newest, behind: 0 });
    });
  });

  describe("against a database behind the build", () => {
    it("reports drift, naming both versions and the size of the gap", async () => {
      const { status, body } = await withMigrationWithheld(newest, () => health());

      expect(status).toBe(503);
      expect(body).toMatchObject({ status: "degraded", database: "reachable" });
      expect(body.schema).toEqual({
        expected: newest,
        applied: expected[expected.length - 2],
        behind: 1,
      });
    });

    it("counts a gap in the middle, which a newest-version comparison would miss", async () => {
      const middle = expected[Math.floor(expected.length / 2)];

      const { status, body } = await withMigrationWithheld(middle, () => health());

      expect(status).toBe(503);
      expect(body.schema).toMatchObject({ expected: newest, applied: newest, behind: 1 });
    });

    it("stays distinguishable from a schema that is level but unreadable", async () => {
      const { body } = await withMigrationWithheld(newest, () => health());

      expect(body.tables).toEqual({ probed: "tenders", readable: true });
    });
  });

  describe("against a table the app may no longer read", () => {
    it("reports the permission denial as its own state rather than as ok", async () => {
      const { status, body } = await withReadRevoked("tenders", () => health());

      expect(status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.tables).toEqual({ probed: "tenders", readable: false, error: "42501" });
    });

    it("stays distinguishable from a schema that is behind", async () => {
      const { body } = await withReadRevoked("tenders", () => health());

      expect(body.schema).toEqual({ expected: newest, applied: newest, behind: 0 });
      expect(body.database).toBe("reachable");
    });
  });
});

/**
 * The app not knowing its own public URL (#59), where the schema is *also* behind.
 *
 * The rest of that fault needs nothing taken away from Postgres and lives in
 * `route.test.ts`; this one case withholds a migration, so it belongs to the exclusive
 * seam and only it is here.
 */
describe("GET /api/health, with no APP_ORIGIN and a schema behind the build", () => {
  beforeAll(() => withSuperuser(restoreWithheld));

  beforeEach(() => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the schema as the fault and still reports the origin, so nothing hides behind a redeploy", async () => {
    // The database fault outranks it in `status`, and must not swallow it: a deployment
    // fixed for the schema and still linkless has to go red again on the next probe
    // rather than come back green. That is only true if the origin is in every answer.
    vi.stubEnv("APP_ORIGIN", "");

    const { body } = await withMigrationWithheld(newest, () => health());

    expect(body.status).toBe("degraded");
    expect(body.appOrigin).toMatchObject({ configured: false });
  });
});
