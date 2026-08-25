import "server-only";

import { createServiceClient } from "@/lib/supabase/service-client";
import type { SessionCookieStore } from "@/lib/supabase/session-client";
import { currentUser } from "@/lib/auth/session";

import { webhookFor } from "./group-robot";
import { testMentionMessage } from "./messages";
import { sendGroupMessages, type RobotBoundary } from "./robot";

/**
 * The refusals that carry nothing but themselves. `send_failed` is kept out because it
 * arrives with WeCom's own answer attached, which is the one refusal an admin can act on.
 */
export const plainTestMentionRefusals = [
  "not_admin",
  "not_found",
  "no_userid",
  "no_robot",
] as const;

export const testMentionRefusals = [...plainTestMentionRefusals, "send_failed"] as const;

/**
 * `detail` carries WeCom's own words — its `errcode`/`errmsg`, an HTTP status, or the
 * transport's error. Surfaced rather than swallowed because this is the screen somebody
 * opens *because* notifications are not arriving, and "it didn't work" is not something
 * they can act on. The sentence around it comes from the message catalogue, so a
 * zh-Hans admin reads Chinese with WeCom's raw answer in brackets.
 */
export type TestMentionResult =
  | { ok: true }
  | { ok: false; reason: (typeof plainTestMentionRefusals)[number] }
  | { ok: false; reason: "send_failed"; detail: string };

/**
 * How a test mention can end, as a list rather than a bare union.
 *
 * The wording here carries more than legibility. `errcode 0` means accepted and never
 * notified, so this status is the only thing between the Org Admin and believing a
 * mention was delivered — `conventions.test.ts` holds the success string to what it may
 * promise, and `messages.test.ts` walks this to hold every status to having one at all.
 */
export const testMentionStatuses = [...testMentionRefusals, "sent"] as const;

export type TestMentionStatus = (typeof testMentionStatuses)[number];

/**
 * Post a test @mention to the WeCom group, aimed at one colleague.
 *
 * This is how a `wecom_userid` becomes trustworthy, and there is no substitute for it.
 * A nonexistent userid and an empty string are both accepted with `errcode 0` and
 * notify nobody (ticket 14), so nothing the API returns distinguishes a working
 * identifier from a typo. Only the colleague replying "got it" does.
 *
 * Org Admin-gated for two reasons: the userid it exercises is a field about somebody
 * else's account, and the message lands in a group chat the whole company reads. The
 * gate is here rather than in the page, because a server action is a public endpoint.
 */
export async function sendTestMention(
  { userId }: { userId: string },
  store: SessionCookieStore,
  boundary: RobotBoundary = {},
): Promise<TestMentionResult> {
  const caller = await currentUser(store);

  if (!caller?.isOrgAdmin) {
    return { ok: false, reason: "not_admin" };
  }

  const { data: member } = await createServiceClient()
    .from("users")
    .select("wecom_userid")
    .eq("id", userId)
    .eq("org_id", caller.orgId)
    .maybeSingle();

  if (!member) {
    return { ok: false, reason: "not_found" };
  }

  const wecomUserid = member.wecom_userid?.trim();

  if (!wecomUserid) {
    // Sending anyway would post a message to the group, mention nobody, and come back
    // `errcode 0` — success by every signal available, and a lie.
    return { ok: false, reason: "no_userid" };
  }

  // After the checks that need no round trip. An org with no Group Robot is not a
  // failed send and must not be reported as one: "try again" is useless advice, and
  // what is actually needed is one screen away.
  const webhook = await webhookFor(caller.orgId);

  if (webhook === null) {
    return { ok: false, reason: "no_robot" };
  }

  const [outcome] = await sendGroupMessages(
    webhook,
    [testMentionMessage({ wecomUserid })],
    boundary,
  );

  if (!outcome.ok) {
    return { ok: false, reason: "send_failed", detail: outcome.detail };
  }

  // Deliberately not "notified", "delivered" or "sent to Somchai". All that is known is
  // that WeCom accepted it. Whether it reached anyone is the human's half of this.
  return { ok: true };
}
