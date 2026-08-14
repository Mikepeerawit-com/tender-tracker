import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";

import { invite, setWecomUserid } from "./invite";
import { signIn } from "./session";

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const admin = { id: "", email: `admin-${run}@example.test` };
const member = { id: "", email: `member-${run}@example.test` };
const otherOrgAdmin = { id: "", email: `other-admin-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

// Anything an invite creates, so it can be removed however the test ended.
const invited: string[] = [];

async function createOrg(name: string): Promise<string> {
  const { data, error } = await service
    .from("orgs")
    .insert({ name })
    .select("id")
    .single();

  if (error) throw error;

  return data.id;
}

async function createMember(
  org: string,
  who: { id: string; email: string },
  isOrgAdmin: boolean,
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
  orgId = await createOrg(`Invite ${run}`);
  otherOrgId = await createOrg(`Invite other ${run}`);

  await createMember(orgId, admin, true);
  await createMember(orgId, member, false);
  await createMember(otherOrgId, otherOrgAdmin, true);
});

afterEach(async () => {
  if (invited.length === 0) return;

  await service.from("users").delete().in("id", invited);

  for (const id of invited) {
    await service.auth.admin.deleteUser(id);
  }

  invited.length = 0;
});

afterAll(async () => {
  const ids = [admin.id, member.id, otherOrgAdmin.id].filter((id) => id !== "");

  await service.from("users").delete().in("id", ids);

  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId].filter(Boolean));
});

describe("invite", () => {
  it("lets an Org Admin invite a colleague", async () => {
    const store = await signedInAs(admin.email);

    const result = await invite(
      { email: `new-${run}@example.test`, name: "Nok" },
      store,
    );

    expect(result.ok).toBe(true);

    if (result.ok) invited.push(result.userId);
  });

  it("gives the invitee a profile in the inviter's org, with no locale yet", async () => {
    const store = await signedInAs(admin.email);

    const result = await invite(
      { email: `profile-${run}@example.test`, name: "Nok" },
      store,
    );

    if (!result.ok) throw new Error("invite failed");

    invited.push(result.userId);

    const { data } = await service
      .from("users")
      .select("org_id, name, locale, is_org_admin")
      .eq("id", result.userId)
      .single();

    expect(data).toEqual({
      org_id: orgId,
      name: "Nok",
      locale: null,
      is_org_admin: false,
    });
  });

  it("refuses a member who is not an Org Admin", async () => {
    // The action is a public endpoint. Hiding the form is not the gate.
    const store = await signedInAs(member.email);

    const result = await invite(
      { email: `refused-${run}@example.test`, name: "Nobody" },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_admin" });
  });

  it("refuses a caller with no session at all", async () => {
    const result = await invite(
      { email: `anon-${run}@example.test`, name: "Nobody" },
      memoryCookieStore(),
    );

    expect(result).toEqual({ ok: false, reason: "not_admin" });
  });

  it("creates no account when it refuses", async () => {
    const email = `refused-${run}@example.test`;
    const store = await signedInAs(member.email);

    await invite({ email, name: "Nobody" }, store);

    const { data } = await service.from("users").select("id").eq("email", email);

    expect(data).toEqual([]);
  });

  it("reports an address that already has an account", async () => {
    const store = await signedInAs(admin.email);

    const result = await invite({ email: member.email, name: "Again" }, store);

    expect(result).toEqual({ ok: false, reason: "already_invited" });
  });
});

describe("setWecomUserid", () => {
  it("lets an Org Admin set it by hand", async () => {
    const store = await signedInAs(admin.email);

    const result = await setWecomUserid(
      { userId: member.id, wecomUserid: `NokW-${run}` },
      store,
    );

    expect(result).toEqual({ ok: true });

    const { data } = await service
      .from("users")
      .select("wecom_userid")
      .eq("id", member.id)
      .single();

    expect(data?.wecom_userid).toBe(`NokW-${run}`);
  });

  it("refuses a member who is not an Org Admin", async () => {
    const store = await signedInAs(member.email);

    const result = await setWecomUserid(
      { userId: admin.id, wecomUserid: "Sneaky" },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_admin" });
  });

  it("refuses to reach into another org", async () => {
    const store = await signedInAs(otherOrgAdmin.email);

    const result = await setWecomUserid(
      { userId: member.id, wecomUserid: "Reached" },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});
