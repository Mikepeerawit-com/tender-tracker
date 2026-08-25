import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstantHeader } from "@/lib/run-instant";

import { GET } from "./route";

/**
 * The cron route's guard, and nothing else.
 *
 * What the run *does* is asserted in `src/lib/reminders/send.test.ts`, against the two
 * outbound boundaries a route handler has nowhere to take as arguments. What is left here
 * is the half that belongs to the handler: this endpoint posts to the company's WeCom
 * group, so it must refuse anybody who is not Vercel Cron — and it must refuse before it
 * does any work at all.
 *
 * Every case below is therefore one that returns before the first query — a run that
 * really executed would reach Frankfurter and the webhook, and a test that reaches the
 * network is a test that fails on a train. The correct secret is proved by a request that
 * gets past the guard and is then rejected for its instant: a 400 there is only reachable
 * once the bearer token has matched. That the header is disregarded rather than honoured
 * in a production build is a property of `runInstantFrom` itself, held by
 * `src/app/api/health/route.test.ts`.
 */

const secret = "not-the-real-one";

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/daily", { headers });
}

function asCron(headers: Record<string, string> = {}): Request {
  return cronRequest({ authorization: `Bearer ${secret}`, ...headers });
}

describe("GET /api/cron/daily", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives an unauthenticated caller nothing to work with", async () => {
    // Not a 401: whether a secret is even configured is itself a hint, on an endpoint
    // whose whole capability is posting into a group chat the company reads.
    const response = await GET(cronRequest());

    expect(response.status).toBe(404);
  });

  it("refuses a wrong secret", async () => {
    const response = await GET(cronRequest({ authorization: "Bearer guessed" }));

    expect(response.status).toBe(404);
  });

  it("refuses everything when the deployment has no secret set", async () => {
    // Closed by default. The failure mode of the alternative is that anybody who guesses
    // the path can make the app post to the group as often as they like.
    vi.stubEnv("CRON_SECRET", "");

    expect((await GET(cronRequest())).status).toBe(404);
    expect((await GET(asCron())).status).toBe(404);
  });

  it("rejects an unparseable run instant rather than guessing one", async () => {
    // Past the guard — which is the only way to reach this — and refused on the instant.
    // A pinned instant that quietly became the wall clock would make a test pass by lying.
    const response = await GET(asCron({ [runInstantHeader]: "the night before" }));

    expect(response.status).toBe(400);
  });
});
