import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client for Storage and nothing else — the one client this codebase builds
 * for the browser.
 *
 * It holds no session, and that is the point. `persistSession` off means nothing is
 * written to `localStorage`, which is the storage class WebKit's Tracking Prevention
 * deletes after seven idle days and the whole reason this app's session lives in a
 * server-set cookie instead. Nothing here authenticates as anybody: a signed upload URL
 * carries its own token, minted server-side against the caller's real session, and that
 * token is the entire authorisation for the one request this client makes.
 *
 * It lives in `src/lib/supabase/` because that is where the lint rule on
 * `createClient` says clients get built — the rule exists to stop a session-bearing
 * client appearing in user-facing code, and the exemption is the directory rather than a
 * comment somebody can copy.
 *
 * Used for `uploadToSignedUrl()` only. Reads never come through it: they are signed URLs
 * rendered into an `<img>`, which needs no client at all.
 *
 * The two variables are read as literals rather than through `requiredEnv`, because only
 * a literal `process.env.NEXT_PUBLIC_…` is inlined into the client bundle — a dynamic
 * lookup compiles to `undefined` in the browser.
 */
export function createStorageClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
