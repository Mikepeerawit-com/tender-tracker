import { NextResponse, type NextRequest } from "next/server";

import { createSessionClient } from "@/lib/supabase/session-client";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

/**
 * Refreshes the session on every request, and turns anyone without one away.
 *
 * The refresh is the load-bearing half. Access tokens last an hour; the 30-day session
 * survives because each request quietly exchanges the refresh token and writes the new
 * pair back as `Set-Cookie`. Without this the app would work perfectly for an hour and
 * then log everyone out.
 *
 * (`proxy.ts`, not `middleware.ts` — the middleware filename is deprecated in Next 16.)
 */

/**
 * The paths that must not be behind the session gate, and why each one is not.
 *
 * Three of these are reached by somebody with no session *yet* — a redirected visitor, an
 * invite link opened before an account exists, an uptime probe that will never hold a
 * cookie. The fourth is different and is the one that was missing: **Vercel Cron
 * authenticates with a bearer token, not a cookie.** Redirecting it to `/login` does not
 * secure anything; it just means the run is answered with a 307 every night and the whole
 * reminder engine — every escalation, the missed submission, the decision chase — never
 * fires. It did exactly that until `src/proxy.test.ts` was written.
 *
 * Being listed here is not the same as being unprotected. `/api/cron/daily` gates itself
 * on `CRON_SECRET` and answers a bare 404 to anyone who fails, and `/api/health` is a
 * liveness probe by design. What this list says is "the session cookie is not the lock on
 * this door", which for the cron is a statement about *which* lock, not whether there is
 * one.
 */
const publicPaths = ["/login", "/auth/confirm", "/api/health", "/api/cron/daily"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  const store: SessionCookieStore = {
    getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
    set: (name, value, options) => {
      // Both sides: the request copy so anything rendering downstream sees the fresh
      // token, and the response so the browser is actually told about it.
      request.cookies.set(name, value);
      response.cookies.set(name, value, options);
    },
  };

  // `getUser()` is what performs the refresh, and it revalidates against the auth
  // server rather than trusting the cookie as sent.
  const {
    data: { user },
  } = await createSessionClient(store).auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!user && !isPublic) {
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
