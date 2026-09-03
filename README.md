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

Then set `SETUP_SECRET` in `.env.local` to anything you like and open
<http://127.0.0.1:3000/setup> to create your local Org Admin. It is the same screen a real
deployment uses (§6), and it reopens after every `npm run db:reset` — which wipes the
accounts along with everything else.

| Script              | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Development server                                        |
| `npm run build`     | Production build                                          |
| `npm test`          | The test suite — needs the local Supabase stack running   |
| `npm run contact-sheet` | Photograph every screen in both locales, to look at   |
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
server seam needs.

**`*.exclusive.test.ts` is the server seam again, run alone.** A few tests can only prove
their point by breaking the shared database — revoking a grant every screen needs,
withholding a migration — and those faults are database-wide, not worker-wide. Its
project runs in a later group, when nothing else is in flight. Nothing is destroyed even
so: withheld rows are moved to a `withheld` schema and put back, and a run killed
mid-test is repaired by the next one.

`npm test` runs them all. Plain `vitest run` additionally picks up the contact sheet
below, which is not a test.

**The contact sheet is not a check — it is something to look at.** `npm run contact-sheet`
draws every screen in both locales at 390×844 and writes them, plus an index page, to a
gitignored `.contact-sheet/`. There is no baseline, no diff, and nothing it can fail;
open `.contact-sheet/index.html` and judge with your own eyes. It exists because the
#68 redesign merged with no image anybody could compare against anything.

It renders the same screens the `layout` project measures, from one shared module, so
what you look at and what CI guards cannot drift apart.

**It runs on your machine and never in CI, deliberately.** Under ADR-0019 the CJK face is
drawn by the device with no webfont, so a screenshot of this app is a fact about the
machine that took it: a Linux runner resolves at best Noto Sans SC and may carry no CJK
face at all, which would render `zh-Hans` — the locale to judge first — as a wall of
tofu. macOS resolves PingFang SC, what an iPhone reader actually sees. The index page
names which faces really resolved, so a sheet from one machine can be read safely on
another. Note that `next/font` supplies IBM Plex Sans in the real app and not in this
harness, so unless you have it installed the Latin text is drawn by the CJK face behind
it.

The phone in your hand is still the only fully honest renderer; see
`scripts/prelaunch-phone-checks.sh`.

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

`GET /api/health` is the acceptance check for every step below. It answers four
questions — can this deployment reach Postgres, is the schema the one this build was
written against, can the app still read its own tables, and does it know its own public
URL — and it names both migration versions and the origin either way, so a healthy answer
is checkable rather than merely reassuring:

```
200 {"status":"ok","database":"reachable",
     "schema":{"expected":"20260825020000","applied":"20260825020000","behind":0},
     "tables":{"probed":"tenders","readable":true},
     "appOrigin":{"configured":true,"origin":"https://tenders.mikepeerawit.com"},
     "checkedAt":"…"}
```

Every fault has a different fix, so read the body — the status code alone cannot tell
them apart, and five of these six are `503`:

| Response | Meaning | Fix |
| --- | --- | --- |
| `500 {"status":"misconfigured"}` | No usable Supabase credentials. | Step 1, then redeploy. |
| `503 {"database":"unreachable"}` | Neither PostgREST nor the Postgres behind it answers. | Check the project is not paused. |
| `503 {"schema":{"applied":null}}` | It answers, and `health_probe()` is not there — **no migration ever reached this database.** | Step 2. |
| `503 {"schema":{"behind":3}}` | Partly migrated: `applied` names the newest version it does hold. | Step 2. |
| `503 {"tables":{"readable":false,"error":"42501"}}` | The schema is there and the app may not read it — its table grants are missing. | A migration granting them, as `20260825010000` did. |
| `503 {"status":"no-app-origin"}` | Nobody set `APP_ORIGIN`, or set it to something that is not an absolute `https` origin — so **every reminder goes out with no link into the app.** | Set it on the deployment, then redeploy. |

The last row is the app working and the *messages* being broken, which is why it is not
folded into `misconfigured`: the app has its Supabase credentials and serves fine, and
what is missing is the thing that makes a reminder tappable. The messages still send
without it — reminders are the product, and suppressing a run over a missing config line
would cause the exact failure this app exists to prevent — so this endpoint is the only
place the fault is visible. See `src/lib/app-links.ts`.

Note the third and fourth rows are one fault reported two ways, because the probe cannot
report its own absence: `health_probe()` ships in a migration, so a database that has
received *nothing* has no way to say what it holds, and `applied: null` is the honest
answer. `behind` is for a database that has received some of them.

**Until #40 this table promised more than the probe delivered.** `health_check()` is
defined in the first migration, so `{"database":"reachable"}` only ever meant "migration
#1 landed" and said nothing about the rest — the hosted database ran three weeks eight
migrations behind while the probe reported `ok`. Worse, using it to decide reachability
reported a never-migrated database as `"unreachable"`, sending the reader to a Postgres
that was fine. `expected` is now baked in from `supabase/migrations/` at build time and
compared against the whole applied list; reachability means "the database answered,
whatever it said"; and the probe really reads a row from `tenders` as `authenticated`
rather than trusting a catalogue. Every fault it missed now has its own row above.

### 1. Vercel project and Supabase credentials

Import the repo into Vercel, then add Supabase through the **Vercel Marketplace**
integration rather than setting the variables by hand. The integration supplies
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the `POSTGRES_*` set, and
keeps them correct if a key is ever rotated. Hand-copied values are how a deployment
ends up pointed at the local stack in `.env.local`.

Two variables the integration does not supply: `CRON_SECRET`, which Vercel sets for the
scheduled job, and **`SETUP_SECRET`**, which you set by hand and which §6 uses once. Both
are secrets in the ordinary sense — long, random, and not reused.

A third, which is not a secret at all: **`APP_ORIGIN`**, the app's own public origin —
`https://tenders.mikepeerawit.com` here, absolute, no trailing slash. It is what lets a
reminder carry a link into the app, and nothing else in the environment can supply it,
since every URL is built server-side in the cron run. Leave it out and the messages still
go, without links; `/api/health` answers `no-app-origin` and the gate below stays red
until it is set.

**Set it for Preview as well as Production.** `preview-schema.yml` runs the same probe
against a pull request's deployment (§4), so a Preview environment without it turns every
PR check red — for a real fault, but not the one the reader is looking for. Production's
value is the right one to give both: the origin is what a *message* points at, and no
message is ever sent from a preview.

Environment variables added after the first build do not trigger a rebuild — redeploy
once, or `/api/health` keeps reporting the state from before they landed.

### 2. Apply migrations to the hosted database

Vercel deploys the app; nothing deploys the schema. This is a separate, easily
forgotten step, and the app boots fine without it — `/api/health` is what catches it,
answering `schema.applied: null` until this has run at all, and `schema.behind` above
zero until it has run to the end.

**Push migrations before merging, not after.** A migration that only adds objects is
forward-compatible — the deployed build ignores what it does not call — so applying it
early is safe, while merging first leaves production running against a database it cannot
read for as long as it takes somebody to notice.

Two workflows ask, on either side of the merge. Both read the answer with the same
script, `.github/scripts/probe-health.sh` — the five faults have five different fixes, and
two copies of that diagnosis would drift.

`.github/workflows/preview-schema.yml` is the one that **prevents** the merge. A pull
request's preview deployment is built from that branch, so it expects that branch's
migrations; and because preview and production share one Supabase project, it is asking
about the same database production uses. So `schema.behind` on a preview *is* the
unpushed-migration fault, visible before anything is merged. It reports a **Preview
schema** status against the pull request's head commit, and once the setup below is done
`main` requires it — a red *or absent* status blocks the merge rather than advising
against it. Absent matters as much as red: if no preview deploys, nothing reports, and an
unrequired check that never runs looks exactly like one that passed.

`.github/workflows/deployment-health.yml` is the one that **notices** afterwards. Every
finished production deployment gets asked, and a daily schedule asks again, which is how
drift with no deploy at all — a paused project, a rotated key, a migration applied by
hand — still surfaces.

Previews sit behind Deployment Protection and answer a redirect to SSO, so the preview
check needs a bypass secret. **Until it has one it fails, naming itself; it does not
pass.** Set it up once:

1. Vercel → the project → **Settings → Deployment Protection → Protection Bypass for
   Automation** → generate, and copy the value.
2. `gh secret set VERCEL_AUTOMATION_BYPASS_SECRET` and paste it.
3. `.github/scripts/require-checks.sh`, which is what makes `main` require the check
   rather than merely display it. It refuses to run before step 2 — a required check that
   cannot pass leaves `main` unmergeable, so the order is not optional.

If it is ever rotated on Vercel, the check goes red saying the secret is not getting past
protection — which is the intended behaviour, not a false alarm. To try a preview URL by
hand without waiting for a deployment, run the workflow from the Actions tab: it takes the
preview origin as an input.

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
the first account cannot invite itself into existence. **`/setup` is where it comes from**
— once per database, and never again
([ADR-0017](docs/adr/0017-the-first-org-admin-arrives-through-a-guarded-setup-screen.md)).

1. Set `SETUP_SECRET` on the deployment (§1) and redeploy, so the build actually has it.
2. Open `/setup`, fill in your name, email and password, and paste the secret.

That is the whole procedure. It signs you in and lands on the language choice, exactly as
an accepted invitation does. From here everyone else arrives by invitation from inside the
app, at **/admin/people**.

The screen guards itself twice: an unset `SETUP_SECRET` means **closed**, not "open with
no password", and any row at all in `users` closes it permanently. So **create
production's Org Admin through the deployed screen rather than by hand** — an account
created in the dashboard consumes the second guard forever, and the path then only ever
runs locally. Locally it reopens after every `npm run db:reset`, which is the point: the
same screen, run the same way, on a database that resets often.

`is_org_admin` gates inviting and nothing else — it grants no extra visibility, and it is
not writable through the app by anyone, including an Org Admin (see the column grants in
`20260814010000_membership_is_not_business_data.sql`). **Promoting a second admin** is an
`update` run from the Supabase dashboard, and stays one:

```sql
update users set is_org_admin = true where email = '<email>';
```

If the database somehow has no `orgs` row, `/setup` says so rather than guessing — the row
is seeded by the schema migration, so its absence means §2 has not run.

### 7. When somebody leaves

**Disable them at `/admin/people`, and never delete them.** A departing colleague owns
Tenders and entered the Quotes the comparison view is built on; deleting the row would
orphan the history the whole screen is made of. Disabling ends the Membership and leaves
every one of those rows readable.

It takes effect on their very next request rather than when a cookie expires: RLS makes a
Disabled member read nothing, including their own row, so the live session stops working
immediately, their next sign-in is refused, and they leave the Owner and Assignee pickers
and every group-robot @mention. A Tender they own still names them, marked as the former
Owner, so nothing quietly changes hands. **Restore** on the same screen puts all of it
back.

The one case the screen refuses is **Disabling the org's last remaining Administrator**,
because an org with none is one nobody can ever invite anybody into again, with no way
back inside the app (ADR-0017). Promote somebody first with the `update` in §6 — that is
still a dashboard job — and then Disable. With one Administrator, which is what a
deployment starts with, that refusal is also what stops them Disabling themselves.

Where an org does have two, either can Disable the other, and an Administrator can Disable
their own account. Doing so signs them out on their next request; the way back is the other
Administrator pressing **Restore**.

Nothing checks WeCom membership automatically, so this is a step somebody has to remember
on the day. Clearing their WeCom userid is not a substitute: it stops the @mentions and
leaves the account able to sign in.

## Before launch

Five checks need a real phone and cannot be run from CI: density and 44px tap targets at
390px, the WeCom in-app webview end to end, Android's camera, the redesign's Chinese read
by somebody fluent, and both locales read through on every screen. They are hand-checks by
decision, not by omission — density is a judgement, the webview cannot be driven
headlessly, and whether a sentence is *right* in Chinese is not a thing a test can answer.

```bash
scripts/prelaunch-phone-checks.sh
```

It walks them in order, posts a reminder into the WeCom group so the tap lands in the real
webview, and assembles the result as a comment on the tracking issue. Answers persist, so a
run stopped halfway resumes where it left off. Re-run it after any change to login, the
photo input, or the responsive layout.
