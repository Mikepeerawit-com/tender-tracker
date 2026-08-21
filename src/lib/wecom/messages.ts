import "server-only";

import type { GroupMessage } from "./robot";

/**
 * Every message the group robot posts, in hardcoded Simplified Chinese.
 *
 * ## Why this text is outside next-intl
 *
 * These are broadcast into one WeCom group and rendered once, for everyone in it. There
 * is no reader whose locale could select between two versions — a per-user translation
 * would have to pick one anyway, and would pick it from whoever the message happened to
 * be *about*. This is the app's highest-volume output and it is not a screen, so it sits
 * outside the i18n system entirely rather than being half-inside it.
 *
 * ## Financial silence
 *
 * **No message here may carry a price, a margin, or a supplier's name.** A WeCom group
 * is a broadcast surface with a membership nobody in this app controls, and supplier
 * identity is commercially sensitive. The message names the Tender, the client, the Item
 * and the outcome, and @s the person — the financial detail lives in the app, which the
 * mention is there to drive people to. `messages.test.ts` enforces this by calling every
 * builder below with a fixture full of exactly those fields.
 *
 * ## Convention
 *
 * **Every builder takes a single object argument and returns a {@link GroupMessage}.**
 * That is what lets the financial-silence test call all of them, including ones added
 * after it was written.
 */

/**
 * The one-off test a colleague's `wecom_userid` has to survive before anything is
 * trusted to reach them.
 *
 * The message asks for a reply because a reply is the only evidence that exists:
 * `errcode 0` means accepted, never notified, so a bad userid and a good one are
 * indistinguishable from this side of the webhook. See ./robot.ts.
 *
 * The `@` itself is not written into the content — WeCom renders it from
 * `mentioned_list`, and writing it by hand would show the name twice.
 */
export function testMentionMessage({
  wecomUserid,
}: {
  wecomUserid: string;
}): GroupMessage {
  return {
    content: "【招标跟踪】测试通知:如果这条消息 @ 到了你,请回复确认。",
    mentions: [wecomUserid],
  };
}
