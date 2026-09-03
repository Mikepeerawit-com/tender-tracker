import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { signIn } from "@/lib/auth/session";
import { respondingRates } from "@/lib/fx/rate-stub";
import { createQuote } from "@/lib/quotes/quotes";
import { selectQuote } from "@/lib/comparison/sheet";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { recordingRobot, type RobotStub } from "@/lib/wecom/robot-stub";

import { addAssignee, createTender, setItemOutcome } from "./tenders";

/**
 * The news that follows a Tender Item being won or lost.
 *
 * Run through `setItemOutcome` rather than through `announceOutcome` directly, because
 * the thing worth proving is not that a builder builds — `messages.test.ts` has that —
 * but that **recording an Outcome tells the people who quoted**. The seam is the write,
 * the stub stands at the webhook, and the assertions are about the messages that would
 * be posted and the bell rows left behind.
 *
 * Unlike the cron, this path is scoped to one Item, so it can live in its own file: it
 * consumes nothing another suite is holding and posts nothing into another suite's stub.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

/** Unique to this run, so a message of ours is tellable from a neighbouring suite's. */
const client = `Chiang Mai Central ${run}`;

const webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${run}`;

const decidedAt = new Date("2026-08-10T02:00:00Z");

const owner = { id: "", email: `news-owner-${run}@example.test`, wecom: `n-owner-${run}` };
const nok = { id: "", email: `news-nok-${run}@example.test`, wecom: `n-nok-${run}` };
const anong = { id: "", email: `news-anong-${run}@example.test`, wecom: `n-anong-${run}` };

let orgId = "";

async function signedInAs(who: { email: string }): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email: who.email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${who.email}`);

  return store;
}

async function createMember(who: { id: string; email: string; wecom: string }) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service.from("users").insert({
    id: who.id,
    org_id: orgId,
    // The name the group is told we bid on. A colleague's, never a supplier's.
    name: who === nok ? "Nok" : who === anong ? "Anong" : "Owner",
    email: who.email,
    wecom_userid: who.wecom,
  });

  if (profileError) throw profileError;
}

/** A Tender with one Item, and whoever should be able to quote on it assigned. */
async function aTender(assignees: { id: string }[] = []): Promise<{
  id: string;
  itemId: string;
}> {
  const store = await signedInAs(owner);
  const result = await createTender(
    {
      clientName: client,
      title: "Theatre consumables",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-25",
      clientSubmissionDeadline: "2026-09-01",
      expectedDecisionDate: null,
      ownerUserId: owner.id,
      notes: null,
      items: [
        { productName: "PICC catheter 4Fr", description: null, quantity: 12, unit: "box" },
      ],
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  for (const assignee of assignees) {
    const added = await addAssignee(
      { tenderId: result.tenderId, userId: assignee.id },
      store,
    );

    if (!added.ok) throw new Error(`could not assign: ${added.reason}`);
  }

  const { data } = await service
    .from("tender_items")
    .select("id")
    .eq("tender_id", result.tenderId)
    .single();

  return { id: result.tenderId, itemId: data!.id };
}

/** One supplier's price, entered by one Assignee. Returns the Quote's id. */
async function quoteOn(
  itemId: string,
  who: { email: string },
  supplier: string,
): Promise<string> {
  const result = await createQuote(
    {
      tenderItemId: itemId,
      supplierName: `${supplier} ${run}`,
      unitPrice: 120,
      currency: "THB",
      quotedUnit: "box",
      leadTimeDays: null,
      matchType: "exact",
      alternativeProductName: null,
      detailNotes: null,
      quotedAt: "2026-08-05",
    },
    await signedInAs(who),
    respondingRates(1),
  );

  if (!result.ok) throw new Error(`could not quote: ${result.reason}`);

  return result.quoteId;
}

async function decide(
  itemId: string,
  outcome: string,
  robot: RobotStub,
): Promise<void> {
  const result = await setItemOutcome(
    { itemId, outcome, decidedAt },
    await signedInAs(owner),
    robot,
  );

  if (!result.ok) throw new Error(`could not record the Outcome: ${result.reason}`);
}

/** Only what this suite posted — other suites' orgs share the run. */
function mine(robot: RobotStub) {
  return robot.sent.filter((message) => message.payload.text.content.includes(client));
}

/** The one message @-ing this person, if there is one. */
function addressedTo(robot: RobotStub, who: { wecom: string }) {
  return mine(robot).find((message) =>
    (message.payload.text.mentioned_list ?? []).includes(who.wecom),
  )?.payload.text.content;
}

async function notificationsOn(itemId: string) {
  const { data } = await service
    .from("notifications")
    .select("user_id, type, tender_id, tender_item_id, body")
    .eq("tender_item_id", itemId);

  return data ?? [];
}

beforeAll(async () => {
  const { data: org, error } = await service
    .from("orgs")
    .insert({ name: `Outcome news ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = org.id;

  await createMember(owner);
  await createMember(nok);
  await createMember(anong);

  const { error: robotError } = await service
    .from("group_robots")
    .insert({ org_id: orgId, webhook_url: webhook, updated_by: owner.id });

  if (robotError) throw robotError;
});

afterAll(async () => {
  await service.from("group_robots").delete().eq("org_id", orgId);
  await service.from("notifications").delete().eq("org_id", orgId);
  await service.from("tenders").delete().eq("org_id", orgId);
  await service.from("suppliers").delete().eq("org_id", orgId);
  await service.from("users").delete().eq("org_id", orgId);

  for (const who of [owner, nok, anong]) await service.auth.admin.deleteUser(who.id);

  await service.from("orgs").delete().eq("id", orgId);
});

describe("who hears about a won Item", () => {
  it("tells every Assignee who quoted it, not only the one we bid", async () => {
    // The rule the whole feature turns on. Assignees compete rather than divide, and the
    // Assignee whose supplier was not chosen has no other feedback anywhere in this app
    // on how theirs compared — silence teaches them not to bother next time.
    const tender = await aTender([nok, anong]);
    const winning = await quoteOn(tender.itemId, nok, "Ace Medical");

    await quoteOn(tender.itemId, anong, "Siam Surgical");
    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: winning },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);

    expect(addressedTo(robot, nok)).toBeDefined();
    expect(addressedTo(robot, anong)).toBeDefined();
  });

  it("words it differently for the Assignee we bid than for the others", async () => {
    const tender = await aTender([nok, anong]);
    const winning = await quoteOn(tender.itemId, nok, "Ace Medical");

    await quoteOn(tender.itemId, anong, "Siam Surgical");
    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: winning },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);

    // "your quote was selected and won" against "the tender was won on Nok's quote".
    expect(addressedTo(robot, nok)).toContain("你的报价");
    expect(addressedTo(robot, anong)).toContain("Nok");
    expect(addressedTo(robot, anong)).not.toBe(addressedTo(robot, nok));
  });

  it("names the colleague we bid on and never the supplier", async () => {
    // ADR-0012 permits the one and forbids the other in the same breath: who to go and
    // ask is what makes the message actionable, and supplier identity is commercially
    // sensitive in a group whose membership nobody in this app controls.
    const tender = await aTender([nok, anong]);
    const winning = await quoteOn(tender.itemId, nok, "Ace Medical");

    await quoteOn(tender.itemId, anong, "Siam Surgical");
    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: winning },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);

    for (const message of mine(robot)) {
      expect(message.payload.text.content).not.toContain("Ace Medical");
      expect(message.payload.text.content).not.toContain("Siam Surgical");
    }
  });

  it("collapses to one message when the only quoter is the one we bid", async () => {
    const tender = await aTender([nok]);
    const winning = await quoteOn(tender.itemId, nok, "Ace Medical");

    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: winning },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);

    expect(mine(robot)).toHaveLength(1);
    expect(addressedTo(robot, nok)).toContain("你的报价");
  });
});

describe("who hears about a lost Item", () => {
  it("tells everyone who quoted, with the loss worded for each of them", async () => {
    // A loss is not the selected Assignee's failure, but they are the one who will be
    // asked about it — and finding out from the group beats finding out in a meeting.
    const tender = await aTender([nok, anong]);
    const bid = await quoteOn(tender.itemId, nok, "Ace Medical");

    await quoteOn(tender.itemId, anong, "Siam Surgical");
    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: bid },
      await signedInAs(owner),
    );

    const robot = recordingRobot();

    await decide(tender.itemId, "lost", robot);

    expect(addressedTo(robot, nok)).toContain("未中标");
    expect(addressedTo(robot, nok)).toContain("你的报价");
    expect(addressedTo(robot, anong)).toContain("Nok");
  });

  it("attributes nothing when no Quote was ever selected", async () => {
    // Ordinary on an Item nobody got round to picking from. A guess here would credit a
    // colleague with a Bid that was never made.
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");

    const robot = recordingRobot();

    await decide(tender.itemId, "lost", robot);

    expect(mine(robot)).toHaveLength(1);
    expect(addressedTo(robot, nok)).toContain("未记录");
  });
});

describe("what stays quiet", () => {
  it("says nothing when we chose not to bid", async () => {
    // `no_bid` is us deciding, not the client. It is a verdict on nobody's sourcing.
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");

    const robot = recordingRobot();

    await decide(tender.itemId, "no_bid", robot);

    expect(mine(robot)).toEqual([]);
  });

  it("says nothing when the client pulled the Item", async () => {
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");

    const robot = recordingRobot();

    await decide(tender.itemId, "cancelled", robot);

    expect(mine(robot)).toEqual([]);
  });

  it("says nothing when nobody quoted the Item at all", async () => {
    // There is nobody the news would be feedback for. The Tender's own outcome is on the
    // worklist, where the Owner reads it.
    const tender = await aTender([nok]);
    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);

    expect(mine(robot)).toEqual([]);
  });

  it("says it once, however many times the same Outcome is saved", async () => {
    // Re-recording an Outcome an Item already has is not a decision — `setItemOutcome`
    // refuses to re-date it — so the group is not told twice about one result.
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");

    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);
    await decide(tender.itemId, "won", robot);

    expect(mine(robot)).toHaveLength(1);
  });
});

describe("the in-app rows the bell will read", () => {
  it("writes one per quoter, saying whose Quote we bid", async () => {
    const tender = await aTender([nok, anong]);
    const bid = await quoteOn(tender.itemId, nok, "Ace Medical");

    await quoteOn(tender.itemId, anong, "Siam Surgical");
    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: bid },
      await signedInAs(owner),
    );

    await decide(tender.itemId, "won", recordingRobot());

    const rows = await notificationsOn(tender.itemId);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.type === "outcome:won")).toBe(true);
    // Both ids, so the bell can build a link without a second lookup.
    expect(rows.every((row) => row.tender_id === tender.id)).toBe(true);
    expect(new Map(rows.map((row) => [row.user_id, row.body]))).toEqual(
      new Map([
        [nok.id, "selected"],
        [anong.id, "not_selected"],
      ]),
    );
  });

  it("writes them even when WeCom refuses the post", async () => {
    // The opposite call from the reminder path, and for a reason: a refused reminder is
    // retried tomorrow, so writing its bell rows now would double them. This fires once
    // and is never retried, so skipping the bell would leave the loser told by nothing.
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");
    await decide(tender.itemId, "lost", recordingRobot(500));

    expect(await notificationsOn(tender.itemId)).toHaveLength(1);
  });
});

describe("what a failed post costs the person recording the Outcome", () => {
  it("nothing — the Outcome is saved and the write reports success", async () => {
    // Sending them back to retry would save again, send nothing (the Outcome is already
    // recorded), and tell them it worked. Reporting failure would cost them their
    // Outcome and buy them nothing.
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");

    const result = await setItemOutcome(
      { itemId: tender.itemId, outcome: "won", decidedAt },
      await signedInAs(owner),
      recordingRobot(500),
    );

    expect(result.ok).toBe(true);

    const { data } = await service
      .from("tender_items")
      .select("outcome")
      .eq("id", tender.itemId)
      .single();

    expect(data?.outcome).toBe("won");
  });
});

/**
 * The way into the app (#59).
 *
 * Both outcome messages point at the **Item**, not the Tender it belongs to. That is the
 * distinction worth a test: the Tender's screen would look plausible, would resolve, and
 * would drop the reader one level above the Quotes the message is about — including
 * their own, which is the entire subject of "your quote was not selected".
 */
describe("where the outcome news sends people", () => {
  const origin = "https://tenders.example.test";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("points both messages at the Item's sourcing screen", async () => {
    const tender = await aTender([nok, anong]);
    const winning = await quoteOn(tender.itemId, nok, "Ace Medical");

    await quoteOn(tender.itemId, anong, "Siam Surgical");
    await selectQuote(
      { tenderItemId: tender.itemId, quoteId: winning },
      await signedInAs(owner),
    );

    vi.stubEnv("APP_ORIGIN", origin);

    const robot = recordingRobot();

    await decide(tender.itemId, "won", robot);

    const link = `${origin}/tenders/${tender.id}/items/${tender.itemId}/quote`;

    // Both audiences, both told where. The one whose Quote we bid and the one whose we
    // did not are being told different things about the same Item.
    expect(addressedTo(robot, nok)).toContain(link);
    expect(addressedTo(robot, anong)).toContain(link);
    expect(addressedTo(robot, nok)?.split("\n").at(-1)).toBe(link);
  });

  it("still tells everybody, linkless, when nobody configured an origin", async () => {
    const tender = await aTender([nok]);

    await quoteOn(tender.itemId, nok, "Ace Medical");

    vi.stubEnv("APP_ORIGIN", "");

    const robot = recordingRobot();

    await decide(tender.itemId, "lost", robot);

    expect(addressedTo(robot, nok)).toContain("请进入系统打开该产品项");
    expect(addressedTo(robot, nok)).not.toContain("http");
  });
});
