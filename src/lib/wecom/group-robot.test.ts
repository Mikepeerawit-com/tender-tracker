import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";
import { signIn } from "@/lib/auth/session";

import {
  groupRobotStatus,
  normaliseWebhook,
  setGroupRobot,
  webhookFor,
} from "./group-robot";

/**
 * Who may set the org's Group Robot, and what a screen is allowed to learn about it.
 *
 * The webhook is a bearer credential — whoever holds it can post to the company's WeCom
 * group as this app. `src/lib/supabase/rls.test.ts` proves the database will not hand it
 * to the anon key. What is proven here is the layer above: that the server action gates
 * on Org Admin rather than on the form being hidden, and that the value cannot leak back
 * out through the screen that manages it.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);
const webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-${run}`;

const service = createServiceClient();

const admin = { id: "", email: `robot-admin-${run}@example.test` };
const member = { id: "", email: `robot-member-${run}@example.test` };

let orgId = "";

async function createMember(who: { id: string; email: string }, isOrgAdmin: boolean) {
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
    name: who.email,
    email: who.email,
    is_org_admin: isOrgAdmin,
  });

  if (profileError) throw profileError;
}

async function signedInAs(email: string) {
  const store = memoryCookieStore();
  const result = await signIn({ email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${email}`);

  return store;
}

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Robot ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = data.id;

  await createMember(admin, true);
  await createMember(member, false);
});

afterEach(async () => {
  await service.from("group_robots").delete().eq("org_id", orgId);
});

afterAll(async () => {
  const ids = [admin.id, member.id].filter(Boolean);

  await service.from("users").delete().in("id", ids);

  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().eq("id", orgId);
});

describe("normaliseWebhook", () => {
  it("accepts a WeCom group-robot webhook", () => {
    expect(normaliseWebhook(webhook)).toBe(webhook);
  });

  it("trims what a paste actually brings with it", () => {
    // Ticket 06 lost a whole measurement session to a URL pasted with a trailing
    // newline: every send failed with `URL rejected: Malformed input`. Pasting from a
    // chat client is the only way this value ever arrives, so the whitespace is
    // expected input, not an edge case.
    expect(normaliseWebhook(`  ${webhook}\n`)).toBe(webhook);
  });

  it.each([
    ["a newline", "\n"],
    ["a tab", "\t"],
    ["a carriage return", "\r"],
  ])("strips %s from the middle, where the URL parser hides it", (_case, whitespace) => {
    // The nastier half of the same bug, and the reason this returns the *parsed* URL
    // rather than the trimmed input. `new URL()` silently drops tabs and newlines from
    // anywhere inside a URL, so a webhook wrapped across two lines by a chat client
    // validates perfectly — and, kept as typed, is stored still broken and still fails
    // every send. Trimming the ends would never have caught it.
    const split = webhook.replace("key=", `key=${whitespace}`);

    const cleaned = normaliseWebhook(split);

    expect(cleaned).toBe(webhook);
    expect(cleaned).not.toMatch(/\s/);
  });

  it("refuses credentials smuggled into the URL", () => {
    // No legitimate use — WeCom's webhook authenticates on the `key` alone — and they
    // would be stored, sent on every request, and never looked at again.
    expect(
      normaliseWebhook("https://user:pw@qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x"),
    ).toBeNull();
  });

  it("accepts the host however it was capitalised", () => {
    expect(normaliseWebhook(webhook.replace("qyapi", "QYAPI"))).toBe(webhook);
  });

  it.each([
    ["an empty box", ""],
    ["only whitespace", "   \n "],
    ["not a URL at all", "paste the webhook here"],
    ["plain http", webhook.replace("https:", "http:")],
    ["somebody else's hook", "https://hooks.slack.com/services/T000/B000/xxxx"],
    ["a shortener in front of it", "https://bit.ly/3xYzAbC"],
    ["the right host with no key", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send"],
    ["an empty key", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key="],
  ])("refuses %s", (_case, pasted) => {
    // Refused while somebody is standing at the form, because the alternative is
    // finding out at 08:00 the next morning on the one path nobody watches.
    expect(normaliseWebhook(pasted)).toBeNull();
  });
});

describe("setGroupRobot", () => {
  it("lets an Org Admin set it", async () => {
    const store = await signedInAs(admin.email);

    await expect(setGroupRobot({ webhook }, store)).resolves.toEqual({ ok: true });
    await expect(webhookFor(orgId)).resolves.toBe(webhook);
  });

  it("records who last changed it", async () => {
    // The one audit question worth answering about a credential that redirects every
    // notification the org sends.
    const store = await signedInAs(admin.email);

    await setGroupRobot({ webhook }, store);

    const { data } = await service
      .from("group_robots")
      .select("updated_by")
      .eq("org_id", orgId)
      .single();

    expect(data?.updated_by).toBe(admin.id);
  });

  it("replaces one that is already set, and moves the timestamp", async () => {
    const store = await signedInAs(admin.email);
    const replacement = `${webhook}-two`;

    await setGroupRobot({ webhook }, store);
    const first = await groupRobotStatus(store);

    await setGroupRobot({ webhook: replacement }, store);
    const second = await groupRobotStatus(store);

    await expect(webhookFor(orgId)).resolves.toBe(replacement);
    // Strictly greater: the column's default only covers the insert, so a replace that
    // left this alone would mean the trigger is not firing and the screen would report
    // a stale "last changed" for a webhook that had in fact just been swapped.
    expect(Date.parse(second?.updatedAt ?? "")).toBeGreaterThan(
      Date.parse(first?.updatedAt ?? ""),
    );
  });

  it("clears it when handed null", async () => {
    // A real operation: a group gets recreated, or somebody leaks the URL. Being able
    // to revoke it without a deploy is half the point of it living here.
    const store = await signedInAs(admin.email);

    await setGroupRobot({ webhook }, store);
    await expect(setGroupRobot({ webhook: null }, store)).resolves.toEqual({ ok: true });

    await expect(webhookFor(orgId)).resolves.toBeNull();
  });

  it("refuses a member who is not an Org Admin", async () => {
    // The action is a public endpoint, and this is the highest-value write in the app
    // for anyone who wants the company's tender traffic read out to them.
    const store = await signedInAs(member.email);

    await expect(setGroupRobot({ webhook }, store)).resolves.toEqual({
      ok: false,
      reason: "not_admin",
    });
    await expect(webhookFor(orgId)).resolves.toBeNull();
  });

  it("refuses a caller with no session at all", async () => {
    const result = await setGroupRobot({ webhook }, memoryCookieStore());

    expect(result).toEqual({ ok: false, reason: "not_admin" });
    await expect(webhookFor(orgId)).resolves.toBeNull();
  });

  it("refuses a member trying to clear it", async () => {
    const store = await signedInAs(admin.email);
    await setGroupRobot({ webhook }, store);

    await setGroupRobot({ webhook: null }, await signedInAs(member.email));

    await expect(webhookFor(orgId)).resolves.toBe(webhook);
  });

  it("stores nothing when the paste is not a WeCom webhook", async () => {
    const store = await signedInAs(admin.email);

    await expect(
      setGroupRobot({ webhook: "https://hooks.slack.com/services/T/B/x" }, store),
    ).resolves.toEqual({ ok: false, reason: "not_a_wecom_webhook" });

    await expect(webhookFor(orgId)).resolves.toBeNull();
  });
});

describe("groupRobotStatus", () => {
  it("cannot carry the webhook, whatever the screen asks it for", async () => {
    // The type says so, and this says so again: a screen that could render the URL is a
    // screen that eventually does, and the value is one copy-paste from being the
    // company group's back door.
    const store = await signedInAs(admin.email);
    await setGroupRobot({ webhook }, store);

    const status = await groupRobotStatus(store);

    expect(JSON.stringify(status)).not.toContain(`abc-${run}`);
    expect(status?.configured).toBe(true);
  });

  it("reports an org that has no robot yet", async () => {
    const status = await groupRobotStatus(await signedInAs(admin.email));

    expect(status).toEqual({ configured: false, updatedAt: null });
  });

  it("tells a non-admin nothing, rather than telling them there is no robot", async () => {
    // Those are different answers and only one of them is true. "Not set up" would send
    // an Org Admin looking at the wrong account off to configure one that exists.
    const store = await signedInAs(admin.email);
    await setGroupRobot({ webhook }, store);

    await expect(groupRobotStatus(await signedInAs(member.email))).resolves.toBeNull();
  });
});
