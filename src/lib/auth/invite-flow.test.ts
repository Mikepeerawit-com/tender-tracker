import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { createSessionClient, memoryCookieStore } from "@/lib/supabase/session-client";

import { invite } from "./invite";
import { setPassword } from "./password";
import { chooseLocale } from "./preferences";
import { currentUser, signIn } from "./session";

/**
 * The whole way in, once: an Org Admin invites, the email arrives, the link in it
 * works, the invitee sets a password and can sign back in with it.
 *
 * This one goes through the real mail catcher rather than reaching past it, because the
 * email template is where the riskiest decision in this ticket lives. Supabase's default
 * invite link returns its tokens in the URL *fragment*, which no server ever receives —
 * handling it would require client-side script and a browser-persisted session, which
 * WebKit clears after 7 idle days. A test that skipped the email would keep passing
 * after someone restored the default template, and the failure would then show up as
 * "invited people are silently logged out a week later".
 */

const adminPassword = "correct-horse-battery-staple";
const invitedPassword = "a-different-correct-horse";
const run = crypto.randomUUID().slice(0, 8);
const mailpit = "http://127.0.0.1:54324";

const service = createServiceClient();

const admin = { id: "", email: `flow-admin-${run}@example.test` };
const invitee = { email: `flow-invitee-${run}@example.test`, id: "" };
let orgId = "";

async function inviteEmailBody(to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };

    if (messages.length > 0) {
      const message = await fetch(`${mailpit}/api/v1/message/${messages[0].ID}`);
      const { HTML, Text } = (await message.json()) as { HTML: string; Text: string };

      return HTML || Text;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`no invite email reached ${to}`);
}

beforeAll(async () => {
  const { data, error } = await service
    .from("orgs")
    .insert({ name: `Flow ${run}` })
    .select("id")
    .single();

  if (error) throw error;

  orgId = data.id;

  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: admin.email,
    password: adminPassword,
    email_confirm: true,
  });

  if (authError) throw authError;

  admin.id = created.user.id;

  await service.from("users").insert({
    id: admin.id,
    org_id: orgId,
    name: "Org Admin",
    email: admin.email,
    is_org_admin: true,
  });
});

afterAll(async () => {
  const ids = [admin.id, invitee.id].filter((id) => id !== "");

  await service.from("users").delete().in("id", ids);

  for (const id of ids) {
    await service.auth.admin.deleteUser(id);
  }

  if (orgId !== "") await service.from("orgs").delete().eq("id", orgId);
});

describe("invitation, end to end", () => {
  it("carries someone from an emailed link to a working account", async () => {
    const adminStore = memoryCookieStore();
    await signIn({ email: admin.email, password: adminPassword }, adminStore);

    const invited = await invite({ email: invitee.email, name: "Nok" }, adminStore);

    if (!invited.ok) throw new Error(`invite failed: ${invited.reason}`);

    invitee.id = invited.userId;

    const body = await inviteEmailBody(invitee.email);

    // The link must be server-verifiable. A fragment would put the tokens somewhere
    // only the browser can see.
    expect(body).toContain("token_hash=");
    expect(body).not.toContain("#access_token");

    // Nothing may ever tell someone to leave the WeCom webview — there is no way out of
    // it into Safari, so the advice is unfollowable as well as wrong.
    expect(body.toLowerCase()).not.toContain("open in your browser");

    const tokenHash = /token_hash=([^&"'\s]+)/.exec(body)?.[1];

    expect(tokenHash).toBeDefined();

    // What /auth/confirm does with that link.
    const inviteeStore = memoryCookieStore();
    const { error } = await createSessionClient(inviteeStore).auth.verifyOtp({
      type: "invite",
      token_hash: tokenHash!,
    });

    expect(error).toBeNull();

    await expect(setPassword(invitedPassword, inviteeStore)).resolves.toEqual({
      ok: true,
    });

    // The point of the whole exercise: they can now get back in on their own.
    const returning = memoryCookieStore();
    const result = await signIn(
      { email: invitee.email, password: invitedPassword },
      returning,
    );

    expect(result).toEqual({ ok: true });

    const user = await currentUser(returning);

    expect(user).toMatchObject({ orgId, name: "Nok", isOrgAdmin: false });
    // Still unasked, so the app sends them to choose one.
    expect(user?.locale).toBeNull();

    await chooseLocale("zh-Hans", returning);

    await expect(currentUser(returning)).resolves.toMatchObject({ locale: "zh-Hans" });
  });

  it("sends exactly one email — the invite is the only one there is", async () => {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${invitee.email}`)}`,
    );
    const { messages_count } = (await search.json()) as { messages_count: number };

    expect(messages_count).toBe(1);
  });
});
