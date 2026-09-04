import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";

import { chooseLocale, chooseTheme } from "./preferences";
import { currentUser, signIn } from "./session";

/**
 * The half of the language switcher that outlives the cookie.
 *
 * The cookie is what renders, and on its own it would be enough to make the switcher
 * *look* like it works: flip the language, the page comes back translated, and the
 * choice survives until something clears the jar. What it would not survive is the next
 * phone, or a WeCom webview that discards cookies between sessions — and a setting that
 * silently reverts is worse than one that was never offered, because the second time it
 * happens nobody trusts it.
 *
 * So the row is the thing tested here. `switchLocale` itself cannot be: it writes the
 * cookie through `next/headers`, which has no request context to reach from a test.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const member = { id: "", email: `locale-${run}@example.test` };
let orgId = "";

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Locale ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = data.id;

  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: member.email,
    password,
    email_confirm: true,
  });

  if (authError) throw authError;

  member.id = created.user.id;

  // `locale` is left null, which is how an invitee arrives: first start-up asks rather
  // than inferring, and `/choose-language` is what stands in front of the app until it
  // has an answer.
  const { error: profileError } = await service.from("users").insert({
    id: member.id,
    org_id: orgId,
    name: member.email,
    email: member.email,
  });

  if (profileError) throw profileError;
});

afterAll(async () => {
  if (member.id !== "") {
    await service.from("users").delete().eq("id", member.id);
    await service.auth.admin.deleteUser(member.id);
  }

  if (orgId !== "") await service.from("orgs").delete().eq("id", orgId);
});

async function signedIn() {
  const store = memoryCookieStore();
  const result = await signIn({ email: member.email, password }, store);

  expect(result).toEqual({ ok: true });

  return store;
}

describe("chooseLocale", () => {
  it("starts with no answer, so the app has to ask", async () => {
    const store = await signedIn();

    await expect(currentUser(store)).resolves.toMatchObject({ locale: null });
  });

  it("remembers the choice on the user's own row", async () => {
    const store = await signedIn();

    await expect(chooseLocale("zh-Hans", store)).resolves.toEqual({ ok: true });

    // Read back through the session client, the way a page renders it — not through the
    // service key, which would pass even if the column grant did not allow the write.
    await expect(currentUser(store)).resolves.toMatchObject({ locale: "zh-Hans" });
  });

  it("survives a new session with an empty cookie jar", async () => {
    await chooseLocale("zh-Hans", await signedIn());

    // A fresh jar is the phone that has never seen this app, and the WeCom webview that
    // came back without the cookie. Either way the row is what answers.
    const later = await signedIn();

    await expect(currentUser(later)).resolves.toMatchObject({ locale: "zh-Hans" });
  });

  it("lets a member change their mind", async () => {
    const store = await signedIn();

    await chooseLocale("zh-Hans", store);
    await expect(chooseLocale("en", store)).resolves.toEqual({ ok: true });

    await expect(currentUser(store)).resolves.toMatchObject({ locale: "en" });
  });

  it("records nothing for a caller with no session", async () => {
    // The signed-out login screen has a switcher too, and there is no row to write yet.
    // The cookie carries that choice alone until the sign-in turns them into somebody.
    await expect(chooseLocale("zh-Hans", memoryCookieStore())).resolves.toEqual({
      ok: false,
    });
  });
});

describe("chooseTheme", () => {
  it("follows the device for a member who has never been asked", async () => {
    const store = await signedIn();

    // The one place theme parts company with locale: there is no `/choose-theme` and
    // there should not be, so the answer that needs no question is already on the row.
    await expect(currentUser(store)).resolves.toMatchObject({ theme: "system" });
  });

  it("remembers a pinned theme on the user's own row", async () => {
    const store = await signedIn();

    await expect(chooseTheme("dark", store)).resolves.toEqual({ ok: true });

    // Read back through the session client, the way a page renders it — the service key
    // would pass even if `theme` had never joined the column grant.
    await expect(currentUser(store)).resolves.toMatchObject({ theme: "dark" });
  });

  it("survives a new session with an empty cookie jar", async () => {
    await chooseTheme("dark", await signedIn());

    // The phone the choice was made on, and the office desktop it was not. A theme that
    // reverted on the second device would be worse than one nobody was offered, which is
    // the whole of why it is a column rather than a cookie (ADR-0024).
    const later = await signedIn();

    await expect(currentUser(later)).resolves.toMatchObject({ theme: "dark" });
  });

  it("lets a member come back to following their device", async () => {
    const store = await signedIn();

    await chooseTheme("dark", store);
    await expect(chooseTheme("system", store)).resolves.toEqual({ ok: true });

    // `system` is a stored answer rather than the absence of one, which is what makes
    // coming back to it something a member can do at all.
    await expect(currentUser(store)).resolves.toMatchObject({ theme: "system" });
  });

  it("records nothing for a caller with no session", async () => {
    // No screen reaches this today — the control is behind the login, unlike the language
    // switcher, which the sign-in screen carries. It is asserted anyway because the write
    // aims at `auth.uid()`: a version of this that fell back to updating *by something
    // else* would be a write with no owner, and the refusal is what says it cannot be.
    await expect(chooseTheme("dark", memoryCookieStore())).resolves.toEqual({
      ok: false,
    });
  });
});
