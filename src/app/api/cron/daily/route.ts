import { runDailyCron } from "@/lib/cron/daily";
import { InvalidRunInstantError, runInstantFrom } from "@/lib/run-instant";

export const dynamic = "force-dynamic";

/**
 * The one scheduled job in v1: 01:00 UTC, which is 08:00 in Bangkok and the start of the
 * Thai working day. Registered in `vercel.json`.
 *
 * The handler is deliberately thin: it decides whether this really is Vercel Cron
 * calling, resolves the instant from the request boundary (ADR-0010), and hands both to
 * `runDailyCron`. The work itself lives there because it stands at both of the outbound
 * boundaries this project stubs, and a route handler has nowhere to take them as
 * arguments.
 *
 * There is no separate "what time is it" path for scheduled work: Vercel Cron calls a
 * route, and a route is a request.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    // Nothing about why. This endpoint posts to the company's WeCom group, and an
    // unauthenticated caller learning whether a secret is even configured is a hint.
    return new Response("Not found", { status: 404 });
  }

  let at: Date;

  try {
    at = runInstantFrom(request);
  } catch (error) {
    if (error instanceof InvalidRunInstantError) {
      return Response.json({ status: "error", error: error.message }, { status: 400 });
    }
    throw error;
  }

  // Null rates say the day's fetch failed and the stored ones are older than they should
  // be. That is a fact about the run worth reading in the Vercel log — not an error, and
  // never a non-200: the reminders went out, which is the half anybody would notice.
  return Response.json({ status: "ok", ...(await runDailyCron(at)) });
}

/**
 * Vercel Cron signs its call with `Authorization: Bearer $CRON_SECRET`, and this route is
 * public HTTP like any other.
 *
 * A deployment with no `CRON_SECRET` set refuses every call rather than defaulting to
 * open. The failure mode of the alternative is that anybody who guesses the path can make
 * the app post to the company group as often as they like — and the fix ("set the
 * variable") is the same either way, so the closed default costs nothing.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  return (
    secret !== undefined &&
    secret !== "" &&
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}
