import "server-only";

import type { ReminderMilestone } from "@/lib/reminders/schedule";

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

/** What the group is told a deadline is called. Hardcoded, like everything else here. */
const milestoneLabels: Record<ReminderMilestone, string> = {
  internal_quote: "内部报价截止",
  client_submission: "客户投标截止",
};

/** One milestone this Tender is being nudged about, as the message needs it. */
export type DueMilestone = {
  milestone: ReminderMilestone;
  /** The deadline itself, `yyyy-mm-dd` — never the day the reminder came due. */
  deadline: string;
  /** Days from today to that deadline. `0` is the morning of, and never negative. */
  daysLeft: number;
};

/**
 * One Tender's reminders for one cron run — **every** milestone it owes, in one message.
 *
 * The collapsing is the point rather than tidiness (ADR-0005, rule 4). Ten open Tenders
 * after a three-day outage is about ten messages if a run batches per Tender, and up to
 * sixty if it loops the pending rows instead — and the webhook is capped at twenty a
 * minute. The rule has to hold across missed days *and* across both milestones, which is
 * why this takes a list and not a milestone.
 *
 * `mentions` is likewise the union of everybody the surviving milestones point at: the
 * Assignees who have entered no Quotes at all, and the Owner. One message, one @-list.
 * Nobody is mentioned twice for the same Tender in the same run.
 *
 * The deadline is named, not the day the nudge fell due. A caught-up reminder is posted
 * late by definition, and "due 25 Aug" is the fact worth reading; which offset row
 * produced it is this app's bookkeeping.
 */
export function reminderMessage({
  reference,
  client,
  title,
  milestones,
  mentions,
}: {
  reference: string;
  client: string;
  title: string;
  milestones: DueMilestone[];
  mentions: string[];
}): GroupMessage {
  return {
    content: [
      `【招标跟踪】${reference} · ${client} · ${title}`,
      ...milestones.map(
        ({ milestone, deadline, daysLeft }) =>
          `${milestoneLabels[milestone]}:${deadline}${remaining(daysLeft)}`,
      ),
      "请进入系统跟进。",
    ].join("\n"),
    // The `@` is not written into the text — WeCom renders it from `mentioned_list`, and
    // writing it by hand would show each name twice.
    mentions,
  };
}

function remaining(daysLeft: number): string {
  return daysLeft === 0 ? "(就是今天)" : `(还剩 ${daysLeft} 天)`;
}
