import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requiredEnv } from "@/lib/env";

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
const members: Record<"a" | "b" | "disabled", { id: string; email: string }> = {
  a: { id: "", email: `a-${run}@example.test` },
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
