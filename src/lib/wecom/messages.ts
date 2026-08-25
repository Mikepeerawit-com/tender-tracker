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

/**
 * The line each milestone contributes to a Tender's message.
 *
 * A function per milestone rather than a label plus one shared sentence, because the four
 * do not say the same kind of thing. Three count down to a date that has not arrived; the
 * fourth reports a date that went by with nothing sent, and **that one is the loudest
 * thing this app says** — it is the failure the whole product exists to prevent, and a
 * line that read "客户投标截止:2026-09-01(还剩 -1 天)" would bury it in the format of a
 * routine nudge.
 *
 * `daysLeft` is therefore taken by the three that count down and ignored by the one that
 * does not, which is why it is an argument rather than something this record interpolates
 * for everybody.
 */
const milestoneLines: Record<
  ReminderMilestone,
  (date: string, daysLeft: number) => string
> = {
  internal_quote: (date, daysLeft) => `内部报价截止:${date}${remaining(daysLeft)}`,
  client_submission: (date, daysLeft) => `客户投标截止:${date}${remaining(daysLeft)}`,
  submission_missed: (date) =>
    `⚠️ 投标已错过!客户投标截止日期 ${date} 已过,我方仍未提交。`,
  decision_chase: (date) => `跟进客户决标:预计决标日期 ${date}。请联系客户询问结果。`,
};

/** One milestone this Tender is being nudged about, as the message needs it. */
export type DueMilestone = {
  milestone: ReminderMilestone;
  /**
   * The milestone's own date, `yyyy-mm-dd` — never the day the reminder came due.
   *
   * `date` rather than `deadline`, because one of the four is not one. The decision chase
   * carries the day the Owner picked to go and ask the client, which nothing is due on
   * and which CONTEXT.md is careful to keep out of the word "deadline".
   */
  date: string;
  /**
   * Days from today to that date. `0` is the morning of.
   *
   * Negative on `submission_missed`, which is the only milestone that comes due *after*
   * the date it is about — and the only one whose line does not read it.
   */
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
 * The milestone's own date is named, not the day the nudge fell due. A caught-up reminder
 * is posted late by definition, and "due 25 Aug" is the fact worth reading; which offset
 * row produced it is this app's bookkeeping.
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
      ...milestones.map(({ milestone, date, daysLeft }) =>
        milestoneLines[milestone](date, daysLeft),
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

/**
 * How each Milestone reads in the Digest — a listing, where the reminder lines are a
 * nudge.
 *
 * A second record beside {@link milestoneLines} rather than a reuse of it, because the
 * two are said for different reasons and it shows in the wording: a reminder ends by
 * telling somebody to go and do the thing, and a line that did that twelve times over
 * would be a Digest nobody reads to the bottom of. What they must not do is name the
 * same Milestone differently, which is why both are `Record<ReminderMilestone, …>` — a
 * fifth Milestone is a missing key in two places, at compile time.
 *
 * `daysLeft` is read by the two that count down, for the same reason it is in the
 * reminder: "还剩 -1 天" is a rounding bug where a missed submission is a failure.
 */
const digestSummaries: Record<
  ReminderMilestone,
  (date: string, daysLeft: number) => string
> = {
  internal_quote: (date, daysLeft) => `内部报价截止 ${date}${remaining(daysLeft)}`,
  client_submission: (date, daysLeft) => `客户投标截止 ${date}${remaining(daysLeft)}`,
  submission_missed: (date) => `⚠️ 已错过客户投标截止 ${date},仍未提交`,
  decision_chase: (date) => `等待客户决标,预计 ${date}`,
};

/** A Tender whose Bid is out with no chase date set — open, and dated by nothing. */
const undated = "已提交,等待客户决标(未设预计决标日期)";

/** One open Tender in the Digest: which it is, and what it is heading for. */
export type DigestLine = {
  reference: string;
  client: string;
  title: string;
  /** Null when nothing is dated ahead of it — see `@/lib/digest/digest.ts`. */
  next: DueMilestone | null;
};

/**
 * The **whole** content of a WeCom `text` message, in bytes.
 *
 * The documented cap is 2048 UTF-8 bytes, and the Digest is the one message in this app
 * whose length grows with the data: every other one is about a single Tender. At the
 * volume this product assumes — ~6–10 open Tenders — a line each is already within
 * sight of it, and a message that goes over is **refused whole**, so the morning's
 * Digest would vanish rather than arrive short.
 *
 * The budget is set below the cap rather than at it because Chinese characters are
 * three bytes each and a client name is not length-checked anywhere.
 */
const digestBudget = 1_800;

/**
 * Every open Tender and its next Milestone, in one message a day.
 *
 * **Nobody is @-ed.** It goes out every morning whether or not anything has changed, and
 * a daily mention is how a group learns to mute the robot — which would cost the
 * reminders, which are the messages that matter. It names Tenders and dates; the person
 * who has to act on one is named in the app.
 *
 * **It truncates rather than overflowing.** Lines are added while they fit
 * {@link digestBudget}, and whatever did not fit is *counted* in a final line — so a
 * long list arrives short and says so, instead of being refused whole and arriving not
 * at all. The count in the header is always the true one.
 */
export function digestMessage({ tenders }: { tenders: DigestLine[] }): GroupMessage {
  const head = `【招标跟踪】今日概览:共 ${tenders.length} 个进行中的招标`;
  const foot = "详情请进入系统查看。";
  const omission = (count: number) => `其余 ${count} 个未列出。`;

  // Reserved up front at its longest, so the line that says what was dropped can never
  // itself be the line that does not fit.
  const reserved = utf8Bytes(`\n${omission(tenders.length)}`);
  const lines: string[] = [];
  let used = utf8Bytes(head) + utf8Bytes(`\n${foot}`);

  for (const [index, tender] of tenders.entries()) {
    const line = digestLine(tender);
    const cost = utf8Bytes(`\n${line}`);
    // Nothing can be omitted after the last one, so it is not made to pay for the notice.
    const last = index === tenders.length - 1;

    if (used + cost + (last ? 0 : reserved) > digestBudget) break;

    used += cost;
    lines.push(line);
  }

  const omitted = tenders.length - lines.length;

  return {
    content: [
      head,
      ...lines,
      ...(omitted > 0 ? [omission(omitted)] : []),
      foot,
    ].join("\n"),
  };
}

function digestLine({ reference, client, title, next }: DigestLine): string {
  const summary =
    next === null ? undated : digestSummaries[next.milestone](next.date, next.daysLeft);

  return `${reference} · ${client} · ${title}:${summary}`;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The two Outcomes the group is told about. `no_bid` and `cancelled` are silent. */
export type AnnouncedOutcome = "won" | "lost";

/** How the group is told a Tender Item ended. */
const outcomeVerdicts: Record<AnnouncedOutcome, string> = {
  won: "中标",
  lost: "未中标",
};

/**
 * The head every outcome message shares: which Item of which Tender, and how it ended.
 *
 * Not exported, so `messages.test.ts` does not count it as a builder — and so the two
 * that are exported cannot drift into naming the same Item differently.
 */
function outcomeHead(
  { reference, client, item }: { reference: string; client: string; item: string },
  outcome: AnnouncedOutcome,
): string {
  return `【招标跟踪】${reference} · ${client} · ${item} — ${outcomeVerdicts[outcome]}`;
}

/**
 * The news, for the Assignee whose Quote we actually bid.
 *
 * Split from {@link otherQuotesOutcomeMessage} rather than folded into one message with
 * one @-list, because the two audiences are being told different facts. "Your supplier is
 * the one we went with" is feedback about their own sourcing; "we went with somebody
 * else's" is feedback about how theirs compared. A single wording would have to be vague
 * enough to be true for both, and vague is what makes a notification ignorable.
 *
 * Both endings are worth saying to this person. A `lost` here is not their failure — the
 * client chose elsewhere — but they are the one who will be asked why, and finding out
 * from the group beats finding out in a meeting.
 */
export function selectedQuoteOutcomeMessage({
  reference,
  client,
  item,
  outcome,
  mentions,
}: {
  reference: string;
  client: string;
  item: string;
  outcome: AnnouncedOutcome;
  mentions: string[];
}): GroupMessage {
  return {
    content: [
      outcomeHead({ reference, client, item }, outcome),
      outcome === "won"
        ? "你的报价被选用,并且中标了。"
        : "本次投标采用的是你的报价,客户最终选择了其他供应商。",
      "详情请进入系统查看。",
    ].join("\n"),
    mentions,
  };
}

/**
 * The news, for everybody else who quoted this Item.
 *
 * **This message is the entire reason outcome news is not restricted to the Assignee
 * whose Quote was selected.** Somebody who rang round their suppliers and was not chosen
 * has no other feedback anywhere in this app on how their supplier compared, and silence
 * teaches them that sourcing an Item they will not win is wasted effort — which is the
 * one habit ADR-0004's competing Assignees cannot survive.
 *
 * `selectedBy` names a **colleague**, never a supplier. Naming who we bid is what makes
 * the message actionable — it is who to go and ask — and it is exactly the disclosure
 * ADR-0012 permits, in the same breath as forbidding the supplier's own name. It is null
 * when the Item was decided with no Quote ever selected, and the attribution is then
 * dropped rather than guessed at.
 */
export function otherQuotesOutcomeMessage({
  reference,
  client,
  item,
  outcome,
  selectedBy,
  mentions,
}: {
  reference: string;
  client: string;
  item: string;
  outcome: AnnouncedOutcome;
  selectedBy: string | null;
  mentions: string[];
}): GroupMessage {
  return {
    content: [
      outcomeHead({ reference, client, item }, outcome),
      selectedBy === null
        ? "本次投标未记录选用的报价。"
        : `本次投标采用的是 ${selectedBy} 的报价。`,
      "你的报价未被选用。详情请进入系统查看。",
    ].join("\n"),
    mentions,
  };
}
