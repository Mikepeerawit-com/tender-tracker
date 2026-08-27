import "server-only";

import { timingSafeEqual } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service-client";

/**
 * How the first Org Admin comes into existence.
 *
 * Every other account arrives by Invite, and an Invite can only be sent by an Org Admin
 * — so the first one cannot invite itself into existence. Until now that gap was closed
 * by hand, in README §6: create the auth user in the Supabase dashboard, copy its UUID,
 * then run an `insert` against the database from a second window. Two systems and a
 * hand-typed identifier, performed once per database, by whoever is least likely to be
 * doing it often.
 *
 * This is that procedure as a screen, and it is the *only* thing that writes
 * `is_org_admin = true` anywhere in the app. See ADR-0017.
 *
 * The two guards below are what make a publicly reachable route that mints an Org Admin
 * defensible, and neither is sufficient alone:
 *
 *   * **`SETUP_SECRET` must be set, and must match.** Unset means closed — not "open
 *     with no password". A deployment that forgets the variable gets a shut door rather
 *     than an unguarded one, which is the only safe direction for that mistake to fail
 *     in.
 *   * **`users` must be empty.** One-shot: the moment this succeeds, the route can
 *     never do anything again.
 *
 * The emptiness check alone was rejected deliberately. It is true by definition at
 * exactly the moment the route is reachable, on a public domain, and it would be live on
 * every preview deployment too. The secret is the guard; the emptiness check is the belt.
 */

export const setupRefusals = [
  "closed",
  "wrong_secret",
  "no_org",
  "create_failed",
] as const;

export type SetupRefusal = (typeof setupRefusals)[number];

/**
 * Everything the setup screen can say, including the two refusals the form makes before
 * any of this is reached. `messages.test.ts` walks this so a reason cannot ship without a
 * sentence — and this is a screen nobody is signed in behind, on a database with no
 * accounts in it, so a raw message key here leaves the reader with no app to retreat into.
 */
export const setupErrors = [
  ...setupRefusals,
  "incomplete",
  "too_short",
  "mismatch",
] as const;

export type SetupError = (typeof setupErrors)[number];

export type SetupResult =
  { ok: true; userId: string } | { ok: false; reason: SetupRefusal };

/**
 * Whether the door is open at all — the same two conditions `setUpOrgAdmin` enforces,
 * asked ahead of time so the page can render a closed notice instead of a form nobody
 * can submit.
 *
 * This is not a security boundary and is not treated as one: it decides what to draw.
 * The refusal that matters is made below, at the write.
 */
export async function setupIsOpen(): Promise<boolean> {
  if (!configuredSecret()) return false;

  return (await accountCount()) === 0;
}

/**
 * Create the first Org Admin, or say why not.
 *
 * `email_confirm` is set because there is no mail in this path at all: the person
 * standing here typed the address and the password into the same form, so a confirmation
 * round trip would prove nothing and would fail on a project whose SMTP is not configured
 * yet — which, for the deployment this runs against, is every one of them.
 */
export async function setUpOrgAdmin({
  email,
  name,
  password,
  secret,
}: {
  email: string;
  name: string;
  password: string;
  secret: string;
}): Promise<SetupResult> {
  const expected = configuredSecret();

  if (!expected) return { ok: false, reason: "closed" };

  // The secret is asked before anything reaches the database, which is the order this
  // module's own design implies: the secret is the guard, the emptiness check is the belt.
  // Asking the belt first lets an unauthenticated caller drive service-role queries on a
  // public route, and tell `closed` from `wrong_secret` without ever holding the secret.
  if (!secretMatches(secret, expected))
    return { ok: false, reason: "wrong_secret" };

  const count = await accountCount();

  // `null` means the question could not be asked. An unreadable `users` table is not an
  // empty one, and guessing in the permissive direction here creates a second Org Admin.
  if (count === null) return { ok: false, reason: "create_failed" };
  if (count > 0) return { ok: false, reason: "closed" };

  const service = createServiceClient();

  // The org is seeded by the schema migration (`insert into orgs (name) values
  // ('Taihue')`), so this reads it rather than creating one. Org creation is deliberately
  // not here: `org_id` is a placeholder column and this app is single-org until the
  // multi-org map says otherwise.
  const { data: org } = await service
    .from("orgs")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!org) return { ok: false, reason: "no_org" };

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error !== null || !data.user)
    return { ok: false, reason: "create_failed" };

  const { error: profileError } = await service.from("users").insert({
    id: data.user.id,
    org_id: org.id,
    name,
    email,
    is_org_admin: true,
    // `locale` is left null for the same reason an invited colleague's is: first
    // start-up asks rather than inferring.
  });

  if (profileError) {
    // An auth account with no profile row is an account that can hold a password and read
    // nothing — and worse here than after a failed Invite, because this address is the one
    // the operator will immediately try again with. Undo it. `invite.ts` does the same.
    await service.auth.admin.deleteUser(data.user.id);

    return { ok: false, reason: "create_failed" };
  }

  // Two submissions racing would both have seen an empty table. `users.email` is unique,
  // so the same address cannot win twice, but two different ones could — and exactly one
  // of them has to survive.
  //
  // Counting cannot decide which. Both racers see the same count, and asked only "am I
  // alone?" both answer no and both undo themselves, leaving the deployment with no Org
  // Admin at all and a screen that says `closed` about a door that just reopened.
  //
  // So the survivor is *named* rather than counted: the earliest row, with `id` settling
  // the tie two transactions sharing a `now()` could otherwise produce. Both racers
  // compute the same answer and only the one that is not it cleans up. A read that fails
  // names nobody and so undoes this row — the door reopens, rather than staying shut
  // behind an account nobody can vouch for.
  if ((await firstAccount()) !== data.user.id) {
    await service.from("users").delete().eq("id", data.user.id);
    await service.auth.admin.deleteUser(data.user.id);

    return { ok: false, reason: "closed" };
  }

  return { ok: true, userId: data.user.id };
}

/**
 * The configured secret, or `null` when there isn't one.
 *
 * Read on each call rather than captured at module load, matching `requiredEnv` — and
 * `requiredEnv` itself is deliberately not used, because a missing value here is a
 * closed door rather than a crash.
 */
function configuredSecret(): string | null {
  const secret = process.env.SETUP_SECRET;

  return secret === undefined || secret === "" ? null : secret;
}

/**
 * How many accounts exist, or `null` if the database would not say.
 *
 * Every row, not just the admins. The guard is "`users` is empty", so an account that
 * arrived by Invite, by a restored backup, or by the old README §6 procedure has to shut
 * this route exactly as firmly as one setup made itself. Narrowing this to
 * `is_org_admin = true` would reopen setup on any of them.
 */
async function accountCount(): Promise<number | null> {
  const { count, error } = await createServiceClient()
    .from("users")
    .select("id", { count: "exact", head: true });

  return error !== null || count === null ? null : count;
}

/**
 * The id of the earliest-created account, or `null` if the database would not say.
 *
 * Ordered by `id` as well as `created_at` so that two rows sharing a timestamp still have
 * one deterministic answer every caller agrees on. That agreement is the whole point: it
 * is what lets two racing submissions elect the same survivor without talking.
 */
async function firstAccount(): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("users")
    .select("id")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  return error !== null || !data ? null : data.id;
}

/**
 * Constant-time comparison, because this is a secret arriving over the network and a
 * timing oracle on it is the one attack a guessable-length string is actually vulnerable
 * to. `timingSafeEqual` throws on a length mismatch, so that case is answered first —
 * leaking the length of the expected secret, which is the standard and accepted trade.
 */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}
