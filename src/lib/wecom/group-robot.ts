import "server-only";

import { currentUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service-client";
import type { SessionCookieStore } from "@/lib/supabase/session-client";

/**
 * The org's Group Robot: where its webhook is kept, and who may change it.
 *
 * The webhook is a **bearer credential** — anyone holding it can post to the company's
 * WeCom group as this app. Everything here follows from that:
 *
 * - It is read and written **only** through the service client. `group_robots` is
 *   revoked from `anon` and `authenticated` and carries no policy, so the anon key
 *   cannot reach it at all (ADR-0013, proven in `src/lib/supabase/rls.test.ts`).
 * - It is **never returned to a page**. {@link groupRobotStatus} is what screens ask
 *   for, and it deliberately cannot carry the URL. Only {@link webhookFor} yields the
 *   value, and only the send path calls it.
 * - It is never put in an error message or a log line.
 */

/** WeCom's own host. A webhook anywhere else is not a Group Robot. */
const wecomHost = "qyapi.weixin.qq.com";

/** What a screen may know: that there is one, and when it last changed. Never the URL. */
export type GroupRobotStatus = { configured: boolean; updatedAt: string | null };

export type SetGroupRobotResult =
  | { ok: true }
  | { ok: false; reason: "not_admin" | "not_a_wecom_webhook" | "save_failed" };

/**
 * Normalise a pasted webhook, or reject it.
 *
 * Trimming is not tidiness. Ticket 06 lost an entire measurement session to a URL
 * pasted with a stray newline, which failed every send with `URL rejected: Malformed
 * input`. Pasting from a chat client is the *only* way this value ever arrives, so the
 * whitespace is expected input rather than an edge case.
 *
 * Which is why what comes back is `url.href` and not the trimmed input. `new URL()`
 * *silently strips* tabs and newlines from anywhere inside a URL, so a webhook broken
 * across two lines by a chat client parses perfectly and would then be stored with the
 * newline still in it — validated, and still unusable at 08:00 the next morning. The
 * parse has to be what is kept, not merely what is checked.
 *
 * The host check is the other half. A webhook typed into the wrong box — a Slack hook,
 * a shortened link, an `http://` copy — would be accepted by the database and then fail
 * every night at 08:00, on the one path nobody is watching because its whole purpose is
 * to run unattended. Refusing it while somebody is standing at the form is the only
 * cheap moment there is.
 *
 * @returns the cleaned URL, or null if it is not a WeCom Group Robot webhook.
 */
export function normaliseWebhook(pasted: string): string | null {
  const trimmed = pasted.trim();

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== wecomHost) return null;
  // Credentials in the URL have no legitimate use here — WeCom's webhook authenticates
  // by the `key` alone — and they would be stored and never looked at again.
  if (url.username !== "" || url.password !== "") return null;
  // Without the key there is no robot to post to, and WeCom would answer every send
  // with the same errcode from a URL that otherwise looks perfectly correct.
  if (!url.searchParams.get("key")) return null;

  return url.href;
}

/**
 * Set, replace or clear the org's Group Robot webhook. `null` clears it.
 *
 * Org Admin-gated, and gated *here* rather than in the page, because a server action is
 * a public HTTP endpoint. This is the highest-value write in the app for anyone who
 * wants to read the company's tender traffic: repointing it is silent, and every send
 * afterwards still reports success.
 */
export async function setGroupRobot(
  { webhook }: { webhook: string | null },
  store: SessionCookieStore,
): Promise<SetGroupRobotResult> {
  const caller = await currentUser(store);

  if (!caller?.isOrgAdmin) {
    return { ok: false, reason: "not_admin" };
  }

  const service = createServiceClient();

  if (webhook === null) {
    const { error } = await service
      .from("group_robots")
      .delete()
      .eq("org_id", caller.orgId);

    // Reported rather than assumed: an admin who was told the robot was removed, and
    // whose org keeps posting to it, has been given the one answer they cannot debug.
    return error === null ? { ok: true } : { ok: false, reason: "save_failed" };
  }

  const url = normaliseWebhook(webhook);

  if (url === null) {
    return { ok: false, reason: "not_a_wecom_webhook" };
  }

  // `updated_at` is left to the database: the column defaults on insert and a trigger
  // moves it on replace, so no clock is read here (ADR-0010).
  const { error } = await service
    .from("group_robots")
    .upsert(
      { org_id: caller.orgId, webhook_url: url, updated_by: caller.id },
      { onConflict: "org_id" },
    );

  // A write that failed is not a webhook that was wrong. Reporting it as one sends the
  // admin back to re-check a URL that was fine.
  return error === null ? { ok: true } : { ok: false, reason: "save_failed" };
}

/**
 * What the admin screen renders: whether a robot is set up, and when it last changed.
 * Null when the caller is not an Org Admin.
 *
 * Returns no URL by construction. A screen that could accidentally render the webhook
 * is a screen that eventually does, and the value is one copy-paste away from being the
 * company group's back door.
 *
 * Null rather than an unconfigured-looking status, because those are different answers
 * and only one of them is true. "There is no robot" would send an Org Admin who is
 * looking at the wrong account off to set one up that already exists.
 */
export async function groupRobotStatus(
  store: SessionCookieStore,
): Promise<GroupRobotStatus | null> {
  const caller = await currentUser(store);

  if (!caller?.isOrgAdmin) return null;

  const { data } = await createServiceClient()
    .from("group_robots")
    .select("updated_at")
    .eq("org_id", caller.orgId)
    .maybeSingle();

  return { configured: data !== null, updatedAt: data?.updated_at ?? null };
}

/**
 * The org's webhook, or null if it has no Group Robot yet.
 *
 * Takes an org id rather than a session because the daily cron has no session — it runs
 * for every org, unattended. The only callers are send paths.
 */
export async function webhookFor(orgId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from("group_robots")
    .select("webhook_url")
    .eq("org_id", orgId)
    .maybeSingle();

  return data?.webhook_url ?? null;
}
