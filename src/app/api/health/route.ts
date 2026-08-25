import type { SupabaseClient } from "@supabase/supabase-js";

import { InvalidRunInstantError, runInstantFrom } from "@/lib/run-instant";
import { expectedMigrations } from "@/lib/schema/expected-migrations";
import { createServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";

/**
 * Deployment probe: the app is up, Postgres answered it, the schema is the one this
 * build was written against, and the app can still read its own tables.
 *
 * The last two are #40. Reachability alone reported `ok` through eight missing
 * migrations and through a month of `permission denied for table orgs`, because
 * `health_check()` is defined in the first migration and needs no table privilege — it
 * asks "did migration #1 land", which is `true` for every possible state of the rest.
 *
 * Five faults, five fixes, kept apart on purpose. Collapsing any two sends somebody to
 * the wrong place, so read the body rather than the status code — four of these are
 * `503` and only the body tells them apart:
 *
 * | Answer | Fix |
 * | --- | --- |
 * | `misconfigured` | The deployment has no working Supabase credentials. |
 * | `database: "unreachable"` | Neither PostgREST nor Postgres behind it answers. |
 * | `schema.applied: null` | Reachable, and `health_probe()` is not there — no migration ever reached it. `supabase db push`. |
 * | `schema.behind > 0` | Reachable and partly migrated: `applied` names what it holds. `supabase db push`. |
 * | `tables.readable: false` | The schema is there and unreadable; check its grants. |
 *
 * `health_check()` is deliberately *not* the reachability oracle any more, and this is
 * the subtlest half of #40. It ships in the first migration, so a database that has
 * never been pushed to has no such function — and calling it to decide reachability
 * reported the never-deployed database, the exact fault this ticket is about, as
 * `unreachable`, sending the reader to look at a Postgres that was fine. Reachability is
 * now "did PostgREST answer at all", which a missing function does not disprove.
 *
 * It is also the worked example of the run-instant convention — the instant arrives from
 * the boundary and is reported, never read from the wall clock further in (ADR-0010).
 */
export async function GET(request: Request): Promise<Response> {
  let checkedAt: Date;

  try {
    checkedAt = runInstantFrom(request);
  } catch (error) {
    if (error instanceof InvalidRunInstantError) {
      return Response.json({ status: "error", error: error.message }, { status: 400 });
    }
    throw error;
  }

  // Read before anything else can fail, so that "what did this build expect?" is
  // answerable in every response below — including the ones where the database never
  // got asked. A probe that only names the version when it is unhappy leaves the reader
  // guessing on the healthy answer, which is where the eight-migration gap hid.
  let expected: string[];

  try {
    expected = expectedMigrations();
  } catch (error) {
    return Response.json(
      {
        status: "misconfigured",
        error: error instanceof Error ? error.message : String(error),
        schema: unknownSchema("unknown"),
        checkedAt: checkedAt.toISOString(),
      },
      { status: 500 },
    );
  }

  const newest = expected[expected.length - 1];

  // A deployment missing its Supabase credentials is a different fault from a database
  // that is down, and must not be reported as one: "unreachable" sends someone to look
  // at Postgres, which is fine.
  let client: SupabaseClient;

  try {
    client = createServiceClient();
  } catch (error) {
    return Response.json(
      {
        status: "misconfigured",
        error: error instanceof Error ? error.message : String(error),
        schema: unknownSchema(newest),
        checkedAt: checkedAt.toISOString(),
      },
      { status: 500 },
    );
  }

  const probe = await schemaProbe(client);

  if (!probe.ok) {
    return Response.json(
      {
        status: "degraded",
        database: probe.reachable ? "reachable" : "unreachable",
        // Reachable and unable to answer means the probe function itself is missing, so
        // the migration carrying it never landed and neither did anything after it.
        // `applied: null` is the whole answer: not "behind by n", but "nothing known to
        // be applied at all".
        schema: probe.reachable
          ? { ...unknownSchema(newest), error: probe.error }
          : unknownSchema(newest),
        checkedAt: checkedAt.toISOString(),
      },
      { status: 503 },
    );
  }

  // Counted against the whole list, not the newest version: a `migration repair` leaves
  // a hole in the middle, and a max comparison calls that level.
  const applied = new Set(probe.applied);
  const behind = expected.filter((version) => !applied.has(version)).length;

  const body = {
    status: behind === 0 && probe.tables.readable ? "ok" : "degraded",
    database: "reachable",
    schema: { expected: newest, applied: newestOf(probe.applied), behind },
    tables: probe.tables,
    checkedAt: checkedAt.toISOString(),
  };

  return Response.json(body, { status: body.status === "ok" ? 200 : 503 });
}

/** What the schema block says when the database could not be asked. */
function unknownSchema(expected: string) {
  return { expected, applied: null, behind: null };
}

function newestOf(applied: string[]): string | null {
  return applied.length === 0 ? null : applied[applied.length - 1];
}

type TableProbe = { probed: string; readable: boolean; error?: string };

type SchemaProbe =
  | { ok: true; applied: string[]; tables: TableProbe }
  | { ok: false; reachable: boolean; error: string };

/**
 * PostgREST's codes for "I am here, the database behind me is not". Everything else it
 * answers with — a missing function, a permission denial — proves it answered, which is
 * the only thing `database: "reachable"` claims.
 */
const postgrestCannotReachDatabase = new Set(["PGRST000", "PGRST001", "PGRST002"]);

/**
 * Did the database answer, whatever it said? A transport failure comes back with an
 * empty `code` and a `fetch failed` message; anything PostgREST composed itself carries
 * a code. That distinction is what keeps a never-migrated database out of `unreachable`.
 */
function answered(code: string | undefined): boolean {
  return code !== undefined && code !== "" && !postgrestCannotReachDatabase.has(code);
}

/**
 * The schema's own account of itself: every migration version it holds, and whether one
 * real table is still readable by the role a screen reads on. Both come from
 * `health_probe()` — see its migration for why the table read has to happen down there
 * rather than through a second client up here.
 */
async function schemaProbe(client: SupabaseClient): Promise<SchemaProbe> {
  try {
    const { data, error } = await client.rpc("health_probe");

    if (error) {
      return { ok: false, reachable: answered(error.code), error: error.message };
    }

    const report = data as { applied?: unknown; tables?: unknown } | null;

    // An older `health_probe()` answering a newer build is itself a schema that is
    // behind, so this reads as drift rather than as a crash. A probe that 500s is a
    // probe nobody can read the diagnosis off — which is why the `tables` check is
    // written against `readable` rather than `typeof … === "object"`, a test `null`
    // passes on its way to throwing two frames later.
    if (
      !Array.isArray(report?.applied) ||
      typeof (report.tables as TableProbe | null)?.readable !== "boolean"
    ) {
      return {
        ok: false,
        reachable: true,
        error: "health_probe() answered in a shape this build cannot read",
      };
    }

    return {
      ok: true,
      applied: report.applied as string[],
      tables: report.tables as TableProbe,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
