import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requiredEnv } from "@/lib/env";
import { imagesBucket } from "@/lib/images/images";
import { onePixelJpeg } from "@/lib/images/one-pixel-jpeg";

import { createServiceClient } from "./service-client";

/**
 * RLS is the only thing between the anon key — which reaches the browser — and every
 * table in `public`. It is deliberately not a permission model: inside an org everyone
 * sees everything, cost and margin included. So what it has to prove is narrow and
 * total: the org boundary holds, and a disabled user reads nothing.
 *
 * This sits outside the project's route-handler seam on purpose. The policies have to
 * be right before the first handler that depends on them is written, and no handler
 * can reach them yet.
 */

const password = "correct-horse-battery-staple";

// A real database, shared across runs — every fixture is namespaced so a re-run cannot
// collide with the rows a previous one left behind.
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const orgs: Record<"a" | "b", string> = { a: "", b: "" };
const members: Record<"a" | "mate" | "b" | "disabled", { id: string; email: string }> = {
  a: { id: "", email: `a-${run}@example.test` },
  // A second *active member of org A*. `b` is across the org boundary, so a write aimed
  // at it proves only that the boundary holds — anything about what one colleague may
  // do to another has to be asked inside a single org.
  mate: { id: "", email: `mate-${run}@example.test` },
  b: { id: "", email: `b-${run}@example.test` },
  disabled: { id: "", email: `disabled-${run}@example.test` },
};
const tenders: Record<"a" | "b", string> = { a: "", b: "" };

function anonClient(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signedInAs(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) throw error;

  return client;
}

async function createOrg(name: string): Promise<string> {
  const { data, error } = await service
    .from("orgs")
    .insert({ name })
    .select("id")
    .single();

  if (error) throw error;

  return data.id as string;
}

async function createMember(
  orgId: string,
  member: { id: string; email: string },
  disabledAt: string | null = null,
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

async function createTender(orgId: string, ownerId: string): Promise<string> {
  const { data, error } = await service
    .from("tenders")
    .insert({
      org_id: orgId,
      reference: `T-${run}`,
      client_name: "Bangkok General",
      title: "Examination gloves",
      date_received: "2026-08-01",
      internal_quote_deadline: "2026-08-10",
      client_submission_deadline: "2026-08-17",
      owner_user_id: ownerId,
    })
    .select("id")
    .single();

  if (error) throw error;

  return data.id as string;
}

beforeAll(async () => {
  orgs.a = await createOrg(`Org A ${run}`);
  orgs.b = await createOrg(`Org B ${run}`);

  await createMember(orgs.a, members.a);
  await createMember(orgs.a, members.mate);
  await createMember(orgs.b, members.b);
  await createMember(orgs.a, members.disabled, "2026-08-01T00:00:00.000Z");

  tenders.a = await createTender(orgs.a, members.a.id);
  tenders.b = await createTender(orgs.b, members.b.id);
});

afterAll(async () => {
  // Ordered by the foreign keys: users are `on delete restrict` from auth, and nothing
  // cascades from orgs, so the graph has to be torn down the way it was built.
  //
  // Every id is filtered for emptiness first. A `beforeAll` that fails halfway leaves
  // the ids it never reached at "", and an empty string thrown at `deleteUser` raises
  // an invalid-UUID error *out of the hook* — which is then the only failure reported,
  // hiding the one that actually mattered and stranding the rows already created.
  const memberIds = Object.values(members)
    .map((member) => member.id)
    .filter((id) => id !== "");
  const created = (ids: Record<string, string>) =>
    Object.values(ids).filter((id) => id !== "");

  await service.from("tenders").delete().in("id", created(tenders));
  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", created(orgs));
});

describe("row-level security", () => {
  it("shows a member only their own org's rows", async () => {
    const client = await signedInAs(members.a.email);

    const { data, error } = await client.from("tenders").select("id");

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([tenders.a]);
  });

  it("hides another org's row even when asked for it by id", async () => {
    const client = await signedInAs(members.a.email);

    const { data } = await client.from("tenders").select("id").eq("id", tenders.b);

    expect(data).toEqual([]);
  });

  it("refuses a write into another org", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client.from("tenders").insert({
      org_id: orgs.b,
      reference: `T-${run}-smuggled`,
      client_name: "Bangkok General",
      title: "Smuggled across the boundary",
      date_received: "2026-08-01",
      internal_quote_deadline: "2026-08-10",
      client_submission_deadline: "2026-08-17",
      owner_user_id: members.b.id,
    });

    expect(error).not.toBeNull();
  });

  it("refuses to let a member move a row into another org", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("tenders")
      .update({ org_id: orgs.b })
      .eq("id", tenders.a);

    expect(error).not.toBeNull();
  });

  it("shows a disabled user nothing, including their own org", async () => {
    const client = await signedInAs(members.disabled.email);

    const { data, error } = await client.from("tenders").select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets no disabled user write", async () => {
    const client = await signedInAs(members.disabled.email);

    const { error } = await client.from("suppliers").insert({
      org_id: orgs.a,
      name: `Supplier ${run}`,
    });

    expect(error).not.toBeNull();
  });

  it("shows a signed-out caller nothing", async () => {
    const { data, error } = await anonClient().from("tenders").select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("membership is not business data", () => {
  // RLS scopes rows to an org and deliberately stops there: inside one, everyone reads
  // and writes everything, cost and margin included. Three columns cannot live under
  // that rule. `is_org_admin` gates inviting (buildspec_2.md:154) and story 48 wants
  // the Org Admin to be the only person who can invite — a gate you can grant yourself
  // is not a gate. `disabled_at` is the same in reverse. `org_id` is the boundary
  // itself. Column-level privileges handle those, because they are the layer that
  // answers "which columns", where RLS answers "which rows".

  it("refuses to let a member make themselves an Org Admin", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("users")
      .update({ is_org_admin: true })
      .eq("id", members.a.id);

    expect(error).not.toBeNull();
  });

  it("refuses to let a member re-enable a disabled colleague", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("users")
      .update({ disabled_at: null })
      .eq("id", members.disabled.id);

    expect(error).not.toBeNull();
  });

  it("refuses to let a member conjure an account", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("users")
      .insert({
        id: crypto.randomUUID(),
        org_id: orgs.a,
        name: "Uninvited",
        email: `uninvited-${run}@example.test`,
      });

    expect(error).not.toBeNull();
  });

  it("refuses to let a member delete an account", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client.from("users").delete().eq("id", members.b.id);

    // Users are never deleted — they are soft-disabled, because a Quote records who
    // sourced it and that attribution has to survive someone leaving.
    expect(error).not.toBeNull();
  });

  it("still lets a member edit their own name and language", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("users")
      .update({ name: "Nok", locale: "zh-Hans" })
      .eq("id", members.a.id);

    expect(error).toBeNull();
  });

  it("refuses to let a member edit a colleague's name or language", async () => {
    // Their *own* org's colleague, so the org boundary is not what is being tested.
    // The column grant says which columns are writable and nothing about whose row, so
    // without a row-scoped rule `name` and `locale` are two of the org's columns rather
    // than two of your own — and flipping a colleague's `locale` switches the language
    // of their app on next load.
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("users")
      .update({ name: "Renamed by a colleague", locale: "zh-Hans" })
      .eq("id", members.mate.id);

    // PostgREST reports an update that matches no updatable row as a success over zero
    // rows, so the row itself is what has to be checked.
    expect(error).toBeNull();

    const { data } = await service
      .from("users")
      .select("name, locale")
      .eq("id", members.mate.id)
      .single();

    expect(data?.name).not.toBe("Renamed by a colleague");
    expect(data?.locale).not.toBe("zh-Hans");
  });

  it("refuses to let a member rewrite the org's settings", async () => {
    // No v1 screen edits these, and fx_buffer_pct silently re-prices every future
    // Quote.
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("orgs")
      .update({ fx_buffer_pct: 0.5 })
      .eq("id", orgs.a);

    expect(error).not.toBeNull();
  });

  it("still lets a member read the org, for its timezone and buffer", async () => {
    const client = await signedInAs(members.a.email);

    const { data, error } = await client.from("orgs").select("timezone").eq("id", orgs.a);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("fx_rates", () => {
  // Shared reference data with no org to scope by. The only legitimate writer is the
  // daily Frankfurter fetch, which runs with the service role.
  beforeAll(async () => {
    await service
      .from("fx_rates")
      .upsert({ currency: "CNY", as_of: "2026-08-10", rate_to_thb: 5 });
  });

  afterAll(async () => {
    // fx_rates is keyed by (currency, as_of), not by anything run-scoped, so it is the
    // one fixture here that a parallel or repeated run could collide on.
    await service
      .from("fx_rates")
      .delete()
      .eq("as_of", "2026-08-10")
      .in("currency", ["CNY", "USD"]);
  });

  it("is readable by any member", async () => {
    const client = await signedInAs(members.a.email);

    const { data, error } = await client
      .from("fx_rates")
      .select("rate_to_thb")
      .eq("currency", "CNY")
      .eq("as_of", "2026-08-10");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("is not writable from the browser's key", async () => {
    // A bad write here corrupts the rate every subsequent Quote freezes at entry.
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("fx_rates")
      .insert({ currency: "USD", as_of: "2026-08-10", rate_to_thb: 1 });

    expect(error).not.toBeNull();
  });

  it("cannot have a rate rewritten by a member", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client
      .from("fx_rates")
      .update({ rate_to_thb: 999 })
      .eq("currency", "CNY")
      .eq("as_of", "2026-08-10");

    // PostgREST reports an update that matches no updatable row as a success over zero
    // rows, so the rate itself is what has to be checked.
    expect(error).toBeNull();

    const { data } = await service
      .from("fx_rates")
      .select("rate_to_thb")
      .eq("currency", "CNY")
      .eq("as_of", "2026-08-10")
      .single();

    expect(Number(data?.rate_to_thb)).toBe(5);
  });

  it("shows a disabled user no rates either", async () => {
    const client = await signedInAs(members.disabled.email);

    const { data } = await client.from("fx_rates").select("rate_to_thb");

    expect(data).toEqual([]);
  });
});

/**
 * The one value in this schema the org boundary is not enough for.
 *
 * Everywhere else, "inside an org everyone sees everything" is the deliberate design —
 * cost and margin included. The Group Robot's webhook is different in kind: it is a
 * bearer credential, and anyone holding it can post to the company WeCom group *as the
 * app*. So the question here is not whether the org boundary holds. It is whether a
 * perfectly ordinary, active member of the org that owns the row can reach it at all.
 *
 * They must not. Not to read it — the URL is the credential, and it reaches nothing
 * less than the whole company's group chat. And not to write it either: an unnoticed
 * repoint is worse than a leak, because every reminder and Digest the org sends would
 * keep reporting success while arriving somewhere nobody is watching.
 */
describe("the Group Robot's webhook", () => {
  const webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-${run}`;

  async function storedWebhook(): Promise<string | null> {
    const { data } = await service
      .from("group_robots")
      .select("webhook_url")
      .eq("org_id", orgs.a)
      .maybeSingle();

    return data?.webhook_url ?? null;
  }

  beforeAll(async () => {
    const { error } = await service
      .from("group_robots")
      .insert({ org_id: orgs.a, webhook_url: webhook });

    if (error) throw error;
  });

  it("cannot be read by a member of the org that owns it", async () => {
    const client = await signedInAs(members.a.email);

    const { data } = await client.from("group_robots").select("webhook_url");

    // Asserted on the value, not just the row count: whether the database refuses with
    // a permission error or hands back an empty set, what must never happen is the URL
    // arriving at something holding the anon key.
    expect(data ?? []).toEqual([]);
    expect(JSON.stringify(data ?? [])).not.toContain(`secret-${run}`);
  });

  it("cannot be read across the org boundary either", async () => {
    const client = await signedInAs(members.b.email);

    const { data } = await client.from("group_robots").select("webhook_url");

    expect(data ?? []).toEqual([]);
  });

  it("cannot be repointed by a member", async () => {
    // The dangerous write. It would not look like an attack or like a bug: every send
    // afterwards still returns errcode 0, from a group nobody is reading.
    const client = await signedInAs(members.mate.email);

    await client
      .from("group_robots")
      .update({ webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=theirs" })
      .eq("org_id", orgs.a);

    // PostgREST reports an update matching no updatable row as a success over zero
    // rows, so the stored value is what has to be checked.
    await expect(storedWebhook()).resolves.toBe(webhook);
  });

  it("cannot be given to an org that has none", async () => {
    const client = await signedInAs(members.b.email);

    await client
      .from("group_robots")
      .insert({ org_id: orgs.b, webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=theirs" });

    const { data } = await service.from("group_robots").select("org_id").eq("org_id", orgs.b);

    expect(data ?? []).toEqual([]);
  });

  it("cannot be deleted by a member", async () => {
    // Deleting it silences the org without a trace: nothing is misconfigured, there is
    // simply no robot any more.
    const client = await signedInAs(members.a.email);

    await client.from("group_robots").delete().eq("org_id", orgs.a);

    await expect(storedWebhook()).resolves.toBe(webhook);
  });
});

describe("the images bucket", () => {
  // One private bucket holds every image the app stores — Reference Images now, Quote
  // Photos next — with the path carrying the org boundary: `{org_id}/{entity}/{id}/…`
  // (A13). Storage has no `org_id` column to write a policy against, so the leading
  // path segment *is* the tenancy check, and a naming convention that nothing enforces
  // is not one. Everything below asks the database the way the browser's anon key
  // would, because that is the only key a signed upload URL is ever minted with.
  // Every path any test here names, so the bucket is left as it was found: nothing
  // cascades from an org into Storage, and `afterAll` only tears down rows.
  const objects: string[] = [];

  const objectIn = (orgId: string, tenderId: string) => {
    const path = `${orgId}/tenders/${tenderId}/${crypto.randomUUID()}.jpg`;

    objects.push(path);

    return path;
  };

  it("lets a member upload into their own org's folder through a signed URL", async () => {
    const client = await signedInAs(members.a.email);
    const path = objectIn(orgs.a, tenders.a);

    const { data: signed, error: signError } = await client.storage
      .from(imagesBucket)
      .createSignedUploadUrl(path);

    expect(signError).toBeNull();

    // The browser's half. It carries the token and no session at all, which is the
    // whole point of the route: the upload leaves the phone for Storage directly.
    const { error: uploadError } = await client.storage
      .from(imagesBucket)
      .uploadToSignedUrl(path, signed!.token, onePixelJpeg());

    expect(uploadError).toBeNull();
  });

  it("refuses to sign an upload into another org's folder", async () => {
    const client = await signedInAs(members.a.email);

    const { error } = await client.storage
      .from(imagesBucket)
      .createSignedUploadUrl(objectIn(orgs.b, tenders.b));

    expect(error).not.toBeNull();
  });

  it("will not sign a read of another org's object", async () => {
    const path = objectIn(orgs.b, tenders.b);
    const { error: seedError } = await service.storage
      .from(imagesBucket)
      .upload(path, onePixelJpeg(), { contentType: "image/jpeg" });

    expect(seedError).toBeNull();

    const client = await signedInAs(members.a.email);
    const { error } = await client.storage.from(imagesBucket).createSignedUrl(path, 60);

    expect(error).not.toBeNull();
  });

  it("will not sign an upload for a disabled user", async () => {
    // `current_org_id()` is null for them, and `= null` is null rather than true, so the
    // same policy that scopes an org also ends a disabled member's uploads.
    const client = await signedInAs(members.disabled.email);

    const { error } = await client.storage
      .from(imagesBucket)
      .createSignedUploadUrl(objectIn(orgs.a, tenders.a));

    expect(error).not.toBeNull();
  });

  afterAll(async () => {
    if (objects.length > 0) await service.storage.from(imagesBucket).remove(objects);
  });

  it("is not public", async () => {
    // A public bucket serves every object to anyone who can guess a uuid, and these are
    // a client's Reference Images and a supplier's price evidence.
    const { data } = await service.storage.getBucket(imagesBucket);

    expect(data?.public).toBe(false);
  });
});
