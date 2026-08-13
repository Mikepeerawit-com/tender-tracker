import type { SupabaseClient } from "@supabase/supabase-js";

import { InvalidRunInstantError, runInstantFrom } from "@/lib/run-instant";
import { createServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";

/**
 * Liveness probe: the app is up, and Postgres answered it.
 *
 * The one route handler ticket 21 ships. It is also the worked example of the
 * run-instant convention — the instant arrives from the boundary and is reported,
 * never read from the wall clock further in.
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

  // A deployment missing its Supabase credentials is a different fault from a
  // database that is down, and must not be reported as one: "unreachable" sends
  // someone to look at Postgres, which is fine.
  let client: SupabaseClient;

  try {
    client = createServiceClient();
  } catch (error) {
    return Response.json(
      {
        status: "misconfigured",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: checkedAt.toISOString(),
      },
      { status: 500 },
    );
  }

  if (await databaseAnswers(client)) {
    return Response.json({
      status: "ok",
      database: "reachable",
      checkedAt: checkedAt.toISOString(),
    });
  }

  return Response.json(
    {
      status: "degraded",
      database: "unreachable",
      checkedAt: checkedAt.toISOString(),
    },
    { status: 503 },
  );
}

async function databaseAnswers(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("health_check");
    return !error && data === true;
  } catch {
    return false;
  }
}
