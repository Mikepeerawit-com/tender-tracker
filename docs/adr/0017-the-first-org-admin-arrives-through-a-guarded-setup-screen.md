# The first Org Admin arrives through a guarded setup screen

**Status:** accepted. Qualifies one clause of [ADR-0006](0006-email-password-floor-wecom-convenience.md); the rest of it, and all of [ADR-0008](0008-wecom-qr-login-deferred-from-v1.md), stand unchanged.

ADR-0006 decided that **accounts are created by invitation, never otherwise**, and `supabase/config.toml` puts `enable_signup = false` "at the platform level rather than merely unlinked from the UI". Both still hold. But an Invite can only be sent by an Org Admin, so the _first_ account cannot invite itself into existence, and that gap has to be closed by something.

Until now it was closed by hand, in README §6: create the auth user in the Supabase dashboard, copy the UUID it generates, then run `insert into users (…) select '<uuid>', id, … from orgs limit 1` against the database from somewhere else. Two systems, a hand-typed identifier, and a subselect — performed once per database, by whoever is least practised at it, at the moment a deployment is being stood up for the first time.

## Decision

**The first Org Admin is created at `/setup`, in the app, and that route is the only thing anywhere in the codebase that writes `is_org_admin = true`.** It is guarded by two conditions, and neither is sufficient alone:

- **`SETUP_SECRET` must be set on the deployment, and the form's value must match it.** Unset means _closed_ — not "open with no password". A deployment that forgets the variable gets a shut door, which is the only safe direction for that mistake to fail in.
- **`public.users` must be empty.** One-shot: the moment setup succeeds, the route can never do anything again, and it has no memory of having run — an existing row is the entire record. An account that arrived some other way (a restored backup, the old README §6 procedure, an Invite) shuts it just as firmly.

`/setup` joins `publicPaths` in `src/proxy.ts`, because there is by definition nobody to be signed in as. As with `/api/cron/daily` and its `CRON_SECRET`, being listed there is a statement about _which_ lock, not whether there is one.

## Why not the alternatives

**Open signup was rejected, and it is worth being precise about why.** The v1 RLS posture is one policy per table: inside your org you read and write everything, cost and Margin included. There is exactly one org, seeded by the schema migration. So an account created by an unguarded form is not a limited account — it holds every Tender, every supplier's price, every landed cost and every Margin the business has. `enable_confirmations` is off, so it would work immediately, with no email in the loop to slow anyone down.

**The emptiness check alone was rejected**, which is the version that looks sufficient and is not. It is true _by definition_ at exactly the moment the route is reachable. And **preview and production share one Supabase project** — the same fact ADR-0016 leans on to make `preview-schema.yml` meaningful — so such a route would be live on every preview URL, writing real accounts into the real database. The secret is the lock; the emptiness check is the belt.

**A CLI script (`npm run bootstrap:admin`) was the other serious candidate.** It fails on where the credential has to live: the service-role key for the _hosted_ project would have to be on the operator's laptop, when the deployment already holds it. It is also a second account-creation mechanism, run once per database, which is precisely the profile of code that is broken when you finally need it. The screen is exercised on every local `db:reset` instead.

**Writing `auth.users` and `auth.identities` directly from `supabase/seed.sql`** would have made local resets free, at the cost of a second implementation of account creation coupled to GoTrue's internal table shape — one that drifts silently. A local reset reopening the same screen a real deployment uses is worth more than the convenience of not having to fill it in.

## What must not be quietly undone

- **An unset `SETUP_SECRET` means closed.** `requiredEnv` is deliberately _not_ used in `src/lib/auth/setup.ts`: a missing value is a shut door, not a crash and not an open one. Changing it to default-open is one line and would be catastrophic on a fresh production deployment.
- **Setup never promotes a second Org Admin.** Promotion stays an `update` run from the Supabase dashboard, per README §6. "First account wins" applied to any table state other than empty is a race on a publicly reachable route.
- **`is_org_admin` stays unwritable by `authenticated`.** The column grants in `20260814010000_membership_is_not_business_data.sql` are what make the boolean a gate rather than a suggestion; setup writes it with the service role, on the server, once.
- **Setup reads the org and never creates one.** `org_id` is "a placeholder column… the entire concession to a future multi-tenant product". Making setup create an org is the first half of multi-tenancy arriving by accident, in the one place nobody is signed in.
- **The secret is checked before the database is touched.** The emptiness check is the belt, so asking it first would let anyone who does not hold the secret drive service-role queries on a public route and tell `closed` from `wrong_secret` — a question they have no business being able to ask.
- **A racing write is settled by naming the survivor, not by counting.** Two submissions can both pass an emptiness check. Asked afterwards only "am I the only row?", both answer no and both undo themselves, which leaves the deployment with _no_ Org Admin and a screen saying `closed` about a door that just reopened. The last guard therefore elects the earliest row — `id` settling a tie — so both racers reach the same verdict and only the loser cleans up. Reverting it to a count restores the both-lose outcome, and no test will say so: the interleave needed to reach that branch is not reproducible from outside the function, which is why this is written down here.
- **This does not reopen self-signup.** `enable_signup` stays `false`; setup writes through the service role, which is how _every_ `users` row in this app is written, including an Invite's.

## Consequences

- **README §6 becomes a paragraph instead of a procedure**, and the dashboard-plus-SQL route stops being the documented path — though it keeps working, and setup correctly shuts against an account created that way.
- **`npm run db:reset` re-bootstraps through the same screen a real deployment uses.** Before this, a reset left a developer locked out of their own environment with nothing in `supabase/seed.sql` to put them back — the file is configured in `config.toml` and has never existed.
- **The one-shot guard means production's Org Admin should be created through the deployed screen, not by hand first.** Hand-bootstrapping consumes the emptiness condition permanently, leaving a path that is only ever exercised locally.
- **`CONTEXT.md`'s **Invite** entry is qualified rather than rewritten.** "The only way an account comes into existence" becomes true _from inside the app_, with the first Org Admin named as the exception it always was.
- **Multi-org is unaffected and still deferred.** When one account may belong to several organisations, `current_org_id()` stops meaning "the caller's org" and this route's "the org" becomes a question rather than a `limit 1` — but nothing here makes that change harder.

## Amendment, 31 August 2026 — signup creates an organisation; joining one never does

Multi-org is no longer deferred as a direction, and the last consequence above has come due. The decision is recorded here rather than in a new ADR because it changes exactly one clause of this one — how the *first* Org Admin of an organisation arrives — and leaves the rest standing.

**Signing up creates a new, empty organisation, with the person who signed up as its first Org Admin. There is no way to sign up *into* an existing organisation.** A Membership of an organisation that already holds data is created by an **Invite** from one of that organisation's Org Admins, and by nothing else.

**The rejected shape was a signup form offering "create an org" or "join an org", and it is worth being explicit about why**, because it is the obvious design and it is unsafe. The v1 RLS posture is one policy per table keyed on `current_org_id()`: inside your org you read and write everything, supplier names, prices, Landed Cost and Margin included. A self-selected "join" makes the attacker a *legitimate member*, so every policy would work perfectly and still hand over the business. There is no version of that form that is safe without a token in the loop — and a token in the loop is an Invite by another name. The safe alternatives considered were an org-scoped invite link (an Invite) and email-domain verification (which fails the moment two colleagues use Gmail).

Creating an empty organisation is safe for the same reason that joining one is not: there is nothing in it yet.

### What this changes

- **`/setup` and `SETUP_SECRET` retire** once signup exists. Their whole purpose was closing the "the first account cannot invite itself" gap for a single seeded organisation; signup closes it generally, and for every organisation rather than one. Until signup ships, `/setup` stands exactly as specified above.
- **`enable_signup` flips to `true`, and the reasoning above is what makes that safe** — not a relaxation of the argument in "Why not the alternatives", but its resolution. What was rejected there was signup into *the* org, when there was only one and it held everything.
- **Org Admin moves off the person and onto the Membership.** A boolean still, and deliberately not a role enum, but scoped: admin of one organisation says nothing about any other, and an Invite grants Membership only. Promotion is a separate deliberate act by an existing admin of that organisation.
- **"Exactly one row" becomes "at least one per organisation."** The old constraint has a failure mode that only bites later: a sole Org Admin who leaves or is Disabled leaves an organisation nobody can ever invite anyone into again, with no recovery path in the app. Disabling the last remaining Org Admin of an organisation is therefore refused.
- **One person may hold several Memberships, and sees one organisation at a time.** `current_org_id()` survives as a scalar — it reads a session's **Active Org** instead of a column — rather than becoming a set. Showing two organisations' Tenders in one list was rejected: it reintroduces the long-list problem, forces every row to carry an org label at 390px, and turns cross-org adjacency into a permanent one-bug-away risk instead of an impossible state.
- **The switcher renders only for people holding more than one Membership.** A global mode that changes what every screen shows is exactly the kind of control that defeats a low-literacy reader, and the overwhelming majority have nothing to switch to. See [ADR-0021](0021-two-destinations-and-the-device-follows-the-role.md), whose bar is capped at two destinations.
- **The organisation's name becomes visible**, having been stored and never rendered anywhere. Correct while there was one; a hazard the moment there are two.
- **Sequencing: none of this ships before the simplification work.** It is a new product surface with a security model to get right, and it makes no difference to whether a colleague can enter a Quote. The four constraints above exist so that work starts from them rather than rediscovering them.
