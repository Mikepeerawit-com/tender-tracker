import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";

import { currentUser, signIn, signOut } from "./session";

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const active = { id: "", email: `active-${run}@example.test` };
const disabled = { id: "", email: `disabled-${run}@example.test` };
let orgId = "";

async function createMember(
  member: { id: string; email: string },
  disabledAt: string | null,
): Promise<void> {
  const { data, error } = await service.auth.admin.createUser({
    email: member.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  member.id = data.user.id;

  const { error: profileError } = await service.from("users").insert({
    id: member.id,
    org_id: orgId,
    name: member.email,
    email: member.email,
    disabled_at: disabledAt,
  });

  if (profileError) throw profileError;
}

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Session ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = data.id;

  await createMember(active, null);
  await createMember(disabled, "2026-08-01T00:00:00.000Z");
});

afterAll(async () => {
  const ids = [active.id, disabled.id].filter((id) => id !== "");

  await service.from("users").delete().in("id", ids);

  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }

  if (orgId !== "") await service.from("orgs").delete().eq("id", orgId);
});

describe("signIn", () => {
  it("admits a member and writes the session to the cookie jar", async () => {
    const store = memoryCookieStore();

    const result = await signIn({ email: active.email, password }, store);

    expect(result).toEqual({ ok: true });
    // Written through `set`, which in a real request is a Set-Cookie header. That is the
    // whole point: a cookie written from script is capped at 7 days by WebKit, and this
    // app's usage is sparse enough to sit outside that window.
    expect(store.written.size).toBeGreaterThan(0);
  });

  it("refuses a wrong password", async () => {
    const store = memoryCookieStore();

    const result = await signIn({ email: active.email, password: "wrong" }, store);

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an email that was never invited", async () => {
    const store = memoryCookieStore();

    const result = await signIn(
      { email: `stranger-${run}@example.test`, password },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a disabled member whose password is still correct", async () => {
    const store = memoryCookieStore();

    const result = await signIn({ email: disabled.email, password }, store);

    expect(result).toEqual({ ok: false, reason: "disabled" });
  });

  it("leaves a refused disabled member no usable session", async () => {
    const store = memoryCookieStore();

    await signIn({ email: disabled.email, password }, store);

    // Supabase Auth accepted the credentials, so a session briefly existed. It has to be
    // torn down, or the cookie jar walks away holding one.
    await expect(currentUser(store)).resolves.toBeNull();
  });
});

describe("currentUser", () => {
  it("is nobody without cookies", async () => {
    await expect(currentUser(memoryCookieStore())).resolves.toBeNull();
  });

  it("reports the signed-in member's profile", async () => {
    const store = memoryCookieStore();
    await signIn({ email: active.email, password }, store);

    const user = await currentUser(store);

    expect(user).toMatchObject({
      id: active.id,
      orgId,
      email: active.email,
      isOrgAdmin: false,
    });
  });

  it("reports a null locale rather than guessing one", async () => {
    const store = memoryCookieStore();
    await signIn({ email: active.email, password }, store);

    const user = await currentUser(store);

    // First start-up asks. Inferring from Accept-Language would mean a colleague in
    // China silently gets a different app from one in Bangkok.
    expect(user?.locale).toBeNull();
  });

  it("drops a live session the moment the member is disabled", async () => {
    const store = memoryCookieStore();
    await signIn({ email: active.email, password }, store);
    await expect(currentUser(store)).resolves.not.toBeNull();

    await service
      .from("users")
      .update({ disabled_at: "2026-08-14T00:00:00.000Z" })
      .eq("id", active.id);

    try {
      // RLS is doing this, not a session check: a disabled user reads nothing, their own
      // profile row included. Disabling therefore takes effect on the next request
      // rather than whenever a 30-day cookie happens to expire.
      await expect(currentUser(store)).resolves.toBeNull();
    } finally {
      await service.from("users").update({ disabled_at: null }).eq("id", active.id);
    }
  });
});

describe("signOut", () => {
  it("ends the session", async () => {
    const store = memoryCookieStore();
    await signIn({ email: active.email, password }, store);

    await signOut(store);

    await expect(currentUser(store)).resolves.toBeNull();
  });
});
