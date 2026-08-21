import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";
import { signIn } from "@/lib/auth/session";

import { recordingRobot } from "./robot-stub";
import { sendTestMention } from "./test-mention";

/**
 * The smallest real user story on the robot seam, and the only verification that
 * exists: an Org Admin @s one colleague, and that colleague says they got it.
 *
 * This is not ceremony. `errcode 0` means accepted, never notified — a nonexistent
 * userid and an empty string are both accepted silently (ticket 14). So a
 * `wecom_userid` is untrustworthy until a human has confirmed receipt once, and the
 * app's job is to make that one message easy to send. What is asserted here is the
 * half the app controls: who may send it, who it names, and what the admin is told
 * when the webhook refuses it.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);
const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key";

const service = createServiceClient();

const admin = { id: "", email: `mention-admin-${run}@example.test` };
const mentionable = { id: "", email: `mention-yes-${run}@example.test` };
const unlinked = { id: "", email: `mention-no-${run}@example.test` };
const stranger = { id: "", email: `mention-other-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

async function createOrg(name: string): Promise<string> {
  const { data, error } = await service.from("orgs").insert({ name }).select("id").single();

  if (error) throw error;

  return data.id;
}

async function createMember(
  org: string,
  who: { id: string; email: string },
  extra: { isOrgAdmin?: boolean; wecomUserid?: string } = {},
): Promise<void> {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service.from("users").insert({
    id: who.id,
    org_id: org,
    name: who.email,
    email: who.email,
    is_org_admin: extra.isOrgAdmin ?? false,
    wecom_userid: extra.wecomUserid ?? null,
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
  orgId = await createOrg(`Mention ${run}`);
  otherOrgId = await createOrg(`Mention other ${run}`);

  await createMember(orgId, admin, { isOrgAdmin: true, wecomUserid: `admin-${run}` });
  await createMember(orgId, mentionable, { wecomUserid: `somchai-${run}` });
  await createMember(orgId, unlinked);
  await createMember(otherOrgId, stranger, { wecomUserid: `stranger-${run}` });
});

beforeAll(() => {
  vi.stubEnv("WECOM_ROBOT_WEBHOOK", webhook);
});

afterAll(async () => {
  vi.unstubAllEnvs();

  const ids = [admin.id, mentionable.id, unlinked.id, stranger.id].filter(Boolean);

  await service.from("users").delete().in("id", ids);

  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId].filter(Boolean));
});

describe("sendTestMention", () => {
  it("lets an Org Admin @ a colleague who has a userid", async () => {
    const store = await signedInAs(admin.email);
    const boundary = recordingRobot();

    const result = await sendTestMention({ userId: mentionable.id }, store, boundary);

    expect(result).toEqual({ ok: true });
  });

  it("mentions that colleague, and only them", async () => {
    const store = await signedInAs(admin.email);
    const boundary = recordingRobot();

    await sendTestMention({ userId: mentionable.id }, store, boundary);

    expect(boundary.sent).toHaveLength(1);
    expect(boundary.sent[0].payload.text.mentioned_list).toEqual([`somchai-${run}`]);
  });

  it("refuses a member who is not an Org Admin, and posts nothing", async () => {
    // The action is a public endpoint, and this one writes into a shared group chat.
    const store = await signedInAs(mentionable.email);
    const boundary = recordingRobot();

    const result = await sendTestMention({ userId: mentionable.id }, store, boundary);

    expect(result).toEqual({ ok: false, reason: "not_admin" });
    expect(boundary.sent).toEqual([]);
  });

  it("refuses a caller with no session at all", async () => {
    const boundary = recordingRobot();

    const result = await sendTestMention(
      { userId: mentionable.id },
      memoryCookieStore(),
      boundary,
    );

    expect(result).toEqual({ ok: false, reason: "not_admin" });
    expect(boundary.sent).toEqual([]);
  });

  it("says so when the colleague has no userid yet, rather than @ing nobody", async () => {
    // `mentioned_list: [""]` is accepted with errcode 0 and notifies nobody. Sending it
    // would put a message in the group and report success, which is the exact
    // silent failure this whole ticket exists to keep out of the product.
    const store = await signedInAs(admin.email);
    const boundary = recordingRobot();

    const result = await sendTestMention({ userId: unlinked.id }, store, boundary);

    expect(result).toEqual({ ok: false, reason: "no_userid" });
    expect(boundary.sent).toEqual([]);
  });

  it("cannot reach into another org", async () => {
    const store = await signedInAs(admin.email);
    const boundary = recordingRobot();

    const result = await sendTestMention({ userId: stranger.id }, store, boundary);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(boundary.sent).toEqual([]);
  });

  it("never calls a non-zero errcode a success, and reports which one", async () => {
    const store = await signedInAs(admin.email);
    const boundary = recordingRobot({ errcode: 45009, errmsg: "api freq out of limit" });

    const result = await sendTestMention({ userId: mentionable.id }, store, boundary);

    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    expect(result).toHaveProperty("detail", expect.stringContaining("45009"));
  });
});
