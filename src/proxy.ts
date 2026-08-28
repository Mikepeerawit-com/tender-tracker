import { NextResponse, type NextRequest } from "next/server";

import { createSessionClient } from "@/lib/supabase/session-client";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

/**
 * Refreshes the session on every request, and turns anyone without one away.
 *
 * The refresh is the load-bearing half, and the only half. Access tokens last an hour;
 * the 30-day session survives because each request quietly exchanges the refresh token —
 * when, and only when, it has expired — and writes the new pair back as `Set-Cookie`.
 * Without this the app would work perfectly for an hour and then log everyone out.
 *
 * Turning people away is the other half, and it is deliberately the *weak* half. See the
 * note on `getSession()` below for what this does and does not decide.
 *
 * (`proxy.ts`, not `middleware.ts` — the middleware filename is deprecated in Next 16.)
 */

/**
 * The paths that must not be behind the session gate, and why each one is not.
 *
 * Four of these are reached by somebody with no session *yet* — a redirected visitor, an
 * invite link opened before an account exists, the setup screen on a database with no
 * accounts in it at all, an uptime probe that will never hold a cookie. The fifth is
 * different and is the one that was missing: **Vercel Cron
 * authenticates with a bearer token, not a cookie.** Redirecting it to `/login` does not
 * secure anything; it just means the run is answered with a 307 every night and the whole
 * reminder engine — every escalation, the missed submission, the decision chase — never
 * fires. It did exactly that until `src/proxy.test.ts` was written.
 *
 * Being listed here is not the same as being unprotected. `/api/cron/daily` gates itself
 * on `CRON_SECRET` and answers a bare 404 to anyone who fails, `/setup` gates itself on
 * `SETUP_SECRET` *and* on `users` being empty (ADR-0017), and `/api/health` is a liveness
 * probe by design. What this list says is "the session cookie is not the lock on this
 * door", which for the cron and for setup is a statement about *which* lock, not whether
 * there is one.
 */
const publicPaths = [
  "/login",
  "/auth/confirm",
  "/setup",
  "/api/health",
  "/api/cron/daily",
];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  const store: SessionCookieStore = {
    getAll: () =>
      request.cookies.getAll().map(({ name, value }) => ({ name, value })),
    set: (name, value, options) => {
      // Both sides: the request copy so anything rendering downstream sees the fresh
      // token, and the response so the browser is actually told about it.
      request.cookies.set(name, value);
      response.cookies.set(name, value, options);
    },
  };

  // `getSession()`, not `getUser()`. Both perform the refresh this file exists for — it
  // happens inside `__loadSession`, which exchanges the refresh token only once the
  // access token has actually expired — but `getUser()` additionally revalidates against
  // the auth server on *every* request. That is a network round trip standing in front of
  // every navigation, and in front of every RSC prefetch a screen fires off, for an
  // answer this file does not need.
  //
  // What is given up is nothing this file was relying on. The redirect below is an
  // optimistic check deciding whether to send somebody to the login screen, and Next's
  // own guidance is that Proxy "should not be used as a full session management or
  // authorization solution". The real gate is `(app)/layout.tsx`, which still calls
  // `currentUser()` and so still asks the auth server — and it is the stronger question
  // regardless, being the one that catches a disabled member. Every authenticated page
  // outside `(app)` (`/choose-language`, `/set-password`) gates itself the same way.
  //
  // So a forged cookie that merely parses as a session buys exactly one thing: reaching a
  // layout that asks the auth server about it and redirects to `/login`. It reads nothing.
  const {
    data: { session },
  } = await createSessionClient(store).auth.getSession();

  const { pathname } = request.nextUrl;
  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!session && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";

    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and image files. Note that `/login` is still
     * matched: a signed-out visitor needs the refresh attempt to run, and a page that
     * skips the proxy entirely never gets its cookies rewritten.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
