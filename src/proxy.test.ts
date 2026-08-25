import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

/**
 * Which paths the session gate turns away, and which it lets through.
 *
 * **This file exists because of a bug no other test could see.** Every route handler in
 * this project is tested by importing its `GET` and calling it, which is the right seam
 * for what a handler decides — and it steps straight over the proxy, which runs first and
 * can redirect the request before the handler is ever reached. `/api/cron/daily` sat
 * behind the session gate from the day it was written: Vercel Cron sends a bearer token
 * and no cookie, so every nightly run was answered with a redirect to `/login` and the
 * whole reminder engine never fired once in production.
 *
 * The assertions are therefore about **the proxy's answer for a path**, which is the one
 * thing `route.test.ts` structurally cannot ask.
 *
 * No database and no session: an unauthenticated request is exactly the case that matters,
 * and `getUser()` on a request with no cookies answers "nobody" without a round trip to
 * anything this test would have to stand up.
 */

/** A signed-out request for `path`, the way Vercel Cron or a stranger would make it. */
function signedOutRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://tenders.example.test"));
}

async function answerFor(path: string) {
  const response = await proxy(signedOutRequest(path));

  return {
    status: response.status,
    location: response.headers.get("location"),
  };
}

describe("what the session gate turns away", () => {
  it("redirects a signed-out visitor to the login screen", async () => {
    const { status, location } = await answerFor("/tenders");

    expect(status).toBe(307);
    expect(location).toContain("/login");
  });

  it("redirects a signed-out visitor away from a Tender's own page", async () => {
    expect((await answerFor("/tenders/abc/edit")).location).toContain("/login");
  });
});

describe("what the session gate lets through", () => {
  /**
   * Each of these is public for a reason of its own, and each reason is a different
   * caller: a signed-out human, a link in an email, an uptime probe, and Vercel Cron.
   */
  it.each([
    ["/login", "the screen a redirected visitor is being sent to"],
    ["/auth/confirm", "the link in an invite email, opened before any session exists"],
    ["/api/health", "an uptime probe, which carries no cookie and never will"],
    ["/api/cron/daily", "Vercel Cron, which carries a bearer token and no cookie"],
  ])("lets %s through — %s", async (path) => {
    const { status, location } = await answerFor(path);

    expect(location).toBeNull();
    expect(status).toBe(200);
  });
});

describe("the cron endpoint in particular", () => {
  it("is not defended by the session gate, and must not be", async () => {
    // The regression this file was written for. It is stated twice — once in the table
    // above with its siblings, and once here on its own — because the two say different
    // things: that one says "public", and this one says **why letting it through is safe**.
    //
    // The proxy is not what protects this route and never was. `authorised()` in the
    // handler compares `Authorization` against `CRON_SECRET` and answers a bare 404 to
    // anybody who fails, revealing not even whether a secret is configured. A cookie
    // check in front of that does not add a lock; it only ensures the real lock is never
    // reached by the one caller holding the key.
    const { status, location } = await answerFor("/api/cron/daily");

    expect(location).toBeNull();
    expect(status).toBe(200);
  });
});
