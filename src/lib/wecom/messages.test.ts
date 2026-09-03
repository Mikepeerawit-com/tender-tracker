import { describe, expect, it } from "vitest";

import * as builders from "./messages";
import type { GroupMessage } from "./robot";

/**
 * What may and may not be said in the WeCom group.
 *
 * The group is a broadcast surface whose membership nobody in this app controls, and
 * the messages posted to it are the app's highest-volume output. The rules below are
 * the ones that cannot be recovered from: a price posted into a group chat cannot be
 * unposted, and a supplier's name reaching a client's ear is a commercial problem, not
 * a bug report. See ADR-0012.
 *
 * Every builder is called by introspection rather than by name, so a message added for
 * the reminders (#33), the outcome news (#34) or the Digest (#35) is covered by these
 * rules the day it is written, without anyone remembering to come back here.
 */

/**
 * One fixture, wide enough to satisfy any builder — and salted with exactly the fields
 * a future builder might reach for and must not. A sentinel appearing in a message is
 * the failure this file exists to catch.
 */
const fixture = {
  wecomUserid: "somchai",
  name: "Somchai",
  reference: "1042",
  client: "Bangkok Hospital",
  item: "PICC catheter 4Fr",
  title: "Surgical consumables Q3",
  outcome: "won",
  quantity: 12,
  daysLeft: 3,
  // Widened for the reminder batch (#33): one message carries every milestone a Tender
  // owes in this run, and the union of everybody they point at.
  milestones: [
    { milestone: "internal_quote", date: "2026-08-25", daysLeft: 3 },
    { milestone: "client_submission", date: "2026-09-01", daysLeft: 0 },
    // The one milestone that comes due *after* the date it names, and so the only one
    // with a negative count. A line that read "还剩 -1 天" would pass every rule below.
    { milestone: "submission_missed", date: "2026-09-01", daysLeft: -1 },
    { milestone: "decision_chase", date: "2026-09-20", daysLeft: 5 },
  ],
  mentions: ["somchai", "anong"],
  // Widened for the Digest (#35): it is the one message whose length grows with the
  // data, and the one that has to say something about a Tender with no date ahead of it.
  tenders: [
    {
      reference: "1042",
      client: "Bangkok Hospital",
      title: "Surgical consumables Q3",
      next: { milestone: "internal_quote", date: "2026-08-25", daysLeft: 3 },
    },
    {
      reference: "1043",
      client: "Chiang Mai Clinic",
      title: "Ward furniture",
      next: null,
    },
  ],
  // Widened for the outcome news (#34): a **colleague's** name, which is the one identity
  // ADR-0012 permits a message to carry. `supplier` below is the one it never may.
  selectedBy: "Nok",
  // Widened for the way into the app (#59). Present rather than null on purpose: without
  // it every rule below would only ever be asked about the linkless branch, and the
  // branch that carries a URL — the one that could smuggle an id, a query string or a
  // locale past these rules — would go unguarded. See `@/lib/app-links.ts`.
  link: "https://tenders.example.com/tenders/8f0e2d1c",
  // None of these may ever leave the app.
  supplier: "SENTINEL-SUPPLIER-ACME",
  price: "SENTINEL-PRICE",
  sellingPrice: "SENTINEL-SELLING-PRICE",
  landedCost: "SENTINEL-LANDED-COST",
  margin: "SENTINEL-MARGIN",
} as const;

const sentinels: string[] = Object.values(fixture)
  .map(String)
  .filter((value) => value.startsWith("SENTINEL-"));

type Rule = { name: string; offences: (message: GroupMessage) => string[] };

/** Everything a message carries, mentions included — a sentinel hides just as well there. */
function everything(message: GroupMessage): string {
  return [message.content, ...(message.mentions ?? [])].join(" ");
}

const rules: Rule[] = [
  {
    name: "names no supplier, price, cost or margin",
    offences: (message) =>
      sentinels.filter((sentinel) => everything(message).includes(sentinel)),
  },
  {
    name: "quotes no money at all",
    // Not just the fixture's fields: a hardcoded figure or a currency symbol is the
    // same disclosure by a different route.
    offences: (message) =>
      message.content.match(/[฿¥$€£]|THB|CNY|USD|EUR|\d+(\.\d+)?\s*%/g) ?? [],
  },
  {
    name: "is written in Simplified Chinese",
    // Hardcoded and not switchable: one group, one rendering, read once by everyone.
    offences: (message) => (/[一-鿿]/.test(message.content) ? [] : [message.content]),
  },
  {
    name: "uses no markdown",
    // `text` is the only message type that carries a mention, and it renders markdown
    // literally — so formatting here reaches the group as punctuation.
    offences: (message) =>
      message.content.match(/\*\*|__|\[.+\]\(.+\)|^#{1,6}\s|^[-*]\s/gm) ?? [],
  },
  {
    name: "mentions people by userid, never by mobile number",
    // A mis-formatted mobile binds for nobody and still returns errcode 0, so one
    // mistake makes the whole org silently unreachable at once.
    offences: (message) =>
      (message.mentions ?? []).filter((mention) => /^[+\d][\d\s-]{6,}$/.test(mention)),
  },
  {
    name: "asks the reader for something, somewhere in it",
    // #99: these messages are this app's manual. A help page is the tax paid for an
    // interface that did not get simple enough and a tour is dismissed once and never
    // found again, so `docs/simplification-scope.md` ships neither — the teaching happens
    // here, in the sentence somebody is reading in WeCom anyway.
    //
    // **This is a floor and not the guard**, and the name says so. It goes red on a
    // builder added later that asks the reader for nothing at all, which is the fault an
    // introspecting rule can see; it cannot see a *line* going back to a bare report,
    // because every message carries a 请 somewhere else. That regression is #99's actual
    // one, and it is pinned per line in "the role each reminder line addresses" below.
    offences: (message) => (message.content.includes("请") ? [] : [message.content]),
  },
  {
    name: "says none of the retired words for a Tender or an Item",
    // The settled vocabulary (#87, #88). These strings are hardcoded here rather than in
    // `zh-Hans.json`, so the guard that retired 标书, 条目, 明细 and bare 产品 across the
    // screens cannot see them — and this is the app's highest-volume Chinese. 标书 is the
    // bid document *we send back*, and pointed at the opposite end of the exchange from
    // the client's enquiry it was being used for.
    offences: (message) => message.content.match(/标书|条目|明细|产品(?!项)/g) ?? [],
  },
  {
    name: "renders every field it reached for",
    // The fixture is passed to every builder by introspection, so a builder wanting a
    // field it does not carry would quietly interpolate `undefined` — and a message
    // full of holes would satisfy every other rule here.
    offences: (message) =>
      message.content.includes("undefined") || message.content.trim() === ""
        ? [message.content]
        : [],
  },
];

/**
 * Builders differ in what they take, and every one of them is called with the same
 * over-wide fixture. The widening is the point, not a shortcut: a builder this cannot
 * call is a builder this guard cannot see.
 */
type Builder = (input: typeof fixture) => GroupMessage;

const everyMessage = Object.entries(builders)
  .filter(([, value]) => typeof value === "function")
  .map(([name, build]) => [name, (build as unknown as Builder)(fixture)] as const);

describe("the messages the group robot posts", () => {
  it("has some — an introspecting guard that matches nothing guards nothing", () => {
    expect(everyMessage.length).toBeGreaterThan(0);
  });

  describe.each(everyMessage)("%s", (_name, message) => {
    it.each(rules)("$name", (rule) => {
      expect(rule.offences(message)).toEqual([]);
    });
  });
});

/**
 * Proof that the rules above bite.
 *
 * The builders `./messages` exports touch none of the fixture's sentinels, so every rule
 * above passes without being asked anything hard. That makes them true but not yet
 * load-bearing, and a guard nobody has watched fail is a guard nobody should trust.
 *
 * This is the message a tired person would write for the outcome news (#34): the
 * client's own words, the supplier who won it, the number the boss asked about, bolded
 * for emphasis, @ing the assignee by the phone number that is easiest to find.
 */
describe("the rules themselves", () => {
  const leaky: GroupMessage = {
    content: `**${fixture.client}** ${fixture.item} 中标 ${fixture.supplier} ฿1200 毛利 ${fixture.margin} 25%`,
    mentions: ["0933555055"],
  };

  it.each([
    "names no supplier, price, cost or margin",
    "quotes no money at all",
    "uses no markdown",
    "mentions people by userid, never by mobile number",
  ])("catches a message that breaks %s", (name) => {
    const rule = rules.find((candidate) => candidate.name === name);

    expect(rule?.offences(leaky).length).toBeGreaterThan(0);
  });

  /**
   * The message #99 was filed about: every fact correct, nothing forbidden said, and no
   * idea in it what the reader is supposed to do. It is what all four milestone lines
   * looked like, and it satisfies every other rule in the list.
   */
  const reporting: GroupMessage = {
    content: `【招标跟踪】${fixture.reference} · ${fixture.client}\n内部报价截止:2026-08-25`,
  };

  /**
   * The same message in the vocabulary #87 and #88 retired — five words for two things,
   * and not one of them wrong on its own line, which is why they survived on the screens
   * for as long as they did. It asks the reader to do something, so it clears the rule
   * above and is caught only by the one it is here for.
   */
  const stale: GroupMessage = {
    content: "【招标跟踪】本标书的招标明细已有报价,请进入系统查看该条目下的产品。",
  };

  it("catches a message that only reports a condition", () => {
    const rule = rules.find(
      (candidate) => candidate.name === "asks the reader for something, somewhere in it",
    );

    expect(rule?.offences(reporting).length).toBeGreaterThan(0);
    expect(rules.flatMap((other) => other.offences(reporting))).toEqual([
      reporting.content,
    ]);
  });

  it("catches a message written in the retired vocabulary", () => {
    const rule = rules.find((candidate) =>
      candidate.name.startsWith("says none of the retired words"),
    );

    // Every one of the four, named, so a failure says which word came back.
    expect(rule?.offences(stale)).toEqual(["标书", "明细", "条目", "产品"]);
  });

  it("passes the message the app actually sends", () => {
    const real = builders.testMentionMessage({ wecomUserid: "somchai" });

    expect(rules.flatMap((rule) => rule.offences(real))).toEqual([]);
  });
});

describe("testMentionMessage", () => {
  it("@s the one person it is verifying", () => {
    expect(builders.testMentionMessage({ wecomUserid: "anong" }).mentions).toEqual([
      "anong",
    ]);
  });

  it("asks for a reply, because a reply is the only evidence there is", () => {
    // `errcode 0` means accepted, never notified. A human confirming receipt is the
    // entire verification mechanism — the API will never tell us.
    expect(builders.testMentionMessage({ wecomUserid: "anong" }).content).toContain(
      "确认",
    );
  });
});

describe("the missed submission, which is the loudest thing the robot says", () => {
  const missed = builders.reminderMessage({
    reference: "T-1042",
    client: "Bangkok General Hospital",
    title: "Surgical consumables Q3",
    milestones: [
      { milestone: "submission_missed", date: "2026-09-01", daysLeft: -1 },
    ],
    mentions: ["somchai"],
    link: null,
  });

  it("says the deadline passed with nothing submitted", () => {
    expect(missed.content).toContain("2026-09-01");
    expect(missed.content).toContain("错过");
  });

  it("counts no days down, because the date it names is behind us", () => {
    // The generic countdown would render "(还剩 -1 天)" here, which reads as a rounding
    // bug rather than as the failure this whole product exists to prevent.
    expect(missed.content).not.toMatch(/还剩|就是今天/);
  });
});

describe("the decision chase", () => {
  it("asks the Owner to go and ask the client", () => {
    const chase = builders.reminderMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      milestones: [
        { milestone: "decision_chase", date: "2026-09-20", daysLeft: 0 },
      ],
      mentions: ["somchai"],
      link: null,
    });

    expect(chase.content).toContain("2026-09-20");
    expect(chase.content).toContain("决标");
  });
});

describe("the outcome news", () => {
  const head = {
    reference: "T-1042",
    client: "Bangkok General Hospital",
    item: "PICC catheter 4Fr",
    mentions: ["somchai"],
    // These tests are about the wording, which #59 did not change. The link has its own
    // describe at the foot of this file.
    link: null,
  };

  it("tells the Assignee we bid that it was their quote", () => {
    const won = builders.selectedQuoteOutcomeMessage({ ...head, outcome: "won" });

    expect(won.content).toContain("中标");
    expect(won.content).toContain("你的报价");
  });

  it("words a loss differently from a win for the same person", () => {
    // Both are worth saying to whoever we bid, and they are not the same news.
    const won = builders.selectedQuoteOutcomeMessage({ ...head, outcome: "won" });
    const lost = builders.selectedQuoteOutcomeMessage({ ...head, outcome: "lost" });

    expect(lost.content).not.toBe(won.content);
    expect(lost.content).toContain("未中标");
  });

  it("tells everybody else whose quote we went with instead", () => {
    // The whole reason the news is not restricted to the winner: this is the only
    // feedback a non-selected Assignee gets on how their supplier compared.
    const others = builders.otherQuotesOutcomeMessage({
      ...head,
      outcome: "won",
      selectedBy: "Nok",
      mentions: ["anong"],
    });

    expect(others.content).toContain("Nok");
    expect(others.content).toContain("未被选用");
  });

  it("differs from what the selected Assignee is told", () => {
    expect(
      builders.otherQuotesOutcomeMessage({ ...head, outcome: "won", selectedBy: "Nok" })
        .content,
    ).not.toBe(builders.selectedQuoteOutcomeMessage({ ...head, outcome: "won" }).content);
  });

  it("names nobody when no Quote was ever selected, rather than guessing", () => {
    const unattributed = builders.otherQuotesOutcomeMessage({
      ...head,
      outcome: "lost",
      selectedBy: null,
    });

    expect(unattributed.content).not.toContain("null");
    expect(unattributed.content).toContain("未记录");
  });

  it("writes no @ into the text, which WeCom renders from the mention list", () => {
    expect(
      builders.selectedQuoteOutcomeMessage({ ...head, outcome: "won" }).content,
    ).not.toContain("@");
  });
});

describe("reminderMessage", () => {
  const message = builders.reminderMessage({
    reference: "T-1042",
    client: "Bangkok General Hospital",
    title: "Surgical consumables Q3",
    milestones: [
      { milestone: "internal_quote", date: "2026-08-25", daysLeft: 3 },
      { milestone: "client_submission", date: "2026-09-01", daysLeft: 0 },
    ],
    mentions: ["somchai", "anong"],
    link: null,
  });

  it("carries every milestone the Tender owes in one message", () => {
    // Rule 4: a run that posts one message per pending reminder row turns a three-day
    // backlog into sixty messages against a twenty-a-minute cap.
    expect(message.content).toContain("2026-08-25");
    expect(message.content).toContain("2026-09-01");
  });

  it("names the deadline, not the day the nudge fell due", () => {
    // A caught-up reminder is late by definition. Which offset row produced it is
    // bookkeeping; the date the client is expecting something is the fact worth reading.
    const late = builders.reminderMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      milestones: [
        { milestone: "client_submission", date: "2026-09-01", daysLeft: 7 },
      ],
      mentions: [],
      link: null,
    });

    expect(late.content).toContain("2026-09-01");
  });

  it("says a deadline is today rather than counting zero days to it", () => {
    const today = builders.reminderMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      milestones: [
        { milestone: "internal_quote", date: "2026-08-25", daysLeft: 0 },
      ],
      mentions: [],
      link: null,
    });

    expect(today.content).toContain("今天");
    expect(today.content).not.toContain("0 天");
  });

  it("@s everybody the milestones point at, once each", () => {
    expect(message.mentions).toEqual(["somchai", "anong"]);
  });

  it("writes no @ into the text, which WeCom renders from the mention list", () => {
    expect(message.content).not.toContain("@");
  });
});

/**
 * Who each milestone's line speaks to, in the line itself (#99).
 *
 * The audience is already a property of the Milestone — `@/lib/reminders/send.ts` states
 * it once, in `milestoneRules`, and that is what decides who gets @-ed. What was missing
 * is that the *sentence* never said it, so somebody @-ed about a Tender owing two
 * milestones had to work out which half was theirs. These pin the two halves apart, in
 * the words #87 settled: 负责人 is the Owner and nobody else, 参与人 is the Assignee.
 */
describe("the role each reminder line addresses", () => {
  const lineFor = (milestone: builders.DueMilestone["milestone"]) =>
    builders.reminderMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      milestones: [{ milestone, date: "2026-09-01", daysLeft: 2 }],
      mentions: ["somchai"],
      link: null,
    }).content;

  it("asks 参与人 for the prices, because that is who the internal deadline reaches", () => {
    // `milestoneRules.internal_quote.audience` is the Assignees who still owe a Quote —
    // the Owner is not @-ed by this one at all, so naming them here would address a
    // person the message never reached.
    const line = lineFor("internal_quote");

    expect(line).toContain("参与人");
    expect(line).not.toContain("负责人");
  });

  it.each(["client_submission", "submission_missed", "decision_chase"] as const)(
    "asks 负责人 on %s, which is the only person it reaches",
    (milestone) => {
      const line = lineFor(milestone);

      expect(line).toContain("负责人");
      expect(line).not.toContain("参与人");
    },
  );

  it.each([
    "internal_quote",
    "client_submission",
    "submission_missed",
    "decision_chase",
  ] as const)("asks for something on %s, in the line itself", (milestone) => {
    // The regression #99 is about, pinned where it can actually be seen. The whole-message
    // rule cannot: `reminderMessage` always appends 请进入系统完成以上操作, so all four
    // lines could go back to bare dates and it would stay green. This reads the milestone
    // line alone — index 1, after the head and before the footer.
    const line = lineFor(milestone).split("\n")[1];

    expect(line).toContain("请");
  });

  it("names the screen or the control, not just the app", () => {
    // "请进入系统跟进" is where this started: true, and no help to somebody who has the
    // app open and does not know which of its screens wants them.
    expect(lineFor("internal_quote")).toContain("我的工作");
    expect(lineFor("client_submission")).toContain("记录投标已送出");
  });

  it("stays inside WeCom's cap with every milestone the Tender can owe at once", () => {
    // The instruction wording roughly trebled a milestone line, and a Tender caught up
    // after an outage carries all four in one message. A `text` message over 2048 bytes
    // is refused whole, and this is the one reminder shape that could reach it — the
    // Digest has a budget of its own; this one had never needed one.
    const everything = builders.reminderMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital and Medical Centre, Sukhumvit",
      title: "Surgical consumables and ward furniture, Q3 restock",
      milestones: [
        { milestone: "internal_quote", date: "2026-08-25", daysLeft: 3 },
        { milestone: "client_submission", date: "2026-09-01", daysLeft: 0 },
        { milestone: "submission_missed", date: "2026-09-01", daysLeft: -1 },
        { milestone: "decision_chase", date: "2026-09-20", daysLeft: 5 },
      ],
      mentions: ["somchai", "anong"],
      link: "https://tenders.example.com/tenders/8f0e2d1c",
    });

    expect(new TextEncoder().encode(everything.content).length).toBeLessThanOrEqual(2048);
  });
});

describe("the daily Digest", () => {
  const line = (reference: string, daysLeft: number) => ({
    reference,
    client: "Bangkok General Hospital",
    title: "Surgical consumables Q3",
    next: {
      milestone: "client_submission" as const,
      date: "2026-09-01",
      daysLeft,
    },
  });

  it("lists every open Tender and the milestone it is heading for", () => {
    const digest = builders.digestMessage({
      tenders: [
        {
          reference: "T-1042",
          client: "Bangkok General Hospital",
          title: "Surgical consumables Q3",
          next: { milestone: "internal_quote", date: "2026-08-25", daysLeft: 3 },
        },
        {
          reference: "T-1043",
          client: "Chiang Mai Clinic",
          title: "Ward furniture",
          next: { milestone: "submission_missed", date: "2026-08-20", daysLeft: -5 },
        },
      ],
      link: null,
    });

    expect(digest.content).toContain("T-1042");
    expect(digest.content).toContain("2026-08-25");
    expect(digest.content).toContain("T-1043");
    expect(digest.content).toContain("2026-08-20");
    expect(digest.content).toContain("共 2 个");
  });

  it("@s nobody, because a daily mention is how a group learns to mute the robot", () => {
    // The reminders are the messages that matter, and they arrive through the same
    // robot. A Digest that pinged people every morning would cost them their audience.
    expect(builders.digestMessage({ tenders: [line("T-1042", 3)], link: null }).mentions).toBe(
      undefined,
    );
  });

  it("counts no days down on a submission already missed", () => {
    const digest = builders.digestMessage({
      tenders: [
        {
          reference: "T-1042",
          client: "Bangkok General Hospital",
          title: "Surgical consumables Q3",
          next: { milestone: "submission_missed", date: "2026-08-20", daysLeft: -5 },
        },
      ],
      link: null,
    });

    expect(digest.content).toContain("错过");
    expect(digest.content).not.toMatch(/还剩|就是今天/);
  });

  it("says so plainly when a Tender has no date ahead of it", () => {
    // Submitted, with no chase date set. There is no honest day to name, and a guessed
    // one would send somebody to the client a week early.
    const digest = builders.digestMessage({
      tenders: [
        {
          reference: "T-1042",
          client: "Bangkok General Hospital",
          title: "Surgical consumables Q3",
          next: null,
        },
      ],
      link: null,
    });

    expect(digest.content).toContain("等待客户决标");
    expect(digest.content).not.toContain("null");
  });

  it("arrives short and says so rather than being refused whole", () => {
    // WeCom caps a text message at 2048 bytes and refuses anything over it outright, so
    // an org with a long list would lose the entire morning's Digest rather than the
    // tail of it. The header still counts them all.
    const many = Array.from({ length: 60 }, (_value, index) =>
      line(`T-${1000 + index}`, index),
    );
    const digest = builders.digestMessage({ tenders: many, link: null });

    expect(new TextEncoder().encode(digest.content).length).toBeLessThanOrEqual(2048);
    expect(digest.content).toContain("共 60 个");
    expect(digest.content).toMatch(/其余 \d+ 个未列出/);
    // The tail is what was dropped: the soonest are listed, which is the half worth
    // reading.
    expect(digest.content).toContain("T-1000");
    expect(digest.content).not.toContain("T-1059");
  });

  it("tells the reader what to do with the list, once, at the top", () => {
    // Once and not per line: the Digest is a listing of every open Tender, and a line
    // that told somebody what to do twelve times over is a Digest nobody reads to the
    // bottom of. Both roles are named because it @s nobody and is read by everybody.
    const digest = builders.digestMessage({ tenders: [line("T-1042", 3)], link: null });

    expect(digest.content).toContain("参与人");
    expect(digest.content).toContain("负责人");
    expect(digest.content.match(/参与人/g)).toHaveLength(1);
  });

  it("keeps that instruction when the list is too long to print", () => {
    // In the head rather than the footer precisely so the truncation cannot reach it. A
    // reader whose org has sixty open Tenders is the one most in need of being told what
    // the list is for.
    const many = Array.from({ length: 60 }, (_value, index) =>
      line(`T-${1000 + index}`, index),
    );
    const digest = builders.digestMessage({ tenders: many, link: null });

    expect(digest.content.split("\n")[1]).toContain("参与人");
    expect(digest.content).toMatch(/其余 \d+ 个未列出/);
  });

  it("calls itself the daily summary, which is what CONTEXT.md says it is", () => {
    // 每日摘要 — the settled label. 今日概览 was a sixth name for a thing with no screen.
    expect(
      builders.digestMessage({ tenders: [line("T-1042", 3)], link: null }).content,
    ).toContain("每日摘要");
  });

  it("names no omission when everything fitted", () => {
    expect(
      builders.digestMessage({ tenders: [line("T-1042", 3)], link: null }).content,
    ).not.toContain("未列出");
  });
});

/**
 * The way into the app (#59).
 *
 * Every message here already ended by telling the reader to go and look, and none of them
 * said where. These tests are about the sentence that closes that gap and about the two
 * things it must not cost: the Digest's byte budget, and the messages themselves when the
 * deployment was never told its own origin.
 */
describe("the link into the app", () => {
  const link = "https://tenders.example.com/tenders/8f0e2d1c";

  const reminder = (into: string | null) =>
    builders.reminderMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      milestones: [{ milestone: "client_submission", date: "2026-09-01", daysLeft: 2 }],
      mentions: ["somchai"],
      link: into,
    });

  const outcomes = (into: string | null) => [
    builders.selectedQuoteOutcomeMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      item: "PICC catheter 4Fr",
      outcome: "won",
      mentions: ["somchai"],
      link: into,
    }),
    builders.otherQuotesOutcomeMessage({
      reference: "T-1042",
      client: "Bangkok General Hospital",
      item: "PICC catheter 4Fr",
      outcome: "won",
      selectedBy: "Nok",
      mentions: ["anong"],
      link: into,
    }),
  ];

  const digest = (into: string | null) =>
    builders.digestMessage({
      tenders: [
        {
          reference: "T-1042",
          client: "Bangkok General Hospital",
          title: "Surgical consumables Q3",
          next: { milestone: "internal_quote", date: "2026-08-25", daysLeft: 3 },
        },
      ],
      link: into,
    });

  const linked = [
    ["a reminder", reminder(link)],
    ["the news for the selected Quote", outcomes(link)[0]],
    ["the news for everybody else who quoted", outcomes(link)[1]],
    ["the Digest", digest(link)],
  ] as const;

  it.each(linked)("%s carries it", (_name, message) => {
    expect(message.content).toContain(link);
  });

  it.each(linked)("%s puts it alone on the last line, so WeCom autolinks it", (_name, message) => {
    // A bare URL on its own line is what WeCom turns into something tappable. Wrapped in
    // a sentence — "详情见 https://…。" — the trailing punctuation goes into the href,
    // and the reader gets a 404 from a message nobody can edit.
    const lines = message.content.split("\n");

    expect(lines[lines.length - 1]).toBe(link);
  });

  it.each(linked)("%s says nothing extra around it", (_name, message) => {
    // #59 is explicit that no message's wording changes beyond gaining the link. The
    // instruction to go and look was already there; this only tells the reader where.
    expect(message.content.replace(`\n${link}`, "")).not.toContain("http");
  });

  /**
   * The whole reason a missing origin is allowed to be quiet: reminders are the product,
   * and a run that refused to post over an unset configuration line would cause the exact
   * failure this app exists to prevent. See `@/lib/app-links.ts`.
   */
  it.each([
    ["a reminder", reminder(null), reminder(link)],
    ["the news for the selected Quote", outcomes(null)[0], outcomes(link)[0]],
    ["the news for everybody else who quoted", outcomes(null)[1], outcomes(link)[1]],
    ["the Digest", digest(null), digest(link)],
  ])("%s is exactly the message it was before when there is none", (_name, without, with_) => {
    expect(without.content).not.toContain("http");
    // Not merely "no URL": no stray blank line, no dangling separator, nothing that
    // reads as a link that failed to render.
    expect(without.content).toBe(with_.content.replace(`\n${link}`, ""));
    expect(without.content.endsWith("\n")).toBe(false);
  });

  describe("the Digest, which is the one message with a budget", () => {
    const line = (reference: string) => ({
      reference,
      client: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      next: { milestone: "client_submission" as const, date: "2026-09-01", daysLeft: 4 },
    });

    it("carries exactly one, in its footer, not one per Tender", () => {
      // A URL is 60-70 bytes against a Tender line's 60-90, so per-line links would very
      // nearly halve how many Tenders fit before the truncation point. The cost of making
      // each line tappable is paid in Tenders that stop being listed at all, which is the
      // wrong trade for a message whose whole job is the listing.
      const many = builders.digestMessage({
        tenders: Array.from({ length: 8 }, (_value, index) => line(`T-${1000 + index}`)),
        link,
      });

      expect(many.content.match(/https:\/\//g)).toHaveLength(1);
    });

    it("still arrives short and still says how many it left out, with a link on it", () => {
      const many = Array.from({ length: 60 }, (_value, index) => line(`T-${1000 + index}`));
      const message = builders.digestMessage({ tenders: many, link });

      expect(new TextEncoder().encode(message.content).length).toBeLessThanOrEqual(2048);
      expect(message.content).toContain("共 60 个");
      expect(message.content).toMatch(/其余 \d+ 个未列出/);
      expect(message.content).toContain(link);
    });

    it("charges the link against the budget rather than posting it on top", () => {
      // The self-imposed budget, below WeCom's 2048 because a message over the cap is
      // refused whole. The footer is charged up front, before any line is added — so the
      // footer that gets charged has to be the footer that gets posted. Charge the
      // linkless one and post the linked one and the Digest is over budget by a URL,
      // which is invisible until the day an org's list is long enough to reach the cap.
      const budget = 1_800;
      const many = Array.from({ length: 60 }, (_value, index) => line(`T-${1000 + index}`));
      const bytes = (message: GroupMessage) =>
        new TextEncoder().encode(message.content).length;

      expect(bytes(builders.digestMessage({ tenders: many, link }))).toBeLessThanOrEqual(
        budget,
      );
      // The linkless Digest is the one the budget was set for, and it still fits: a
      // budget the link happens to satisfy because nothing else does is no assertion.
      expect(
        bytes(builders.digestMessage({ tenders: many, link: null })),
      ).toBeLessThanOrEqual(budget);
    });

    it("keeps the omission line, which can never be the line that did not fit", () => {
      // The reserved-omission arithmetic is what stops a Digest from truncating silently.
      // A link long enough to eat the reservation would take the notice with it.
      const many = Array.from({ length: 200 }, (_value, index) => line(`T-${1000 + index}`));
      const message = builders.digestMessage({ tenders: many, link });
      const lines = message.content.split("\n");

      // The footer is the bare URL and nothing else — the instruction sits in the head,
      // where the truncation cannot reach it — so the notice is second from the end.
      expect(lines.slice(-2)).toEqual([
        expect.stringMatching(/其余 \d+ 个未列出/),
        link,
      ]);
    });
  });
});
