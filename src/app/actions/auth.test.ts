import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";

/**
 * **Signing in on a device that has never seen this member.**
 *
 * `preferences.test.ts` proves the row remembers a theme across sessions. What it cannot
 * say is that anything ever *reads* the row back out onto a browser: the renderer paints
 * from a cookie, and on a phone that has never held one — or one the WeCom webview threw
 * away after seven idle days (research 17) — the row is the only copy there is. Signing in
 * is the moment it reaches that browser, and it is one line in `signInAction`. Delete it
 * and the member arrives painted `system` with their pinned theme still on the row,
 * which is the acceptance criterion "applies on any device they sign in on" failing
 * silently.
 *
 * **This is the one action in the app that is reachable from a test**, and only because
 * `next/headers` is stubbed with a jar of the shape it hands out. The cookie writes are
 * what is under test here, so faking the jar is faking the boundary rather than the
 * behaviour — everything between it and Postgres is real, including the sign-in itself.
 */

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    store,
    cookies: {
      getAll: () => [...store].map(([name, value]) => ({ name, value })),
      get: (name: string) => {
        const value = store.get(name);

        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => void store.set(name, value),
    },
  };
});

vi.mock("next/headers", () => ({ cookies: async () => jar.cookies }));

// `next/navigation` reaches for the client router's context, which does not exist under
// the `react-server` condition this project resolves with — and `redirect()` is a throw
// either way, so the stub is the same shape as the real control flow. It also makes the
// destination something this suite can read.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const { signInAction } = await import("./auth");

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const member = { id: "", email: `signin-${run}@example.test` };
let orgId = "";

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Sign-in ${run}` })
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

  // The member as they are on the device they chose it all on: a language and a theme,
  // both pinned, both on their own row.
  const { error: profileError } = await service.from("users").insert({
    id: member.id,
    org_id: orgId,
    name: member.email,
    email: member.email,
    locale: "zh-Hans",
    theme: "dark",
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

/** Sign in through the action, swallowing the redirect it ends with. */
async function signInOnAFreshBrowser(): Promise<void> {
  jar.store.clear();

  const form = new FormData();

  form.set("email", member.email);
  form.set("password", password);

  // `redirect()` throws to unwind the request, so the successful path is the one that
  // does not return — and a member who has already chosen a language lands on the app
  // rather than back at the first-run question.
  await expect(signInAction({}, form)).rejects.toThrow("redirect:/");
}

describe("signing in", () => {
  it("carries the member's theme onto a browser that has never held it", async () => {
    await signInOnAFreshBrowser();

    expect(jar.store.get("THEME")).toBe("dark");
  });

  it("carries their language too, which is the same promise one ticket older", async () => {
    await signInOnAFreshBrowser();

    expect(jar.store.get("NEXT_LOCALE")).toBe("zh-Hans");
  });

  it("writes neither for credentials it refuses", async () => {
    jar.store.clear();

    const form = new FormData();

    form.set("email", member.email);
    form.set("password", "not the password");

    // A refusal returns rather than redirecting, and it must not have painted anything on
    // its way out: the jar belongs to whoever is actually signed in.
    await expect(signInAction({}, form)).resolves.toMatchObject({ error: "invalid" });

    expect(jar.store.get("THEME")).toBeUndefined();
    expect(jar.store.get("NEXT_LOCALE")).toBeUndefined();
  });
});
