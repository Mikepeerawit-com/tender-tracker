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
    expect(builders.digestMessage({ tenders: [line("T-1042", 3)] }).mentions).toBe(
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
    const digest = builders.digestMessage({ tenders: many });

    expect(new TextEncoder().encode(digest.content).length).toBeLessThanOrEqual(2048);
    expect(digest.content).toContain("共 60 个");
    expect(digest.content).toMatch(/其余 \d+ 个未列出/);
    // The tail is what was dropped: the soonest are listed, which is the half worth
    // reading.
    expect(digest.content).toContain("T-1000");
    expect(digest.content).not.toContain("T-1059");
  });

  it("names no omission when everything fitted", () => {
    expect(
      builders.digestMessage({ tenders: [line("T-1042", 3)] }).content,
    ).not.toContain("未列出");
  });
});
