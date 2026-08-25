import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";

import { chooseLocale } from "./preferences";
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
