import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requiredEnv } from "@/lib/env";

/**
 * The cookie jar a request carries, narrowed to what Supabase's session handling needs.
 *
 * Resolved at the request boundary and passed down, the same way the run instant is
 * (ADR-0010) and for the same reason: `cookies()` only works inside a Next request
 * context, so anything that reaches for it directly cannot be tested. Next's own
 * `cookies()` satisfies this shape as-is; so does an adapter over a `NextRequest` in
 * `proxy.ts`, and so does a plain object in a test.
 */
export type SessionCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Partial<SessionCookieOptions>): void;
};

export type SessionCookieOptions = {
  path: string;
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  // Widened to what both `@supabase/ssr` and Next's own cookie writer accept, so this
  // type can sit between them without either needing a cast.
  sameSite: boolean | "lax" | "strict" | "none";
};

const thirtyDaysInSeconds = 60 * 60 * 24 * 30;

/**
 * Why the session lives in a server-set cookie, and why nothing here is readable from
 * script.
 *
 * WebKit's Tracking Prevention deletes script-writable storage after 7 days without
 * user interaction. `localStorage` — which is where `supabase-js` puts a session by
 * default — is named in that capped set, and so are cookies written from
 * `document.cookie`. Only cookies arriving in a `Set-Cookie` header escape it.
 *
 * This app's usage is reminder-driven and therefore sparse by design: someone taps a
 * WeCom link when a deadline nears, which is precisely the pattern that sits outside a
 * 7-day window. A 30-day session that quietly becomes 7 is the failure, and it lands
 * inside the WeCom webview, where there is no way out to Safari to recover.
 *
 * So the session is written server-side only, and `httpOnly` is on: no client-side
 * Supabase client exists in this codebase, nothing in the browser needs to read the
 * cookie, and a session that script cannot read is a session XSS cannot take.
 */
export const sessionCookieOptions: SessionCookieOptions = {
  path: "/",
  // The cookie has to outlive the session, not define it: `[auth.sessions] timebox` in
  // supabase/config.toml is what actually ends it at 30 days. This bound only stops a
  // dead cookie being carried around for the library default of 400 days.
  maxAge: thirtyDaysInSeconds,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
};

/**
 * A Supabase client bound to one request's cookies, subject to RLS as that user.
 *
 * This is the client nearly everything should use. `createServiceClient` bypasses RLS
 * and belongs only in code that has already decided who is asking.
 */
export function createSessionClient(store: SessionCookieStore): SupabaseClient {
  return createServerClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookieOptions: sessionCookieOptions,
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            store.set(name, value, options);
          }
        },
      },
    },
  );
}

/**
 * An in-memory cookie jar. Used by the proxy to collect what Supabase wants to write
 * before copying it onto the response, and by tests to stand in for a browser.
 */
export function memoryCookieStore(
  initial: { name: string; value: string }[] = [],
): SessionCookieStore & { written: Map<string, string> } {
  const jar = new Map(initial.map(({ name, value }) => [name, value]));
  const written = new Map<string, string>();

  return {
    written,
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name, value) => {
      jar.set(name, value);
      written.set(name, value);
    },
  };
}
