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
  outcome: "won",
  quantity: 12,
  daysLeft: 3,
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
 * Today `./messages` exports one builder returning a constant string, which touches
 * none of the fixture's sentinels — so every rule above passes without being asked
 * anything hard. That makes them true but not yet load-bearing, and a guard nobody has
 * watched fail is a guard nobody should trust.
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
