import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requiredEnv } from "@/lib/env";

/**
 * A Supabase client holding the service role key — it bypasses RLS, so it belongs
 * only in code that runs on the server and has already decided who is asking.
 *
 * User-facing requests use the `@supabase/ssr` cookie-backed clients instead, so
 * that RLS is the thing enforcing visibility.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
