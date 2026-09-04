import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createServiceClient } from "@/lib/supabase/service-client";
import { memoryCookieStore } from "@/lib/supabase/session-client";
import { reportUnlessRoutine } from "@/test/postgres-notices";

import { signIn } from "./session";
import { setUpOrgAdmin, setupIsOpen } from "./setup";

/**
 * The one-time setup screen, exercised against the real local Postgres.
 *
 * This is `.exclusive.test.ts` for a reason particular to what it tests: the guard *is*
 * "`users` is empty", so the only way to test it honestly is to make the whole table
 * empty — which is database-wide, not worker-wide, and would break every RLS suite
 * reading `users` at the same moment. The exclusive project runs in a later group with
 * nothing else in flight, which is what makes that safe.
 *
 * Nothing is destroyed. Existing rows are *moved* to `withheld.users` and put back, and
 * `restoreWithheld` runs before this file starts as well as after it, so a worker killed
 * mid-test leaves the database repairable rather than repaired-by-luck. The same shape as
 * `src/app/api/health/route.exclusive.test.ts`, for the same reason.
 */

const secret = "a-setup-secret-nobody-would-guess";
const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

/** Every account this file creates, so it can be removed however the test ended. */
const created: string[] = [];

async function withSuperuser<T>(
  work: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1, onnotice: reportUnlessRoutine });

  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Put back anything a previous run left withheld, then drop the holding table so the next
 * withholding starts from the live table's shape rather than a stale copy of it.
 *
 * `session_replication_role = replica` turns off foreign-key enforcement for this session
 * alone. A `users` row can be referenced by a Tender it owns and a Quote it entered, and
 * moving it out and back is not a change either constraint should have an opinion about —
 * but each half of the move looks like a violation on its own.
 */
async function restoreTable(sql: postgres.Sql, table: string): Promise<void> {
  const [held] = await sql`
    select to_regclass(${`withheld.${table}`}) is not null as present
  `;

  if (!held.present) return;

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into ${tx(`public.${table}`)} select * from ${tx(`withheld.${table}`)} on conflict do nothing`;
    await tx`drop table ${tx(`withheld.${table}`)}`;
  });
}

async function restoreWithheld(sql: postgres.Sql): Promise<void> {
  // `orgs` before `users`, so the tables come back in the order their foreign key points
  // even though `replica` means nothing is checking.
  for (const table of ["orgs", "users"]) await restoreTable(sql, table);
}

/**
 * Move a table's rows out of the way, and give back the undo for *that table only*.
 *
 * Deliberately not the blanket `restoreWithheld`: `users` stays withheld for the whole
 * file, so a test that borrows `orgs` for one assertion and then repairs everything would
 * hand every account back to the following test and reopen a door it is trying to prove
 * shut. That failure is invisible in the borrowing test and fatal two tests later.
 */
async function withhold(table: string): Promise<() => Promise<void>> {
  await withSuperuser(async (sql) => {
    await sql`create schema if not exists withheld`;
    await sql`create table ${sql(`withheld.${table}`)} (like ${sql(`public.${table}`)})`;

    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into ${tx(`withheld.${table}`)} select * from ${tx(`public.${table}`)}`;
      await tx`delete from ${tx(`public.${table}`)}`;
    });
  });

  return () => withSuperuser((sql) => restoreTable(sql, table));
}

async function removeCreated(): Promise<void> {
  for (const id of created.splice(0)) {
    await service.from("users").delete().eq("id", id);
    await service.auth.admin.deleteUser(id);
  }
}

function attempt(overrides: Partial<Parameters<typeof setUpOrgAdmin>[0]> = {}) {
  return setUpOrgAdmin({
    email: `admin-${run}-${crypto.randomUUID().slice(0, 8)}@example.test`,
    name: "First Admin",
    password,
    secret,
    ...overrides,
  });
}

beforeAll(async () => {
  process.env.SETUP_SECRET = secret;

  await withSuperuser(restoreWithheld);
  await withhold("users");
});

afterEach(removeCreated);

afterAll(async () => {
  delete process.env.SETUP_SECRET;

  await removeCreated();
  await withSuperuser(restoreWithheld);
});

describe("the door", () => {
  it("is shut when no secret is configured", async () => {
    delete process.env.SETUP_SECRET;

    try {
      expect(await setupIsOpen()).toBe(false);
      expect(await attempt()).toEqual({ ok: false, reason: "closed" });
    } finally {
      process.env.SETUP_SECRET = secret;
    }
  });

  it("is open on a database with no accounts in it", async () => {
    expect(await setupIsOpen()).toBe(true);
  });

  it("refuses a secret that does not match", async () => {
    expect(await attempt({ secret: "not-the-secret" })).toEqual({
      ok: false,
      reason: "wrong_secret",
    });
  });

  it("refuses an empty secret, which is what an unset one submits as", async () => {
    expect(await attempt({ secret: "" })).toEqual({
      ok: false,
      reason: "wrong_secret",
    });
  });
});

describe("the account it creates", () => {
  it("is an Org Admin in the seeded org, and can sign in", async () => {
    const email = `admin-${run}@example.test`;
    const result = await attempt({ email });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    created.push(result.userId);

    const { data: profile } = await service
      .from("users")
      .select("email, name, is_org_admin, locale, org_id, disabled_at")
      .eq("id", result.userId)
      .single();

    const { data: org } = await service
      .from("orgs")
      .select("id")
      .limit(1)
      .single();

    expect(profile).toMatchObject({
      email,
      name: "First Admin",
      is_org_admin: true,
      org_id: org!.id,
      disabled_at: null,
    });

    // Null on purpose, exactly as an invited colleague's is: first start-up asks rather
    // than inferring, and the setup form has no language question on it.
    expect(profile!.locale).toBeNull();

    // The whole point of the screen. `email_confirm` is set at creation, so there is no
    // confirmation mail standing between typing the password and using it.
    expect(await signIn({ email, password }, memoryCookieStore())).toEqual({
      ok: true,
    });
  });
});

describe("having run once", () => {
  it("shuts, and stays shut", async () => {
    const first = await attempt();

    expect(first.ok).toBe(true);

    if (first.ok) created.push(first.userId);

    expect(await setupIsOpen()).toBe(false);
    expect(await attempt()).toEqual({ ok: false, reason: "closed" });
  });

  it("shuts against an account it did not create itself", async () => {
    // The bootstrapped-by-hand case, and the one that decides whether this route is a way
    // in: a database whose only account arrived through README §6, or through an Invite,
    // or through a restored backup. Setup has no memory of having run — an existing row
    // is the whole record.
    const { data } = await service.auth.admin.createUser({
      email: `by-hand-${run}@example.test`,
      password,
      email_confirm: true,
    });

    const { data: org } = await service
      .from("orgs")
      .select("id")
      .limit(1)
      .single();

    await service.from("users").insert({
      id: data.user!.id,
      org_id: org!.id,
      name: "By Hand",
      email: `by-hand-${run}@example.test`,
    });

    created.push(data.user!.id);

    expect(await setupIsOpen()).toBe(false);
    expect(await attempt()).toEqual({ ok: false, reason: "closed" });
  });
});

describe("a database the migrations have not finished with", () => {
  it("says there is no organisation rather than guessing", async () => {
    // `no_org` is not a hypothetical: the `orgs` row is seeded by the schema migration, so
    // its absence means the migrations have not been applied. Naming that is the whole
    // difference between "apply your migrations" and an operator re-typing a secret that
    // was never wrong.
    const restore = await withhold("orgs");

    try {
      expect(await attempt()).toEqual({ ok: false, reason: "no_org" });
    } finally {
      await restore();
    }
  });
});

describe("two people standing it up at once", () => {
  it("never leaves two accounts, and never leaves none", async () => {
    // What this pins is the invariant, not the mechanism. Submissions issued together
    // turn out to serialise in practice — GoTrue's `createUser` and the PostgREST round
    // trips are slow enough that the second caller's emptiness check almost always sees
    // the first caller's row — so this does *not* reliably reach the branch that elects a
    // survivor, and it passes against the counting version it replaced. It is kept for
    // the property it does hold, in the direction that matters: concurrent submissions
    // must never mint a second Org Admin, and must never undo their way to zero.
    //
    // The election itself is reasoned about at `setUpOrgAdmin`'s last guard rather than
    // demonstrated here: reaching it needs a competing row inserted between one caller's
    // emptiness check and its own, which there is no seam to do from outside.
    const results = await Promise.all(
      Array.from({ length: 4 }, () => attempt()),
    );

    for (const result of results) if (result.ok) created.push(result.userId);

    expect(results.filter((result) => result.ok)).toHaveLength(1);

    const { count } = await service
      .from("users")
      .select("id", { count: "exact", head: true });

    expect(count).toBe(1);
  });
});
