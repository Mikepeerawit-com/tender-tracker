# Tender Tracker

Tracks client tenders at a medical-supplies trading company: what a client asked for,
what suppliers quoted in response, what we bid back, and whether we won.

- **What it is for and what it must do:** [`buildspec_2.md`](buildspec_2.md)
- **The words the code uses:** [`CONTEXT.md`](CONTEXT.md)
- **Decisions that must not be reversed by accident:** [`docs/adr/`](docs/adr)

## Stack

Next.js (App Router) · Tailwind CSS · shadcn/ui · next-intl (`en` / `zh-Hans`) ·
Supabase (Postgres, Auth, Storage) · Vercel.

## Running it

Requires Node 24+, Docker (for the local Supabase stack) and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
npm run db:start          # supabase start — brings up local Postgres and applies migrations
cp .env.example .env.local # fill from `supabase status -o env`
npm run dev
```

| Script              | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Development server                                        |
| `npm run build`     | Production build                                          |
| `npm test`          | The test suite — needs the local Supabase stack running   |
| `npm run typecheck` | `next typegen && tsc --noEmit`                            |
| `npm run lint`      | ESLint                                                    |
| `npm run db:start`  | Start local Supabase                                      |
| `npm run db:reset`  | Rebuild the local database from `supabase/migrations/`     |

## Testing

**The main seam is route handlers and server actions, over a real local Postgres** —
every `*.test.ts` file. Tests bring nothing up themselves: run `supabase start` first,
and they read the stack's URL and keys from `supabase status`. Only two outbound
boundaries are ever stubbed: the WeCom robot webhook and the Frankfurter rate fetch.

The seam is chosen deliberately. Progress, the three overdue conditions and the list
blocks are *queries*; testing an extracted pure function tests something that is not
what ships. See "Testing Decisions" in `buildspec_2.md`.

**`*.test.tsx` is the second, much smaller seam: the browser half**, run under jsdom for
the few behaviours that only exist once a component is interactive — a Margin
recomputing as digits are typed into the working sheet. It is a separate Vitest project
because those files cannot resolve packages under the `react-server` condition the
server seam needs. `vitest run` runs both.

## Conventions

- **No hardcoded user-facing strings.** Every string is a next-intl key, in both
  `src/messages/en.json` and `src/messages/zh-Hans.json`, from the first component
  onward. The locale is resolved server-side and is not in the URL — [ADR-0011](docs/adr/0011-locale-is-not-in-the-url.md).
- **The run instant is injected at the request boundary, never read inside business
  logic** — [ADR-0010](docs/adr/0010-injected-run-instant.md). `new Date()` and
  `Date.now()` are ESLint errors everywhere except `src/lib/run-instant.ts`.
- **The cookie jar is injected the same way.** `cookies()` is resolved in the server
  action or route handler and passed down, so everything below it is testable without a
  Next request context. `memoryCookieStore()` stands in for a browser in tests.
- **Sessions are server-set cookies, and never anything else.** No browser-side Supabase
  client exists; the session cookie is `httpOnly`, so script cannot read it. WebKit
  clears script-writable storage — `localStorage` *and* `document.cookie` writes — after
  7 idle days, which would turn the 30-day session into 7 for an app whose usage is
  reminder-driven and sparse by design. `src/lib/auth/conventions.test.ts` fails if
  `localStorage`, `createBrowserClient` or a password-reset call reappears.
- **Nothing tells the reader to open a browser.** Every reminder link lands in the WeCom
  in-app webview and there is no way out of it into Safari, so the advice is
  unfollowable. The same test fails on "open in your browser" or 浏览器 in any
  user-facing string.

## Deploying

Vercel, with Supabase in Singapore (`ap-southeast-1`). Live at
<https://tenders.mikepeerawit.com>.

`GET /api/health` returns `{"status":"ok","database":"reachable"}` when the deployment
can reach Postgres. It is the acceptance check for every step below, and it
distinguishes its own failure modes — read the body, never just the status code:

| Response | Meaning |
| --- | --- |
| `200 {"database":"reachable"}` | Everything is wired up. |
| `503 {"database":"unreachable"}` | Credentials are fine; `health_check()` is missing, so the migration never reached this database. |
| `500 {"status":"misconfigured"}` | The deployment has no Supabase credentials at all. |

### 1. Vercel project and Supabase credentials

Import the repo into Vercel, then add Supabase through the **Vercel Marketplace**
integration rather than setting the variables by hand. The integration supplies
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the `POSTGRES_*` set, and
keeps them correct if a key is ever rotated. Hand-copied values are how a deployment
ends up pointed at the local stack in `.env.local`.

Environment variables added after the first build do not trigger a rebuild — redeploy
once, or `/api/health` keeps reporting the state from before they landed.

### 2. Apply migrations to the hosted database

Vercel deploys the app; nothing deploys the schema. This is a separate, easily
forgotten step, and the app boots fine without it — `/api/health` is what catches it.

```sh
supabase link --project-ref <project-ref>   # needs the database password
supabase db push
supabase migration list                     # Local and Remote columns must match
```

If a migration is ever applied out of band (`psql`, the dashboard SQL editor), the
remote history will not know about it and the next `db push` will try to re-apply it.
Fix with `supabase migration repair --status applied <version>`.

### 3. Custom domain

DNS is at Cloudflare; Vercel still needs the hostname registered so it routes by Host
header and issues the certificate.

```sh
vercel domains add <host> tender-tracker
vercel domains inspect <host>   # prints the exact record to create — do not recite one from memory
```

Then create that record at Cloudflare with **Proxy status: DNS only** (grey cloud).
If you do proxy it, Cloudflare SSL/TLS must be **Full (strict)** — Flexible causes a
redirect loop, and that breaks the WeCom in-app webview entry path this product
depends on, where there is no way out to Safari to work around it.

The certificate takes a few minutes after DNS resolves; TLS handshakes fail until it
is issued, which is not a misconfiguration. `vercel certs ls` shows when it lands.

Because the record points at Vercel rather than moving nameservers,
`vercel domains inspect` reports the nameservers as "not intended" forever. That is
expected and not a fault.

### 4. Supabase Free → Pro, before the first real Tender

**Upgrade Supabase from Free to Pro before the first real (non-test) Tender is
entered.** Not "when we need it" — that moment never announces itself, and by then the
thing it protects against has already happened.

Supabase Free has **no automated backups**. There is no legacy system to fall back on:
the spreadsheets and chat threads this app replaces stop being maintained the day the
team starts using it, so a lost database is lost work with nothing behind it. Pro adds
daily backups and point-in-time recovery.

This is a human step — nothing in the codebase can check it, and no deploy will fail
without it. Verify the current plan terms at the time rather than trusting this
paragraph; Supabase has changed what sits behind the Free/Pro line before.

### 5. Resend as custom SMTP

**The invite is the only email the app sends, and it will not send at all until this is
done.** Supabase's built-in mailer is rate-limited to a handful of messages an hour and
is explicitly not for production; on the hosted project it will silently throttle
invites rather than fail loudly.

1. Create a Resend account and verify the sending domain (DNS records at Cloudflare —
   see §3 for how records are managed here).
2. Create an API key.
3. In the Supabase dashboard: **Project Settings → Authentication → SMTP Settings**,
   enable custom SMTP and fill in `smtp.resend.com`, port `587`, username `resend`,
   password = the API key, and a sender address on the verified domain.

Locally none of this applies: `supabase start` runs Mailpit, and invite emails land at
<http://127.0.0.1:54324> instead of being delivered.

There is deliberately **no password-reset flow**. Under ten users, the Org Admin resets
a password from **Authentication → Users** in the Supabase dashboard. That is what keeps
the email surface at exactly one template, which is what makes an SMTP problem obvious
instead of a category of intermittent bug.

### 6. The first Org Admin

Accounts exist only by invitation and `enable_signup` is off at the platform level, so
the first account cannot invite itself into existence. Create it by hand, once:

1. **Authentication → Users → Add user** in the Supabase dashboard. Set a password and
   tick *Auto Confirm User*. Copy the resulting UUID.
2. Run this against the project database, using that UUID:

   ```sql
   insert into users (id, org_id, name, email, is_org_admin)
   select '<uuid>', id, '<name>', '<email>', true from orgs limit 1;
   ```

The `orgs` row is seeded by the schema migration, so it already exists. `is_org_admin`
gates inviting and nothing else — it grants no extra visibility, and it is not writable
through the app by anyone, including an Org Admin (see the column grants in
`20260814010000_membership_is_not_business_data.sql`). Promoting a second admin is the
same `update` run from the dashboard.

From here everyone else arrives by invitation from inside the app, at **/admin/people**.
