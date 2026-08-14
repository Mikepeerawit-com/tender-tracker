import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * Where the invite link lands.
 *
 * The link carries a `token_hash` in the query string, not tokens in the fragment, so
 * the exchange happens here on the server and the resulting session is written with
 * `Set-Cookie`. A fragment never reaches a server at all: handling it would take
 * client-side script, and a session persisted from script is one WebKit clears after 7
 * idle days — which for a reminder-driven app is most of the time.
 *
 * This also has to work inside the WeCom in-app webview, because that is where every
 * reminder link lands and there is no way out of it into Safari. A plain server
 * redirect is the most boring thing that can possibly work there, which is the point.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type) {
    redirect("/login?error=link");
  }

  const store = await cookies();
  const { error } = await createSessionClient(store).auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    // Expired, already used, or tampered with. The invitee cannot fix any of those
    // themselves and there is no reset flow to send them into, so the login page says
    // to ask the Org Admin for a fresh invite.
    redirect("/login?error=link");
  }

  redirect("/set-password");
}
